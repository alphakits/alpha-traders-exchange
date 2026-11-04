/**
 * Explicit disposable PostgreSQL proof of the v2 ledger boundary. Marketplace
 * consent inputs are canonical synthetic fixtures; no production coordinator,
 * enrolled marketplace record, provider, signer or deployment is activated.
 *
 * NODE_ENV=test node --conditions=react-server --import tsx \
 *   scripts/alpha-wallet/postgres-versioned-ledger.ts \
 *   --fresh-simulation-databases --source-connection-string <loopback fixture URL> \
 *   --target-connection-string <different empty loopback fixture URL>
 */
import { strict as assert } from "node:assert";
import { calculateTradeTermsQuote, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { MarketplaceListing, PurchaseRequest } from "../../src/types/alpha-exchange";
import { describeDevelopmentTradeTerms, planAcceptedAmountTerms } from "../../src/lib/alpha-wallet/accepted-terms";
import { assetFor, parseUnits } from "../../src/lib/alpha-wallet/amounts";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import type { FileFakeProvider } from "../../src/lib/alpha-wallet/fake-provider";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import type { State } from "../../src/lib/alpha-wallet/types";
import { acceptanceInputFromPlan, v2Command, type V2CommandOf } from "../../src/lib/alpha-wallet/v2-commands";
import { isV2State, planningBindingFor } from "../../src/lib/alpha-wallet/v2-engine";
import { exportVersionedWalletBackup, inspectVersionedWalletBackup, restoreVersionedWalletBackup } from "../../src/lib/alpha-wallet/versioned-backup";
import { createVersionedDurableWallet, upgradeDurableWalletV2, type VersionedDurableWallet } from "../../src/lib/alpha-wallet/versioned-durable";
import { createVersionedSimulationPayoutWorker } from "../../src/lib/alpha-wallet/versioned-payout-worker";
import { BUYER, DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, VERIFIER, durableFixture } from "./durable-fixtures";

const USAGE = "Pass --fresh-simulation-databases --source-connection-string <explicit loopback alpha_wallet_dev_ URL> --target-connection-string <different explicit loopback alpha_wallet_dev_ URL>. Both databases must already exist and be empty. No ambient database URL is used; this harness creates or drops no database.";
let stage = "argument validation";
const LISTING = "v2-native-listing", MAIN_TRADE = "v2-native-main", ZERO_TRADE = "v2-native-zero";
const units = (value: string) => parseUnits(value, 6);

function argumentsOf(args: string[]) {
  assert.equal(args.length, 5, USAGE);
  let fresh = false, source: string | undefined, target: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (arg === "--source-connection-string") { assert(!source && args[index + 1] && !args[index + 1].startsWith("--"), USAGE); source = args[++index]; }
    else if (arg === "--target-connection-string") { assert(!target && args[index + 1] && !args[index + 1].startsWith("--"), USAGE); target = args[++index]; }
    else assert.fail(USAGE);
  }
  assert(fresh && source && target, USAGE);
  assert.notEqual(decodeURIComponent(new URL(source).pathname), decodeURIComponent(new URL(target).pathname), "Use different fixture database names");
  return { source, target };
}

async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
    const relations = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0, "Use an empty isolated database; existing schemas are never removed");
    assert.equal(relations.rows[0]?.count, "0"); assert.equal(role.rows[0]?.permitted, true);
  });
}

