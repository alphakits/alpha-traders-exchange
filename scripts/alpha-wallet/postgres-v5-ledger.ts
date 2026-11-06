/** Native PostgreSQL proof for isolated V5 buyer claims/disputes. Synthetic data only. */
import { strict as assert } from "node:assert";
import { walletDigest, walletJson } from "../../src/lib/alpha-wallet/commands";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { paymentClaimPlannerDigest, v5Command, v5CommandKey, type V5CommandOf } from "../../src/lib/alpha-wallet/v5-commands";
import { createV4DurableWallet } from "../../src/lib/alpha-wallet/v4-durable";
import { createV5DurableWallet, upgradeDurableWalletV5, type V5WalletSnapshot } from "../../src/lib/alpha-wallet/v5-durable";
import { applyV5Command, baseV4StateForV5, isV5State, type V5InitialPaymentClaimReceipt } from "../../src/lib/alpha-wallet/v5-engine";
import { exportV5WalletBackup, inspectV5WalletBackup, restoreV5WalletBackup, type WalletV5RestoreResult } from "../../src/lib/alpha-wallet/v5-backup";
import { OPERATOR } from "./durable-fixtures";
import { V3_RESTORE_AT, v3FixtureCheckpoint, v3FixtureHistory } from "./v3-durable-fixtures";
import { buildV4CancellationFixture } from "./v4-durable-fixtures";
import { buildV5PaymentFixture, v5FixtureClaimInput, v5FixtureDisputeInput } from "./v5-durable-fixtures";
const MODE = "simulation-only" as const;
const USAGE = "Pass --fresh-simulation-databases --source-connection-string <explicit loopback alpha_wallet_dev_ URL> --race-connection-string <different empty loopback fixture URL> --target-connection-string <third empty loopback fixture URL>. No ambient URL is used and no database is created or dropped.";
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
async function competingClaim(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore,
  command: V5CommandOf<"claimInitialPayment">, at: number) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0;
  const first = firstStore.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const result = await createV5DurableWallet({ mode: MODE, store: bound(tx), clock: () => at }).execute(command);
    held.resolve(); await bounded(release.promise, "first financial claim release"); return result;
  });
  void first.catch(held.reject);
  await bounded(held.promise, "first financial claim lock");
  const second = secondStore.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,revision FROM alpha_wallet_simulation.head WHERE singleton=true")).rows[0]!.pid;
    if (secondAttempts === 1) started.resolve();
    return createV5DurableWallet({ mode: MODE, store: bound(tx), clock: () => at }).execute({ ...command, requestId: "native-v5-alternate-operation" });
  });
  void second.catch(started.reject);
  try {
    await bounded(started.promise, "second financial claim snapshot");
    assert.notEqual(firstPid, secondPid);
    await waitForLock(observer, secondPid);
    release.resolve();
    const results = await bounded(Promise.all([first, second]), "competing acceptance outcomes");
    assert(secondAttempts >= 2); assert.equal(results[0].replayed, false); assert.equal(results[1].replayed, true);
    assert.equal(results[0].commandKey, results[1].commandKey); assert.equal(results[0].eventHash, results[1].eventHash);
    assert.deepEqual(results[0].result, results[1].result);
    return { secondAttempts, distinctBackends: true, lockWaitObserved: true, committedClaims: 1,
      originalRevision: results[0].revision, originalEventHash: results[0].eventHash };
  } finally { release.resolve(); await Promise.allSettled([first, second]); }
}
async function competingRestore(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore, backup: string) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0, committed = false;
  let result: WalletV5RestoreResult | undefined;
  const first = (async () => {
    await firstStore.transaction(async tx => {
      firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      result = await restoreV5WalletBackup({ mode: MODE, store: bound(tx), backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
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
    return restoreV5WalletBackup({ mode: MODE, store: bound(tx), backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
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

async function footprint(store: WalletStore) {
  const snapshot = await createV5DurableWallet({ mode: MODE, store }).snapshot();
  const tables = await store.transaction(async tx => {
    const names = (await tx.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relkind='r' AND c.relname<>'head' ORDER BY c.relname`)).rows;
    const rows: Record<string, unknown> = {};
    for (const { name } of names) rows[name] = (await tx.query(`SELECT to_jsonb(t) AS payload FROM alpha_wallet_simulation.${name} t ORDER BY to_jsonb(t)::text`)).rows;
    return rows;
  });
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), tables };
}
async function rejectedRawClaim(store: WalletStore, snapshot: V5WalletSnapshot, original: V5CommandOf<"claimInitialPayment">,
  failure: "wrong buyer" | "missing receipt" | "principal movement") {
  const command = structuredClone(original);
  const applied = applyV5Command(snapshot.state, command, { ...v3FixtureCheckpoint(snapshot), at: command.input.claimedAtMs });
  const result = structuredClone(applied.result as V5InitialPaymentClaimReceipt);
  if (failure === "wrong buyer") {
    command.actor.id = "native-unrelated-buyer";
    command.input.plannerInputDigest = paymentClaimPlannerDigest(command.input, command.actor.id);
    result.actorUserId = command.actor.id; result.input = structuredClone(command.input); result.commandKey = v5CommandKey(command);
    result.plannerInputDigest = command.input.plannerInputDigest; result.inputDigest = walletDigest({ actor: command.actor, input: command.input });
  }
  const revision = snapshot.revision + 1, key = v5CommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(result), stateHash = walletDigest(applied.state);
  const eventHash = walletDigest({ revision, commandKey: key, at: command.input.claimedAtMs, inputHash, resultHash, stateHash, previousHash: snapshot.eventHash });
  await store.transaction(async tx => {
    await tx.query("SELECT set_config('alpha_wallet.writer_protocol','simulation-v5',true)");
    await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true");
    await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
      result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
    [revision, key, command.type, command.input.claimedAtMs, JSON.stringify(command), inputHash, JSON.stringify(walletJson(result)), resultHash, stateHash, snapshot.eventHash, eventHash]);
    if (failure !== "missing receipt") await tx.query(`INSERT INTO alpha_wallet_simulation.initial_payment_claim_receipts
      (claim_key,platform_request_id,wallet_trade_id,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [result.claimKey, result.platformRequestId, result.walletTradeId, revision, JSON.stringify(walletJson(result))]);
    if (failure === "principal movement") {
      const journalId = `journal-${snapshot.state.journal.length + 1}`, asset = command.input.terms.assetId;
      await tx.query("INSERT INTO alpha_wallet_simulation.journals(journal_id,command_revision,asset_id,operation) VALUES($1,$2,$3,$4)", [journalId, revision, asset, `v5:${key}`]);
      await tx.query("INSERT INTO alpha_wallet_simulation.entries(journal_id,asset_id,account,delta_units) VALUES($1,$2,$3,-1),($1,$2,$4,1)",
        [journalId, asset, `trade:${result.walletTradeId}`, `listing:${result.walletListingId}`]);
    }
    await tx.query("UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2 WHERE singleton=true", [revision, eventHash]);
  });
}
async function verify(urls: ReturnType<typeof argumentsOf>) {
  const stores: WalletStore[] = [], checks: string[] = [];
  const connect = async (connectionString: string) => { const store = await createPostgresWalletStore({ mode: MODE, connectionString }); stores.push(store); return store; };
  try {
    stage = "fresh isolated native databases";
    const source = await connect(urls.source), races = await connect(urls.races), target = await connect(urls.target);
    await Promise.all([fresh(source), fresh(races), fresh(target)]);
    const f = await buildV5PaymentFixture(source, { claim: false, unknownWithdrawal: true });
    assert(isV5State(f.before.state)); assert.deepEqual(baseV4StateForV5(f.before.state), f.original.snapshot.state);
    const prefix = await source.transaction(tx => v3FixtureHistory(tx, f.original.snapshot.revision));
    checks.push("Explicit claim-only enrollment preserves the exact V4 state, old receipt meanings and original unknown withdrawal");

    stage = "direct SQL financial boundary";
    for (const failure of ["wrong buyer", "missing receipt", "principal movement"] as const) {
      const before = await footprint(source);
      await assert.rejects(rejectedRawClaim(source, f.before, f.claimCommand, failure));
      assert.deepEqual(await footprint(source), before);
      checks.push(`Native SQL rejects ${failure} with no committed receipt, history or principal change`);
    }
    stage = "claim participant rollback";
    for (const needle of ["INSERT INTO alpha_wallet_simulation.commands", "INSERT INTO alpha_wallet_simulation.initial_payment_claim_receipts", "UPDATE alpha_wallet_simulation.head SET revision="]) {
      const before = await footprint(source);
      const broken = wrapped(source, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values); if (sql.includes(needle)) throw new Error("Injected after native V5 write"); return result;
      } }));
      await assert.rejects(createV5DurableWallet({ mode: MODE, store: broken, clock: () => f.claimCommand.input.claimedAtMs }).execute(f.claimCommand));
      assert.deepEqual(await footprint(source), before);
    }
    checks.push("Native failures after command, claim receipt and head writes each roll back the complete decision");

    stage = "claim lost commit reply";
    let committed = false;
    const uncertain: WalletStore = { transaction: async work => {
      const result = await source.transaction(work); void result; committed = true; throw new CommitOutcomeUnknownError(new Error("Lost native claim commit reply"));
    }, close: async () => undefined };
    await assert.rejects(createV5DurableWallet({ mode: MODE, store: uncertain, clock: () => f.claimCommand.input.claimedAtMs }).execute(f.claimCommand), CommitOutcomeUnknownError);
    assert(committed);
    const wallet = createV5DurableWallet({ mode: MODE, store: source, clock: () => f.claimCommand.input.claimedAtMs + 1 });
    const claim = await wallet.execute({ ...f.claimCommand, requestId: "native-claim-recovery" }); assert.equal(claim.replayed, true);
    const afterClaim = await wallet.snapshot(); assert.equal(afterClaim.revision, f.before.revision + 1);
    assert.deepEqual(afterClaim.state.accounts, f.before.state.accounts); assert.deepEqual(afterClaim.state.journal, f.before.state.journal);
    checks.push("One actual committed buyer claim survives a lost reply and returns its original receipt under a new transport operation");

    stage = "exact buyer dispute freeze";
    const dispute = v5Command("freezeInitialDispute", f.buyer, "native-buyer-dispute", v5FixtureDisputeInput(afterClaim, afterClaim.lastCommandAtMs + 1));
    const frozen = await wallet.execute(dispute); assert.equal(frozen.replayed, false);
    const afterDispute = await wallet.snapshot(); assert(isV5State(afterDispute.state));
    assert.deepEqual(afterDispute.state.accounts, f.before.state.accounts); assert.deepEqual(afterDispute.state.journal, f.before.state.journal);
    assert.equal(afterDispute.state.trades.get(frozen.result.walletTradeId)!.disputed, true);
    assert.equal(afterDispute.state.trades.get(frozen.result.walletTradeId)!.status, "payment_reported");
    await assert.rejects(wallet.execute({ ...dispute, requestId: "seller-cannot-dispute", actor: { kind: "seller", id: f.buyer.id } }));
    await assert.rejects(wallet.execute(f.original.cancellation));
    checks.push("Only the original buyer can freeze its exact preceding V5 claim; principal stays reserved and new cancellation stays fenced");
    assert.equal((await wallet.execute(f.original.original.historicalDispatch!)).result.shouldDispatch, false);
    assert.deepEqual(afterDispute.state.payouts, f.original.snapshot.state.payouts);
    checks.push("Historical unknown dispatch remains held with one original submission and retry cannot dispatch again");

    stage = "native source-bound migration rollback";
    const old = await buildV4CancellationFixture(races, { cancel: false, unknownWithdrawal: false });
    const continuation = v5Command("continueFromV4", OPERATOR, "native-v5-race-upgrade", { checkpoint: v3FixtureCheckpoint(old.snapshot) });
    let sawDDL = false;
    const brokenUpgrade = wrapped(races, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands") && values?.[2] === "continueFromV4") {
        sawDDL = Boolean((await tx.query("SELECT to_regclass('alpha_wallet_simulation.payment_engine_continuations')::text AS name")).rows[0]?.name);
        throw new Error("Injected native failure after V5 DDL");
      }
      return tx.query<Row>(sql, values);
    } }));
    await assert.rejects(upgradeDurableWalletV5({ mode: MODE, store: brokenUpgrade, command: continuation,
      acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true, clock: () => old.now() + 1 }));
    assert(sawDDL); assert.deepEqual(await createV4DurableWallet({ mode: MODE, store: races }).snapshot(), old.snapshot);
    checks.push("A native failure after real V5 DDL leaves the exact original V4 schema and history usable");
    await upgradeDurableWalletV5({ mode: MODE, store: races, command: continuation,
      acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true, clock: () => old.now() + 1 });
    const raceSnapshot = await createV5DurableWallet({ mode: MODE, store: races }).snapshot();
    const raceCommand = v5Command("claimInitialPayment", f.buyer, "native-v5-first-claim", v5FixtureClaimInput(raceSnapshot, raceSnapshot.lastCommandAtMs + 1));
    stage = "visible two-backend claim race";
    const claimRace = await competingClaim(races, await connect(urls.races), await connect(urls.races), raceCommand, raceCommand.input.claimedAtMs);
    assert.equal((await races.transaction(tx => tx.query("SELECT * FROM alpha_wallet_simulation.initial_payment_claim_receipts"))).rows.length, 1);
    checks.push("Two visibly competing PostgreSQL backends retry the entire claim decision and commit exactly one immutable receipt");

    stage = "paused isolated export";
    await assert.rejects(exportV5WalletBackup({ mode: MODE, store: source }));
    await createV5DurableWallet({ mode: MODE, store: source, clock: () => afterDispute.lastCommandAtMs + 1 }).execute(v5Command("pause", OPERATOR, "native-v5-source-pause", null));
    const finalSource = await wallet.snapshot(), backup = await exportV5WalletBackup({ mode: MODE, store: source, clock: () => V3_RESTORE_AT - 1 });
    const inspected = inspectV5WalletBackup(backup); assert.equal(inspected.initialPaymentClaimCount, 1); assert.equal(inspected.initialDisputeFreezeCount, 1);
    assert.deepEqual(await source.transaction(tx => v3FixtureHistory(tx, f.original.snapshot.revision)), prefix);
    checks.push("Paused export retains all five engine prefixes, four continuations and original claim/dispute receipts without any new financial entry");

    stage = "visible native restore race and lost commit reply";
    const restoreRace = await competingRestore(target, await connect(urls.target), await connect(urls.target), backup);
    const restoredWallet = createV5DurableWallet({ mode: MODE, store: target }), restored = await restoredWallet.snapshot();
    assert.equal(restored.revision, finalSource.revision + 1); assert(restored.state.haltReason);
    assert.equal(walletDigest(restored.state), restoreRace.result.restored.stateHash);
    assert.deepEqual(await target.transaction(tx => v3FixtureHistory(tx, finalSource.revision)), JSON.parse(backup).commands);
    assert.deepEqual(restored.state.accounts, finalSource.state.accounts); assert.deepEqual(restored.state.journal, finalSource.state.journal);
    assert.equal((await restoredWallet.execute({ ...f.claimCommand, requestId: "native-restored-claim" })).eventHash, claim.eventHash);
    assert.equal((await restoredWallet.execute(dispute)).eventHash, frozen.eventHash);
    assert.equal((await restoredWallet.execute(f.original.original.historicalDispatch!)).result.shouldDispatch, false);
    await assert.rejects(restoreV5WalletBackup({ mode: MODE, store: target, backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT }));
    checks.push("Competing fresh restores visibly contend; one exact history plus quarantine commits and a lost reply is resolved by inspecting the same target");
    await target.close(); stores.splice(stores.indexOf(target), 1);
    const reopened = await createV5DurableWallet({ mode: MODE, store: await connect(urls.target) }).snapshot();
    assert.equal(reopened.eventHash, restored.eventHash); assert.equal(walletDigest(reopened.state), walletDigest(restored.state));
    checks.push("A fresh native connection reopens the exact quarantined state without resumed authority");
    stage = "complete";
    return { mode: MODE, scope: "isolated-v5-payment-claim-dispute", result: "passed", checks,
      originalV4PrefixCommands: f.original.snapshot.revision, principalMovedRaw: "0", principalReservedRaw: f.claimCommand.input.terms.principalRaw,
      source: { revision: finalSource.revision, eventHash: finalSource.eventHash, stateHash: walletDigest(finalSource.state), paused: true },
      backup: inspected, restored: restoreRace.result.restored, claimRace, restoreRace: restoreRace.details,
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
