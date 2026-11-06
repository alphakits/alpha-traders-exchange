/** Native stored-buyer payment claims and dispute freezes in disposable databases.
 * All credentials, evidence bytes, addresses and balances are synthetic fixtures.
 * No production endpoint, environment database URL, signer or delivery is used.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { exportCancellationMarketplaceWalletBackup } from "../../src/lib/alpha-wallet/cancellation-marketplace-backup";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { createDevelopmentPaymentMarketplaceWalletCoordinator,
  createDevelopmentMobilePaymentMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/payment-marketplace-coordinator";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createV4DurableWallet } from "../../src/lib/alpha-wallet/v4-durable";
import { verifyV5History } from "../../src/lib/alpha-wallet/v5-durable";
import { isV5State } from "../../src/lib/alpha-wallet/v5-engine";
import type { PurchaseRequest } from "../../src/types/alpha-exchange";
import { buildPaymentMarketplaceFixture, PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE,
  PAYMENT_MARKETPLACE_SYNTHETIC_REASON } from "./payment-marketplace-fixtures";

const MODE = "simulation-only" as const;
const SCHEMA = "alpha_wallet_payment_marketplace_simulation";
const INITIAL = "alpha_wallet_initial_marketplace_simulation", CANCELLATION = "alpha_wallet_cancellation_marketplace_simulation";
const USAGE = "Use --fresh-simulation-databases and three distinct already-created empty loopback alpha_wallet_dev_ databases via --atomic-connection-string, --race-connection-string and --auth-connection-string. No environment database URL is read; no database is created or dropped.";
type Fixture = Awaited<ReturnType<typeof buildPaymentMarketplaceFixture>>;
type Row = Record<string, unknown>;
let stage = "argument validation";
function argumentsOf(args: string[]) {
  assert.equal(args.length, 7, USAGE);
  const values = new Map<string, string>(); let fresh = false;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (["--atomic-connection-string", "--race-connection-string", "--auth-connection-string"].includes(name)) {
      assert(!values.has(name) && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
      values.set(name, args[++index]);
    } else assert.fail(USAGE);
  }
  assert(fresh && values.size === 3, USAGE);
  assert.equal(new Set([...values.values()].map(value => decodeURIComponent(new URL(value).pathname))).size, 3, USAGE);
  return { atomic: values.get("--atomic-connection-string")!, race: values.get("--race-connection-string")!, auth: values.get("--auth-connection-string")! };
}
const upgrade = (f: Fixture, operationId = "native-payment-upgrade") => ({ ...f.ownerInput, operationId,
  acknowledgeVersionUpgrade: true as const, acknowledgePaymentClaimOnlyProfile: true as const });
const claim = (f: Fixture, operationId = "native-payment-claim") => ({ ...f.buyerInput, operationId,
  ...(f.evidence ? { evidence: f.evidence } : {}) });
const mobileClaim = (f: Fixture, operationId = "native-mobile-payment-claim") => ({ ...f.mobileBuyerInput, operationId,
  ...(f.evidence ? { evidence: f.evidence } : {}) });
const dispute = (f: Fixture, operationId = "native-payment-dispute") => ({ ...f.buyerInput, operationId, reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON });
const mobileDispute = (f: Fixture, operationId = "native-mobile-payment-dispute") => ({ ...f.mobileBuyerInput, operationId, reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON });
const web = (store: WalletStore, f: Fixture) => createDevelopmentPaymentMarketplaceWalletCoordinator({ mode: MODE, store, clock: f.clock });
const mobile = (store: WalletStore, f: Fixture) => createDevelopmentMobilePaymentMarketplaceWalletCoordinator({ mode: MODE, store, clock: f.clock });
const wrapped = (store: WalletStore, transform: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(transform(tx))), close: async () => undefined,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Native payment timeout: ${label}`)), 15_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function observeWait(client: Client, pid: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = (await client.query<{ wait_event_type: string | null }>("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
    if (row?.wait_event_type === "Lock") return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail("Expected an observed PostgreSQL lock wait on the distinct backend");
}
async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    assert.equal((await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'")).rows.length, 0);
    assert.equal((await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')")).rows[0]?.count, "0");
    assert.equal((await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user")).rows[0]?.permitted, true);
    assert(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"].includes((await tx.query<{ timezone: string }>("SELECT current_setting('TimeZone') AS timezone")).rows[0].timezone));
  });
}
async function footprint(store: WalletStore) {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const snapshot = verifyV5History(commands), canonical: Record<string, Row[]> = {};
    for (const table of ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"]) {
      canonical[table] = (await tx.query<{ row: Row }>(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    }
    const predecessor: Record<string, Row[]> = {};
    for (const [namespace, tables] of [[INITIAL, ["activations", "acceptances", "publications"]],
      [CANCELLATION, ["transitions", "cancellations", "publications"]]] as const) {
      for (const table of tables) predecessor[`${namespace}.${table}`] = (await tx.query(
        `SELECT * FROM ${namespace}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    }
    const present = (await tx.query<{ present: boolean }>("SELECT to_regnamespace($1) IS NOT NULL AS present", [SCHEMA])).rows[0].present;
    const coordination: Record<string, Row[]> = {};
    if (present) for (const table of ["transitions", "claims", "dispute_freezes", "publications"]) coordination[table] = (await tx.query(
      `SELECT * FROM ${SCHEMA}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    return { commands, snapshot, canonical, predecessor, present, coordination };
  });
}
type Footprint = Awaited<ReturnType<typeof footprint>>;
function assertPrincipalPreserved(before: Footprint, after: Footprint, f: Fixture) {
  for (const key of ["accounts", "journal", "payouts", "commissions", "evidenceOwners", "deposits", "listings"] as const) {
    assert.deepEqual(after.snapshot.state[key], before.snapshot.state[key], `Unchanged financial ${key}`);
  }
  assert.equal(expectedCustody(after.snapshot.state, f.canonical.assetId), expectedCustody(before.snapshot.state, f.canonical.assetId));
  assert.equal(balance(after.snapshot.state, f.canonical.assetId, `trade:${f.canonical.walletTradeId}`), balance(before.snapshot.state, f.canonical.assetId, `trade:${f.canonical.walletTradeId}`));
  assert.equal(balance(after.snapshot.state, f.canonical.assetId, `listing:${f.canonical.walletListingId}`), balance(before.snapshot.state, f.canonical.assetId, `listing:${f.canonical.walletListingId}`));
  assert.equal(after.snapshot.state.trades.get(f.canonical.walletTradeId)?.evidence, undefined);
  assert.equal(after.snapshot.state.trades.get(f.canonical.walletTradeId)?.authorization, undefined);
  assert.deepEqual(after.predecessor, before.predecessor);
}
function assertClaimed(before: Footprint, after: Footprint, f: Fixture) {
  assert(isV5State(after.snapshot.state)); assertPrincipalPreserved(before, after, f);
  assert.equal(after.commands.length, before.commands.length + 1); assert.deepEqual(after.commands.slice(0, -1), before.commands);
  assert.equal(after.commands.at(-1)?.command_type, "claimInitialPayment");
  assert.deepEqual(after.coordination.transitions, before.coordination.transitions);
  assert.equal(after.coordination.claims.length, 1); assert.equal(after.coordination.dispute_freezes.length, 0); assert.equal(after.coordination.publications.length, 1);
  assert.equal(after.snapshot.state.initialPaymentClaimReceipts.size, 1); assert.equal(after.snapshot.state.initialDisputeFreezeReceipts.size, 0);
  const request = after.canonical.purchase_requests.find(row => row.id === f.canonical.requestId)!;
  const prior = before.canonical.purchase_requests.find(row => row.id === f.canonical.requestId)!;
  const payload = request.payload as PurchaseRequest, previous = prior.payload as PurchaseRequest;
  assert.equal(request.status, "payment_sent"); assert.equal(payload.status, "payment_sent");
  for (const key of ["usdtAmount", "fiatAmount", "pricePerUsdt", "buyerReceivingWalletAddress", "sellerBankAccountSnapshot", "tradeCreatedAt"] as const) assert.deepEqual(payload[key], previous[key]);
  assert.equal(payload.fundsReceivedAt, undefined); assert.equal(payload.trustReconciliation, undefined);
  assert.equal(after.canonical.trades[0].status, "payment_sent"); assert.equal(after.canonical.trades[0].created_at, before.canonical.trades[0].created_at);
  const listing = after.canonical.listings.find(row => row.id === f.canonical.listingId)!;
  assert.equal(listing.status, "in_trade"); assert.equal(listing.active_trade_request_id, f.canonical.requestId);
  assert.equal((listing.payload as Row).availableAmount, "500");
  assert.equal(after.canonical.notifications.length, before.canonical.notifications.length + 1);
  assert.equal(after.canonical.audit_logs.length, before.canonical.audit_logs.length + 1);
  assert.equal(after.canonical.evidence.length, 1);
  const content = Buffer.from(PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE.contentBase64, "base64");
  assert.equal(after.canonical.evidence[0].content, `\\x${content.toString("hex")}`);
  assert.equal(after.canonical.evidence[0].size_bytes, content.length);
  const financial = [...after.snapshot.state.initialPaymentClaimReceipts.values()][0];
  assert.equal(financial.input.claim.proof?.contentSha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(financial.input.claim.proof?.evidenceId, payload.buyerEvidence?.id);
}
function assertDisputed(before: Footprint, after: Footprint, f: Fixture) {
  assert(isV5State(after.snapshot.state)); assertPrincipalPreserved(before, after, f);
  assert.equal(after.commands.length, before.commands.length + 1); assert.deepEqual(after.commands.slice(0, -1), before.commands);
  assert.equal(after.commands.at(-1)?.command_type, "freezeInitialDispute");
  assert.deepEqual(after.coordination.claims, before.coordination.claims); assert.deepEqual(after.coordination.transitions, before.coordination.transitions);
  assert.equal(after.coordination.dispute_freezes.length, 1); assert.equal(after.coordination.publications.length, 2);
  assert.equal(after.snapshot.state.initialDisputeFreezeReceipts.size, 1);
  assert.deepEqual(after.canonical.evidence, before.canonical.evidence); assert.deepEqual(after.canonical.listings, before.canonical.listings);
  assert.equal(after.canonical.disputes.length, 1);
  const opened = after.canonical.disputes[0].payload as Row;
  assert.equal(opened.reason, PAYMENT_MARKETPLACE_SYNTHETIC_REASON); assert.equal(opened.openedByUserId, f.canonical.buyerId);
  assert.equal(opened.buyerEvidenceId, before.canonical.evidence[0].id); assert.equal(opened.status, "open");
  const request = after.canonical.purchase_requests.find(row => row.id === f.canonical.requestId)!.payload as PurchaseRequest;
  const prior = before.canonical.purchase_requests.find(row => row.id === f.canonical.requestId)!.payload as PurchaseRequest;
  assert.equal(request.status, "payment_sent"); assert.equal(request.paymentSentAt, prior.paymentSentAt);
  assert.equal(request.trustReconciliation, undefined); assert.equal(request.timeline.at(-1)?.type, "dispute_opened");
  assert.equal(after.snapshot.state.trades.get(f.canonical.walletTradeId)?.disputed, true);
  assert.equal(after.canonical.notifications.length, before.canonical.notifications.length + 2);
  assert.equal(after.canonical.audit_logs.length, before.canonical.audit_logs.length + 1);
}
function withoutAuthority(value: Footprint) {
  return { ...value, canonical: Object.fromEntries(Object.entries(value.canonical).filter(([name]) => !["users", "runtime_meta"].includes(name))) };
}
function loseOneReplyAfterCommit(store: WalletStore): WalletStore {
  let lost = true;
  return { async transaction(work) {
    const result = await store.transaction(work);
    if (lost) { lost = false; throw new CommitOutcomeUnknownError(new Error("Synthetic payment response loss after actual COMMIT")); }
    return result;
  }, close: async () => undefined };
}

async function main() {
  assertSimulationRuntime(MODE);
  const urls = argumentsOf(process.argv.slice(2));
  const stores = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([key, url]) =>
    [key, await createPostgresWalletStore({ mode: MODE, connectionString: url })]))) as Record<keyof typeof urls, WalletStore>;
  const checks: string[] = [], clients: Client[] = [];
  try {
    stage = "fresh database validation";
    for (const store of Object.values(stores)) await fresh(store);
    stage = "explicit owner cutover";
    const f = await buildPaymentMarketplaceFixture(stores.atomic, { upgrade: false });
    const original = await footprint(stores.atomic);
    await assert.rejects(web(stores.atomic, f).upgradeRequest({ ...upgrade(f), sessionToken: f.canonical.sellerSessionToken }));
    const { acknowledgePaymentClaimOnlyProfile: _scopeAcknowledgement, ...withoutScopeAcknowledgement } = upgrade(f);
    const { acknowledgeVersionUpgrade: _versionAcknowledgement, ...withoutVersionAcknowledgement } = upgrade(f);
    await assert.rejects(web(stores.atomic, f).upgradeRequest(withoutScopeAcknowledgement as never));
    await assert.rejects(web(stores.atomic, f).upgradeRequest(withoutVersionAcknowledgement as never));
    assert.deepEqual(await footprint(stores.atomic), original);
    checks.push("The stored seller cannot enroll the payment-only profile; owner authority and both explicit acknowledgements remain required");
    let migrationFault = false;
    const brokenUpgrade = wrapped(stores.atomic, tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.includes(`${SCHEMA}.transitions`) && /INSERT INTO/i.test(sql)) {
        migrationFault = true; await tx.query("SELECT 1 / 0 /* native payment cutover rollback */");
      }
      return tx.query<Row>(sql, values);
    } }));
    await assert.rejects(web(brokenUpgrade, f).upgradeRequest(upgrade(f, "failed-native-payment-upgrade")));
    assert(migrationFault); assert.deepEqual(await footprint(stores.atomic), original);
    checks.push("Actual SQL failure after V5 migration work rolls back successor schema and continuation, preserving both original profiles");
    const continuation = await web(stores.atomic, f).upgradeRequest(upgrade(f)); f.advanceTime();
    const before = await footprint(stores.atomic);
    assert.deepEqual(before.commands.slice(0, -1), original.commands); assert.deepEqual(before.predecessor, original.predecessor);
    assert.equal(continuation.sourceRevision, original.snapshot.revision); assert.equal(continuation.newCancellationSupported, false);
    checks.push("Current owner enrollment appends one source-bound V5 continuation with original initial acceptance and V4 cancellation histories unchanged");

    stage = "late claim SQL rollback";
    let claimFault = false;
    const brokenClaim = wrapped(stores.atomic, tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.includes(`${SCHEMA}.publications`) && /INSERT INTO/i.test(sql)) {
        claimFault = true; await tx.query("SELECT 1 / 0 /* native payment late claim rollback */");
      }
      return tx.query<Row>(sql, values);
    } }));
    await assert.rejects(web(brokenClaim, f).claimPayment(claim(f, "late-claim-failure")));
    assert(claimFault); assert.deepEqual(await footprint(stores.atomic), before);
    checks.push("Late claim SQL failure rolls back evidence bytes, request/listing/trade changes, notices, audit and both receipts without account or journal movement");
    stage = "claim lost committed reply";
    await assert.rejects(web(loseOneReplyAfterCommit(stores.atomic), f).claimPayment(claim(f)), error => error instanceof CommitOutcomeUnknownError);
    const claimed = await footprint(stores.atomic); assertClaimed(before, claimed, f);
    const claimReceipt = await mobile(stores.atomic, f).claimPayment(mobileClaim(f));
    assert.equal(claimReceipt.replayed, true); assert.equal(claimReceipt.walletRevision, claimed.snapshot.revision);
    assert.equal(claimReceipt.transferAmountRaw, "0"); assert.equal(claimReceipt.paymentVerified, false); assert.equal(claimReceipt.releaseAuthorized, false);
    assert.deepEqual(await footprint(stores.atomic), claimed);
    checks.push("An actual committed Bank claim persists exact content-bound bytea once; current mobile authority recovers the original web receipt after reply loss");

    f.advanceTime(); stage = "late dispute SQL rollback";
    let disputeFault = false;
    const brokenDispute = wrapped(stores.atomic, tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.includes(`${SCHEMA}.publications`) && /INSERT INTO/i.test(sql)) {
        disputeFault = true; await tx.query("SELECT 1 / 0 /* native payment late dispute rollback */");
      }
      return tx.query<Row>(sql, values);
    } }));
    await assert.rejects(web(brokenDispute, f).openDispute(dispute(f, "late-dispute-failure")));
    assert(disputeFault); assert.deepEqual(await footprint(stores.atomic), claimed);
    checks.push("Late dispute SQL failure rolls back the open-dispute row, freeze, timeline, notices, audit and both receipts while preserving the original claim and bytes");
    stage = "dispute lost committed reply";
    await assert.rejects(mobile(loseOneReplyAfterCommit(stores.atomic), f).openDispute(mobileDispute(f)), error => error instanceof CommitOutcomeUnknownError);
    const disputed = await footprint(stores.atomic); assertDisputed(claimed, disputed, f);
    const disputeReceipt = await web(stores.atomic, f).openDispute(dispute(f, "recover-committed-mobile-dispute"));
    assert.equal(disputeReceipt.replayed, true); assert.equal(disputeReceipt.walletRevision, disputed.snapshot.revision);
    assert.equal(disputeReceipt.claimKey, claimReceipt.claimKey); assert.equal(disputeReceipt.transferAmountRaw, "0");
    assert.deepEqual(await footprint(stores.atomic), disputed);
    checks.push("An actual committed buyer dispute keeps the same full principal and exact evidence held, and web authority recovers its original mobile receipt after reply loss");

    stage = "old-profile and direct-writer fences";
    await assert.rejects(f.predecessor.coordinator.cancelRequest({ ...f.sellerInput, operationId: "forbidden-old-cancellation" }));
    await assert.rejects(createV4DurableWallet({ mode: MODE, store: stores.atomic }).snapshot());
    await assert.rejects(exportCancellationMarketplaceWalletBackup({ mode: MODE, store: stores.atomic, ...f.ownerInput, clock: f.clock }));
    for (const statement of [
      `UPDATE ${INITIAL}.acceptances SET input_digest=repeat('0',64)`,
      `UPDATE ${CANCELLATION}.transitions SET input_digest=repeat('0',64)`,
      `UPDATE ${SCHEMA}.claims SET input_digest=repeat('0',64)`, `DELETE FROM ${SCHEMA}.publications`,
      "UPDATE alpha_exchange.purchase_requests SET status='funds_received' WHERE id=$1",
      "UPDATE alpha_exchange.trades SET status='completed' WHERE purchase_request_id=$1",
      "UPDATE alpha_exchange.listings SET status='active',active_trade_request_id=NULL WHERE active_trade_request_id=$1",
      "UPDATE alpha_exchange.evidence SET content=decode('255044462d','hex') WHERE purchase_request_id=$1",
      "DELETE FROM alpha_exchange.evidence WHERE purchase_request_id=$1",
      `UPDATE ${INITIAL}.acceptances SET input_digest=input_digest WHERE false`,
      "UPDATE alpha_exchange.disputes SET status='resolved' WHERE purchase_request_id=$1",
    ]) await assert.rejects(stores.atomic.transaction(tx => tx.query(statement, statement.includes("$1") ? [f.canonical.requestId] : undefined)));
    assert.deepEqual(await footprint(stores.atomic), disputed);
    checks.push("Old cancellation and recovery entry points plus direct canonical, evidence, dispute and retained receipt writers are fenced, including an empty predecessor statement");
    stage = "paused cross-transport receipt recovery";
    f.advanceTime(); await web(stores.atomic, f).pause({ ...f.ownerInput, operationId: "native-payment-final-pause" });
    const paused = await footprint(stores.atomic);
    assert.deepEqual(await web(stores.atomic, f).claimPayment(claim(f, "paused-web-claim")), claimReceipt);
    assert.deepEqual(await mobile(stores.atomic, f).openDispute(mobileDispute(f, "paused-mobile-dispute")), disputeReceipt);
    const safe = JSON.stringify({ claimReceipt, disputeReceipt, inspect: await web(stores.atomic, f).inspect(f.ownerInput), publications: paused.coordination.publications });
    for (const secret of [PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE.contentBase64, PAYMENT_MARKETPLACE_SYNTHETIC_REASON,
      "buyer-payment-evidence.png", "accountNumber", "passwordHash", f.canonical.buyerSessionToken, "sim://", "canonicalBasis"]) assert(!safe.includes(secret));
    assert.deepEqual(await footprint(stores.atomic), paused);
    checks.push("Paused valid web/mobile retries recover both immutable receipts without exposing private reason, proof bytes, filename, credentials or bank information");
    await stores.atomic.close(); stores.atomic = await createPostgresWalletStore({ mode: MODE, connectionString: urls.atomic });
    assert.deepEqual(await footprint(stores.atomic), paused);
    checks.push("A new PostgreSQL connection reconstructs the exact paused financial, evidence and dispute state");

    stage = "competing buyer claim transports and legacy writer";
    const r = await buildPaymentMarketplaceFixture(stores.race, { paymentMethod: "Bank Transfer", assetId: "bsc-sim-binance-peg-usdt" });
    const raceBefore = await footprint(stores.race);
    const firstHeld = deferred(), release = deferred(), secondStarted = deferred(), thirdStarted = deferred();
    let firstPid = 0, secondPid = 0, thirdPid = 0, secondAttempts = 0, thirdAttempts = 0, held = false, distinctClaimBackends = false;
    const first = wrapped(stores.race, tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      const result = await tx.query<Row>(sql, values);
      if (!held && sql.includes(`${SCHEMA}.claims`) && /INSERT INTO/i.test(sql)) {
        held = true; firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        firstHeld.resolve(); await bounded(release.promise, "held payment claim release");
      }
      return result;
    } }));
    function contender(which: "same" | "different"): WalletStore {
      return { transaction: work => stores.race.transaction(async tx => {
        const pid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        if (which === "same") { secondAttempts++; secondPid = pid; } else { thirdAttempts++; thirdPid = pid; }
        return work({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          if (sql.includes("pg_advisory_xact_lock(61422919")) (which === "same" ? secondStarted : thirdStarted).resolve();
          return tx.query<Row>(sql, values);
        } });
      }), close: async () => undefined };
    }
    const observer = new Client({ connectionString: urls.race }); clients.push(observer); await observer.connect();
    const legacy = new Client({ connectionString: urls.race }); clients.push(legacy); await legacy.connect();
    const legacyPid = (await legacy.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const firstWork = web(first, r).claimPayment(claim(r, "race-first-claim")); void firstWork.catch(() => undefined);
    await bounded(firstHeld.promise, "first held claim receipt");
    const secondWork = mobile(contender("same"), r).claimPayment(mobileClaim(r, "race-same-mobile")); void secondWork.catch(() => undefined);
    const changedProof = { mimeType: "application/pdf" as const, contentBase64: Buffer.from("%PDF-1.7\nDifferent synthetic claim\n%%EOF").toString("base64") };
    const thirdWork = web(contender("different"), r).claimPayment({ ...claim(r, "race-different-proof"), evidence: changedProof }); void thirdWork.catch(() => undefined);
    let legacyRefused = false;
    await legacy.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await legacy.query("SET LOCAL alpha_wallet.development_schema='simulation-only'");
    const legacyWork = legacy.query("UPDATE alpha_exchange.purchase_requests SET status='funds_received',payload=jsonb_set(payload,'{status}','\"funds_received\"'::jsonb) WHERE id=$1", [r.canonical.requestId])
      .then(() => { throw new Error("Legacy payment writer unexpectedly succeeded"); }, () => { legacyRefused = true; });
    try {
      await bounded(Promise.all([secondStarted.promise, thirdStarted.promise]), "claim contenders started");
      distinctClaimBackends = new Set([firstPid, secondPid, thirdPid, legacyPid]).size === 4;
      assert(distinctClaimBackends);
      await Promise.all([observeWait(observer, secondPid), observeWait(observer, thirdPid), observeWait(observer, legacyPid)]);
    } finally { release.resolve(); }
    const [winner, retry] = await bounded(Promise.all([firstWork, secondWork]), "same-content competing claim results");
    await assert.rejects(bounded(thirdWork, "changed-content competing claim refusal"), (error: unknown) =>
      Boolean(error && typeof error === "object" && "code" in error && error.code === "STALE"));
    await bounded(legacyWork, "legacy writer refusal"); await legacy.query("ROLLBACK");
    assert(legacyRefused); assert(secondAttempts >= 2); assert(thirdAttempts >= 2);
    assert.equal(winner.replayed, false); assert.deepEqual(retry, { ...winner, replayed: true });
    const raceAfter = await footprint(stores.race); assertClaimed(raceBefore, raceAfter, r);
    checks.push("Distinct observed waiting web/mobile BSC backends retry the whole decision and persist one payment claim, one exact evidence object and one publication");
    checks.push("A third observed waiting buyer claim retries with its changed proof and fails STALE instead of receiving the original evidence receipt");
    checks.push("The distinct legacy funds-received writer visibly waits behind the buyer claim, then refuses without changing its committed hold");
    r.advanceTime(); await web(stores.race, r).pause({ ...r.ownerInput, operationId: "native-race-final-pause" });

    stage = "stored buyer revocation winning before claim";
    const a = await buildPaymentMarketplaceFixture(stores.auth, { paymentMethod: "Face-to-Face" });
    const authBefore = await footprint(stores.auth);
    const revoker = new Client({ connectionString: urls.auth }); clients.push(revoker); await revoker.connect();
    const authObserver = new Client({ connectionString: urls.auth }); clients.push(authObserver); await authObserver.connect();
    const revokerPid = (await revoker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await revoker.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await revoker.query("SET LOCAL alpha_wallet.development_schema='simulation-only'");
    await revoker.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true'::jsonb) WHERE id=$1", [a.canonical.buyerId]);
    const authStarted = deferred(); let authPid = 0, authAttempts = 0;
    const stale: WalletStore = { transaction: work => stores.auth.transaction(async tx => {
      authAttempts++; authPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      return work({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (sql.includes("FROM alpha_exchange.runtime_meta") && /FOR UPDATE/i.test(sql)) authStarted.resolve();
        return tx.query<Row>(sql, values);
      } });
    }), close: async () => undefined };
    const staleWork = web(stale, a).claimPayment(claim(a, "revoked-stale-buyer-claim")); void staleWork.catch(() => undefined);
    try { await bounded(authStarted.promise, "revoked buyer waiter"); assert.notEqual(authPid, revokerPid); await observeWait(authObserver, authPid); }
    finally { await revoker.query("COMMIT"); }
    await assert.rejects(bounded(staleWork, "revoked buyer refusal")); assert(authAttempts >= 2);
    assert.deepEqual(withoutAuthority(await footprint(stores.auth)), withoutAuthority(authBefore));
    checks.push("A prior stored buyer revocation wins on a distinct observed waiting backend; the stale whole decision retries and records no claim or money movement");
    await assert.rejects(mobile(stores.auth, a).claimPayment(mobileClaim(a, "disabled-mobile-claim")));
    assert.deepEqual(withoutAuthority(await footprint(stores.auth)), withoutAuthority(authBefore));
    checks.push("The disabled buyer cannot bypass the same current-account refusal through mobile credentials");
    a.advanceTime(); await web(stores.auth, a).pause({ ...a.ownerInput, operationId: "native-auth-final-pause" });
    assertSimulationRuntime(MODE);
    console.log(JSON.stringify({ mode: MODE, scope: "Authenticated initial payment claims and dispute freezes with exact private evidence and zero principal movement",
      result: "passed", checks,
      atomic: { principalRaw: claimReceipt.principalRaw, transferAmountRaw: "0", claimCount: disputed.coordination.claims.length,
        disputeCount: disputed.coordination.dispute_freezes.length, publicationCount: disputed.coordination.publications.length,
        exactEvidenceBytes: true, accountsAndJournalUnchanged: true, originalHistoryPreserved: true,
        claimLostCommitReplyRecovered: true, disputeLostCommitReplyRecovered: true, sourcePaused: true },
      concurrency: { claims: { distinctBackends: distinctClaimBackends,
        lockWaitObserved: true, sameContentAttempts: secondAttempts, differentContentAttempts: thirdAttempts,
        committedClaims: raceAfter.coordination.claims.length, evidenceObjects: raceAfter.canonical.evidence.length,
        changedContentRefused: true, legacyPaymentWriterRefused: legacyRefused, assetId: r.canonical.assetId },
        revocation: { distinctBackends: authPid !== revokerPid, lockWaitObserved: true, attempts: authAttempts, claims: 0 } },
      providerSubmissions: 0, externalDeliveries: 0, productionWrites: 0,
      limits: ["All credentials, evidence, addresses, records and funds are synthetic development fixtures.",
        "Reply loss is injected after an actual COMMIT, not an actual network partition.",
        "A fresh database connection is not a process restart or production failover.",
        "The separately executed payment combined recovery drill supplies backup/restore evidence.",
        "No fiat verification, dispute resolution, cancellation after enrollment or release authority is enabled."] }, null, 2));
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    for (const store of Object.values(stores)) await store.close().catch(() => undefined);
  }
}
main().catch(error => {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  console.error(JSON.stringify({ result: "failed", stage, error: error instanceof Error ? error.message : "Unknown failure", code }));
  process.exitCode = 1;
});