async function catalog(store: WalletStore) {
  return store.transaction(async tx => ({
    namespaces: (await tx.query("SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_simulation'")).rows,
    relations: (await tx.query("SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='alpha_wallet_simulation' ORDER BY c.relname,c.relkind")).rows,
    functions: (await tx.query("SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='alpha_wallet_simulation' ORDER BY p.proname,p.oid")).rows,
    constraints: (await tx.query("SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition,k.condeferrable,k.condeferred FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='alpha_wallet_simulation' ORDER BY c.relname,k.conname")).rows,
  }));
}
async function history(store: WalletStore, maximum: number) {
  return store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
    command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands WHERE revision <= $1 ORDER BY revision`, [maximum])).rows);
}
function wrapped(store: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(make(tx))), close: async () => undefined };
}
function checkpoint(snapshot: { revision: number; eventHash: string; lastCommandAtMs: number; state: State }) {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs };
}
async function v2Snapshot(wallet: VersionedDurableWallet) {
  const snapshot = await wallet.snapshot();
  assert(isV2State(snapshot.state), "Explicit v2 continuation must exist");
  return { ...snapshot, state: snapshot.state };
}
function quote(amount: string) {
  const result = calculateTradeTermsQuote({ paymentMethod: "Bank Transfer", currency: "ILS", usdtAmount: amount,
    fiatAmount: "0.00", pricePerUsdt: "3.20", feePolicyVersion: MARKETPLACE_FEE_POLICY }, "propose_amount", amount);
  assert(result); return result;
}
function canonicalMarketplace(at: number) {
  const time = new Date(at).toISOString();
  const listing: MarketplaceListing = { id: "v2-market-listing", sellerId: SELLER.id, sellerDisplayName: "Synthetic seller", photos: [],
    originalAmount: "500", availableAmount: "500", price: "3.60", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"], bankAccountId: "v2-fixture-bank", bankTransferProvider: "israeli_bank", minimumTrade: "1",
    maximumTrade: "500", sellerDescription: "Synthetic ledger fixture", responseTime: "fixture", status: "matched", approvalStatus: "approved",
    lockedAt: time, createdAt: time, updatedAt: time };
  const requests: PurchaseRequest[] = [];
  const request = (id: string, amount: string): PurchaseRequest => {
    const record: PurchaseRequest = { id, tradeId: `${id}-trade`, listingId: listing.id, buyerId: BUYER.id, sellerId: SELLER.id,
      buyerName: "Synthetic buyer", ...quote(amount), listingPriceAtRequest: "3.20", priceMode: "listing_price", currency: "ILS", network: "TRC20",
      buyerReceivingWalletAddress: simulatedDestination(TRON, BUYER.id), paymentMethod: "Bank Transfer", sellerBankAccountId: "v2-fixture-bank",
      bankTransferProvider: "israeli_bank", bankName: "Synthetic bank", sellerBankAccountSnapshot: { accountHolderName: "Synthetic Seller",
        bankName: "Synthetic bank", branchNumber: "001", accountNumber: "00001234", accountLast4: "1234" },
      feePolicyVersion: MARKETPLACE_FEE_POLICY, commissionCalculationVersion: COMMISSION_CALCULATION_VERSION, amountAdjustmentCount: 0,
      timeline: [], messages: [], status: "accepted", createdAt: time, updatedAt: time };
    requests.push(record); return record;
  };
  return { listing, request, context: { purchaseRequests: requests, marketplaceListings: [listing], tradeEvidenceFiles: [], disputes: [] } };
}
async function enroll(wallet: VersionedDurableWallet, request: PurchaseRequest, tradeId: string) {
  const current = await v2Snapshot(wallet);
  const description = describeDevelopmentTradeTerms({ mode: "simulation-only", request, assetId: TRON, walletListingId: LISTING });
  return wallet.execute(v2Command("enrollReservedTrade", OPERATOR, `enroll-${request.id}`, { walletTradeId: tradeId,
    terms: description.terms, termsDigest: description.digest, expectedWallet: checkpoint(current), walletTradeDigest: walletDigest(current.state.trades.get(tradeId)) }));
}
async function acceptance(wallet: VersionedDurableWallet, market: ReturnType<typeof canonicalMarketplace>, request: PurchaseRequest,
  proposalId: string, amount: string, count: number, at: number, requestId: string) {
  request.amountAdjustmentCount = count; request.updatedAt = new Date(at).toISOString();
  request.termsProposal = { id: proposalId, kind: "amount_correction", status: "pending", createdAt: request.updatedAt, ...quote(amount) };
  const current = await v2Snapshot(wallet), binding = planningBindingFor(current.state, request.id);
  const plan = planAcceptedAmountTerms({ mode: "simulation-only", actorUserId: BUYER.id, requestId: request.id, proposalId,
    expectedBindingRevision: binding.revision, marketplace: market.context, wallet: current, binding });
  return v2Command("acceptAmountCorrection", BUYER, requestId, acceptanceInputFromPlan(plan));
}
function reflectAcceptance(request: PurchaseRequest, command: V2CommandOf<"acceptAmountCorrection">, at: number) {
  Object.assign(request, { usdtAmount: command.input.acceptedTerms.usdtAmount, fiatAmount: command.input.acceptedTerms.fiatAmount,
    pricePerUsdt: command.input.acceptedTerms.pricePerUsdt, updatedAt: new Date(at).toISOString() });
  assert(request.termsProposal); request.termsProposal.status = "accepted"; request.termsProposal.resolvedAt = request.updatedAt;
}

/** Deliberately overlap two old snapshots on distinct native connections. */
async function concurrentAcceptance(first: WalletStore, second: WalletStore, command: V2CommandOf<"acceptAmountCorrection">, at: number) {
  let arrivals = 0;
  let release!: () => void, reject!: (error: unknown) => void;
  const gate = new Promise<void>((yes, no) => { release = yes; reject = no; });
  // Observe failure immediately, including while both connections are opening.
  // Each participant still awaits the original promise and receives the error.
  void gate.catch(() => undefined);
  const timeout = setTimeout(() => reject(new Error("Native acceptance snapshot barrier did not fill")), 3500);
  const attempts = [0, 0], pids = [0, 0];
  function racing(store: WalletStore, index: number): WalletStore {
    return { close: async () => undefined, transaction: work => store.transaction(async tx => {
      attempts[index]++;
      const row = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,revision FROM alpha_wallet_simulation.head WHERE singleton=true")).rows[0];
      if (attempts[index] === 1) {
        pids[index] = row.pid;
        if (++arrivals === 2) { clearTimeout(timeout); release(); }
        await gate;
      }
      return work(tx);
    }) };
  }
  const commands = [command, v2Command("acceptAmountCorrection", BUYER, "native-v2-mobile-retry", command.input)];
  const pending = [first, second].map((store, index) => createVersionedDurableWallet({ mode: "simulation-only", store: racing(store, index), clock: () => at }).execute(commands[index]));
  for (const promise of pending) void promise.catch(reject);
  try {
    const results = await Promise.all(pending);
    assert.notEqual(pids[0], pids[1]); assert(attempts.some(value => value >= 2));
    assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
    assert.equal(results[0].revision, results[1].revision); assert.equal(results[0].commandKey, results[1].commandKey);
    assert.equal(results[0].eventHash, results[1].eventHash);
    return { attempts, distinctBackends: true, oneAcceptanceReceipt: true, originalRevision: results[0].revision };
  } finally { clearTimeout(timeout); release(); await Promise.allSettled(pending); }
}

async function verify(sourceUrl: string, targetUrl: string) {
  let source: WalletStore | undefined, target: WalletStore | undefined, contender: WalletStore | undefined;
  let clock = FIXTURE_TIME;
  let report: Record<string, unknown> | undefined;
  const checks: string[] = [];
  try {
    stage = "explicit fresh source and target validation";
    source = await createPostgresWalletStore({ mode: "simulation-only", connectionString: sourceUrl });
    target = await createPostgresWalletStore({ mode: "simulation-only", connectionString: targetUrl });
    await Promise.all([fresh(source), fresh(target)]);
    const emptyTarget = await catalog(target);
    await initializeDurableWallet(source);
    const oldWallet = createDurableWallet({ mode: "simulation-only", store: source, clock: () => clock });
    const fixture = durableFixture(oldWallet);
    await fixture.fundedListing("500", LISTING);
    const originalReserve = walletCommand("reserveTrade", BUYER, "native-v1-main-reserve", { id: MAIN_TRADE, listingId: LISTING,
      amount: "200", destination: simulatedDestination(TRON, BUYER.id) });
    const reserved = await oldWallet.execute(originalReserve);
    await fixture.deposit("100"); await fixture.ready();
    const withdrawal = (await fixture.command("requestWithdrawal", SELLER, { id: "v2-inherited-withdrawal", assetId: TRON,
      amount: "25", destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-v2-native" })).result;
    const originalClaim = walletCommand("beginDispatch", DISPATCHER, "native-v1-withdrawal-claim", withdrawal.id);
    const claimed = await oldWallet.execute(originalClaim); assert.equal(claimed.result.shouldDispatch, true);
    await fixture.command("recordSubmission", DISPATCHER, { payoutId: withdrawal.id, outcome: "unknown" });
    const original = await oldWallet.snapshot(), prefix = await history(source, original.revision), oldCatalog = await catalog(source);
    const priorCheckpoint = { revision: original.revision, eventHash: original.eventHash, stateHash: walletDigest(original.state), lastCommandAtMs: clock };
    clock += 1000;
    const continuation = v2Command("continueFromV1", OPERATOR, "native-explicit-v2-upgrade", { checkpoint: priorCheckpoint });

    stage = "rollback of real migration DDL before continuation append";
    let migrationObserved = false;
    const brokenUpgrade = wrapped(source, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (/INSERT INTO alpha_wallet_simulation\.commands/i.test(sql) && params?.[2] === "continueFromV1") {
        migrationObserved = Boolean((await tx.query("SELECT to_regclass('alpha_wallet_simulation.engine_continuations')::text AS name")).rows[0]?.name);
        await tx.query("SELECT 1 / 0");
      }
      return tx.query<Row>(sql, params);
    } }));
    await assert.rejects(upgradeDurableWalletV2({ mode: "simulation-only", store: brokenUpgrade, command: continuation,
      acknowledgeVersionUpgrade: true, clock: () => clock }), /division by zero/);
    assert.equal(migrationObserved, true); assert.deepEqual(await catalog(source), oldCatalog);
    assert.deepEqual(await oldWallet.snapshot(), original); assert.deepEqual(await history(source, original.revision), prefix);
    checks.push("A real SQL failure after migration DDL rolls back the complete upgrade, retaining original schema, v1 rows and balances");

    stage = "real upgrade commit with injected lost acknowledgement";
    let loseReply = true;
    const lossy: WalletStore = { close: async () => undefined, transaction: async work => {
      const result = await source!.transaction(work);
      if (loseReply) { loseReply = false; throw new CommitOutcomeUnknownError(new Error("synthetic v2 upgrade reply lost after actual commit")); }
      return result;
    } };
    await assert.rejects(upgradeDurableWalletV2({ mode: "simulation-only", store: lossy, command: continuation,
      acknowledgeVersionUpgrade: true, clock: () => clock }), CommitOutcomeUnknownError);
    const replayedUpgrade = await upgradeDurableWalletV2({ mode: "simulation-only", store: source, command: continuation,
      acknowledgeVersionUpgrade: true, clock: () => clock });
    assert.equal(replayedUpgrade.replayed, true); assert.equal(replayedUpgrade.revision, original.revision + 1);
    const wallet = createVersionedDurableWallet({ mode: "simulation-only", store: source, clock: () => clock });
    assert.deepEqual(await history(source, original.revision), prefix);
    const upgraded = await v2Snapshot(wallet);
    assert.equal(expectedCustody(upgraded.state, TRON), units("600"));
    checks.push("An explicit upgrade links one v2 continuation to the unchanged v1 prefix; a lost reply recovers that original command without another transition");

    stage = "old binary and new v1 write rejection";
    await assert.rejects(oldWallet.execute(walletCommand("pause", OPERATOR, "native-old-writer", null)));
    await assert.rejects(initializeDurableWallet(source));
    await assert.rejects(wallet.execute(walletCommand("pause", OPERATOR, "native-v1-envelope-after-upgrade", null)));
    assert.deepEqual(await wallet.snapshot(), upgraded);
    checks.push("The old v1 repository/initializer and fresh v1 envelopes fail closed after upgrade without changing the upgraded ledger");

    stage = "canonical enrollment and concurrent acceptance with distinct transport IDs";
    const market = canonicalMarketplace(clock), main = market.request("v2-market-main", "200");
    await enroll(wallet, main, MAIN_TRADE); clock += 1000;
    const increase = await acceptance(wallet, market, main, "v2-proposal-increase", "300", 1, clock, "native-v2-web-accept");
    const beforeIncrease = await v2Snapshot(wallet);
    contender = await createPostgresWalletStore({ mode: "simulation-only", connectionString: sourceUrl });
    const concurrency = await concurrentAcceptance(source, contender, increase, clock);
    reflectAcceptance(main, increase, clock);
    const increased = await v2Snapshot(wallet);
    assert.equal(increased.revision, beforeIncrease.revision + 1); assert.equal(increased.state.acceptanceReceipts.size, 1);
    assert.equal(balance(increased.state, TRON, `trade:${MAIN_TRADE}`), units("300"));
    assert.equal(balance(increased.state, TRON, `listing:${LISTING}`), units("200"));
    checks.push("Two native backends with overlapping snapshots accept one proposal once despite different transport IDs; whole-transaction retry returns one original receipt");

    stage = "decrease and settlement of the resized inherited trade";
    clock += 1000;
    const decrease = await acceptance(wallet, market, main, "v2-proposal-decrease", "150", 2, clock, "native-v2-decrease");
    await wallet.execute(decrease); reflectAcceptance(main, decrease, clock);
    const reduced = await v2Snapshot(wallet);
    assert.equal(balance(reduced.state, TRON, `trade:${MAIN_TRADE}`), units("150"));
    assert.equal(balance(reduced.state, TRON, `listing:${LISTING}`), units("350"));
    assert.equal(reduced.state.trades.get(MAIN_TRADE)?.totalFeeRaw, units("3"));
    await wallet.execute(v2Command("markBuyerPaid", BUYER, "v2-main-paid", MAIN_TRADE));
    await wallet.execute(v2Command("verifyPayment", VERIFIER, "v2-main-verified", { tradeId: MAIN_TRADE,
      evidence: { reference: "sim-v2-native-payment", amountMinor: "48480", currency: "ILS", kind: "simulated-bank-credit" } }));
    await wallet.execute(v2Command("authorizeRelease", SELLER, "v2-main-release", MAIN_TRADE));
    await wallet.execute(v2Command("reconcileAsset", VERIFIER, "v2-main-reconcile", { assetId: TRON, observedRaw: units("600").toString(), complete: true }));
    await wallet.execute(v2Command("setNativeFeeReadiness", OPERATOR, "v2-main-gas", { assetId: TRON, ready: true }));
    const outgoing = (await wallet.execute(v2Command("queueRelease", DISPATCHER, "v2-main-payout", MAIN_TRADE))).result;
    assert.equal(outgoing.amountRaw, units("150"));
    assert.equal((await wallet.execute(v2Command("beginDispatch", DISPATCHER, "v2-main-claim", outgoing.id))).result.shouldDispatch, true);
    await wallet.execute(v2Command("recordSubmission", DISPATCHER, "v2-main-broadcast", { payoutId: outgoing.id, outcome: "broadcast", transactionId: "sim-tx-v2-main" }));
    const asset = assetFor(TRON);
    await wallet.execute(v2Command("confirmPayout", VERIFIER, "v2-main-final-receipt", { payoutId: outgoing.id,
      providerReference: outgoing.providerReference, assetId: TRON, network: asset.network, token: asset.token,
      transactionId: "sim-tx-v2-main", eventIndex: 0, destination: outgoing.destination, amountRaw: outgoing.amountRaw.toString(), finalized: true, successful: true }));
    const commissionIntent = (await wallet.execute(v2Command("createDepositIntent", SELLER, "v2-fee-intent", { id: "v2-fee-funding", assetId: TRON, purpose: "commission" }))).result;
    await wallet.execute(v2Command("observeDeposit", VERIFIER, "v2-fee-final", { intentId: commissionIntent.id, assetId: TRON,
      network: asset.network, token: asset.token, transactionId: "sim-tx-v2-fees", eventIndex: 0, destination: commissionIntent.destination,
      amountRaw: units("3").toString(), blockHash: "sim-block-v2-fees", finalized: true, successful: true }));
    main.status = "completed"; main.completedAt = new Date(clock).toISOString(); market.listing.availableAmount = "350";
    checks.push("A second accepted correction releases only the 150-USDT delta; inherited settlement delivers all remaining 150 principal and recognizes separately funded 3-USDT fees");

    stage = "zero delta and historical acceptance recovery after settlement";
    await wallet.execute(v2Command("reserveTrade", BUYER, "v2-zero-reserve", { id: ZERO_TRADE, listingId: LISTING, amount: "50", destination: simulatedDestination(TRON, BUYER.id) }));
    const zeroRequest = market.request("v2-market-zero", "50"); await enroll(wallet, zeroRequest, ZERO_TRADE); clock += 1000;
    const unchanged = await acceptance(wallet, market, zeroRequest, "v2-proposal-zero", "50", 1, clock, "v2-zero-accept");
    const beforeZero = await v2Snapshot(wallet); await wallet.execute(unchanged);
    const afterZero = await v2Snapshot(wallet);
    assert.equal(afterZero.state.journal.length, beforeZero.state.journal.length);
    assert.equal(afterZero.state.acceptanceReceipts.size, 3);
    const recovered = await wallet.execute(v2Command("acceptAmountCorrection", BUYER, "v2-old-proposal-after-progress", increase.input));
    assert.equal(recovered.replayed, true); assert.equal(recovered.revision, concurrency.originalRevision);
    const oldResult = await wallet.execute(originalReserve);
    assert.equal(oldResult.replayed, true); assert.equal(oldResult.result.amountRaw, units("200")); assert.equal(oldResult.eventHash, reserved.eventHash);
    const oldDispatch = await wallet.execute(originalClaim);
    assert.equal(oldDispatch.replayed, true); assert.equal(oldDispatch.result.shouldDispatch, false); assert.equal(oldDispatch.eventHash, claimed.eventHash);
    assert.equal(oldDispatch.result.payout.providerReference, withdrawal.providerReference);
    assert.deepEqual(await wallet.snapshot(), afterZero);
    checks.push("Zero-delta acceptance appends a receipt without a journal; after later settlement, old proposal and v1 reservation/dispatch retries retain original identities and never regain dispatch authority");

    stage = "mixed-history export and final-pause rollback on native target";
    const backup = await exportVersionedWalletBackup({ mode: "simulation-only", store: source, clock: () => clock });
    const inspected = inspectVersionedWalletBackup(backup); assert.equal(inspected.formatVersion, 2);
    let finalPauseObserved = false;
    const brokenRestore = wrapped(target, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (/INSERT INTO alpha_wallet_simulation\.commands/i.test(sql) && params?.[2] === "pause") {
        finalPauseObserved = true; await tx.query("SELECT 1 / 0");
      }
      return tx.query<Row>(sql, params);
    } }));
    await assert.rejects(restoreVersionedWalletBackup({ mode: "simulation-only", store: brokenRestore, backup,
      acknowledgeFreshTarget: true, expectedChecksum: inspected.checksum, clock: () => clock }), /division by zero/);
    assert.equal(finalPauseObserved, true); assert.deepEqual(await catalog(target), emptyTarget);
    checks.push("Mixed-history backup verifies semantic replay; a real final-quarantine SQL fault rolls back the entire native restore including both schema versions and migration DDL");

    stage = "paused mixed restore, original row preservation and reconnect";
    const restored = await restoreVersionedWalletBackup({ mode: "simulation-only", store: target, backup,
      acknowledgeFreshTarget: true, expectedChecksum: inspected.checksum, clock: () => clock });
    assert.equal(restored.quarantined, true);
    assert.deepEqual(await history(target, afterZero.revision), await history(source, afterZero.revision));
    await target.close(); target = await createPostgresWalletStore({ mode: "simulation-only", connectionString: targetUrl });
    const restoredWallet = createVersionedDurableWallet({ mode: "simulation-only", store: target, clock: () => clock });
    const reopened = await v2Snapshot(restoredWallet);
    assert.equal(reopened.revision, afterZero.revision + 1); assert.equal(reopened.state.haltReason, "Operator emergency pause");
    assert.equal(reopened.eventHash, restored.restored.eventHash); assert.equal(walletDigest(reopened.state), restored.restored.stateHash);
    assert.equal(expectedCustody(reopened.state, TRON), units("453"));
    assert.equal(balance(reopened.state, TRON, `listing:${LISTING}`), units("300"));
    assert.equal(balance(reopened.state, TRON, `trade:${ZERO_TRADE}`), units("50"));
    assert.equal(balance(reopened.state, TRON, `available:${SELLER.id}`), units("75"));
    assert.equal(balance(reopened.state, TRON, `payout:${withdrawal.id}`), units("25"));
    assert.equal(balance(reopened.state, TRON, "platform-revenue"), units("3"));
    assert.equal(reopened.state.commissions.get(MAIN_TRADE)?.paid, true); assertLedgerInvariants(reopened.state);
    checks.push("A new native connection reopens the paused mixed restore with every original row/hash unchanged and 450 remaining principal plus 3 separate fee revenue conserved");

    stage = "versioned lookup-only recovery of inherited uncertain payout";
    let lookups = 0, submissions = 0;
    const provider: FileFakeProvider = { kind: "alpha-wallet-file-fake-provider", lookup: async payout => {
      lookups++; assert.equal(payout.providerReference, withdrawal.providerReference); return { status: "not_found" };
    }, submit: async () => { submissions++; throw new Error("Lookup-only native fixture cannot submit"); },
    finalize: async () => { throw new Error("No provider finalization in lookup-only fixture"); } };
    const worker = createVersionedSimulationPayoutWorker({ mode: "simulation-only", wallet: restoredWallet, provider });
    assert.equal((await worker.step(withdrawal.id)).status, "provider_lookup_required");
    assert.equal(lookups, 1); assert.equal(submissions, 0);
    assert.equal((await restoredWallet.execute(originalClaim)).result.shouldDispatch, false);
    assert.deepEqual(await restoredWallet.snapshot(), reopened);
    checks.push("The v2 worker can recover inherited uncertainty after restore using only the original provider reference; an empty lookup submits nothing and retains the 25-USDT hold");
    report = { mode: "simulation-only", storage: "Disposable native PostgreSQL v1/v2 continuation, resizing and mixed restore", checks,
      concurrency, sourceV1Checkpoint: priorCheckpoint, sourceCheckpoint: inspected.checkpoint, restoredCheckpoint: restored.restored,
      originalV1Rows: prefix.length, acceptanceReceipts: reopened.state.acceptanceReceipts.size, termsBindings: reopened.state.termsBindings.size,
      money: { initialPrincipalUSDT: "600", deliveredPrincipalUSDT: "150", remainingPrincipalUSDT: "450", listingPrincipalUSDT: "300",
        reservedTradeUSDT: "50", availablePrincipalUSDT: "75", inheritedUnknownWithdrawalUSDT: "25", separateCommissionRevenueUSDT: "3", custodyUSDT: "453",
        providerSubmissionsDuringRecovery: submissions },
      limits: ["Marketplace records here are synthetic planner inputs; no production marketplace coordinator or enrolled-writer cutover is activated.",
        "Lost upgrade acknowledgement is injected after a real commit; this is not a real network partition or custody-provider test.",
        "Final payment and chain receipts are trusted synthetic evidence; no real signer, RPC, bank verification or funds are used."] };
  } finally {
    const results = await Promise.allSettled([source?.close(), target?.close(), contender?.close()]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  assert(report); console.log(JSON.stringify(report, null, 2));
}

async function main() {
  assertSimulationRuntime("simulation-only");
  if (process.argv.slice(2).join(" ") === "--help") { console.log(USAGE); return; }
  const args = argumentsOf(process.argv.slice(2)); await verify(args.source, args.target);
}
void main().catch(() => { console.error(`Alpha Wallet versioned native fixture failed during ${stage}`); process.exitCode = 1; });
