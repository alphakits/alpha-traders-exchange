/**
 * Canonical prepayment cancellation groundwork on disposable native PostgreSQL.
 * The wallet companion is an independently authorized synthetic operator pause.
 * It proves shared transaction mechanics, not authenticated financial cancellation.
 */
import { strict as assert } from "node:assert";
import { Client } from "pg";
import { mutateDevelopmentInitialAcceptanceInTransaction, withDevelopmentPrepaymentCancellationInTransaction,
  type DevelopmentPrepaymentCancellationDecision } from "../../src/lib/alpha-exchange-repository";
import { createInitialAcceptanceFixture } from "../../src/lib/alpha-wallet/initial-acceptance-fixture";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { parseUnits } from "../../src/lib/alpha-wallet/amounts";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import type { AlphaExchangeNotification, PurchaseRequest } from "../../src/types/alpha-exchange";
import { FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "./durable-fixtures";

const MODE = "simulation-only" as const;
const USAGE = "Pass --fresh-simulation-databases --atomic-connection-string <explicit loopback alpha_wallet_dev_ URL> --race-connection-string <different empty loopback alpha_wallet_dev_ URL>. No environment database URL is read; no database is created or dropped.";
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records",
  "evidence", "disputes", "notifications", "audit_logs"] as const;
