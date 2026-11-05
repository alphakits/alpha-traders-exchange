/**
 * Initial seller acceptance groundwork on disposable native PostgreSQL.
 * The companion wallet command is an independently authorized synthetic
 * operator pause. It is deliberately NOT a seller-authorized reservation.
 * These fixtures prove canonical SQL and transaction mechanics only.
 */
import { strict as assert } from "node:assert";
import { mutateDevelopmentInitialAcceptanceInTransaction } from "../../src/lib/alpha-exchange-repository";
import { planDevelopmentInitialAcceptance } from "../../src/lib/alpha-wallet/initial-acceptance";
import { createInitialAcceptanceFixture } from "../../src/lib/alpha-wallet/initial-acceptance-fixture";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { parseUnits } from "../../src/lib/alpha-wallet/amounts";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "./durable-fixtures";

const MODE = "simulation-only" as const;
const USAGE = "Pass --fresh-simulation-databases --atomic-connection-string <explicit loopback alpha_wallet_dev_ URL> --race-connection-string <different empty loopback alpha_wallet_dev_ URL>. No environment database URL is read; no database is created or dropped.";
let stage = "argument validation";
type Fixture = Awaited<ReturnType<typeof createInitialAcceptanceFixture>>;
type Marketplace = Parameters<Parameters<typeof mutateDevelopmentInitialAcceptanceInTransaction>[1]>[0];
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions",
  "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"] as const;

function argumentsOf(args: string[]) {
  assert.equal(args.length, 5, USAGE);
  assert.equal(args.filter(value => value === "--fresh-simulation-databases").length, 1, USAGE);
  const value = (flag: string) => {
    assert.equal(args.filter(item => item === flag).length, 1, USAGE);
    const result = args[args.indexOf(flag) + 1];
    assert(result && !result.startsWith("--"), USAGE);
    return result;
  };
  const atomic = value("--atomic-connection-string"), race = value("--race-connection-string");
  assert.notEqual(new URL(atomic).pathname, new URL(race).pathname, "Use two distinct disposable fixture databases");
  return { atomic, race };
}

/** The caller alone owns BEGIN, retries, COMMIT and release. */
function boundWallet(tx: WalletSql) {
  const store: WalletStore = { transaction: work => work(tx), close: async () => undefined };
  return createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME + 1000 });
}

async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
    const relations = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    const roles = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0, "Existing schemas are never removed");
    assert.equal(relations.rows[0]?.count, "0");
    assert.equal(roles.rows[0]?.permitted, true, "Disposable fixture requires BYPASSRLS");
  });
}

async function setup(store: WalletStore, paymentMethod: "Bank Transfer" | "Face-to-Face", tradeProjection: "absent" | "pending" = "absent") {
  await fresh(store);
  await initializeDurableWallet(store);
  const fixture = await store.transaction(tx => createInitialAcceptanceFixture({ mode: MODE, tx, paymentMethod, tradeProjection }));
  const wallet = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", fixture.listingId);
  return fixture;
}

async function plan(tx: WalletSql, fixture: Fixture, marketplace: Marketplace, operationId: string) {
  return planDevelopmentInitialAcceptance({ mode: MODE, actorUserId: fixture.sellerId,
    requestId: fixture.requestId, operationId, acceptedAtMs: fixture.acceptedAtMs,
    safetyAcknowledged: true,
    mapping: { assetId: TRON, walletListingId: fixture.listingId, walletTradeId: fixture.tradeId },
    marketplace, wallet: await boundWallet(tx).snapshot() });
}

async function accept(tx: WalletSql, fixture: Fixture, operationId: string) {
  const pid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  return mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async marketplace => {
    const planned = await plan(tx, fixture, marketplace, operationId);
    assert.equal(planned.executionAuthority, false);
    assert.equal(planned.reservation.principalRaw, parseUnits("200", 6).toString());
    assert.equal(planned.reservation.transferAmountRaw, planned.reservation.principalRaw);
    // Independent fixture authority proves the shared transaction. A future
    // seller-native versioned command must implement the actual reservation.
    await boundWallet(tx).execute(walletCommand("pause", OPERATOR, operationId, null));
    assert.equal((await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid, pid);
    return planned.canonicalAcceptance;
  });
}

