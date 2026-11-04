// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateTradeTermsQuote, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { BUYER, DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, VERIFIER, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { describeDevelopmentTradeTerms, planAcceptedAmountTerms } from "./accepted-terms";
import { assetFor, parseUnits } from "./amounts";
import { exportWalletBackup, inspectWalletBackup, MAX_WALLET_BACKUP_BYTES } from "./backup";
import { walletDigest, walletJson } from "./commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { simulatedDestination } from "./sandbox";
import type { State } from "./types";
import { acceptanceInputFromPlan, v2Command, WALLET_V2_ENGINE_VERSION } from "./v2-commands";
import { planningBindingFor, type V2State } from "./v2-engine";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "./versioned-durable";
import { exportVersionedWalletBackup, inspectVersionedWalletBackup, restoreVersionedWalletBackup } from "./versioned-backup";

const TIMEOUT = 120_000;
const LISTING_ID = "versioned-backup-listing", TRADE_ID = "versioned-backup-trade";
const RESTORE_AT = FIXTURE_TIME + 10_000;
const V1_FIXTURE = readFileSync(new URL("./fixtures/v1/settlement-and-held-withdrawal.backup.json", import.meta.url), "utf8");
const stores: WalletStore[] = [];
let directory: string;
let mixed: Awaited<ReturnType<typeof mixedFixture>>;

function guardedRuntime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
}
beforeAll(async () => {
  guardedRuntime();
  const dataDir = await mkdtemp(join(tmpdir(), "alpha-wallet-versioned-backup-source-"));
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir });
  try { mixed = await mixedFixture(store); }
  finally {
    try { await store.close(); }
    finally { await rm(dataDir, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  }
}, TIMEOUT);
beforeEach(async () => {
  guardedRuntime();
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-versioned-backup-target-"));
});
afterEach(async () => {
  try { await Promise.allSettled(stores.splice(0).map(store => store.close())); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

async function connected(name: string, initialize = false) {
  const dataDir = join(directory, name);
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir });
  stores.push(store);
  if (initialize) await initializeDurableWallet(store);
  return { store, dataDir, wallet: createVersionedDurableWallet({ mode: "simulation-only", store, clock: () => RESTORE_AT }) };
}
function checkpoint(snapshot: { revision: number; eventHash: string; occurredAtMs: number; state: State }) {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.occurredAtMs };
}
function v2State(state: State | V2State): V2State {
  if (!("engineVersion" in state) || state.engineVersion !== WALLET_V2_ENGINE_VERSION) throw new Error("Expected fixture v2 state");
  return state;
}
async function rows(store: WalletStore) {
  return store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,
    occurred_at_ms::text AS occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
}
function wrapped(backing: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => backing.transaction(tx => work(make(tx))), close: () => backing.close() };
}
function restore(store: WalletStore, backup = mixed.serialized, at = RESTORE_AT) {
  return restoreVersionedWalletBackup({ mode: "simulation-only", store, backup, acknowledgeFreshTarget: true, clock: () => at });
}
function resign(document: Record<string, unknown>) {
  const { checksum: _checksum, ...body } = document;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}
function quote(amount: string) {
  const result = calculateTradeTermsQuote({ paymentMethod: "Bank Transfer", currency: "ILS", usdtAmount: amount,
    fiatAmount: "0.00", pricePerUsdt: "3.20", feePolicyVersion: MARKETPLACE_FEE_POLICY }, "propose_amount", amount);
  if (!result) throw new Error("Invalid synthetic terms");
  return result;
}