type Fixture = Awaited<ReturnType<typeof createInitialAcceptanceFixture>>;
type Row = Record<string, unknown>;
let stage = "argument validation";
function argumentsOf(args: string[]) {
  assert.equal(args.length, 5, USAGE);
  assert.equal(args.filter(value => value === "--fresh-simulation-databases").length, 1, USAGE);
  const value = (flag: string) => {
    assert.equal(args.filter(item => item === flag).length, 1, USAGE);
    const result = args[args.indexOf(flag) + 1]; assert(result && !result.startsWith("--"), USAGE); return result;
  };
  const atomic = value("--atomic-connection-string"), race = value("--race-connection-string");
  assert.notEqual(new URL(atomic).pathname, new URL(race).pathname, "Use two distinct disposable fixture databases");
  return { atomic, race };
}
function boundWallet(tx: WalletSql) {
  return createDurableWallet({ mode: MODE, clock: () => FIXTURE_TIME + 2000,
    store: { transaction: work => work(tx), close: async () => undefined } });
}
function decision(fixture: Fixture, actorUserId = fixture.sellerId): DevelopmentPrepaymentCancellationDecision {
  return { requestId: fixture.requestId, tradeId: fixture.tradeId, actorUserId, cancelledAtMs: fixture.acceptedAtMs + 1000 };
}
async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
    const relations = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    const roles = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0, "Existing schemas are never removed"); assert.equal(relations.rows[0]?.count, "0");
    assert.equal(roles.rows[0]?.permitted, true, "Disposable fixture requires BYPASSRLS");
  });
}
async function setup(store: WalletStore, method: "Bank Transfer" | "Face-to-Face") {
  await fresh(store); await initializeDurableWallet(store);
  const fixture = await store.transaction(tx => createInitialAcceptanceFixture({ mode: MODE, tx, paymentMethod: method, tradeProjection: "pending" }));
  const wallet = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", fixture.listingId);
  // Current-schema synthetic acceptance only; no coordinated namespace or old
  // initial guards are installed, disabled, dropped or bypassed in this fixture.
  await store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => ({
    requestId: fixture.requestId, tradeId: fixture.tradeId, actorUserId: fixture.sellerId, acceptedAtMs: fixture.acceptedAtMs,
    ...(method === "Face-to-Face" ? { safetyAcknowledged: true as const } : {}),
  })));
  return fixture;
}
async function pause(tx: WalletSql, operationId: string) {
  return boundWallet(tx).execute(walletCommand("pause", OPERATOR, operationId, null));
}
async function cancel(tx: WalletSql, fixture: Fixture, operationId: string, actorUserId = fixture.sellerId) {
  const backend = (await tx.query<{ pid: number; xid: string }>("SELECT pg_backend_pid() AS pid,txid_current()::text AS xid")).rows[0];
  return withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
    await pause(tx, operationId);
    const result = await participant.cancel(decision(fixture, actorUserId));
    assert.deepEqual((await tx.query<{ pid: number; xid: string }>("SELECT pg_backend_pid() AS pid,txid_current()::text AS xid")).rows[0], backend);
    return result;
  });
}
async function footprint(store: WalletStore) {
  return store.transaction(async tx => {
    const marketplace: Record<string, Row[]> = {};
    for (const table of TABLES) marketplace[table] = (await tx.query(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(item => item.row as Row);
    const commands = (await tx.query("SELECT revision,command_type,command_key,event_hash,result_hash,state_hash FROM alpha_wallet_simulation.commands ORDER BY revision")).rows;
    return { marketplace, commands, wallet: await boundWallet(tx).snapshot() };
  });
}
type Footprint = Awaited<ReturnType<typeof footprint>>;
function assertCancelled(after: Footprint, before: Footprint, fixture: Fixture) {
  const oldRequest = before.marketplace.purchase_requests.find(row => row.id === fixture.requestId)!;
  const request = after.marketplace.purchase_requests.find(row => row.id === fixture.requestId)!;
  const payload = request.payload as PurchaseRequest, oldPayload = oldRequest.payload as PurchaseRequest;
  const listing = after.marketplace.listings.find(row => row.id === fixture.listingId)!;
  const oldListing = before.marketplace.listings.find(row => row.id === fixture.listingId)!;
  assert.equal(request.status, "cancelled"); assert.equal(request.trade_id, fixture.tradeId);
  assert.equal(request.created_at, oldRequest.created_at); assert.equal(request.sort_index, oldRequest.sort_index);
  assert.equal(payload.tradeCreatedAt, oldPayload.tradeCreatedAt);
  assert.equal(payload.usdtAmount, oldPayload.usdtAmount); assert.equal(payload.pricePerUsdt, oldPayload.pricePerUsdt); assert.equal(payload.fiatAmount, oldPayload.fiatAmount);
  assert.deepEqual(payload.timeline.slice(0, -1), oldPayload.timeline);
  assert.equal(payload.timeline.at(-1)?.type, "request_cancelled"); assert.equal(payload.closedAt, undefined);
  assert.deepEqual(payload.trustReconciliation, { requestedAt: payload.updatedAt, requestedByUserId: fixture.sellerId });
  assert.equal(listing.status, "active"); assert.equal(listing.active_trade_request_id, null); assert.equal(listing.sort_index, oldListing.sort_index);
  assert.equal((listing.payload as Fixture["initialListing"]).availableAmount, "500");
  assert.equal(after.marketplace.trades.length, 1);
  const trade = after.marketplace.trades[0], oldTrade = before.marketplace.trades[0];
  assert.equal(trade.status, "cancelled"); assert.equal(trade.id, fixture.tradeId); assert.equal(trade.purchase_request_id, fixture.requestId);
  assert.equal(trade.created_at, oldTrade.created_at); assert.equal(trade.sort_index, oldTrade.sort_index); assert.equal(trade.completed_at, null);
  assert.deepEqual((trade.payload as Row).timeline, payload.timeline);
  assert.equal(after.marketplace.notifications.length, before.marketplace.notifications.length + 2);
  assert.equal(after.marketplace.audit_logs.length, before.marketplace.audit_logs.length + 1);
  for (const table of ["users", "commissions", "marketplace_enforcement_records", "evidence", "disputes"] as const) assert.deepEqual(after.marketplace[table], before.marketplace[table]);
  assert.deepEqual(after.marketplace.purchase_requests.filter(row => row.id !== fixture.requestId), before.marketplace.purchase_requests.filter(row => row.id !== fixture.requestId));
  assert.deepEqual(after.marketplace.listings.filter(row => row.id !== fixture.listingId), before.marketplace.listings.filter(row => row.id !== fixture.listingId));
  assert.equal(BigInt(String(after.marketplace.runtime_meta[0].version)), BigInt(String(before.marketplace.runtime_meta[0].version)) + BigInt(1));
  assert.equal(after.wallet.revision, before.wallet.revision + 1); assert.equal(after.commands.at(-1)?.command_type, "pause");
  assert.equal(Boolean(after.wallet.state.haltReason), true); assert.equal(after.wallet.state.trades.size, 0, "No wallet-backed sale or refund is fabricated");
  assert.equal(after.wallet.state.payouts.size, 0); assert.equal(expectedCustody(after.wallet.state, TRON), parseUnits("500", 6));
  assert.equal(balance(after.wallet.state, TRON, `listing:${fixture.listingId}`), parseUnits("500", 6)); assertLedgerInvariants(after.wallet.state);
}
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 10_000);
  })]); } finally { clearTimeout(timer); }
}
async function waitForAdvisoryWait(observer: WalletStore, pid: number) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const row = await observer.transaction(tx => tx.query<{ waiting: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting", [pid]));
    if (row.rows[0].waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Native advisory lock wait was not observed");
}
async function staleBankDisclosure(observer: WalletStore, writerStore: WalletStore, contenderStore: WalletStore, fixture: Fixture) {
  const held = deferred(), release = deferred(), started = deferred();
  const before = await footprint(observer); let writerPid = 0, contenderPid = 0, attempts = 0;
  const observed: string[] = [];
  const writer = writerStore.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(61422917)");
    writerPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [fixture.requestId])).rows[0].payload;
    const at = new Date(fixture.acceptedAtMs + 500).toISOString();
    const next = { ...request, sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: at, updatedAt: at };
    const trade = { id: request.tradeId, purchaseRequestId: request.id, listingId: request.listingId, sellerId: request.sellerId, buyerId: request.buyerId,
      status: request.status, createdAt: request.tradeCreatedAt, updatedAt: at, timeline: request.timeline };
    await tx.query("UPDATE alpha_exchange.purchase_requests SET updated_at=$2::timestamptz,payload=$3::jsonb WHERE id=$1", [request.id, at, JSON.stringify(next)]);
    await tx.query("UPDATE alpha_exchange.trades SET updated_at=$2::timestamptz,payload=$3::jsonb WHERE id=$1", [request.tradeId, at, JSON.stringify(trade)]);
    await tx.query("UPDATE alpha_exchange.runtime_meta SET version=version+1,updated_at=now() WHERE singleton=true");
    held.resolve(); await bounded(release.promise, "bank-disclosure writer release");
  });
  void writer.catch(error => held.reject(error)); await bounded(held.promise, "bank-disclosure writer lock");
  const contender = contenderStore.transaction(async tx => {
    attempts++;
    contenderPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].pid;
    if (attempts === 1) started.resolve();
    return withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
      const request = participant.marketplace.purchaseRequests.find(row => row.id === fixture.requestId)!;
      observed.push(request.sensitivePaymentKind ?? "missing");
      await pause(tx, "native-cancellation-stale-buyer");
      return participant.cancel(decision(fixture, fixture.buyerId));
    });
  });
  const outcome = contender.then(() => ({ error: undefined }), error => ({ error }));
  void contender.catch(error => started.reject(error)); let failure: unknown;
  try {
    await bounded(started.promise, "stale cancellation snapshot"); assert.notEqual(writerPid, contenderPid);
    await waitForAdvisoryWait(observer, contenderPid); release.resolve(); await writer;
    failure = (await bounded(outcome, "buyer cancellation refusal")).error;
  } finally { release.resolve(); await Promise.allSettled([writer, contender]); }
  assert(failure instanceof Error); assert.match(failure.message, /bank details/); assert(attempts >= 2);
  assert.deepEqual(observed, ["bank_details"]);
  const after = await footprint(observer); assert.deepEqual(after.wallet, before.wallet); assert.deepEqual(after.commands, before.commands);
  for (const table of ["listings", "notifications", "audit_logs"] as const) assert.deepEqual(after.marketplace[table], before.marketplace[table]);
  assert.equal(after.marketplace.purchase_requests.find(row => row.id === fixture.requestId)?.status, "accepted");
  return { attempts, distinctBackends: true, advisoryWaitObserved: true, bankDisclosureRechecked: true, buyerCancellationRefused: true };
}
async function competingCancellations(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore, fixture: Fixture) {
  const before = await footprint(observer), held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0;
  const first = firstStore.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    return withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
      await pause(tx, "native-cancellation-winner"); held.resolve(); await bounded(release.promise, "winning cancellation release");
      return participant.cancel(decision(fixture));
    });
  });
  void first.catch(error => held.reject(error)); await bounded(held.promise, "winning cancellation lock");
  const second = secondStore.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].pid;
    if (secondAttempts === 1) started.resolve();
    return cancel(tx, fixture, "native-cancellation-loser");
  });
  const outcome = second.then(() => ({ error: undefined }), error => ({ error }));
  void second.catch(error => started.reject(error));
  try {
    await bounded(started.promise, "second cancellation snapshot"); assert.notEqual(firstPid, secondPid);
    await waitForAdvisoryWait(observer, secondPid); release.resolve(); await first;
    const error = (await bounded(outcome, "second cancellation refusal")).error;
    assert(error instanceof Error); assert.match(error.message, /no idempotent receipt/);
  } finally { release.resolve(); await Promise.allSettled([first, second]); }
  assert(secondAttempts >= 2); const after = await footprint(observer); assertCancelled(after, before, fixture);
  assert.equal(after.commands.length, before.commands.length + 1);
  return { secondAttempts, distinctBackends: true, advisoryWaitObserved: true, committedCanonicalCancellations: 1, newWalletCommands: 1, financialReturns: 0 };
}

