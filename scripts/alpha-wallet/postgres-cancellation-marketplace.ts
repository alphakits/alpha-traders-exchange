/** Stored web/mobile cancellation, real principal return and native races.
 * Every database, credential, address and unit of money is a synthetic fixture.
 * No production URL, route, chain, signer or external notification is contacted.
 */
import { strict as assert } from "node:assert";
import { Client } from "pg";
import { createDevelopmentCancellationMarketplaceWalletCoordinator,
  createDevelopmentMobileCancellationMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/cancellation-marketplace-coordinator";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/initial-marketplace-coordinator";
import { exportInitialMarketplaceWalletBackup } from "../../src/lib/alpha-wallet/initial-marketplace-backup";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createV4DurableWallet, verifyV4History } from "../../src/lib/alpha-wallet/v4-durable";
import { isV4State } from "../../src/lib/alpha-wallet/v4-engine";
import type { PurchaseRequest } from "../../src/types/alpha-exchange";
import { buildInitialMarketplaceFixture } from "./initial-marketplace-fixtures";

const MODE = "simulation-only" as const;
const SCHEMA = "alpha_wallet_cancellation_marketplace_simulation";
const ORIGINAL = "alpha_wallet_initial_marketplace_simulation";
const USAGE = "Use --fresh-simulation-databases and three distinct already-created empty loopback alpha_wallet_dev_ databases via --atomic-connection-string, --race-connection-string and --auth-connection-string. No environment database URL is read; no database is created or dropped.";
type Fixture = Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
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
const owner = (f: Fixture) => ({ sessionToken: f.ownerSessionToken, requestId: f.requestId });
const upgrade = (f: Fixture, operationId = "native-cancel-upgrade") => ({ ...owner(f), operationId, acknowledgeVersionUpgrade: true as const });
const cancellation = (f: Fixture, operationId = "native-cancel-request") => ({ sessionToken: f.sellerSessionToken, requestId: f.requestId, operationId });
const mobileCancellation = (f: Fixture, operationId = "native-cancel-mobile-retry") => ({ ...f.mobile.credentials[f.sellerId], requestId: f.requestId, operationId });
const web = (store: WalletStore, f: Fixture, clock = () => f.acceptedAtMs + 1000) =>
  createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store, clock });