/** One genuine two-engine history, reused read-only by the backup fault cases. */
async function mixedFixture(store: WalletStore) {
  await initializeDurableWallet(store);
  let clock = FIXTURE_TIME;
  const v1 = createDurableWallet({ mode: "simulation-only", store, clock: () => ++clock });
  const fixture = durableFixture(v1);
  await fixture.fundedListing("500", LISTING_ID);
  const reserve = walletCommand("reserveTrade", BUYER, "versioned-backup-v1-reserve", {
    id: TRADE_ID, listingId: LISTING_ID, amount: "200", destination: simulatedDestination(TRON, BUYER.id),
  });
  await v1.execute(reserve);
  await fixture.deposit("100");
  await fixture.ready();
  const withdrawal = (await fixture.command("requestWithdrawal", SELLER, {
    id: "versioned-backup-withdrawal", assetId: TRON, amount: "25", destination: simulatedDestination(TRON, SELLER.id),
    stepUpReference: "sim-stepup-versioned-backup",
  })).result;
  const dispatch = walletCommand("beginDispatch", DISPATCHER, "versioned-backup-v1-dispatch", withdrawal.id);
  await v1.execute(dispatch);
  await fixture.command("recordSubmission", DISPATCHER, { payoutId: withdrawal.id, outcome: "unknown" });
  const prefix = await v1.snapshot();
  const prefixRows = await rows(store);
  const prefixCheckpoint = checkpoint({ ...prefix, occurredAtMs: clock });
  const continuation = v2Command("continueFromV1", OPERATOR, "versioned-backup-continue", { checkpoint: prefixCheckpoint });
  await upgradeDurableWalletV2({ mode: "simulation-only", store, command: continuation, acknowledgeVersionUpgrade: true, clock: () => ++clock });
  const wallet = createVersionedDurableWallet({ mode: "simulation-only", store, clock: () => ++clock });

  const at = new Date(FIXTURE_TIME).toISOString();
  const listing: MarketplaceListing = {
    id: "versioned-backup-platform-listing", sellerId: SELLER.id, sellerDisplayName: "Synthetic seller", photos: [],
    originalAmount: "500", availableAmount: "500", price: "3.20", currency: "ILS", network: "TRC20",
    paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer"], bankAccountId: "versioned-backup-bank",
    bankTransferProvider: "israeli_bank", bankName: "Synthetic bank", minimumTrade: "1", maximumTrade: "500",
    sellerDescription: "Backup fixture only", responseTime: "fixture", status: "matched", approvalStatus: "approved",
    activeTradeRequestId: "versioned-backup-request", lockedAt: at, createdAt: at, updatedAt: at,
  };
  const request: PurchaseRequest = {
    id: "versioned-backup-request", tradeId: "versioned-backup-platform-trade", buyerId: BUYER.id, sellerId: SELLER.id,
    listingId: listing.id, buyerName: "Synthetic buyer", ...quote("200"), listingPriceAtRequest: "3.20", priceMode: "listing_price",
    currency: "ILS", network: "TRC20", buyerReceivingWalletAddress: simulatedDestination(TRON, BUYER.id),
    paymentMethod: "Bank Transfer", bankTransferProvider: "israeli_bank", bankName: "Synthetic bank",
    sellerBankAccountId: "versioned-backup-bank",
    sellerBankAccountSnapshot: { accountHolderName: "Private fixture holder", bankName: "Synthetic bank", branchNumber: "001", accountNumber: "98765432", accountLast4: "5432" },
    feePolicyVersion: MARKETPLACE_FEE_POLICY, commissionCalculationVersion: COMMISSION_CALCULATION_VERSION,
    amountAdjustmentCount: 1, timeline: [], messages: [], status: "accepted", createdAt: at, updatedAt: at,
    termsProposal: { id: "versioned-backup-proposal", kind: "amount_correction", status: "pending", createdAt: at, ...quote("250") },
  };
  const description = describeDevelopmentTradeTerms({ mode: "simulation-only", request, assetId: TRON, walletListingId: LISTING_ID });
  const beforeEnroll = await wallet.snapshot();
  await wallet.execute(v2Command("enrollReservedTrade", OPERATOR, "versioned-backup-enroll", {
    walletTradeId: TRADE_ID, terms: description.terms, termsDigest: description.digest,
    expectedWallet: checkpoint(beforeEnroll), walletTradeDigest: walletDigest(beforeEnroll.state.trades.get(TRADE_ID)),
  }));
  const beforeResize = await wallet.snapshot();
  const binding = planningBindingFor(v2State(beforeResize.state), request.id);
  const plan = planAcceptedAmountTerms({
    mode: "simulation-only", actorUserId: BUYER.id, requestId: request.id, proposalId: request.termsProposal!.id,
    expectedBindingRevision: binding.revision, binding,
    marketplace: { purchaseRequests: [request], marketplaceListings: [listing], tradeEvidenceFiles: [], disputes: [] },
    wallet: beforeResize,
  });
  const acceptance = v2Command("acceptAmountCorrection", BUYER, "versioned-backup-resize", acceptanceInputFromPlan(plan));
  await wallet.execute(acceptance);
  await wallet.execute(v2Command("markBuyerPaid", BUYER, "versioned-backup-paid", TRADE_ID));
  const resized = (await wallet.snapshot()).state.trades.get(TRADE_ID)!;
  await wallet.execute(v2Command("verifyPayment", VERIFIER, "versioned-backup-verify", {
    tradeId: TRADE_ID, evidence: { reference: "sim-evidence-versioned-backup", amountMinor: resized.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" },
  }));
  await wallet.execute(v2Command("authorizeRelease", SELLER, "versioned-backup-authorize", TRADE_ID));
  await wallet.execute(v2Command("reconcileAsset", VERIFIER, "versioned-backup-reconcile", {
    assetId: TRON, observedRaw: expectedCustody((await wallet.snapshot()).state, TRON).toString(), complete: true,
  }));
  await wallet.execute(v2Command("setNativeFeeReadiness", OPERATOR, "versioned-backup-gas", { assetId: TRON, ready: true }));
  await wallet.execute(v2Command("queueRelease", DISPATCHER, "versioned-backup-queue", TRADE_ID));
  const queued = (await wallet.snapshot()).state;
  const payout = queued.payouts.get(queued.trades.get(TRADE_ID)!.payoutId!)!;
  await wallet.execute(v2Command("beginDispatch", DISPATCHER, "versioned-backup-trade-claim", payout.id));
  const asset = assetFor(TRON);
  await wallet.execute(v2Command("confirmPayout", VERIFIER, "versioned-backup-confirm", {
    payoutId: payout.id, providerReference: payout.providerReference, assetId: TRON, network: asset.network, token: asset.token,
    transactionId: "sim-tx-versioned-backup-trade", eventIndex: 0, destination: payout.destination, amountRaw: payout.amountRaw.toString(),
    finalized: true, successful: true,
  }));
  await wallet.execute(v2Command("createDepositIntent", SELLER, "versioned-backup-fee-intent", { id: "versioned-backup-fees", assetId: TRON, purpose: "commission" }));
  const feeIntent = (await wallet.snapshot()).state.depositIntents.get("versioned-backup-fees")!;
  await wallet.execute(v2Command("observeDeposit", VERIFIER, "versioned-backup-fee-credit", {
    intentId: feeIntent.id, assetId: TRON, network: asset.network, token: asset.token, transactionId: "sim-tx-versioned-backup-fees",
    eventIndex: 0, destination: feeIntent.destination, amountRaw: parseUnits("5", 6).toString(), blockHash: "sim-block-versioned-backup",
    finalized: true, successful: true,
  }));
  const original = await wallet.snapshot();
  const originalRows = await rows(store);
  const serialized = await exportVersionedWalletBackup({ mode: "simulation-only", store, clock: () => clock + 1 });
  return { serialized, original, originalRows, prefixRows, prefixCheckpoint, continuation, reserve, dispatch, acceptance,
    withdrawalId: withdrawal.id, platformRequestId: request.id };
}

describe("mixed-history backup and quarantined restore", () => {
  it("delegates pure v1 inspection, byte-identical export and restoration without upgrading the old format", async () => {
    expect(inspectVersionedWalletBackup(V1_FIXTURE)).toEqual(inspectWalletBackup(V1_FIXTURE));
    const empty = await connected("pure-v1", true);
    expect(await exportVersionedWalletBackup({ mode: "simulation-only", store: empty.store, clock: () => FIXTURE_TIME }))
      .toBe(await exportWalletBackup({ mode: "simulation-only", store: empty.store, clock: () => FIXTURE_TIME }));
    const target = await connected("pure-v1-restored");
    const restored = await restore(target.store, V1_FIXTURE);
    expect(restored.backup.formatVersion).toBe(1);
    const snapshot = await createDurableWallet({ mode: "simulation-only", store: target.store }).snapshot();
    expect(snapshot.revision).toBe(42);
    expect(snapshot.state.haltReason).toBe("Operator emergency pause");
    expect((await rows(target.store)).slice(0, 41)).toEqual(JSON.parse(V1_FIXTURE).commands);
    expect(await target.store.transaction(async tx => (await tx.query("SELECT format_version FROM alpha_wallet_simulation.head")).rows))
      .toEqual([{ format_version: 1 }]);
  }, TIMEOUT);

  it("preserves both original engine histories, resized terms and receipts before one v2 pause, including after reopen", async () => {
    const inspection = inspectVersionedWalletBackup(mixed.serialized);
    expect(inspection).toMatchObject({ formatVersion: 2, engineVersion: WALLET_V2_ENGINE_VERSION,
      checkpoint: checkpoint(mixed.original), continuation: { checkpoint: mixed.prefixCheckpoint,
        commandRevision: mixed.prefixCheckpoint.revision + 1 } });
    expect(mixed.serialized).not.toContain("accountNumber");
    expect(mixed.serialized).not.toContain("Private fixture holder");
    const target = await connected("mixed-restored");
    let outerTransactions = 0;
    const owned: WalletStore = { transaction: work => { outerTransactions++; return target.store.transaction(work); }, close: async () => undefined };
    const restored = await restoreVersionedWalletBackup({ mode: "simulation-only", store: owned, backup: mixed.serialized,
      acknowledgeFreshTarget: true, expectedChecksum: inspection.checksum, clock: () => RESTORE_AT });
    expect(outerTransactions).toBe(1);
    const snapshot = await target.wallet.snapshot();
    expect(snapshot.engineVersion).toBe(WALLET_V2_ENGINE_VERSION);
    expect(snapshot.revision).toBe(mixed.original.revision + 1);
    expect(snapshot.eventHash).toBe(restored.restored.eventHash);
    expect(snapshot.state.haltReason).toBe("Operator emergency pause");
    const state = v2State(snapshot.state), before = v2State(mixed.original.state);
    expect(state.termsBindings).toEqual(before.termsBindings);
    expect(state.acceptanceReceipts).toEqual(before.acceptanceReceipts);
    expect(state.trades.get(TRADE_ID)).toMatchObject({ status: "completed", amountRaw: parseUnits("250", 6), totalFeeRaw: parseUnits("5", 6) });
    expect(balance(state, TRON, "platform-revenue")).toBe(parseUnits("5", 6));
    expect(expectedCustody(state, TRON)).toBe(parseUnits("355", 6));
    expect(balance(state, TRON, `payout:${mixed.withdrawalId}`)).toBe(parseUnits("25", 6));
    const restoredRows = await rows(target.store);
    expect(restoredRows.slice(0, -1)).toEqual(mixed.originalRows);
    expect(restoredRows.slice(0, mixed.prefixRows.length)).toEqual(mixed.prefixRows);
    expect(restoredRows.at(-1)).toMatchObject({ command_type: "pause", command_key: restored.quarantineCommandKey,
      command_json: { version: 2, engineVersion: WALLET_V2_ENGINE_VERSION }, occurred_at_ms: String(RESTORE_AT), previous_event_hash: mixed.original.eventHash });
    const replayReserve = await target.wallet.execute(mixed.reserve);
    expect(walletJson(replayReserve.result)).toEqual(mixed.prefixRows.find(row => row.command_type === "reserveTrade")!.result_json);
    expect((await target.wallet.execute(mixed.dispatch)).result).toEqual({ shouldDispatch: false, payout: state.payouts.get(mixed.withdrawalId) });
    expect((await target.wallet.execute(mixed.acceptance)).replayed).toBe(true);
    await expect(target.wallet.execute(v2Command("beginDispatch", DISPATCHER, "new-claim-after-mixed-restore", mixed.withdrawalId)))
      .rejects.toThrow(/Wallet paused/);
    expect((await target.wallet.recoverPayouts()).find(item => item.payout.id === mixed.withdrawalId)).toMatchObject({ action: "lookup_original_reference" });
    expect(await target.wallet.snapshot()).toEqual(snapshot);
    assertLedgerInvariants(snapshot.state);
    await target.store.close();
    const reopened = await connected("mixed-restored");
    expect(await reopened.wallet.snapshot()).toEqual(snapshot);
  }, TIMEOUT);

  it("rejects forged manifests, continuation boundaries and recomputed-checksum history before touching a target", async () => {
    const original = JSON.parse(mixed.serialized);
    const unreachable: WalletStore = { transaction: vi.fn(async () => { throw new Error("Target must not be touched"); }), close: async () => undefined };
    const mutations: Array<(document: typeof original) => void> = [
      d => { d.formatVersion = 3; },
      d => { d.engineVersion = "alpha-wallet-simulation-v1"; },
      d => { d.mode = "production"; },
      d => { d.sql = "DROP SCHEMA alpha_wallet_simulation"; },
      d => { delete d.continuation; },
      d => { d.continuation.commandRevision++; },
      d => { d.continuation.commandKey = "forged-continuation"; },
      d => { d.continuation.checkpoint.eventHash = "a".repeat(64); },
      d => { d.continuation.checkpoint.lastCommandAtMs++; },
      d => { d.checkpoint.stateHash = "b".repeat(64); },
      d => { d.commands[0].result_json = { forged: true }; },
      d => { d.commands[0].command_json.input.id = "forged-prefix"; },
      d => {
        const row = d.commands.find((item: { command_type: string }) => item.command_type === "verifyPayment");
        row.command_json.input.evidence.amountMinor = "1";
        row.input_hash = walletDigest(row.command_json);
      },
      d => {
        const row = d.commands.find((item: { command_type: string }) => item.command_type === "acceptAmountCorrection");
        row.command_json.input.preconditions.evidenceDigest = "c".repeat(64);
        row.input_hash = walletDigest(row.command_json);
      },
      d => { d.commands[d.continuation.commandRevision - 1].command_json.input.checkpoint.revision--; },
      d => { d.commands.splice(d.continuation.commandRevision - 1, 1); },
      d => { d.commands.splice(d.continuation.commandRevision, 0, structuredClone(d.commands[d.continuation.commandRevision - 1])); },
      d => { d.commands.at(-1).command_json.version = 1; d.commands.at(-1).command_json.engineVersion = "alpha-wallet-simulation-v1"; },
      d => { d.commands.at(-1).command_json.engineVersion = "alpha-wallet-simulation-v99"; },
      d => { d.commands[0].occurred_at_ms = "9007199254740992"; },
      d => { d.commands = Array.from({ length: 1001 }, () => structuredClone(d.commands[0])); },
      d => { d.exportedAtMs = 0; },
    ];
    for (const mutate of mutations) {
      const document = structuredClone(original); mutate(document);
      const serialized = resign(document);
      expect(() => inspectVersionedWalletBackup(serialized)).toThrow();
      await expect(restore(unreachable, serialized)).rejects.toThrow();
    }
    for (const serialized of ["", mixed.serialized.slice(0, -5), " ".repeat(MAX_WALLET_BACKUP_BYTES + 1)]) {
      await expect(restore(unreachable, serialized)).rejects.toThrow();
    }
    expect(unreachable.transaction).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("honors an expected checksum and requires target acknowledgement and a valid restore clock before writes", async () => {
    const unreachable: WalletStore = { transaction: vi.fn(async () => { throw new Error("Target must not be touched"); }), close: async () => undefined };
    await expect(restoreVersionedWalletBackup({ mode: "simulation-only", store: unreachable, backup: mixed.serialized,
      acknowledgeFreshTarget: true, expectedChecksum: "f".repeat(64), clock: () => RESTORE_AT })).rejects.toThrow(/expected checksum/);
    await expect(restoreVersionedWalletBackup({ mode: "simulation-only", store: unreachable, backup: mixed.serialized,
      acknowledgeFreshTarget: false as unknown as true, clock: () => RESTORE_AT })).rejects.toThrow(/acknowledgment/);
    await expect(restore(unreachable, mixed.serialized, FIXTURE_TIME - 1)).rejects.toThrow(/clock precedes/);
    await expect(restore(unreachable, mixed.serialized, NaN)).rejects.toThrow(/Invalid backup\/restore clock/);
    vi.stubEnv("NODE_ENV", "production");
    await expect(restore(unreachable)).rejects.toThrow(/local development or test/);
    await expect(exportVersionedWalletBackup({ mode: "simulation-only", store: unreachable })).rejects.toThrow(/local development or test/);
    expect(() => inspectVersionedWalletBackup(mixed.serialized)).toThrow(/local development or test/);
    expect(unreachable.transaction).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("refuses existing history and unrelated relations without deleting or replacing their data", async () => {
    const target = await connected("existing-v1", true);
    const v1 = createDurableWallet({ mode: "simulation-only", store: target.store, clock: () => FIXTURE_TIME });
    await v1.execute(walletCommand("createDepositIntent", SELLER, "retained-existing", { id: "retained-existing", assetId: TRON, purpose: "principal" }));
    const before = await v1.snapshot(), priorRows = await rows(target.store);
    await expect(restore(target.store)).rejects.toThrow(/no committed wallet commands/);
    expect(await v1.snapshot()).toEqual(before);
    expect(await rows(target.store)).toEqual(priorRows);
    const application = await connected("application");
    await application.store.transaction(async tx => { await tx.exec("CREATE TABLE public.keep_me(value text); INSERT INTO public.keep_me VALUES ('retained')"); });
    await expect(restore(application.store)).rejects.toThrow(/fresh isolated development database/);
    expect(await application.store.transaction(async tx => ({
      namespace: (await tx.query("SELECT to_regnamespace('alpha_wallet_simulation')::text AS name")).rows,
      retained: (await tx.query("SELECT value FROM public.keep_me")).rows,
    }))).toEqual({ namespace: [{ name: null }], retained: [{ value: "retained" }] });
  }, TIMEOUT);

  it("rolls back the original history, migration DDL and v2 projections when the final pause hits a real SQL failure", async () => {
    for (const initialized of [false, true]) {
      const target = await connected(`failed-pause-${initialized}`, initialized);
      let inserted = 0, attemptedPause = false;
      const failed = wrapped(target.store, tx => ({
        exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) {
          if (/^\s*INSERT INTO alpha_wallet_simulation\.commands/i.test(sql)) {
            if (parameters?.[2] === "pause") { attemptedPause = true; await tx.query("SELECT 1 / 0"); }
            else inserted++;
          }
          return tx.query<Row>(sql, parameters);
        },
      }));
      await expect(restore(failed)).rejects.toThrow(/division by zero/i);
      expect(inserted).toBe(mixed.original.revision);
      expect(attemptedPause).toBe(true);
      const namespace = await target.store.transaction(async tx => (await tx.query("SELECT to_regnamespace('alpha_wallet_simulation')::text AS name")).rows);
      expect(namespace).toEqual([{ name: initialized ? "alpha_wallet_simulation" : null }]);
      if (initialized) {
        expect(await target.store.transaction(async tx => (await tx.query("SELECT format_version,revision FROM alpha_wallet_simulation.head")).rows))
          .toEqual([{ format_version: 1, revision: 0 }]);
        expect(await rows(target.store)).toEqual([]);
      }
    }
  }, TIMEOUT);

  it("retains the one committed quarantined restore after an injected lost acknowledgement and refuses overwrite on retry", async () => {
    const target = await connected("lost-restore-reply");
    let committed = 0;
    const lostReply: WalletStore = {
      async transaction(work) {
        await target.store.transaction(work);
        committed++;
        throw new CommitOutcomeUnknownError(new Error("Synthetic loss after real mixed restore commit"));
      }, close: async () => undefined,
    };
    await expect(restore(lostReply)).rejects.toMatchObject({ code: "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN" });
    expect(committed).toBe(1);
    await target.store.close();
    const reopened = await connected("lost-restore-reply");
    const recovered = await reopened.wallet.snapshot();
    expect(recovered.revision).toBe(mixed.original.revision + 1);
    expect(recovered.state.haltReason).toBe("Operator emergency pause");
    expect((await rows(reopened.store)).slice(0, -1)).toEqual(mixed.originalRows);
    await expect(restore(reopened.store)).rejects.toThrow();
    expect(await reopened.wallet.snapshot()).toEqual(recovered);
    expect((await reopened.wallet.execute(mixed.dispatch)).result).toEqual({ shouldDispatch: false,
      payout: recovered.state.payouts.get(mixed.withdrawalId) });
  }, TIMEOUT);

  it("refuses export when new immutable projections disagree with the verified mixed history", async () => {
    const target = await connected("projection-check");
    await restore(target.store);
    let intercepted = false;
    const inconsistent = wrapped(target.store, tx => ({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) {
        const result = await tx.query<Row>(sql, parameters);
        if (/FROM alpha_wallet_simulation\.acceptance_receipts\b/i.test(sql)) { intercepted = true; return { rows: [] as Row[] }; }
        return result;
      },
    }));
    await expect(exportVersionedWalletBackup({ mode: "simulation-only", store: inconsistent, clock: () => RESTORE_AT })).rejects.toThrow(/disagree|projection/i);
    expect(intercepted).toBe(true);
    expect(v2State((await target.wallet.snapshot()).state).acceptanceReceipts.size).toBe(1);
  }, TIMEOUT);
});