/** Deliberate raw transaction replacement is fixture fault injection only. */
async function replacementTransactionRemainsUntouched(connectionString: string, fixture: Fixture) {
  const client = new Client({ connectionString }); await client.connect();
  const tx: WalletSql = { query: async (sql, values) => ({ rows: (await client.query(sql, values)).rows }),
    exec: async sql => { await client.query(sql); } };
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await client.query("SET LOCAL alpha_wallet.development_schema='simulation-only'");
    await assert.rejects(withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
      await client.query("ROLLBACK");
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await client.query("SET LOCAL alpha_wallet.development_schema='simulation-only'");
      return participant.cancel(decision(fixture));
    }), /original writable SERIALIZABLE/);
    assert.equal((await client.query("SELECT 1 AS intact")).rows[0].intact, 1, "A replacement transaction must not be poisoned by the old participant");
  } finally { try { await client.query("ROLLBACK"); } finally { await client.end(); } }
}

async function verify(connections: ReturnType<typeof argumentsOf>) {
  let atomic: WalletStore | undefined, races: WalletStore | undefined, writer: WalletStore | undefined, contender: WalletStore | undefined;
  const checks: string[] = []; let report: Record<string, unknown> | undefined;
  try {
    stage = "fresh native databases and current-schema synthetic acceptance";
    atomic = await createPostgresWalletStore({ mode: MODE, connectionString: connections.atomic });
    const fixture = await setup(atomic, "Face-to-Face");
    await atomic.transaction(async tx => {
      const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [fixture.requestId])).rows[0].payload;
      const at = new Date(fixture.acceptedAtMs).toISOString();
      request.termsProposal = { id: "native-cancellation-proposal", kind: "amount_correction", status: "pending", pricePerUsdt: "3.20", usdtAmount: "250", fiatAmount: "808.00", createdAt: at };
      request.actionReminderState = { stage: "accepted", actionStartedAt: at,
        buyer: { userId: request.buyerId, lastSentAt: at, reminderCount: 1 } }; request.inactivityWarningSentAt = at;
      await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=$2::jsonb WHERE id=$1", [request.id, JSON.stringify(request)]);
      const notification: AlphaExchangeNotification = { id: "native-cancellation-reminder", userId: request.buyerId, category: "trade", title: "Action required", message: "Synthetic reminder",
        isRead: false, state: "unread", relatedRequestId: request.id, reason: "automatic_trade_action_reminder", createdAt: at };
      await tx.query("INSERT INTO alpha_exchange.notifications VALUES ($1,$2,'trade',false,$3::timestamptz,77,$4::jsonb)", [notification.id, notification.userId, at, JSON.stringify(notification)]);
    });
    const before = await footprint(atomic);
    stage = "replacement transaction is never poisoned";
    await replacementTransactionRemainsUntouched(connections.atomic, fixture); assert.deepEqual(await footprint(atomic), before);
    checks.push("The participant rejects a changed physical transaction identity without poisoning the replacement transaction");

    stage = "swallowed callback failure after synthetic pause";
    await assert.rejects(atomic.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => {
        await pause(tx, "native-cancellation-swallowed"); throw new Error("Synthetic caller rejection");
      }); } catch { /* A swallowed participant failure must still make commit fail. */ }
    }));
    assert.deepEqual(await footprint(atomic), before);
    checks.push("A swallowed callback failure after an independently authorized synthetic pause aborts the original transaction");

    stage = "non-cloneable decision after synthetic pause";
    await assert.rejects(atomic.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
        await pause(tx, "native-cancellation-uncloneable");
        return participant.cancel({ ...decision(fixture), callback: () => true } as DevelopmentPrepaymentCancellationDecision);
      }); } catch { /* Clone failure must not rescue the already written companion command. */ }
    }));
    assert.deepEqual(await footprint(atomic), before);
    checks.push("A swallowed decision-clone failure cannot commit a companion wallet write");

    stage = "runtime guard rejection followed by restored runtime";
    const runtime: Record<string, string | undefined> = process.env, original = runtime.NODE_ENV;
    const restore = () => { if (original === undefined) delete runtime.NODE_ENV; else runtime.NODE_ENV = original; };
    try {
      await assert.rejects(atomic.transaction(async tx => {
        try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
          await pause(tx, "native-cancellation-runtime"); runtime.NODE_ENV = "production"; return participant.cancel(decision(fixture));
        }); } catch { restore(); }
      }));
    } finally { restore(); }
    assert.deepEqual(await footprint(atomic), before);
    checks.push("Restoring runtime flags after swallowing a guard failure cannot commit earlier companion writes");

    stage = "real SQL failure after all canonical cancellation writes";
    const writes = new Set<string>(); let faultReached = false;
    await assert.rejects(atomic.transaction(async tx => {
      const faulted: WalletSql = { exec: sql => tx.exec(sql), async query<RowType extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (/^\s*UPDATE alpha_exchange\.runtime_meta/i.test(sql)) { faultReached = true; await tx.query("SELECT 1 / 0"); }
        const result = await tx.query<RowType>(sql, values);
        const marker = /prepayment cancellation: (request|trade|listing) persistence/.exec(sql)?.[1]; if (marker) writes.add(marker);
        if (sql.includes("prepayment cancellation: reminder archive")) writes.add("reminder");
        if (/^\s*INSERT INTO alpha_exchange\.(notifications|audit_logs)/i.test(sql)) writes.add("events");
        return result;
      } };
      await cancel(faulted, fixture, "native-cancellation-post-write-fault");
    }));
    assert.equal(faultReached, true); assert.deepEqual([...writes].sort(), ["events", "listing", "reminder", "request", "trade"]);
    assert.deepEqual(await footprint(atomic), before);
    checks.push("A real SQL failure after request, physical trade, listing, reminder archive and event inserts rolls back every effect and companion command");

    stage = "actual commit with a synthetically lost acknowledgement";
    const underlying = atomic;
    const lossy: WalletStore = { close: async () => undefined, transaction: async work => {
      await underlying.transaction(work); throw new CommitOutcomeUnknownError(new Error("Synthetic lost cancellation COMMIT reply"));
    } };
    await assert.rejects(lossy.transaction(tx => cancel(tx, fixture, "native-cancellation-unknown-commit")), CommitOutcomeUnknownError);
    const committed = await footprint(atomic); assertCancelled(committed, before, fixture);
    const request = committed.marketplace.purchase_requests.find(row => row.id === fixture.requestId)?.payload as PurchaseRequest;
    assert.equal(request.termsProposal?.status, "withdrawn"); assert.equal(request.termsProposal?.resolvedAt, request.updatedAt);
    assert.equal(request.actionReminderState, undefined); assert.equal(request.inactivityWarningSentAt, undefined);
    const reminder = committed.marketplace.notifications.find(row => row.id === "native-cancellation-reminder")!;
    assert.equal(reminder.is_read, true); assert.equal(reminder.sort_index, 77); assert.equal((reminder.payload as AlphaExchangeNotification).state, "archived");
    checks.push("One actual SERIALIZABLE transaction commits exact Face-to-Face cancellation, listing reopening, two notices, audit, proposal withdrawal, reminder archive and trust intent together with one synthetic pause");
    checks.push("The original physical trade creation time and all 500 USDT of wallet listing inventory remain unchanged; no reservation, refund or payout is fabricated");
    await assert.rejects(atomic.transaction(tx => cancel(tx, fixture, "native-cancellation-after-unknown")), /no idempotent receipt/);
    assert.deepEqual(await footprint(atomic), committed);
    checks.push("After a lost COMMIT reply, direct read verifies the committed rows and a second mutation is refused without claiming financial receipt recovery");
    await atomic.close(); atomic = await createPostgresWalletStore({ mode: MODE, connectionString: connections.atomic });
    assert.deepEqual(await footprint(atomic), committed);
    checks.push("Reopening the native connection reconstructs the same canonical rows and wallet command hashes");

    stage = "stale buyer cancellation waits behind a bank-disclosure writer";
    races = await createPostgresWalletStore({ mode: MODE, connectionString: connections.race });
    const raceFixture = await setup(races, "Bank Transfer");
    writer = await createPostgresWalletStore({ mode: MODE, connectionString: connections.race });
    contender = await createPostgresWalletStore({ mode: MODE, connectionString: connections.race });
    const staleDisclosure = await staleBankDisclosure(races, writer, contender, raceFixture);
    checks.push("A visibly waiting stale buyer cancellation retries its entire transaction and refuses newly disclosed bank details with no companion command committed");
    stage = "two native backends compete for seller cancellation";
    const competition = await competingCancellations(races, writer, contender, raceFixture);
    checks.push("Seller cancellation remains permitted after unpaid bank disclosure; competing backends commit one cancellation and one pause, and the loser retries then refuses the cancelled request");
    report = { mode: MODE, scope: "Canonical prepayment cancellation groundwork and native transaction mechanics; not an authenticated financial cancellation coordinator",
      checks, concurrency: { staleDisclosure, competition }, money: { custodyUSDT: "500", listingInventoryUSDT: "500", reservedPrincipalUSDT: "0",
        financialReturns: 0, payouts: 0, providerSubmissions: 0 }, limits: [
        "The independently authorized wallet companion is a synthetic operator pause, not a buyer/seller principal-return command.",
        "This current-schema fixture installs no frozen initial coordinator guards and grants no authority over an existing coordinated or recovered cohort.",
        "Stored authentication, canonical-to-v4 coordination, immutable cancellation receipts, recovery, publication delivery and production routes remain outside this drill.",
        "Unknown COMMIT acknowledgement is injected after a real commit, not a real network partition. Every database, identity and fund is synthetic.",
      ] };
  } finally {
    const closed = await Promise.allSettled([atomic?.close(), races?.close(), writer?.close(), contender?.close()]);
    for (const result of closed) if (result.status === "rejected") throw result.reason;
  }
  assert(report); console.log(JSON.stringify(report, null, 2));
}
async function main() {
  assertSimulationRuntime(MODE);
  if (process.argv.slice(2).join(" ") === "--help") { console.log(USAGE); return; }
  await verify(argumentsOf(process.argv.slice(2)));
}
void main().catch(() => {
  // Never print argv, connection credentials or canonical row contents.
  console.error(`Alpha Wallet prepayment cancellation fixture failed during ${stage}`); process.exitCode = 1;
});