const mobile = (store: WalletStore, f: Fixture) =>
  createDevelopmentMobileCancellationMarketplaceWalletCoordinator({ mode: MODE, store, clock: () => f.acceptedAtMs + 1000 });
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
    timer = setTimeout(() => reject(new Error(`Native cancellation timeout: ${label}`)), 15_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function observeWait(client: Client, pid: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = (await client.query<{ wait_event_type: string | null }>("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
    if (row?.wait_event_type === "Lock") return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail("Expected a visible PostgreSQL lock wait on the distinct backend");
}
async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    assert.equal((await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'")).rows.length, 0);
    assert.equal((await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')")).rows[0]?.count, "0");
    assert.equal((await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user")).rows[0]?.permitted, true);
    assert(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"].includes((await tx.query<{ timezone: string }>("SELECT current_setting('TimeZone') AS timezone")).rows[0].timezone));
  });
}
async function setup(store: WalletStore, method: "Bank Transfer" | "Face-to-Face", upgraded = true) {
  const f = (await buildInitialMarketplaceFixture(store, { paymentMethod: method, tradeProjection: "pending" })).canonical;
  const initial = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock: () => f.acceptedAtMs });
  await initial.activateRequest({ ...owner(f), operationId: "native-cancel-original-activate", walletListingId: f.walletListingId,
    walletTradeId: f.walletTradeId, assetId: f.assetId });
  await initial.acceptRequest({ sessionToken: f.sellerSessionToken, requestId: f.requestId, operationId: "native-cancel-original-accept",
    ...(method === "Face-to-Face" ? { safetyAcknowledged: true as const } : {}) });
  if (upgraded) await web(store, f, () => f.acceptedAtMs + 10).upgradeRequest(upgrade(f));
  return f;
}
async function footprint(store: WalletStore) {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const snapshot = verifyV4History(commands);
    const canonical: Record<string, Row[]> = {};
    for (const table of ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"]) {
      canonical[table] = (await tx.query<{ row: Row }>(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    }
    const predecessor: Record<string, Row[]> = {};
    for (const table of ["activations", "acceptances", "publications"]) predecessor[table] = (await tx.query(
      `SELECT * FROM ${ORIGINAL}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    const present = (await tx.query<{ present: boolean }>("SELECT to_regnamespace($1) IS NOT NULL AS present", [SCHEMA])).rows[0].present;
    const coordination: Record<string, Row[]> = {};
    if (present) for (const table of ["transitions", "cancellations", "publications"]) coordination[table] = (await tx.query(
      `SELECT * FROM ${SCHEMA}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    return { commands, snapshot, canonical, predecessor, present, coordination };
  });
}
type Footprint = Awaited<ReturnType<typeof footprint>>;
function assertCancelled(after: Footprint, before: Footprint, f: Fixture) {
  assert(isV4State(after.snapshot.state));
  assert.equal(after.commands.length, before.commands.length + 1);
  assert.deepEqual(after.commands.slice(0, -1), before.commands);
  assert.equal(after.commands.at(-1)?.command_type, "cancelInitialTrade");
  assert.deepEqual(after.predecessor, before.predecessor);
  assert.deepEqual(after.coordination.transitions, before.coordination.transitions);
  assert.equal(after.coordination.cancellations.length, 1); assert.equal(after.coordination.publications.length, 1);
  assert.equal(balance(after.snapshot.state, f.assetId, `listing:${f.walletListingId}`), BigInt(500_000_000));
  assert.equal(balance(after.snapshot.state, f.assetId, `trade:${f.walletTradeId}`), BigInt(0));
  assert.equal(expectedCustody(after.snapshot.state, f.assetId), BigInt(500_000_000));
  assert.equal(after.snapshot.state.payouts.size, 0); assert.equal(after.snapshot.state.initialCancellationReceipts.size, 1);
  const oldRequest = before.canonical.purchase_requests.find(row => row.id === f.requestId)!;
  const request = after.canonical.purchase_requests.find(row => row.id === f.requestId)!;
  const payload = request.payload as PurchaseRequest, previous = oldRequest.payload as PurchaseRequest;
  assert.equal(request.status, "cancelled"); assert.equal(payload.usdtAmount, previous.usdtAmount);
  assert.equal(payload.pricePerUsdt, previous.pricePerUsdt); assert.equal(payload.fiatAmount, previous.fiatAmount);
  assert.equal(payload.tradeCreatedAt, previous.tradeCreatedAt); assert.deepEqual(payload.timeline.slice(0, -1), previous.timeline);
  assert.equal(payload.timeline.at(-1)?.actorUserId, f.sellerId);
  const listing = after.canonical.listings.find(row => row.id === f.listingId)!;
  assert.equal(listing.status, "active"); assert.equal(listing.active_trade_request_id, null);
  assert.equal((listing.payload as Row).availableAmount, "500");
  assert.equal(after.canonical.trades[0].status, "cancelled");
  assert.equal(after.canonical.trades[0].created_at, before.canonical.trades[0].created_at);
  assert.equal(after.canonical.notifications.length, before.canonical.notifications.length + 2);
  assert.equal(after.canonical.audit_logs.length, before.canonical.audit_logs.length + 1);
}
function withoutAuthority(value: Footprint) {
  return { ...value, canonical: Object.fromEntries(Object.entries(value.canonical).filter(([name]) => !["users", "runtime_meta"].includes(name))) };
}

async function main() {
  assertSimulationRuntime(MODE);
  const urls = argumentsOf(process.argv.slice(2));
  const stores = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([key, url]) =>
    [key, await createPostgresWalletStore({ mode: MODE, connectionString: url })]))) as Record<keyof typeof urls, WalletStore>;
  const checks: string[] = [];
  const clients: Client[] = [];
  try {
    stage = "fresh database validation";
    for (const store of Object.values(stores)) await fresh(store);
    stage = "atomic owner cutover";
    const f = await setup(stores.atomic, "Face-to-Face", false);
    const original = await footprint(stores.atomic);
    await assert.rejects(web(stores.atomic, f).upgradeRequest({ ...upgrade(f), sessionToken: f.sellerSessionToken }));
    assert.deepEqual(await footprint(stores.atomic), original);
    checks.push("An actual stored seller cannot perform the explicit owner profile upgrade; original accepted state remains exact");
    let migrationFault = false;
    const brokenUpgrade = wrapped(stores.atomic, tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.includes(`${SCHEMA}.transitions`) && /INSERT INTO/i.test(sql)) { migrationFault = true; await tx.query("SELECT 1 / 0 /* cancellation cutover rollback */"); }
      return tx.query<Row>(sql, values);
    } }));
    await assert.rejects(web(brokenUpgrade, f).upgradeRequest(upgrade(f, "cutover-failure")));
    assert(migrationFault); assert.deepEqual(await footprint(stores.atomic), original);
    checks.push("Failure after actual successor and V4 migration work rolls back the new namespace and continuation, preserving the original cohort");
    const continuation = await web(stores.atomic, f, () => f.acceptedAtMs + 10).upgradeRequest(upgrade(f));
    const before = await footprint(stores.atomic);
    assert.deepEqual(before.commands.slice(0, -1), original.commands); assert.deepEqual(before.predecessor, original.predecessor);
    assert.equal(continuation.sourceRevision, original.snapshot.revision);
    checks.push("Owner-authenticated cutover appends one V4 continuation and preserves original activation, acceptance, publication and full command history");
    stage = "late cancellation rollback";
    let fault = false;
    const broken = wrapped(stores.atomic, tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.includes(`${SCHEMA}.publications`) && /INSERT INTO/i.test(sql)) { fault = true; await tx.query("SELECT 1 / 0 /* cancellation late publication rollback */"); }
      return tx.query<Row>(sql, values);
    } }));
    await assert.rejects(web(broken, f).cancelRequest(cancellation(f, "late-failure")));
    assert(fault); assert.deepEqual(await footprint(stores.atomic), before);
    checks.push("Late SQL failure rolls back the actual principal return, canonical cancellation, notifications, audit and both financial/coordinated receipts");
    stage = "unknown commit outcome";
    let lost = true;
    const uncertain: WalletStore = { async transaction(work) {
      const result = await stores.atomic.transaction(work);
      if (lost) { lost = false; throw new CommitOutcomeUnknownError(new Error("Synthetic cancellation response loss after actual COMMIT")); }
      return result;
    }, close: async () => undefined };
    await assert.rejects(web(uncertain, f).cancelRequest(cancellation(f)), error => error instanceof CommitOutcomeUnknownError);
    const committed = await footprint(stores.atomic); assertCancelled(committed, before, f);
    const receipt = await mobile(stores.atomic, f).cancelRequest(mobileCancellation(f));
    assert.equal(receipt.replayed, true); assert.equal(receipt.walletRevision, committed.snapshot.revision);
    assert.deepEqual(await footprint(stores.atomic), committed);
    checks.push("A real committed cancellation returns exactly 200 USDT once and valid mobile authority recovers its original web result after a lost reply");
    stage = "original writer fences";
    await assert.rejects(createV4DurableWallet({ mode: MODE, store: stores.atomic }).snapshot());
    await assert.rejects(exportInitialMarketplaceWalletBackup({ mode: MODE, store: stores.atomic, ...owner(f), clock: () => f.acceptedAtMs + 1000 }));
    await assert.rejects(stores.atomic.transaction(tx => tx.query(`UPDATE ${ORIGINAL}.acceptances SET input_digest=repeat('0',64)`)));
    await assert.rejects(stores.atomic.transaction(tx => tx.query(`UPDATE ${SCHEMA}.cancellations SET input_digest=repeat('0',64)`)));
    await assert.rejects(stores.atomic.transaction(tx => tx.query(`DELETE FROM ${SCHEMA}.publications`)));
    assert.deepEqual(await footprint(stores.atomic), committed);
    checks.push("Old standalone/recovery paths and direct original or successor receipt/publication mutations fail closed");
    stage = "paused receipt recovery and privacy";
    await web(stores.atomic, f).pause({ ...owner(f), operationId: "native-cancel-final-pause" });
    const paused = await footprint(stores.atomic);
    assert.deepEqual(await mobile(stores.atomic, f).cancelRequest(mobileCancellation(f, "paused-mobile-retry")), receipt);
    const safe = JSON.stringify({ receipt, inspect: await web(stores.atomic, f).inspect(owner(f)), publications: paused.coordination.publications });
    for (const privateText of [f.ownerSessionToken, f.sellerSessionToken, "passwordHash", "accountNumber", "sim://", "canonicalBasis"]) assert(!safe.includes(privateText));
    assert.deepEqual(await footprint(stores.atomic), paused);
    checks.push("Current mobile authority recovers the original cancellation after pause; public inspection and publication omit credentials and private bank/destination data");
    await stores.atomic.close();
    stores.atomic = await createPostgresWalletStore({ mode: MODE, connectionString: urls.atomic });
    assert.deepEqual(await footprint(stores.atomic), paused);
    checks.push("A newly opened PostgreSQL connection reconstructs the exact paused canonical and financial cancellation state");

    stage = "competing stored transports and legacy payment writer";
    const raceFixture = await setup(stores.race, "Bank Transfer"); const raceBefore = await footprint(stores.race);
    const firstHeld = deferred(), release = deferred(), secondStarted = deferred();
    let firstPid = 0, secondPid = 0, attempts = 0, held = false;
    const first = wrapped(stores.race, tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      const result = await tx.query<Row>(sql, values);
      if (!held && sql.includes(`${SCHEMA}.cancellations`) && /INSERT INTO/i.test(sql)) {
        held = true; firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        firstHeld.resolve(); await bounded(release.promise, "held cancellation release");
      }
      return result;
    } }));
    const second: WalletStore = { transaction: work => stores.race.transaction(async tx => {
      attempts++; secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      return work({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (sql.includes("pg_advisory_xact_lock(61422919")) secondStarted.resolve();
        return tx.query<Row>(sql, values);
      } });
    }), close: async () => undefined };
    const observer = new Client({ connectionString: urls.race }); clients.push(observer); await observer.connect();
    const legacy = new Client({ connectionString: urls.race }); clients.push(legacy); await legacy.connect();
    const legacyPid = (await legacy.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const firstWork = web(first, raceFixture).cancelRequest(cancellation(raceFixture, "race-first"));
    void firstWork.catch(() => undefined);
    await bounded(firstHeld.promise, "first cancellation receipt");
    const secondWork = mobile(second, raceFixture).cancelRequest(mobileCancellation(raceFixture, "race-second"));
    void secondWork.catch(() => undefined);
    let legacyRefused = false;
    await legacy.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await legacy.query("SET LOCAL alpha_wallet.development_schema='simulation-only'");
    const legacyWork = legacy.query("UPDATE alpha_exchange.purchase_requests SET status='payment_sent',payload=jsonb_set(payload,'{status}','\"payment_sent\"'::jsonb) WHERE id=$1", [raceFixture.requestId])
      .then(() => { throw new Error("Unsupported legacy payment writer unexpectedly succeeded"); }, () => { legacyRefused = true; });
    try {
      await bounded(secondStarted.promise, "second cancellation started");
      assert.notEqual(firstPid, secondPid); assert.notEqual(firstPid, legacyPid);
      await observeWait(observer, secondPid); await observeWait(observer, legacyPid);
    } finally { release.resolve(); }
    const [winner, retry] = await bounded(Promise.all([firstWork, secondWork]), "competing cancellation results");
    await bounded(legacyWork, "legacy writer refusal"); await legacy.query("ROLLBACK");
    assert(legacyRefused); assert(attempts >= 2); assert.equal(winner.replayed, false);
    assert.deepEqual(retry, { ...winner, replayed: true });
    const raceAfter = await footprint(stores.race); assertCancelled(raceAfter, raceBefore, raceFixture);
    checks.push("Distinct visibly waiting web/mobile backends retry the entire decision and commit one principal return, one canonical cancellation and one publication");
    checks.push("A legacy payment writer visibly waits behind cancellation and then refuses without changing the committed cancellation");
    await web(stores.race, raceFixture).pause({ ...owner(raceFixture), operationId: "race-final-pause" });

    stage = "account revocation winning before cancellation";
    const authFixture = await setup(stores.auth, "Face-to-Face"); const authBefore = await footprint(stores.auth);
    const revoker = new Client({ connectionString: urls.auth }); clients.push(revoker); await revoker.connect();
    const authObserver = new Client({ connectionString: urls.auth }); clients.push(authObserver); await authObserver.connect();
    const revokedPid = (await revoker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await revoker.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await revoker.query("SET LOCAL alpha_wallet.development_schema='simulation-only'");
    await revoker.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true'::jsonb) WHERE id=$1", [authFixture.sellerId]);
    const authStarted = deferred(); let authPid = 0, authAttempts = 0;
    const stale: WalletStore = { transaction: work => stores.auth.transaction(async tx => {
      authAttempts++; authPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      return work({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (sql.includes("FROM alpha_exchange.runtime_meta") && /FOR UPDATE/i.test(sql)) authStarted.resolve();
        return tx.query<Row>(sql, values);
      } });
    }), close: async () => undefined };
    const staleWork = web(stale, authFixture).cancelRequest(cancellation(authFixture, "revoked-stale-cancellation"));
    void staleWork.catch(() => undefined);
    try { await bounded(authStarted.promise, "revocation waiter"); assert.notEqual(authPid, revokedPid); await observeWait(authObserver, authPid); }
    finally { await revoker.query("COMMIT"); }
    await assert.rejects(bounded(staleWork, "revoked cancellation refusal"));
    assert(authAttempts >= 2);
    assert.deepEqual(withoutAuthority(await footprint(stores.auth)), withoutAuthority(authBefore));
    checks.push("A prior account revocation wins on a distinct backend; stale cancellation retries with current authority and returns no principal");
    await assert.rejects(mobile(stores.auth, authFixture).cancelRequest(mobileCancellation(authFixture, "disabled-mobile-cancel")));
    assert.deepEqual(withoutAuthority(await footprint(stores.auth)), withoutAuthority(authBefore));
    checks.push("The same disabled stored account cannot bypass refusal through the mobile credential entry point");
    await web(stores.auth, authFixture).pause({ ...owner(authFixture), operationId: "auth-final-pause" });
    assertSimulationRuntime(MODE);
    console.log(JSON.stringify({ mode: MODE, scope: "Authenticated initial cancellation successor with stored web/mobile authority and exact principal return", result: "passed", checks,
      atomic: { returnedPrincipalRaw: receipt.principalRaw, listingAvailableRaw: receipt.listingAvailableAfterRaw,
        cancellationCount: committed.coordination.cancellations.length, publicationCount: committed.coordination.publications.length,
        originalHistoryPreserved: true, lostCommitReplyRecovered: true, sourcePaused: true },
      concurrency: { cancellation: { distinctBackends: firstPid !== secondPid, lockWaitObserved: true, secondAttempts: attempts,
        committedPrincipalReturns: raceAfter.coordination.cancellations.length, legacyPaymentWriterRefused: legacyRefused },
        revocation: { distinctBackends: authPid !== revokedPid, lockWaitObserved: true, attempts: authAttempts, financialReturns: 0 } },
      providerSubmissions: 0, externalDeliveries: 0, productionWrites: 0,
      limits: ["All credentials, database records and funds are synthetic development fixtures.",
        "Acknowledgement loss is injected after an actual COMMIT, not an actual network partition.",
        "New connection replay is not a process restart or production failover.",
        "The separately executed successor combined recovery drill supplies backup/restore evidence."] }, null, 2));
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
