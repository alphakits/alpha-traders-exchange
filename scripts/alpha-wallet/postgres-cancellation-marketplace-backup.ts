/**
 * Four explicitly provisioned empty loopback development databases. No database
 * creation, application URL discovery, provider, wallet key, or delivery work.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import {
  exportCancellationMarketplaceWalletBackup, exportMobileCancellationMarketplaceWalletBackup,
  inspectCancellationMarketplaceWalletBackup, inspectRestoredCancellationMarketplaceWallet, restoreCancellationMarketplaceWalletBackup,
} from "../../src/lib/alpha-wallet/cancellation-marketplace-backup";
import { createDevelopmentCancellationMarketplaceWalletCoordinator, createDevelopmentMobileCancellationMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/cancellation-marketplace-coordinator";
import { assertFreshCancellationMarketplaceRecoveryTarget, assertCancellationMarketplaceRecoveryIdentityQuarantine,
  readCancellationMarketplaceRecoveryRows } from "../../src/lib/alpha-wallet/cancellation-marketplace-recovery-store";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { exportV4WalletBackup } from "../../src/lib/alpha-wallet/v4-backup";
import { createV4DurableWallet, verifyV4History } from "../../src/lib/alpha-wallet/v4-durable";
import { assertV4Invariants, isV4State } from "../../src/lib/alpha-wallet/v4-engine";
import { buildCancellationMarketplaceFixture } from "./cancellation-marketplace-fixtures";

const MODE = "simulation-only" as const, SCHEMA = "alpha_wallet_cancellation_marketplace_simulation";
const USAGE = "Pass --fresh-simulation-databases and explicit --source-connection-string, --accepted-source-connection-string, --target-connection-string and --race-connection-string URLs for four different empty loopback alpha_wallet_dev_ databases.";
type Fixture = Awaited<ReturnType<typeof buildCancellationMarketplaceFixture>>;
let stage = "argument validation";
function argumentsOf(args: string[]) {
  assert.equal(args.length, 9, USAGE);
  const flags = ["--source-connection-string", "--accepted-source-connection-string", "--target-connection-string", "--race-connection-string"];
  const urls = new Map<string, string>(); let acknowledged = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--fresh-simulation-databases") { assert(!acknowledged, USAGE); acknowledged = true; }
    else if (flags.includes(argument)) {
      assert(!urls.has(argument) && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
      urls.set(argument, args[++index]);
    } else assert.fail(USAGE);
  }
  assert(acknowledged && urls.size === 4, USAGE);
  assert.equal(new Set([...urls.values()].map(url => decodeURIComponent(new URL(url).pathname))).size, 4, USAGE);
  return { source: urls.get(flags[0])!, acceptedSource: urls.get(flags[1])!, target: urls.get(flags[2])!, race: urls.get(flags[3])! };
}
const inside = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const wrapped = (store: WalletStore, wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});
const history = (store: WalletStore) => store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,
  occurred_at_ms::text AS occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
const recoveryRows = (store: WalletStore) => store.transaction(tx => readCancellationMarketplaceRecoveryRows(tx));
async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    await assertFreshCancellationMarketplaceRecoveryTarget(tx);
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(role.rows[0]?.permitted, true, "Disposable fixture role requires superuser/BYPASSRLS");
  });
}
async function capture(store: WalletStore, fixture: Fixture) {
  const commands = await history(store), rows = await recoveryRows(store), exportAt = fixture.clock() + 1000;
  const serialized = await exportCancellationMarketplaceWalletBackup({ mode: MODE, store, ...fixture.ownerInput, clock: () => exportAt });
  assert.equal(await exportMobileCancellationMarketplaceWalletBackup({ mode: MODE, store, ...fixture.mobileOwnerInput, clock: () => exportAt }), serialized);
  const inspection = inspectCancellationMarketplaceWalletBackup(serialized), document = JSON.parse(serialized);
  assert.deepEqual(document.canonical, rows.canonical); assert.deepEqual(document.predecessor, rows.predecessor);
  assert.deepEqual(document.coordination, rows.coordination); assert.deepEqual(document.wallet.commands, commands);
  for (const token of [fixture.canonical.ownerSessionToken, fixture.canonical.sellerSessionToken, fixture.canonical.buyerSessionToken,
    ...Object.values(fixture.canonical.mobile.credentials).map(value => value.accessToken)]) {
    assert(!serialized.includes(token)); assert(!serialized.includes(createHash("sha256").update(token).digest("hex")));
  }
  assert.deepEqual(await history(store), commands); assert.deepEqual(await recoveryRows(store), rows);
  return { fixture, commands, rows, serialized, inspection, exportAt, restoreAt: exportAt + 1000 };
}
type Captured = Awaited<ReturnType<typeof capture>>;
const restore = (store: WalletStore, source: Captured) => restoreCancellationMarketplaceWalletBackup({ mode: MODE, store,
  backup: source.serialized, expectedChecksum: source.inspection.checksum, acknowledgeFreshTarget: true, clock: () => source.restoreAt });
const inspect = (store: WalletStore, source: Captured) => inspectRestoredCancellationMarketplaceWallet({ mode: MODE, store, expectedChecksum: source.inspection.checksum });
function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(label)), 8000); })])
    .finally(() => clearTimeout(timeout));
}

async function run(urls: ReturnType<typeof argumentsOf>) {
  const open: WalletStore[] = [];
  const connect = async (url: string) => { const store = await createPostgresWalletStore({ mode: MODE, connectionString: url }); open.push(store); return store; };
  const checks: string[] = [];
  try {
    const source = await connect(urls.source), acceptedSource = await connect(urls.acceptedSource), race = await connect(urls.race);
    let target = await connect(urls.target);
    stage = "all four target admission checks before any fixture write";
    const initial = await Promise.allSettled([source, acceptedSource, target, race].map(fresh));
    for (const result of initial) if (result.status === "rejected") throw result.reason;
    checks.push("All four explicit empty loopback databases and fixture roles are checked before any canonical or financial fixture write");

    stage = "cancelled and inherited-paused accepted successor sources";
    const cancelledFixture = await buildCancellationMarketplaceFixture(source, { cancel: true, pause: true });
    const acceptedFixture = await buildCancellationMarketplaceFixture(acceptedSource, { sourcePaused: true,
      assetId: "bsc-sim-binance-peg-usdt", paymentMethod: "Face-to-Face", platform: "android" });
    const cancelled = await capture(source, cancelledFixture), accepted = await capture(acceptedSource, acceptedFixture);
    assert.equal(cancelled.inspection.cancellationCount, 1); assert.equal(accepted.inspection.cancellationCount, 0);
    assert.equal(accepted.commands.at(-1)!.command_type, "continueFromV3");
    checks.push("Current web/mobile owners export identical complete cancelled-TRON and accepted-BSC bundles; the latter retains its V3 pause through V4 continuation");
    checks.push("Original activation, acceptance, publication and all four financial histories remain exact; private account/session credentials never enter either bundle");

    stage = "recomputed checksum semantic tamper refusal";
    const altered = JSON.parse(cancelled.serialized);
    altered.coordination.cancellations[0].canonical_result.request.status = "accepted";
    delete altered.checksum; altered.checksum = walletDigest(altered);
    await assert.rejects(restoreCancellationMarketplaceWalletBackup({ mode: MODE, store: target, backup: JSON.stringify(altered),
      expectedChecksum: altered.checksum, acknowledgeFreshTarget: true, clock: () => cancelled.restoreAt }));
    await fresh(target);
    checks.push("Recomputing a checksum cannot hide contradictory canonical cancellation; the destination remains empty");

    for (const failure of ["quarantine", "canonical", "predecessor", "successor", "receipt"] as const) {
      stage = `native SQL rollback at ${failure}`; let reached = false;
      const failed = wrapped(target, tx => ({ exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          const result = await tx.query<Row>(sql, values);
          const matches = failure === "quarantine" && /^\s*INSERT INTO alpha_wallet_simulation\.commands\b/i.test(sql)
            && values?.some(value => typeof value === "string" && value.includes("cancellation-marketplace-backup-recovery"))
            || failure === "canonical" && /^\s*INSERT INTO alpha_exchange\.purchase_requests\b/i.test(sql)
            || failure === "predecessor" && /^\s*INSERT INTO alpha_wallet_initial_marketplace_simulation\.acceptances\b/i.test(sql)
            || failure === "successor" && /^\s*INSERT INTO alpha_wallet_cancellation_marketplace_simulation\.cancellations\b/i.test(sql)
            || failure === "receipt" && /^\s*UPDATE alpha_wallet_cancellation_marketplace_simulation\.recovery_receipts\b/i.test(sql);
          if (matches) { reached = true; await tx.query("SELECT 1 / 0"); }
          return result;
        } }));
      await assert.rejects(restore(failed, cancelled)); assert(reached); await fresh(target);
      checks.push(`A real native SQL error at ${failure} rolls back every replayed financial command, canonical/predecessor/successor row and new schema`);
    }

    stage = "late quarantine changes and deferred credential refusal";
    await assert.rejects(target.transaction(async tx => {
      await restore(inside(tx), cancelled);
      await tx.query("SET CONSTRAINTS ALL IMMEDIATE"); await tx.query("SET CONSTRAINTS ALL DEFERRED");
      await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=payload WHERE id=$1", [cancelledFixture.canonical.otherRequestId]);
    })); await fresh(target);
    await assert.rejects(target.transaction(async tx => {
      await restore(inside(tx), cancelled);
      await tx.exec("CREATE TABLE alpha_exchange.mobile_device_sessions (id text PRIMARY KEY); CREATE TABLE alpha_exchange.mobile_refresh_token_history (token_hash text PRIMARY KEY)");
    })); await fresh(target);
    checks.push("Canonical statement fences still reject a late sibling write after forced constraints, and ordinary deferred COMMIT refuses late authentication tables");

    stage = "caught invalid preflight cannot commit a companion write";
    await assert.rejects(target.transaction(async tx => {
      await tx.exec("CREATE TABLE public.recovery_companion (id integer PRIMARY KEY); INSERT INTO public.recovery_companion VALUES (1)");
      try { await restoreCancellationMarketplaceWalletBackup({ mode: MODE, store: inside(tx), backup: cancelled.serialized,
        expectedChecksum: cancelled.inspection.checksum, acknowledgeFreshTarget: false as true, clock: () => cancelled.restoreAt }); }
      catch { /* Deliberately swallowed by a faulty transaction owner. */ }
      return "must not commit";
    })); await fresh(target);
    checks.push("Catching a preflight refusal cannot commit earlier companion writes in the same certified physical transaction");

    stage = "actual native commit with injected lost acknowledgement and reopen";
    const lost: WalletStore = { close: async () => undefined, async transaction<T>(work: (tx: WalletSql) => Promise<T>) {
      await target.transaction(work); throw new CommitOutcomeUnknownError(new Error("Injected acknowledgement loss after actual native COMMIT"));
    } };
    await assert.rejects(restore(lost, cancelled), error => error instanceof CommitOutcomeUnknownError);
    const registrations = await target.transaction(async tx => ({
      predecessor: (await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM alpha_wallet_initial_marketplace_simulation.transaction_contexts")).rows[0].count,
      successor: (await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${SCHEMA}.transaction_contexts`)).rows[0].count,
    }));
    assert.deepEqual(registrations, { predecessor: "0", successor: "1" });
    await target.close(); target = await connect(urls.target);
    const recovered = await inspect(target, cancelled), restoredCommands = await history(target);
    assert.equal(recovered.quarantined, true); assert.deepEqual(recovered.source, cancelled.inspection.checkpoint);
    assert.deepEqual(restoredCommands.slice(0, -1), cancelled.commands); assert.deepEqual(await recoveryRows(target), cancelled.rows);
    const state = verifyV4History(restoredCommands).state; assert(isV4State(state)); assertV4Invariants(state);
    assert.equal(state.initialAcceptanceReceipts.size, 1); assert.equal(state.initialCancellationReceipts.size, 1);
    assert.equal(balance(state, "tron-sim-usdt", `listing:${cancelledFixture.canonical.walletListingId}`), BigInt("500000000"));
    assert.equal(balance(state, "tron-sim-usdt", `trade:${cancelledFixture.canonical.walletTradeId}`), BigInt(0));
    assert.equal(expectedCustody(state, "tron-sim-usdt"), BigInt("500000000")); assert(state.haltReason); assert.equal(state.payouts.size, 0);
    checks.push("Reopening the same target resolves lost COMMIT acknowledgement and preserves original cancellation once: 500 synthetic USDT available, zero reserved, no payout");

    stage = "credential quarantine, unchanged receipt and no-overwrite refusal";
    await target.transaction(tx => assertCancellationMarketplaceRecoveryIdentityQuarantine(tx));
    const web = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store: target, clock: () => cancelled.restoreAt });
    const mobile = createDevelopmentMobileCancellationMarketplaceWalletCoordinator({ mode: MODE, store: target, clock: () => cancelled.restoreAt });
    await assert.rejects(web.inspect(cancelledFixture.ownerInput)); await assert.rejects(mobile.inspect(cancelledFixture.mobileOwnerInput));
    await assert.rejects(web.cancelRequest({ ...cancelledFixture.buyerInput, operationId: "recovered-retry" }));
    await assert.rejects(createV4DurableWallet({ mode: MODE, store: target }).snapshot());
    await assert.rejects(exportV4WalletBackup({ mode: MODE, store: target }));
    await assert.rejects(restore(target, cancelled));
    await assert.rejects(target.transaction(tx => tx.query(`UPDATE ${SCHEMA}.recovery_receipts SET receipt=receipt`)));
    await assert.rejects(inspectRestoredCancellationMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: "f".repeat(64) }));
    assert.deepEqual(await inspect(target, cancelled), recovered);
    checks.push("Disabled credential-free identities, absent old transaction registrations, standalone refusal and immutable recovery receipt prevent revived authority or an overwriting retry");

    stage = "two native backends visibly contend for one accepted-source restore target";
    const competitor = await connect(urls.race), observer = await connect(urls.race);
    let release!: () => void, firstArrived!: () => void, secondArrived!: () => void;
    const firstHeld = new Promise<void>(resolve => { firstArrived = resolve; });
    const secondStarted = new Promise<void>(resolve => { secondArrived = resolve; });
    const releaseFirst = new Promise<void>(resolve => { release = resolve; });
    let firstPid = 0, secondPid = 0, secondAttempts = 0, waitObserved = false;
    const firstStore = wrapped(race, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        if (sql.includes("pg_advisory_xact_lock(61422924)")) {
          firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          firstArrived(); await bounded(releaseFirst, "Restore race winner was not released");
        }
        return result;
      } }));
    const secondStore = wrapped(competitor, tx => { secondAttempts++; return { exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (sql.includes("pg_advisory_xact_lock(61422924)")) {
          secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid; secondArrived();
        }
        return tx.query<Row>(sql, values);
      } }; });
    const first = restore(firstStore, accepted);
    // Attach rejection observers immediately while the barriers are exercised.
    void first.catch(() => undefined);
    await bounded(firstHeld, "First restore did not acquire its native fresh-target lock");
    const second = restore(secondStore, accepted); void second.catch(() => undefined);
    try {
      await bounded(secondStarted, "Competing restore did not reach its native fresh-target lock");
      for (let attempt = 0; attempt < 80 && !waitObserved; attempt++) {
        waitObserved = await observer.transaction(async tx => (await tx.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND wait_event='advisory') AS waiting", [secondPid])).rows[0].waiting);
        if (!waitObserved) await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert(waitObserved, "The second backend must visibly wait on the first restore claim"); assert.notEqual(firstPid, secondPid);
    } finally { release(); }
    const races = await Promise.allSettled([first, second]);
    assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(races.filter(result => result.status === "rejected").length, 1);
    const acceptedRecovered = await inspect(race, accepted), acceptedCommands = await history(race);
    assert.deepEqual(acceptedCommands.slice(0, -1), accepted.commands); assert.deepEqual(await recoveryRows(race), accepted.rows);
    await race.transaction(tx => assertCancellationMarketplaceRecoveryIdentityQuarantine(tx));
    const acceptedState = verifyV4History(acceptedCommands).state; assert(isV4State(acceptedState)); assertV4Invariants(acceptedState);
    assert.equal(acceptedState.initialCancellationReceipts.size, 0); assert(acceptedState.haltReason);
    assert.equal(balance(acceptedState, "bsc-sim-binance-peg-usdt", `listing:${acceptedFixture.canonical.walletListingId}`), BigInt("300000000000000000000"));
    assert.equal(balance(acceptedState, "bsc-sim-binance-peg-usdt", `trade:${acceptedFixture.canonical.walletTradeId}`), BigInt("200000000000000000000"));
    checks.push("Two distinct PostgreSQL backends visibly serialize on one fresh target; one restores the inherited-paused accepted BSC trade with 200 reserved and 300 available, without cancellation");

    stage = "source histories remain paused and exact";
    assert.deepEqual(await history(source), cancelled.commands); assert.deepEqual(await history(acceptedSource), accepted.commands);
    assert.equal((await cancelledFixture.coordinator.inspect(cancelledFixture.ownerInput)).wallet.halted, true);
    assert.equal((await acceptedFixture.coordinator.inspect(acceptedFixture.ownerInput)).wallet.halted, true);
    checks.push("Both source histories remain unchanged and paused; every recovered target remains paused and credential-free");
    return { kind: "alpha-wallet-native-cancellation-marketplace-recovery-v1", mode: MODE, status: "passed", checks,
      cancelledSource: cancelled.inspection.checkpoint, cancelledRestored: recovered.restored,
      acceptedSource: accepted.inspection.checkpoint, acceptedRestored: acceptedRecovered.restored,
      canonicalRowCounts: cancelled.inspection.canonicalRowCounts, predecessorRowCounts: cancelled.inspection.predecessorRowCounts,
      coordinationRowCounts: cancelled.inspection.coordinationRowCounts,
      allSourcesPaused: true, allTargetsPaused: true, credentialsRestored: false, historicalContextsRestored: false,
      providerSubmissions: 0, externalMessages: 0, productionWrites: 0,
      cancellationCount: 1, cancelledListingAvailableRaw: "500000000", cancelledTradeReservedRaw: "0",
      acceptedListingAvailableRaw: "300000000000000000000", acceptedTradeReservedRaw: "200000000000000000000",
      concurrentRestoreResults: { fulfilled: 1, rejected: 1, distinctBackends: firstPid !== secondPid, advisoryWaitObserved: waitObserved, secondAttempts },
      limits: ["Disposable PostgreSQL fixtures and synthetic identities/funds only.",
        "Unknown acknowledgement is injected after actual COMMIT; no physical network partition is simulated.",
        "Recovery grants no credential re-entry, signing, source leadership, delivery or resume.",
        "Application SQL quarantine is not a hostile-superuser DDL security boundary."] };
  } finally {
    const closed = await Promise.allSettled(open.map(store => store.close()));
    for (const result of closed) if (result.status === "rejected") throw result.reason;
  }
}
async function main() {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") { process.stdout.write(`${USAGE}\n`); return; }
  assertSimulationRuntime(MODE);
  const report = await run(argumentsOf(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: "failed", stage, error: error instanceof Error ? error.message : "Unknown cancellation recovery failure" })}\n`);
  process.exitCode = 1;
});
