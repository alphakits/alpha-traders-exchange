/** Native PostgreSQL evidence for isolated V4 financial cancellation and recovery.
 * All identities/assertions/funds are synthetic. No canonical coordinator is
 * activated; no provider, signer, actual wallet or production database is used.
 */
import { strict as assert } from "node:assert";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createVersionedDurableWallet } from "../../src/lib/alpha-wallet/versioned-durable";
import { createV3DurableWallet } from "../../src/lib/alpha-wallet/v3-durable";
import { exportV3WalletBackup } from "../../src/lib/alpha-wallet/v3-backup";
import { v4Command, type V4CommandOf } from "../../src/lib/alpha-wallet/v4-commands";
import { createV4DurableWallet, upgradeDurableWalletV4 } from "../../src/lib/alpha-wallet/v4-durable";
import { baseV3StateForV4, isV4State } from "../../src/lib/alpha-wallet/v4-engine";
import { exportV4WalletBackup, inspectV4WalletBackup, restoreV4WalletBackup, type WalletV4RestoreResult } from "../../src/lib/alpha-wallet/v4-backup";
import { OPERATOR, SELLER, TRON } from "./durable-fixtures";
import { V3_FIXTURE_LISTING, V3_FIXTURE_TRADE, V3_RESTORE_AT, v3FixtureCheckpoint, v3FixtureHistory } from "./v3-durable-fixtures";
import { buildV4CancellationFixture, v4FixtureCancellationInput } from "./v4-durable-fixtures";

