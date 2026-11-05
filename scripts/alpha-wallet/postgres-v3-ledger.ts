/**
 * Native PostgreSQL verification of the separate seller-native financial engine.
 * All accounts, consent facts and funds are synthetic. No canonical rows,
 * authentication flow, public route, provider, signer or cohort is activated.
 */
import { strict as assert } from "node:assert";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { balance } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { v2Command } from "../../src/lib/alpha-wallet/v2-commands";
import { createVersionedDurableWallet } from "../../src/lib/alpha-wallet/versioned-durable";
import { exportVersionedWalletBackup } from "../../src/lib/alpha-wallet/versioned-backup";
import { initialInputFromPlan, v3Command, type V3CommandOf } from "../../src/lib/alpha-wallet/v3-commands";
import { createV3DurableWallet, upgradeDurableWalletV3 } from "../../src/lib/alpha-wallet/v3-durable";
import { isV3State } from "../../src/lib/alpha-wallet/v3-engine";
import { createV3InitialAcceptanceFixture } from "../../src/lib/alpha-wallet/v3-fixtures";
import { exportV3WalletBackup, inspectV3WalletBackup, restoreV3WalletBackup, type WalletV3RestoreResult } from "../../src/lib/alpha-wallet/v3-backup";
import { FIXTURE_TIME, OPERATOR, SELLER, TRON } from "./durable-fixtures";
import { buildV3AcceptanceFixture, V3_FIXTURE_LISTING, V3_FIXTURE_TRADE, V3_RESTORE_AT,
  v3FixtureCheckpoint, v3FixtureHistory } from "./v3-durable-fixtures";

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
  const wallet = createV3DurableWallet({ mode: MODE, store });
  const snapshot = await wallet.snapshot();
  const rows = await store.transaction(async tx => ({
    history: await v3FixtureHistory(tx),
    bindings: (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_trade_bindings ORDER BY platform_request_id")).rows,
    receipts: (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_acceptance_receipts ORDER BY acceptance_key")).rows,
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
async function competingAcceptance(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore,
  command: V3CommandOf<"acceptInitialSellerRequest">, at: number) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0;
  const first = firstStore.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const result = await createV3DurableWallet({ mode: MODE, store: bound(tx), clock: () => at }).execute(command);
    held.resolve(); await bounded(release.promise, "first financial acceptance release"); return result;
  });
  void first.catch(held.reject);
  await bounded(held.promise, "first financial acceptance lock");
  const second = secondStore.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,revision FROM alpha_wallet_simulation.head WHERE singleton=true")).rows[0]!.pid;
    if (secondAttempts === 1) started.resolve();
    return createV3DurableWallet({ mode: MODE, store: bound(tx), clock: () => at }).execute({ ...command, requestId: "native-v3-alternate-operation" });
  });
  void second.catch(started.reject);
  try {
    await bounded(started.promise, "second financial acceptance snapshot");
    assert.notEqual(firstPid, secondPid);
    await waitForLock(observer, secondPid);
    release.resolve();
    const results = await bounded(Promise.all([first, second]), "competing acceptance outcomes");
    assert(secondAttempts >= 2); assert.equal(results[0].replayed, false); assert.equal(results[1].replayed, true);
    assert.equal(results[0].commandKey, results[1].commandKey); assert.equal(results[0].eventHash, results[1].eventHash);
    assert.deepEqual(results[0].result, results[1].result);
    return { secondAttempts, distinctBackends: true, lockWaitObserved: true, committedReservations: 1,
      originalRevision: results[0].revision, originalEventHash: results[0].eventHash };
  } finally { release.resolve(); await Promise.allSettled([first, second]); }
}
async function competingRestore(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore, backup: string) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0, committed = false;
  let result: WalletV3RestoreResult | undefined;
  const first = (async () => {
    await firstStore.transaction(async tx => {
      firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      result = await restoreV3WalletBackup({ mode: MODE, store: bound(tx), backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
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
    return restoreV3WalletBackup({ mode: MODE, store: bound(tx), backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
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
    const fixture = await buildV3AcceptanceFixture(source, { accept: false });
    assert.deepEqual(await source.transaction(tx => v3FixtureHistory(tx, fixture.prefix.revision)), fixture.prefixRows);
    assert.equal(fixture.before.revision, fixture.prefix.revision + 1);
    checks.push("Explicit source-bound v3 continuation preserves all original v1/v2 command rows, hashes and balances");

    stage = "real migration DDL rollback";
    let observedMigration = false;
    const brokenUpgrade = wrapped(races, tx => ({ exec: sql => tx.exec(sql), query: async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands") && params?.[2] === "continueFromV2") {
        observedMigration = Boolean((await tx.query("SELECT to_regclass('alpha_wallet_simulation.initial_engine_continuations')::text AS name")).rows[0]?.name);
        await tx.query("SELECT 1 / 0 /* fail v3 after native migration DDL */");
      }
      return tx.query<Row>(sql, params);
    } }));
    await assert.rejects(buildV3AcceptanceFixture(brokenUpgrade, { accept: false }), /division by zero/);
    assert(observedMigration);
    const old = await createVersionedDurableWallet({ mode: MODE, store: races }).snapshot();
    const catalog = await races.transaction(async tx => ({
      format: (await tx.query("SELECT format_version FROM alpha_wallet_simulation.head")).rows[0]?.format_version,
      initial: (await tx.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='alpha_wallet_simulation' AND c.relname LIKE 'initial_%'")).rows,
    }));
    assert.equal(catalog.format, 2); assert.equal(catalog.initial.length, 0);
    checks.push("A real SQL failure after v3 migration DDL rolls back its schema and continuation, leaving a readable intact v2 store");
    await upgradeDurableWalletV3({ mode: MODE, store: races, acknowledgeVersionUpgrade: true,
      command: v3Command("continueFromV2", OPERATOR, "native-v3-race-upgrade", { checkpoint: v3FixtureCheckpoint(old) }), clock: () => FIXTURE_TIME + 1000 });

    stage = "seller authority rejection before financial effects";
    const before = await footprint(source);
    await assert.rejects(fixture.wallet.execute(v3Command("acceptInitialSellerRequest", { kind: "buyer", id: "fixture-buyer" },
      "native-v3-false-buyer-actor", fixture.acceptance.input)));
    await assert.rejects(fixture.wallet.execute(v3Command("acceptInitialSellerRequest", OPERATOR, "native-v3-false-operator", fixture.acceptance.input)));
    assert.deepEqual(await footprint(source), before);
    checks.push("Buyer and operator actors cannot impersonate the seller or alter the pending financial state");

    stage = "SQL failure after financial command and binding writes";
    let observedBinding = false;
    const brokenAcceptance = wrapped(source, tx => ({ exec: sql => tx.exec(sql), query: async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT INTO alpha_wallet_simulation.initial_acceptance_receipts")) {
        observedBinding = (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_trade_bindings")).rows.length === 1;
        await tx.query("SELECT 1 / 0 /* fail v3 before initial receipt */");
      }
      return tx.query<Row>(sql, params);
    } }));
    await assert.rejects(createV3DurableWallet({ mode: MODE, store: brokenAcceptance, clock: () => fixture.now() + 1 }).execute(fixture.acceptance), /division by zero/);
    assert(observedBinding); assert.deepEqual(await footprint(source), before);
    checks.push("A real SQL failure after the command, journal and initial binding rolls back the full reservation and every projection");

    stage = "swallowed runtime guard after a companion acceptance";
    const originalSigning = process.env.ALPHA_WALLET_SIGNING_ENABLED;
    try {
      await assert.rejects(source.transaction(async tx => {
        const scoped = createV3DurableWallet({ mode: MODE, store: bound(tx), clock: () => fixture.now() + 1 });
        await scoped.execute(fixture.acceptance);
        process.env.ALPHA_WALLET_SIGNING_ENABLED = "true";
        try { await scoped.snapshot(); } catch { /* Deliberate caller mistake. */ }
        try { await tx.query("SELECT 1"); } catch { /* Transport records refusal before environment restoration. */ }
        if (originalSigning === undefined) delete process.env.ALPHA_WALLET_SIGNING_ENABLED;
        else process.env.ALPHA_WALLET_SIGNING_ENABLED = originalSigning;
      }));
    } finally {
      if (originalSigning === undefined) delete process.env.ALPHA_WALLET_SIGNING_ENABLED;
      else process.env.ALPHA_WALLET_SIGNING_ENABLED = originalSigning;
    }
    assert.deepEqual(await footprint(source), before);
    checks.push("A swallowed runtime transport refusal after reservation cannot become committable after restoring the environment");

    stage = "actual acceptance commit with lost acknowledgment";
    const lost: WalletStore = { close: async () => undefined, transaction: async work => {
      await source.transaction(work);
      throw new CommitOutcomeUnknownError(new Error("Injected lost acceptance acknowledgment after real COMMIT"));
    } };
    await assert.rejects(createV3DurableWallet({ mode: MODE, store: lost, clock: () => fixture.now() + 1 }).execute(fixture.acceptance), CommitOutcomeUnknownError);
    const recovered = await fixture.wallet.execute({ ...fixture.acceptance, requestId: "native-v3-after-lost-commit" });
    const accepted = await fixture.wallet.snapshot();
    assert(recovered.replayed && isV3State(accepted.state));
    assert.equal(accepted.revision, before.revision + 1);
    assert.equal(accepted.state.initialBindings.size, 1); assert.equal(accepted.state.initialAcceptanceReceipts.size, 1);
    assert.equal(balance(accepted.state, TRON, `listing:${V3_FIXTURE_LISTING}`), BigInt(300_000_000));
    assert.equal(balance(accepted.state, TRON, `trade:${V3_FIXTURE_TRADE}`), BigInt(200_000_000));
    assert.equal(accepted.state.listings.get(V3_FIXTURE_LISTING)?.price, "3.20");
    assert.equal(recovered.result.input.terms.pricePerUsdt, "3.10");
    assert.equal(recovered.result.actorUserId, SELLER.id);
    assert.equal(accepted.state.trades.get(V3_FIXTURE_TRADE)?.buyerId, fixture.acceptance.input.buyerRequestEvidence.buyerId);
    assert.equal(accepted.state.payouts.size, 1); // Only the inherited held withdrawal.
    checks.push("A real seller acceptance reserves the full 200 USDT at retained 3.10 ILS terms; a lost COMMIT reply recovers its original identity once");

    stage = "old writer and immutable projection fences";
    const acceptedFootprint = await footprint(source);
    await assert.rejects(createDurableWallet({ mode: MODE, store: source }).execute(walletCommand("pause", OPERATOR, "native-v3-old-v1", null)));
    await assert.rejects(createVersionedDurableWallet({ mode: MODE, store: source }).execute(v2Command("pause", OPERATOR, "native-v3-old-v2", null)));
    await assert.rejects(exportVersionedWalletBackup({ mode: MODE, store: source }));
    for (const statement of [
      "UPDATE alpha_wallet_simulation.initial_trade_bindings SET payload=payload",
      "DELETE FROM alpha_wallet_simulation.initial_acceptance_receipts",
      "TRUNCATE alpha_wallet_simulation.initial_acceptance_receipts",
    ]) await assert.rejects(source.transaction(async tx => {
      await tx.query("SELECT set_config('alpha_wallet.writer_protocol','simulation-v3',true)");
      await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true");
      await tx.exec(statement);
    }));
    await assert.rejects(fixture.wallet.execute({ ...fixture.acceptance, requestId: "native-v3-changed-evidence",
      input: { ...fixture.acceptance.input, buyerRequestEvidence: { ...fixture.acceptance.input.buyerRequestEvidence, submissionTimelineDigest: "1".repeat(64) } } }));
    assert.deepEqual(await footprint(source), acceptedFootprint);
    checks.push("Old writers/exporters, changed business-retry evidence and updates/deletes/truncates of immutable initial projections fail without changing history");

    stage = "visible native same-request acceptance race";
    const raceWallet = createV3DurableWallet({ mode: MODE, store: races, clock: () => FIXTURE_TIME + 3000 });
    const raceSnapshot = await raceWallet.snapshot(); assert(isV3State(raceSnapshot.state));
    const raceFacts = createV3InitialAcceptanceFixture({ mode: MODE, state: raceSnapshot.state, walletRevision: raceSnapshot.revision,
      walletEventHash: raceSnapshot.eventHash, atMs: FIXTURE_TIME + 2000, walletListingId: V3_FIXTURE_LISTING,
      walletTradeId: V3_FIXTURE_TRADE, buyerId: "fixture-buyer", retainedPrice: "3.10" });
    const raceCommand = v3Command("acceptInitialSellerRequest", SELLER, "native-v3-race-first", initialInputFromPlan(raceFacts.plan));
    const raceBefore = await footprint(races);
    const raceResult = await competingAcceptance(races, await connect(urls.races), await connect(urls.races), raceCommand, FIXTURE_TIME + 2000);
    const raceAfter = await footprint(races);
    assert.equal(raceAfter.revision, raceBefore.revision + 1); assert.equal(raceAfter.receipts.length, 1); assert.equal(raceAfter.bindings.length, 1);
    checks.push("Two visibly competing PostgreSQL backends retry the complete decision and return one original seller receipt with exactly one reservation");

    stage = "paused isolated export and historical dispatch suppression";
    await fixture.wallet.execute(v3Command("pause", OPERATOR, "native-v3-source-pause", null));
    await raceWallet.execute(v3Command("pause", OPERATOR, "native-v3-race-pause", null));
    assert(fixture.historicalDispatch);
    const historical = await fixture.wallet.execute(fixture.historicalDispatch);
    assert.equal(historical.result.shouldDispatch, false); assert.equal(historical.result.payout.dispatchCount, 1);
    assert.equal(historical.result.payout.state, "submission_unknown");
    const backup = await exportV3WalletBackup({ mode: MODE, store: source, clock: () => V3_RESTORE_AT - 1 });
    const inspected = inspectV3WalletBackup(backup);
    const finalSource = await fixture.wallet.snapshot();
    assert.equal(inspected.initialAcceptanceCount, 1); assert.equal(inspected.sourcePaused, true);
    assert.deepEqual(await source.transaction(tx => v3FixtureHistory(tx, fixture.prefix.revision)), fixture.prefixRows);
    checks.push("The paused v3 wallet exports a distinct wallet-only format and preserves original history without reauthorizing an uncertain payout");

    stage = "visible fresh-target restore race with real commit and lost acknowledgment";
    const restoreRace = await competingRestore(target, await connect(urls.target), await connect(urls.target), backup);
    const restoredWallet = createV3DurableWallet({ mode: MODE, store: target });
    const restored = await restoredWallet.snapshot();
    assert.equal(restored.revision, finalSource.revision + 1); assert(restored.state.haltReason);
    assert.equal(walletDigest(restored.state), restoreRace.result.restored.stateHash);
    const originalRows = JSON.parse(backup).commands as Array<Record<string, unknown>>;
    assert.deepEqual(await target.transaction(tx => v3FixtureHistory(tx, finalSource.revision)), originalRows);
    assert.equal((await restoredWallet.execute(fixture.acceptance)).eventHash, recovered.eventHash);
    assert.equal((await restoredWallet.execute(fixture.historicalDispatch)).result.shouldDispatch, false);
    await assert.rejects(restoreV3WalletBackup({ mode: MODE, store: target, backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT }));
    checks.push("Two fresh-target restores visibly contend; one commits the exact three-engine history plus quarantine, and a lost reply is resolved by inspecting that same target");

    stage = "native reopen and recovery checkpoint";
    await target.close(); stores.splice(stores.indexOf(target), 1);
    const reopened = createV3DurableWallet({ mode: MODE, store: await connect(urls.target) });
    const reopenedSnapshot = await reopened.snapshot();
    assert.equal(walletDigest(reopenedSnapshot.state), walletDigest(restored.state));
    assert.equal(reopenedSnapshot.eventHash, restored.eventHash);
    assert.equal((await reopened.execute({ ...fixture.acceptance, requestId: "native-v3-reopened-retry" })).eventHash, recovered.eventHash);
    checks.push("A new native connection reopens the exact quarantined state and recovers the original acceptance under a new transport operation");

    stage = "complete";
    return { mode: MODE, scope: "isolated-v3-financial-ledger", result: "passed", checks,
      v1V2PrefixCommands: fixture.prefix.revision, initialPrincipalRaw: "200000000", remainingListingRaw: "300000000",
      retainedPricePerUsdt: "3.10", walletListingPrice: "3.20", source: { revision: finalSource.revision,
        eventHash: finalSource.eventHash, stateHash: walletDigest(finalSource.state), paused: Boolean(finalSource.state.haltReason) },
      backup: inspected, restored: restoreRace.result.restored, acceptanceRace: raceResult, restoreRace: restoreRace.details,
      sourceProviderSubmissions: 0, canonicalMarketplaceWrites: 0, authenticatedSellerSessions: 0, productionWrites: 0 };
  } finally { await Promise.allSettled(stores.map(store => store.close())); }
}

async function main() {
  assertSimulationRuntime(MODE);
  const result = await verify(argumentsOf(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ result: "failed", stage, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