type Row = Record<string, unknown>;
async function footprint(store: WalletStore) {
  return store.transaction(async tx => {
    const wallet = await boundWallet(tx).snapshot();
    const marketplace: Record<string, Row[]> = {};
    for (const table of TABLES) {
      const order = table === "runtime_meta" ? "singleton" : "id";
      marketplace[table] = (await tx.query(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${order}`)).rows.map(item => item.row as Row);
    }
    const commands = (await tx.query("SELECT revision,command_type,command_key,event_hash,result_hash,state_hash FROM alpha_wallet_simulation.commands ORDER BY revision")).rows;
    return { wallet, marketplace, commands };
  });
}
type Footprint = Awaited<ReturnType<typeof footprint>>;

function assertAccepted(current: Footprint, before: Footprint, fixture: Fixture) {
  const request = current.marketplace.purchase_requests.find(row => row.id === fixture.requestId)!;
  const payload = request.payload as Fixture["initialRequest"];
  const listing = current.marketplace.listings.find(row => row.id === fixture.listingId)!;
  const listingPayload = listing.payload as Fixture["initialListing"];
  assert.equal(request.status, "accepted");
  assert.equal(request.trade_id, fixture.tradeId);
  assert.equal(payload.tradeCreatedAt, new Date(fixture.acceptedAtMs).toISOString());
  assert.equal(payload.usdtAmount, fixture.initialRequest.usdtAmount);
  assert.equal(payload.pricePerUsdt, fixture.initialRequest.pricePerUsdt);
  assert.equal(payload.fiatAmount, fixture.initialRequest.fiatAmount);
  assert.equal(listing.status, "matched");
  assert.equal(listing.active_trade_request_id, fixture.requestId);
  assert.equal(listingPayload.availableAmount, "500", "Acceptance locks canonical inventory without subtracting it");
  assert.equal(current.marketplace.trades.length, 1);
  const trade = current.marketplace.trades[0];
  assert.equal(trade.id, fixture.tradeId);
  assert.equal(trade.purchase_request_id, fixture.requestId);
  assert.equal(trade.seller_id, fixture.sellerId);
  assert.equal(trade.buyer_id, fixture.buyerId);
  assert.equal(trade.status, "accepted");
  const pendingProjection = before.marketplace.trades.find(row => row.id === fixture.tradeId);
  if (pendingProjection) assert.equal(trade.sort_index, pendingProjection.sort_index);
  assert.equal(current.marketplace.notifications.length > 0, true);
  assert.equal(current.marketplace.audit_logs.length > 0, true);
  for (const table of ["users", "commissions", "marketplace_enforcement_records", "evidence", "disputes"] as const) {
    assert.deepEqual(current.marketplace[table], before.marketplace[table]);
  }
  assert.deepEqual(current.marketplace.purchase_requests.filter(row => row.id !== fixture.requestId),
    before.marketplace.purchase_requests.filter(row => row.id !== fixture.requestId));
  assert.deepEqual(current.marketplace.listings.filter(row => row.id !== fixture.listingId),
    before.marketplace.listings.filter(row => row.id !== fixture.listingId));
  assert.equal(BigInt(String(current.marketplace.runtime_meta[0].version)), BigInt(String(before.marketplace.runtime_meta[0].version)) + BigInt(1));
  assert.equal(current.wallet.revision, before.wallet.revision + 1);
  assert.equal(current.commands.at(-1)?.command_type, "pause");
  assert.equal(Boolean(current.wallet.state.haltReason), true);
  assert.equal(current.wallet.state.trades.size, 0, "This mechanics fixture must never fabricate a seller reservation");
  assert.equal(current.wallet.state.payouts.size, 0);
  assert.equal(expectedCustody(current.wallet.state, TRON), parseUnits("500", 6));
  assert.equal(balance(current.wallet.state, TRON, `listing:${fixture.listingId}`), parseUnits("500", 6));
  assertLedgerInvariants(current.wallet.state);
}

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
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

async function staleBuyerHistory(observer: WalletStore, writerStore: WalletStore, contenderStore: WalletStore, fixture: Fixture) {
  const held = deferred(), release = deferred(), started = deferred();
  let writerPid = 0, contenderPid = 0, attempts = 0;
  const observed: string[] = [];
  const before = await footprint(observer);
  const writer = writerStore.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(61422917)");
    writerPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await tx.query(`UPDATE alpha_exchange.purchase_requests SET status='accepted',updated_at=$2::timestamptz,
      payload=payload||jsonb_build_object('status','accepted','updatedAt',$2::text,'tradeCreatedAt',$2::text) WHERE id=$1`,
    [fixture.buyerHistoryRequestId, new Date(fixture.atMs + 500).toISOString()]);
    await tx.query("UPDATE alpha_exchange.runtime_meta SET version=version+1, updated_at=now() WHERE singleton=true");
    held.resolve();
    await bounded(release.promise, "ordinary writer release");
  });
  void writer.catch(error => held.reject(error));
  await bounded(held.promise, "ordinary writer lock");
  const contender = contenderStore.transaction(async tx => {
    attempts++;
    const row = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0];
    contenderPid = row.pid;
    if (attempts === 1) started.resolve();
    return mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async marketplace => {
      const other = marketplace.purchaseRequests.find(request => request.id === fixture.buyerHistoryRequestId);
      assert(other, "Authoritative input must include buyer history at another seller");
      observed.push(other.status);
      assert.equal(other.status, "accepted");
      // The pure planner must deny this second active buyer trade before any
      // canonical acceptance or companion wallet command is attempted.
      const planned = await plan(tx, fixture, marketplace, "native-initial-stale-history");
      assert.fail(`Active buyer history was incorrectly accepted: ${planned.canonicalAcceptance.requestId}`);
    });
  });
  const outcome = contender.then(() => ({ error: undefined }), error => ({ error }));
  void contender.catch(error => started.reject(error));
  let failure: unknown;
  try {
    await bounded(started.promise, "contender snapshot");
    assert.notEqual(writerPid, contenderPid);
    await waitForAdvisoryWait(observer, contenderPid);
    release.resolve();
    await writer;
    failure = (await bounded(outcome, "contender rejection")).error;
  } finally {
    release.resolve();
    await Promise.allSettled([writer, contender]);
  }
  assert(failure instanceof Error, "The fresh buyer-active conflict must reject acceptance");
  assert.match(failure.message, /buyer|active/i);
  assert(attempts >= 2, "The runtime fence must retry the whole SERIALIZABLE decision");
  assert.deepEqual(observed, ["accepted"]);
  const after = await footprint(observer);
  assert.deepEqual(after.wallet, before.wallet);
  assert.deepEqual(after.commands, before.commands);
  for (const table of ["trades", "listings", "notifications", "audit_logs"] as const) assert.deepEqual(after.marketplace[table], before.marketplace[table]);
  assert.deepEqual(after.marketplace.purchase_requests.find(row => row.id === fixture.requestId), before.marketplace.purchase_requests.find(row => row.id === fixture.requestId));
  return { attempts, distinctBackends: true, advisoryWaitObserved: true, buyerHistoryAcrossSellersRechecked: true };
}

async function competingAcceptances(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore, fixture: Fixture) {
  // Undo only the deliberate ordinary-writer fixture row, preserving its
  // version history. This is synthetic setup, never an application repair.
  await observer.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(61422917)");
    const original = fixture.marketplace.purchaseRequests.find(request => request.id === fixture.buyerHistoryRequestId)!;
    await tx.query("UPDATE alpha_exchange.purchase_requests SET status=$2,payload=$3::jsonb,updated_at=$4::timestamptz WHERE id=$1",
      [original.id, original.status, JSON.stringify(original), original.updatedAt]);
    await tx.query("UPDATE alpha_exchange.runtime_meta SET version=version+1, updated_at=now() WHERE singleton=true");
  });
  const before = await footprint(observer);
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0;
  const first = firstStore.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    return mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async marketplace => {
      const planned = await plan(tx, fixture, marketplace, "native-initial-first");
      await boundWallet(tx).execute(walletCommand("pause", OPERATOR, "native-initial-first", null));
      held.resolve();
      await bounded(release.promise, "first acceptance release");
      return planned.canonicalAcceptance;
    });
  });
  void first.catch(error => held.reject(error));
  await bounded(held.promise, "first acceptance locks");
  const second = secondStore.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].pid;
    if (secondAttempts === 1) started.resolve();
    return accept(tx, fixture, "native-initial-second");
  });
  const secondOutcome = second.then(() => ({ accepted: true }), () => ({ accepted: false }));
  void second.catch(error => started.reject(error));
  try {
    await bounded(started.promise, "second acceptance snapshot");
    assert.notEqual(firstPid, secondPid);
    await waitForAdvisoryWait(observer, secondPid);
    release.resolve();
    await first;
    assert.equal((await bounded(secondOutcome, "second acceptance refusal")).accepted, false);
  } finally {
    release.resolve();
    await Promise.allSettled([first, second]);
  }
  assert(secondAttempts >= 2);
  const after = await footprint(observer);
  assertAccepted(after, before, fixture);
  assert.equal(after.commands.length, before.commands.length + 1);
  return { secondAttempts, distinctBackends: true, advisoryWaitObserved: true,
    committedCanonicalAcceptances: 1, newWalletCommands: 1, reservationCommands: 0 };
}

async function verify(connections: ReturnType<typeof argumentsOf>) {
  let atomic: WalletStore | undefined, races: WalletStore | undefined, writer: WalletStore | undefined, contender: WalletStore | undefined;
  const checks: string[] = [];
  let report: Record<string, unknown> | undefined;
  try {
    stage = "fresh native databases and explicit synthetic setup";
    atomic = await createPostgresWalletStore({ mode: MODE, connectionString: connections.atomic });
    const fixture = await setup(atomic, "Bank Transfer");
    const before = await footprint(atomic);

    stage = "swallowed callback failure after independently authorized pause";
    let caught = false;
    await assert.rejects(atomic.transaction(async tx => {
      try {
        await mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async marketplace => {
          await plan(tx, fixture, marketplace, "native-initial-caught");
          await boundWallet(tx).execute(walletCommand("pause", OPERATOR, "native-initial-caught", null));
          throw new Error("Synthetic rejection after companion wallet write");
        });
      } catch (error) {
        assert.match(error instanceof Error ? error.message : "", /Synthetic rejection/);
        caught = true;
      }
    }));
    assert.equal(caught, true);
    assert.deepEqual(await footprint(atomic), before);
    checks.push("A swallowed callback rejection after an independently authorized synthetic pause still aborts the whole certified transaction");

    stage = "swallowed runtime guard rejection cannot commit companion writes";
    const runtimeEnvironment: Record<string, string | undefined> = process.env;
    const originalRuntime = runtimeEnvironment.NODE_ENV;
    const restoreRuntime = () => {
      if (originalRuntime === undefined) delete runtimeEnvironment.NODE_ENV;
      else runtimeEnvironment.NODE_ENV = originalRuntime;
    };
    let runtimeFailureCaught = false;
    try {
      await assert.rejects(atomic.transaction(async tx => {
        try {
          await mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async marketplace => {
            const planned = await plan(tx, fixture, marketplace, "native-initial-runtime-failure");
            await boundWallet(tx).execute(walletCommand("pause", OPERATOR, "native-initial-runtime-failure", null));
            runtimeEnvironment.NODE_ENV = "production";
            return planned.canonicalAcceptance;
          });
        } catch (error) {
          assert.match(error instanceof Error ? error.message : "", /runtime/);
          runtimeFailureCaught = true;
          restoreRuntime();
        }
      }));
    } finally { restoreRuntime(); }
    assert.equal(runtimeFailureCaught, true);
    assert.deepEqual(await footprint(atomic), before);
    checks.push("Restoring the simulation environment after swallowing a runtime-guard error cannot commit an earlier wallet write");

    stage = "real SQL failure after canonical acceptance writes";
    let faultReached = false;
    const actualWrites = new Set<string>();
    await assert.rejects(atomic.transaction(async tx => {
      const faulted: WalletSql = { exec: sql => tx.exec(sql), async query<RowType extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const marker = /\/\* initial acceptance: (request|listing) persistence \*\//.exec(sql)?.[1]
          ?? (/^\s*(?:insert into|update) alpha_exchange\.trades\b/i.test(sql) ? "trade" : undefined);
        if (/^\s*update alpha_exchange\.runtime_meta\s/i.test(sql)) {
          faultReached = true;
          await tx.query("SELECT 1 / 0");
        }
        const result = await tx.query<RowType>(sql, values);
        if (marker) actualWrites.add(marker);
        return result;
      } };
      await accept(faulted, fixture, "native-initial-post-write-fault");
    }));
    assert.equal(faultReached, true);
    assert.deepEqual([...actualWrites].sort(), ["listing", "request", "trade"]);
    assert.deepEqual(await footprint(atomic), before);
    checks.push("A real SQL error after request, physical trade and listing persistence rolls back those rows, events and the companion wallet command");

    stage = "real commit followed by a synthetically lost acknowledgement";
    const underlying = atomic;
    const lossy: WalletStore = { close: async () => undefined, transaction: async work => {
      await underlying.transaction(work);
      throw new CommitOutcomeUnknownError(new Error("Synthetic lost initial acceptance COMMIT reply"));
    } };
    await assert.rejects(lossy.transaction(tx => accept(tx, fixture, "native-initial-unknown-commit")), CommitOutcomeUnknownError);
    const committed = await footprint(atomic);
    assertAccepted(committed, before, fixture);
    checks.push("One actual SERIALIZABLE backend commits exact pending-to-accepted canonical SQL, retained trade identity, bounded events and a synthetic operator pause together");
    checks.push("Canonical availableAmount remains 500 USDT; all 500 wallet USDT remain listing inventory, with zero fabricated reservations or payouts");
    await assert.rejects(atomic.transaction(tx => accept(tx, fixture, "native-initial-duplicate-after-unknown")));
    assert.deepEqual(await footprint(atomic), committed);
    checks.push("After a lost COMMIT reply, direct read verifies the original rows and a second initial-acceptance attempt is refused without additional writes; no acceptance receipt recovery is claimed");
    await atomic.close();
    atomic = await createPostgresWalletStore({ mode: MODE, connectionString: connections.atomic });
    assert.deepEqual(await footprint(atomic), committed);
    checks.push("Reopening a new native connection reconstructs the same canonical rows and original wallet command hashes with the wallet paused");

    stage = "stale snapshot behind an ordinary writer changes buyer history at another seller";
    races = await createPostgresWalletStore({ mode: MODE, connectionString: connections.race });
    const raceFixture = await setup(races, "Face-to-Face", "pending");
    writer = await createPostgresWalletStore({ mode: MODE, connectionString: connections.race });
    contender = await createPostgresWalletStore({ mode: MODE, connectionString: connections.race });
    const staleHistory = await staleBuyerHistory(races, writer, contender, raceFixture);
    checks.push("A visibly waiting stale transaction retries at runtime_meta and refuses acceptance after seeing the buyer's new active trade with a different seller");
    stage = "two actual native backends compete for the same initial acceptance";
    const competition = await competingAcceptances(races, writer, contender, raceFixture);
    checks.push("Two competing native backends produce one Face-to-Face canonical acceptance and one pause; the waiting loser retries and refuses the already accepted request");
    report = { mode: MODE,
      scope: "Pure initial seller acceptance planning and actual canonical participant mechanics, not an authenticated financial acceptance coordinator",
      checks, concurrency: { staleHistory, competition },
      money: { custodyUSDT: "500", listingInventoryUSDT: "500", reservedPrincipalUSDT: "0", reservations: 0,
        payouts: 0, providerSubmissions: 0 },
      limits: ["The wallet companion is an independently authorized synthetic operator pause; the seller does not impersonate the buyer.",
        "Accepted canonical rows in this isolated mechanics fixture do not represent a coordinated wallet-backed sale or a recovery-compatible cohort.",
        "No initial-acceptance authentication, seller-native versioned reservation, immutable acceptance receipt, activation, recovery format or production route is implemented by this drill.",
        "Lost COMMIT acknowledgement is injected after a real commit, not a real network partition. All databases, identities and funds are synthetic."] };
  } finally {
    const closed = await Promise.allSettled([atomic?.close(), races?.close(), writer?.close(), contender?.close()]);
    for (const result of closed) if (result.status === "rejected") throw result.reason;
  }
  assert(report);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  assertSimulationRuntime(MODE);
  if (process.argv.slice(2).join(" ") === "--help") { console.log(USAGE); return; }
  await verify(argumentsOf(process.argv.slice(2)));
}
void main().catch(() => {
  // Never print argv, connection credentials or canonical row contents.
  console.error(`Alpha Wallet initial acceptance fixture failed during ${stage}`);
  process.exitCode = 1;
});