const MODE = "simulation-only" as const;
const USAGE = "Pass --fresh-simulation-databases --source-connection-string <explicit loopback alpha_wallet_dev_ URL> --race-connection-string <different empty loopback fixture URL> --target-connection-string <third empty loopback fixture URL>. Existing databases must be empty. No ambient database URL is used; no database is created or dropped.";
let stage = "argument validation";
function argumentsOf(args: string[]) {
  assert.equal(args.length, 7, USAGE);
  let fresh = false;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (key === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (["--source-connection-string", "--race-connection-string", "--target-connection-string"].includes(key)) {
      assert(!values.has(key) && args[index + 1] && !args[index + 1]!.startsWith("--"), USAGE);
      values.set(key, args[++index]!);
    } else assert.fail(USAGE);
  }
  assert(fresh && values.size === 3, USAGE);
  assert.equal(new Set([...values.values()].map(value => decodeURIComponent(new URL(value).pathname))).size, 3, USAGE);
  return { source: values.get("--source-connection-string")!, races: values.get("--race-connection-string")!, target: values.get("--target-connection-string")! };
}
function bound(tx: WalletSql): WalletStore { return { transaction: work => work(tx), close: async () => undefined }; }
function wrapped(store: WalletStore, adapt: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(adapt(tx))), close: async () => undefined };
}
async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
    const publicRows = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0); assert.equal(publicRows.rows[0]?.count, "0"); assert.equal(role.rows[0]?.permitted, true);
  });
}
async function footprint(store: WalletStore) {
  const wallet = createV4DurableWallet({ mode: MODE, store });
  const snapshot = await wallet.snapshot();
  const rows = await store.transaction(async tx => ({
    history: await v3FixtureHistory(tx),
    bindings: (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_trade_bindings ORDER BY platform_request_id")).rows,
    receipts: (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_cancellation_receipts ORDER BY cancellation_key")).rows,
    acceptances: (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_acceptance_receipts ORDER BY acceptance_key")).rows,
    continuations: (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_engine_continuations")).rows,
  }));
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), ...rows };
}
function deferred() {
  let resolve!: () => void, reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 10_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function waitForLock(observer: WalletStore, pid: number, advisory = false) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await observer.transaction(tx => tx.query<{ waiting: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted AND ($2::boolean=false OR locktype='advisory')) AS waiting", [pid, advisory]));
    if (rows.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Native lock wait was not observed");
}
async function competingCancellation(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore,
  command: V4CommandOf<"cancelInitialTrade">, at: number) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0;
  const first = firstStore.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const result = await createV4DurableWallet({ mode: MODE, store: bound(tx), clock: () => at }).execute(command);
    held.resolve(); await bounded(release.promise, "first financial cancellation release"); return result;
  });
  void first.catch(held.reject);
  await bounded(held.promise, "first financial cancellation lock");
  const second = secondStore.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,revision FROM alpha_wallet_simulation.head WHERE singleton=true")).rows[0]!.pid;
    if (secondAttempts === 1) started.resolve();
    return createV4DurableWallet({ mode: MODE, store: bound(tx), clock: () => at }).execute({ ...command, requestId: "native-v4-alternate-operation" });
  });
  void second.catch(started.reject);
  try {
    await bounded(started.promise, "second financial cancellation snapshot");
    assert.notEqual(firstPid, secondPid);
    await waitForLock(observer, secondPid);
    release.resolve();
    const results = await bounded(Promise.all([first, second]), "competing acceptance outcomes");
    assert(secondAttempts >= 2); assert.equal(results[0].replayed, false); assert.equal(results[1].replayed, true);
    assert.equal(results[0].commandKey, results[1].commandKey); assert.equal(results[0].eventHash, results[1].eventHash);
    assert.deepEqual(results[0].result, results[1].result);
    return { secondAttempts, distinctBackends: true, lockWaitObserved: true, committedReturns: 1,
      originalRevision: results[0].revision, originalEventHash: results[0].eventHash };
  } finally { release.resolve(); await Promise.allSettled([first, second]); }
}
async function competingRestore(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore, backup: string) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0, committed = false;
  let result: WalletV4RestoreResult | undefined;
  const first = (async () => {
    await firstStore.transaction(async tx => {
      firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      result = await restoreV4WalletBackup({ mode: MODE, store: bound(tx), backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
      held.resolve(); await bounded(release.promise, "first restore release");
    });
    committed = true;
    throw new CommitOutcomeUnknownError(new Error("Injected lost restore acknowledgment after actual commit"));
  })();
  void first.catch(held.reject);
  await bounded(held.promise, "first restore quarantine and gate");
  const second = secondStore.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    if (secondAttempts === 1) started.resolve();
    return restoreV4WalletBackup({ mode: MODE, store: bound(tx), backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
  });
  void second.catch(started.reject);
  try {
    await bounded(started.promise, "second fresh-target restore");
    assert.notEqual(firstPid, secondPid);
    await waitForLock(observer, secondPid, true);
    release.resolve();
    const outcomes = await bounded(Promise.allSettled([first, second]), "restore outcomes");
    assert.equal(outcomes[0].status, "rejected");
    if (outcomes[0].status === "rejected") assert(outcomes[0].reason instanceof CommitOutcomeUnknownError);
    assert.equal(outcomes[1].status, "rejected");
    assert(committed && result);
    return { result, details: { secondAttempts, distinctBackends: true, advisoryWaitObserved: true,
      committedRestores: 1, lostCommitReplyInspected: true } };
  } finally { release.resolve(); await Promise.allSettled([first, second]); }
}

async function verify(urls: ReturnType<typeof argumentsOf>) {
  const stores: WalletStore[] = [], checks: string[] = [];
  const connect = async (connectionString: string) => {
    const store = await createPostgresWalletStore({ mode: MODE, connectionString }); stores.push(store); return store;
  };
  try {
    stage = "fresh isolated native databases";
    const source = await connect(urls.source), races = await connect(urls.races), target = await connect(urls.target);
    await Promise.all([fresh(source), fresh(races), fresh(target)]);
    const fixture = await buildV4CancellationFixture(source, { cancel: false });
    assert(isV4State(fixture.before.state));
    assert.deepEqual(baseV3StateForV4(fixture.before.state), fixture.original.snapshot.state);
    const sourcePrefix = await source.transaction(tx => v3FixtureHistory(tx, fixture.original.snapshot.revision));
    assert.equal(fixture.before.revision, fixture.original.snapshot.revision + 1);
    checks.push("Explicit source-bound V4 continuation preserves the frozen V3 state and original three-engine history");

    stage = "real migration DDL rollback";
    let observedMigration = false;
    const brokenUpgrade = wrapped(races, tx => ({ exec: sql => tx.exec(sql), query: async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands") && params?.[2] === "continueFromV3") {
        observedMigration = Boolean((await tx.query("SELECT to_regclass('alpha_wallet_simulation.cancellation_engine_continuations')::text AS name")).rows[0]?.name);
        await tx.query("SELECT 1 / 0 /* fail V4 after native migration DDL */");
      }
      return tx.query<Row>(sql, params);
    } }));
    await assert.rejects(buildV4CancellationFixture(brokenUpgrade, { cancel: false }), /division by zero/);
    assert(observedMigration);
    const old = await createV3DurableWallet({ mode: MODE, store: races }).snapshot();
    const catalog = await races.transaction(async tx => ({
      format: (await tx.query("SELECT format_version FROM alpha_wallet_simulation.head")).rows[0]?.format_version,
      newTables: (await tx.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='alpha_wallet_simulation' AND c.relname IN ('cancellation_engine_continuations','initial_cancellation_receipts')")).rows,
    }));
    assert.equal(catalog.format, 3); assert.equal(catalog.newTables.length, 0);
    checks.push("Failure after real V4 migration DDL rolls back all new tables and leaves the original accepted V3 store readable");
    await upgradeDurableWalletV4({ mode: MODE, store: races, acknowledgeVersionUpgrade: true,
      command: v4Command("continueFromV3", OPERATOR, "native-v4-race-upgrade", { checkpoint: v3FixtureCheckpoint(old) }), clock: () => old.lastCommandAtMs + 1 });

    stage = "party identity rejection before cancellation";
    const before = await footprint(source);
    await assert.rejects(fixture.wallet.execute(v4Command("cancelInitialTrade", OPERATOR, "false-operator", fixture.cancellation.input)));
    await assert.rejects(fixture.wallet.execute(v4Command("cancelInitialTrade", { kind: "seller", id: "unrelated-seller" }, "false-seller", fixture.cancellation.input)));
    assert.deepEqual(await footprint(source), before);
    checks.push("Operator and unrelated party identities cannot claim an initial cancellation or alter its reservation");

    stage = "swallowed semantic failure after receipt insertion";
    let observedReceipt = false, caught = false;
    await assert.rejects(source.transaction(async tx => {
      const broken: WalletSql = { exec: sql => tx.exec(sql), query: async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await tx.query<Row>(sql, params);
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.initial_cancellation_receipts")) {
          observedReceipt = true; throw new Error("Injected after native cancellation receipt");
        }
        return result;
      } };
      try { await createV4DurableWallet({ mode: MODE, store: bound(broken), clock: () => fixture.before.lastCommandAtMs + 1 }).execute(fixture.cancellation); }
      catch { caught = true; }
      await tx.query("SELECT 1");
    }), /aborted/);
    assert(observedReceipt && caught); assert.deepEqual(await footprint(source), before);
    checks.push("A swallowed failure after native command, journal and cancellation receipt insertion aborts the original physical transaction");

    stage = "actual cancellation commit with lost acknowledgment";
    const lost: WalletStore = { close: async () => undefined, transaction: async work => {
      await source.transaction(work); throw new CommitOutcomeUnknownError(new Error("Injected lost cancellation reply after real COMMIT"));
    } };
    await assert.rejects(createV4DurableWallet({ mode: MODE, store: lost, clock: () => fixture.before.lastCommandAtMs + 1 }).execute(fixture.cancellation), CommitOutcomeUnknownError);
    const recovered = await fixture.wallet.execute({ ...fixture.cancellation, requestId: "native-v4-after-lost-commit" });
    const cancelled = await fixture.wallet.snapshot(); assert(recovered.replayed && isV4State(cancelled.state));
    assert.equal(cancelled.revision, before.revision + 1); assert.equal(cancelled.state.initialCancellationReceipts.size, 1);
    assert.equal(balance(cancelled.state, TRON, `listing:${V3_FIXTURE_LISTING}`), BigInt(500_000_000));
    assert.equal(balance(cancelled.state, TRON, `trade:${V3_FIXTURE_TRADE}`), BigInt(0));
    assert.equal(expectedCustody(cancelled.state, TRON), expectedCustody(fixture.before.state, TRON));
    assert.deepEqual(cancelled.state.payouts, fixture.before.state.payouts);
    assert.deepEqual(cancelled.state.commissions, fixture.before.state.commissions);
    assert.deepEqual(baseV3StateForV4(cancelled.state), fixture.original.snapshot.state);
    checks.push("One committed cancellation returns exactly 200 USDT to the same listing, restoring 500 USDT with zero payout or fee; lost reply recovers one original receipt");

    stage = "old writer and immutable projection fences";
    const cancelledFootprint = await footprint(source);
    for (const wallet of [createDurableWallet({ mode: MODE, store: source }), createVersionedDurableWallet({ mode: MODE, store: source }), createV3DurableWallet({ mode: MODE, store: source })]) {
      await assert.rejects(wallet.snapshot());
    }
    await assert.rejects(exportV3WalletBackup({ mode: MODE, store: source }));
    for (const sql of ["UPDATE alpha_wallet_simulation.initial_cancellation_receipts SET payload=payload",
      "DELETE FROM alpha_wallet_simulation.initial_cancellation_receipts", "TRUNCATE alpha_wallet_simulation.initial_cancellation_receipts"]) {
      await assert.rejects(source.transaction(async tx => {
        await tx.query("SELECT set_config('alpha_wallet.writer_protocol','simulation-v4',true)");
        await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true"); await tx.exec(sql);
      }));
    }
    assert.deepEqual(await footprint(source), cancelledFootprint);
    checks.push("Every older writer/exporter and cancellation projection update, delete or truncate refuses without rewriting history");

    stage = "visible native cancellation race";
    const raceWallet = createV4DurableWallet({ mode: MODE, store: races });
    const raceBefore = await raceWallet.snapshot();
    const raceCommand = v4Command("cancelInitialTrade", SELLER, "native-v4-race-first",
      v4FixtureCancellationInput(raceBefore, raceBefore.lastCommandAtMs + 1));
    const raceResult = await competingCancellation(races, await connect(urls.races), await connect(urls.races), raceCommand, raceBefore.lastCommandAtMs + 1);
    const raceAfter = await footprint(races);
    assert.equal(raceAfter.revision, raceBefore.revision + 1); assert.equal(raceAfter.receipts.length, 1);
    checks.push("Two visibly competing PostgreSQL backends retry the complete decision and return one cancellation receipt with exactly one principal return");

    stage = "original historical receipts and uncertain payout";
    assert.deepEqual(await fixture.wallet.execute({ ...fixture.original.acceptance, requestId: "native-v4-original-acceptance" }),
      { ...fixture.original.execution, replayed: true });
    assert(fixture.original.historicalDispatch);
    const historical = await fixture.wallet.execute(fixture.original.historicalDispatch);
    assert.equal(historical.result.shouldDispatch, false); assert.equal(historical.result.payout.dispatchCount, 1);
    assert.equal(historical.result.payout.state, "submission_unknown");
    assert((await fixture.wallet.recoverPayouts()).some(row => row.action === "lookup_original_reference"));
    checks.push("The original acceptance receipt remains recoverable while inherited unknown submissions stay held and cannot dispatch again");

    stage = "paused isolated export";
    await assert.rejects(exportV4WalletBackup({ mode: MODE, store: source, clock: () => V3_RESTORE_AT - 1 }), /paused/);
    await createV4DurableWallet({ mode: MODE, store: source, clock: () => V3_RESTORE_AT - 3 }).execute(v4Command("pause", OPERATOR, "native-v4-source-pause", null));
    await createV4DurableWallet({ mode: MODE, store: races, clock: () => V3_RESTORE_AT - 2 }).execute(v4Command("pause", OPERATOR, "native-v4-race-pause", null));
    const backup = await exportV4WalletBackup({ mode: MODE, store: source, clock: () => V3_RESTORE_AT - 1 });
    const inspected = inspectV4WalletBackup(backup), finalSource = await fixture.wallet.snapshot();
    assert.equal(inspected.initialCancellationCount, 1); assert.equal(inspected.sourcePaused, true);
    assert.deepEqual(await source.transaction(tx => v3FixtureHistory(tx, fixture.original.snapshot.revision)), sourcePrefix);
    checks.push("Only the durably paused isolated V4 ledger exports, retaining all four engine prefixes and the immutable initial cancellation");

    stage = "visible fresh-target restore race and lost commit acknowledgment";
    const restoreRace = await competingRestore(target, await connect(urls.target), await connect(urls.target), backup);
    const restoredWallet = createV4DurableWallet({ mode: MODE, store: target }), restored = await restoredWallet.snapshot();
    assert.equal(restored.revision, finalSource.revision + 1); assert(restored.state.haltReason);
    assert.equal(walletDigest(restored.state), restoreRace.result.restored.stateHash);
    assert.deepEqual(await target.transaction(tx => v3FixtureHistory(tx, finalSource.revision)), JSON.parse(backup).commands);
    assert.equal((await restoredWallet.execute(fixture.cancellation)).eventHash, recovered.eventHash);
    assert.equal((await restoredWallet.execute(fixture.original.acceptance)).eventHash, fixture.original.execution!.eventHash);
    assert.equal((await restoredWallet.execute(fixture.original.historicalDispatch)).result.shouldDispatch, false);
    await assert.rejects(restoreV4WalletBackup({ mode: MODE, store: target, backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT }));
    checks.push("Two fresh-target restores visibly contend; one commits exact four-engine history plus quarantine, and a lost reply is resolved by inspecting the same target");

    stage = "native reopen";
    await target.close(); stores.splice(stores.indexOf(target), 1);
    const reopened = createV4DurableWallet({ mode: MODE, store: await connect(urls.target) }), reopenedSnapshot = await reopened.snapshot();
    assert.equal(walletDigest(reopenedSnapshot.state), walletDigest(restored.state)); assert.equal(reopenedSnapshot.eventHash, restored.eventHash);
    assert.equal((await reopened.execute({ ...fixture.cancellation, requestId: "native-v4-reopened-retry" })).eventHash, recovered.eventHash);
    checks.push("A new native connection reopens exact quarantined state and recovers the original cancellation under a new transport operation");
    stage = "complete";
    return { mode: MODE, scope: "isolated-v4-financial-cancellation", result: "passed", checks,
      originalV3PrefixCommands: fixture.original.snapshot.revision, returnedPrincipalRaw: "200000000", listingAvailableRaw: "500000000", tradeReservedRaw: "0",
      source: { revision: finalSource.revision, eventHash: finalSource.eventHash, stateHash: walletDigest(finalSource.state), paused: Boolean(finalSource.state.haltReason) },
      backup: inspected, restored: restoreRace.result.restored, cancellationRace: raceResult, restoreRace: restoreRace.details,
      sourceProviderSubmissions: 0, canonicalMarketplaceWrites: 0, authenticatedPartySessions: 0, productionWrites: 0 };
  } finally { await Promise.allSettled(stores.map(store => store.close())); }
}
async function main() {
  assertSimulationRuntime(MODE);
  process.stdout.write(`${JSON.stringify(await verify(argumentsOf(process.argv.slice(2))), null, 2)}\n`);
}
void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ result: "failed", stage, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
