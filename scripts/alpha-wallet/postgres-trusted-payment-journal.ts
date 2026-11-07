/** Three explicit empty loopback fixture databases. No provider, wallet, marketplace, signer or production IO. */
import { strict as assert } from "node:assert";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createTrustedPaymentFixture } from "../../src/lib/alpha-wallet/trusted-payment-fixture";
import { appendTrustedPaymentJournal, type TrustedPaymentJournalArchive } from "../../src/lib/alpha-wallet/trusted-payment-journal-model";
import {
  createDevelopmentTrustedPaymentJournal, initializeDevelopmentTrustedPaymentJournal, restoreDevelopmentTrustedPaymentJournal,
  TRUSTED_PAYMENT_JOURNAL_SCHEMA as SCHEMA, type TrustedPaymentJournalUnknownCommand,
} from "../../src/lib/alpha-wallet/trusted-payment-journal-store";

const MODE = "simulation-only" as const;
const USAGE = "Pass --source <explicit empty loopback alpha_wallet_dev_ URL> --restore <different empty fixture URL> --race <third empty fixture URL>. No ambient URL is read; no database is created or dropped.";
let stage = "explicit fixture arguments";
type Row = Record<string, unknown>;
function argumentsOf(args: string[]) {
  assert.equal(args.length, 6, USAGE);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!;
    assert(["--source", "--restore", "--race"].includes(key) && !values.has(key)
      && args[index + 1] && !args[index + 1]!.startsWith("--"), USAGE);
    values.set(key, args[index + 1]!);
  }
  assert.equal(values.size, 3, USAGE);
  assert.equal(new Set([...values.values()].map(value => decodeURIComponent(new URL(value).pathname))).size, 3, USAGE);
  return { source: values.get("--source")!, restore: values.get("--restore")!, race: values.get("--race")! };
}
function bound(tx: WalletSql): WalletStore { return { transaction: work => work(tx), close: async () => undefined }; }
function wrap(store: WalletStore, adapt: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(adapt(tx))), close: async () => undefined };
}
async function refused(work: () => Promise<unknown>) {
  let rejected = false;
  try { await work(); } catch { rejected = true; }
  assert(rejected, "Expected independent refusal");
}
async function assertFresh(store: WalletStore) {
  await store.transaction(async tx => {
    assert.equal((await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'")).rows.length, 0);
    assert.equal((await tx.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows.length, 0);
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(role.rows[0]?.permitted, true, "The native drill requires the supplied fixture owner");
  });
}
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined); return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 20_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function waitForLock(observer: WalletStore, pid: number) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await observer.transaction(tx => tx.query<{ waiting: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting", [pid]));
    if (result.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Native fiat singleton lock wait was not observed");
}
async function contend<First, Second>(first: WalletStore, second: WalletStore, observer: WalletStore,
  firstAction: (store: WalletStore) => Promise<First>, secondAction: (store: WalletStore) => Promise<Second>) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0;
  const firstHeld: WalletStore = { close: async () => undefined, transaction: work => first.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const result = await work(tx); held.resolve(); await bounded(release.promise, "held fiat writer release"); return result;
  }) };
  const secondObserved: WalletStore = { close: async () => undefined, transaction: work => second.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid,revision FROM ${SCHEMA}.head WHERE singleton`)).rows[0]!.pid;
    if (secondAttempts === 1) started.resolve(); return work(tx);
  }) };
  const winner = firstAction(firstHeld); void winner.catch(held.reject);
  await bounded(held.promise, "first fiat writer fence");
  const follower = secondAction(secondObserved); void follower.catch(started.reject);
  try {
    await bounded(started.promise, "second fiat writer snapshot");
    assert.notEqual(firstPid, secondPid); await waitForLock(observer, secondPid); release.resolve();
    const outcomes = await bounded(Promise.allSettled([winner, follower]), "native fiat writer outcomes");
    assert.equal(outcomes[0].status, "fulfilled"); assert(secondAttempts >= 2, "The follower must retry its entire stale SERIALIZABLE decision");
    if (outcomes[0].status !== "fulfilled") assert.fail("The held first writer did not commit");
    return { first: outcomes[0].value, second: outcomes[1], evidence: { firstBackendPid: firstPid,
      secondBackendPid: secondPid, distinctBackends: true, lockWaitObserved: true, serializationAttempts: secondAttempts } };
  } finally { release.resolve(); await Promise.allSettled([winner, follower]); }
}
function forgedAppend(before: TrustedPaymentJournalArchive, prepared: unknown, status: "recording" | null) {
  const revision = before.checkpoint.revision + 1, occurredAtMs = before.checkpoint.lastCommandAtMs;
  const command = { type: "record", operationId: "direct_forged_append", prepared }, inputHash = walletDigest(command);
  const state = { ...before.state, status, haltReason: null }, stateHash = walletDigest(state);
  const eventHash = walletDigest({ revision, operationId: command.operationId, inputHash, occurredAtMs,
    previousEventHash: before.checkpoint.eventHash, stateHash, disposition: "recorded", status });
  const receipt = { revision, operationId: command.operationId, inputHash, eventHash, stateHash,
    disposition: "recorded", status, executionAuthority: false, releaseAuthority: false };
  const record = { revision, operationId: command.operationId, inputHash, command, occurredAtMs,
    previousEventHash: before.checkpoint.eventHash, eventHash, stateHash, receipt };
  const body = { kind: before.kind, formatVersion: before.formatVersion, mode: before.mode, bootstrap: before.bootstrap,
    records: [...before.records, record], checkpoint: { revision, eventHash, stateHash, lastCommandAtMs: occurredAtMs }, state };
  return { ...body, archiveSha256: walletDigest(body) };
}
async function directAppend(store: WalletStore, archive: ReturnType<typeof forgedAppend>, didInsert: () => void) {
  await store.transaction(async tx => {
    const record = archive.records.at(-1)!;
    await tx.query(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
    await tx.query(`INSERT INTO ${SCHEMA}.commands(revision,operation_id,input_hash,record_json,owner_transaction_id)
      VALUES($1,$2,$3,$4::jsonb,txid_current()::text)`, [record.revision, record.operationId, record.inputHash, JSON.stringify(record)]);
    didInsert();
    await tx.query(`UPDATE ${SCHEMA}.head SET archive_json=$1::jsonb,revision=$2,event_hash=$3,state_hash=$4,archive_sha256=$5 WHERE singleton`,
      [JSON.stringify(archive), archive.checkpoint.revision, archive.checkpoint.eventHash, archive.checkpoint.stateHash, archive.archiveSha256]);
  });
}

async function main() {
  assertSimulationRuntime(MODE); const args = argumentsOf(process.argv.slice(2)), checks: string[] = [], stores: WalletStore[] = [];
  try {
    // Acquire sequentially so even an acquisition refusal closes every already admitted pool.
    const connect = async (connectionString: string) => {
      const store = await createPostgresWalletStore({ mode: MODE, connectionString }); stores.push(store); return store;
    };
    const source = await connect(args.source), reopened = await connect(args.source), target = await connect(args.restore), targetReopened = await connect(args.restore);
    const first = await connect(args.race), second = await connect(args.race), observer = await connect(args.race);
    stage = "three fresh isolated fixture targets";
    await assertFresh(source); await assertFresh(target); await assertFresh(first);
    checks.push("three explicit distinct empty loopback fixture databases are admitted without ambient targets");
    const fixture = createTrustedPaymentFixture(), sourceId = "native_fiat_source", targetId = "native_fiat_restore";
    const makeSource = (store: WalletStore) => createDevelopmentTrustedPaymentJournal({ mode: MODE, store, storeId: sourceId,
      manifest: fixture.manifest, clock: fixture.now });
    const initial = await initializeDevelopmentTrustedPaymentJournal({ mode: MODE, store: source, manifest: fixture.manifest,
      sourceStoreId: sourceId, clock: fixture.now });
    assert.deepEqual(await initializeDevelopmentTrustedPaymentJournal({ mode: MODE, store: source,
      manifest: fixture.manifest, clock: fixture.now }), initial);
    checks.push("immutable source admission and original physical identity survive idempotent initialization");
    const prepared = await fixture.reader().prepare(fixture.request), input = { operationId: "actual_commit_lost_reply", prepared };
    const journal = makeSource(source);
    let sourceCommitted = false, unknown: unknown;
    const lost: WalletStore = { close: async () => undefined, async transaction(work) {
      await source.transaction(work); sourceCommitted = true;
      throw new CommitOutcomeUnknownError(new Error("Fixture reply loss after actual native fiat COMMIT"));
    } };
    stage = "actual native evidence commit and lost acknowledgement";
    try { await makeSource(lost).record(input); } catch (error) { unknown = error; }
    assert(sourceCommitted && unknown instanceof CommitOutcomeUnknownError);
    const recovery = (unknown as CommitOutcomeUnknownError & { trustedPaymentJournalRecovery: TrustedPaymentJournalUnknownCommand }).trustedPaymentJournalRecovery;
    assert(recovery);
    const recovered = await makeSource(reopened).reconcileUnknown(recovery);
    assert.equal(recovered.status, "committed"); assert.equal(recovered.receipt?.disposition, "recorded");
    const originalReceipt = recovered.receipt!;
    assert.deepEqual(await makeSource(reopened).record(input), originalReceipt);
    const retained = await journal.inspect(); assert.equal(retained.records.length, 1); assert.equal(retained.state.payments.length, 1);
    checks.push("actual native COMMIT acknowledgement loss retains exact physical-target recovery metadata");
    checks.push("a separate pool recovers and retries the historical receipt without adding another observation");

    stage = "native statement and deferred failure rollback";
    for (const point of ["command", "head", "seal"] as const) {
      let injected = false;
      const faulty = wrap(source, tx => ({
        async query<T extends Row>(sql: string, params?: unknown[]) {
          const result = await tx.query<T>(sql, params);
          if ((point === "command" && sql.startsWith(`INSERT INTO ${SCHEMA}.commands`))
            || (point === "head" && sql.startsWith(`UPDATE ${SCHEMA}.head SET archive_json`))) {
            injected = true; await tx.query("SELECT 1/0 /* native fiat rollback proof */");
          }
          return result;
        },
        async exec(sql: string) {
          await tx.exec(sql);
          if (point === "seal" && sql === "SET CONSTRAINTS ALL IMMEDIATE") {
            injected = true; await tx.query("SELECT 1/0 /* native fiat final seal failure */");
          }
        },
      }));
      await refused(() => makeSource(faulty).record({ operationId: `rollback_${point}`, prepared }));
      assert(injected); assert.deepEqual(await journal.inspect(), retained);
      checks.push(`native failure after ${point} rolls back the entire observation, receipt and head`);
    }
    stage = "native SQL guards and physical participant refusal";
    const next = appendTrustedPaymentJournal(retained, { type: "record", operationId: "unowned_direct_insert", prepared }, fixture.now()).archive.records.at(-1)!;
    await refused(() => source.transaction(tx => tx.query(`INSERT INTO ${SCHEMA}.commands(revision,operation_id,input_hash,record_json,owner_transaction_id)
      VALUES($1,$2,$3,$4::jsonb,txid_current()::text)`, [next.revision, next.operationId, next.inputHash, JSON.stringify(next)])));
    checks.push("independent SQL inserts require the real acquired singleton transaction");
    for (const sql of [`UPDATE ${SCHEMA}.commands SET operation_id='rewritten'`, `DELETE FROM ${SCHEMA}.commands`, `TRUNCATE ${SCHEMA}.commands`, `TRUNCATE ${SCHEMA}.head CASCADE`])
      await refused(() => source.transaction(tx => tx.exec(sql)));
    checks.push("independent SQL cannot rewrite or remove command history and physical identity");
    await refused(() => source.transaction(async tx => {
      await tx.query(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
      await tx.query(`UPDATE ${SCHEMA}.head SET revision=revision+1,archive_json=jsonb_set(archive_json,'{checkpoint,revision}',to_jsonb(revision+1)) WHERE singleton`);
    }));
    checks.push("deferred SQL completeness rejects an advanced head without its complete immutable command");
    let nullInserted = false;
    await refused(() => directAppend(source, forgedAppend(retained, prepared, null), () => { nullInserted = true; }));
    assert.equal(nullInserted, false);
    checks.push("SQL independently rejects hash-consistent JSON-null receipt and state status");
    let caughtCompanion = false;
    await refused(() => source.transaction(async tx => {
      await tx.exec("CREATE SCHEMA alpha_wallet_simulation");
      try { await makeSource(bound(tx)).inspect(); } catch { caughtCompanion = true; }
      await tx.query("SELECT 1");
    })); assert(caughtCompanion);
    checks.push("a swallowed companion-namespace refusal poisons and rolls back only its original physical owner");
    let caughtTimezone = false;
    await refused(() => source.transaction(async tx => {
      await tx.exec("SET LOCAL TIME ZONE 'Europe/Bucharest'");
      try { await makeSource(bound(tx)).inspect(); } catch { caughtTimezone = true; }
      await tx.query("SELECT 1");
    })); assert(caughtTimezone);
    checks.push("a swallowed non-UTC runtime refusal cannot commit its same physical transaction");
    assert.deepEqual(await journal.inspect(), retained);

    stage = "stopped source export and independent SQL terminal fence";
    await refused(() => journal.exportBackup());
    await journal.pause({ operationId: "stop_source", reasonCode: "maintenance" });
    const stopped = await journal.inspect(); let stoppedInserted = false;
    await refused(() => directAppend(source, forgedAppend(stopped, prepared, "recording"), () => { stoppedInserted = true; }));
    assert.equal(stoppedInserted, false); assert.deepEqual(await journal.inspect(), stopped);
    assert.deepEqual(await journal.record(input), originalReceipt);
    checks.push("active export is refused and a stopped source cannot append or reset even through independent SQL");
    const backup = await journal.exportBackup();
    assert.equal(backup.sourceStopped, true); assert.deepEqual(backup.archive, stopped);
    checks.push("stopped export retains its complete immutable archive and independent checksum");

    stage = "fresh native restoration rollback boundaries";
    const restore = (store: WalletStore, expectedChecksum = backup.backupSha256) => restoreDevelopmentTrustedPaymentJournal({
      mode: MODE, store, backup, expectedChecksum, operationId: "restore_native_copy", targetStoreId: targetId,
      acknowledgeFreshTarget: true, clock: fixture.now });
    await refused(() => restore(target, "f".repeat(64))); await assertFresh(target);
    checks.push("a mismatched independently retained backup checksum leaves the fresh target empty");
    for (const point of ["schema", "head", "command", "seal"] as const) {
      let injected = false;
      const faulty = wrap(target, tx => ({
        async query<T extends Row>(sql: string, params?: unknown[]) {
          const result = await tx.query<T>(sql, params);
          if ((point === "head" && sql.startsWith(`INSERT INTO ${SCHEMA}.head`))
            || (point === "command" && sql.startsWith(`INSERT INTO ${SCHEMA}.commands`))) {
            injected = true; await tx.query("SELECT 1/0 /* native fiat restore rollback */");
          }
          return result;
        },
        async exec(sql: string) {
          await tx.exec(sql);
          if ((point === "schema" && sql.includes(`CREATE SCHEMA ${SCHEMA}`)) || (point === "seal" && sql === "SET CONSTRAINTS ALL IMMEDIATE")) {
            injected = true; await tx.query("SELECT 1/0 /* native fiat restoration final seal failure */");
          }
        },
      }));
      await refused(() => restore(faulty)); assert(injected); await assertFresh(target);
      checks.push(`native restore failure after ${point} rolls back all fresh schema, imported history and quarantine`);
    }
    let restoreCommitted = false, restoreUnknown: unknown;
    const lostRestore: WalletStore = { close: async () => undefined, async transaction(work) {
      await target.transaction(work); restoreCommitted = true;
      throw new CommitOutcomeUnknownError(new Error("Fixture restore reply loss after actual native COMMIT"));
    } };
    stage = "actual native restoration commit and lost acknowledgement";
    try { await restore(lostRestore); } catch (error) { restoreUnknown = error; }
    assert(restoreCommitted && restoreUnknown instanceof CommitOutcomeUnknownError);
    const restoreRecovery = (restoreUnknown as CommitOutcomeUnknownError & { trustedPaymentJournalRecovery: TrustedPaymentJournalUnknownCommand }).trustedPaymentJournalRecovery;
    assert(restoreRecovery);
    const copy = createDevelopmentTrustedPaymentJournal({ mode: MODE, store: targetReopened, storeId: targetId,
      manifest: fixture.manifest, clock: fixture.now });
    const restored = await copy.reconcileUnknown(restoreRecovery);
    assert.equal(restored.status, "committed"); assert.equal(restored.receipt?.disposition, "restored-quarantined");
    const copyArchive = await copy.inspect();
    assert.deepEqual(copyArchive.records.slice(0, -1), stopped.records); assert.equal(copyArchive.state.status, "quarantined");
    assert.equal(copyArchive.state.restoredTargetStoreId, targetId); assert.equal(copyArchive.bootstrap.sourceStoreId, sourceId);
    assert.deepEqual(await copy.lookupReceipt({ operationId: input.operationId, inputHash: originalReceipt.inputHash }), originalReceipt);
    assert.deepEqual(await copy.record(input), originalReceipt);
    checks.push("actual native restore COMMIT reply loss is reconciled on the exact new physical target");
    checks.push("fresh restore preserves all source receipts and appends one permanent nonauthoritative quarantine");
    await refused(() => copy.record({ operationId: "cannot_resume_restored", prepared }));
    await refused(() => copy.exportBackup()); await refused(() => restore(target));
    const absent = await copy.reconcileUnknown({ operationId: "unknown_source_operation", inputHash: "a".repeat(64),
      expectedStoreId: targetId, expectedPreCommandCheckpoint: stopped.checkpoint });
    assert.equal(absent.status, "unresolved"); assert.deepEqual(await journal.inspect(), stopped);
    checks.push("restored history cannot resume, reexport, overwrite or prove absence of later source operations");

    stage = "native competing writer admission";
    const raceFixture = createTrustedPaymentFixture({ method: "Face-to-Face (Meet in Person)" }), raceId = "native_fiat_race";
    await initializeDevelopmentTrustedPaymentJournal({ mode: MODE, store: first, manifest: raceFixture.manifest,
      sourceStoreId: raceId, clock: raceFixture.now });
    const makeRace = (store: WalletStore) => createDevelopmentTrustedPaymentJournal({ mode: MODE, store, storeId: raceId,
      manifest: raceFixture.manifest, clock: raceFixture.now });
    const shared = await raceFixture.reader().prepare(raceFixture.request), sharedInput = { operationId: "same_native_operation", prepared: shared };
    const exact = await contend(first, second, observer,
      store => makeRace(store).record(sharedInput), store => makeRace(store).record(sharedInput));
    assert.equal(exact.second.status, "fulfilled"); if (exact.second.status !== "fulfilled") assert.fail("Exact competing retry was refused");
    assert.deepEqual(exact.first, exact.second.value);
    assert.equal((await makeRace(first).inspect()).checkpoint.revision, 1);
    checks.push("two actual PostgreSQL backends contend on the physical fence and exact retries produce one receipt");
    const corroboration = await contend(first, second, observer,
      store => makeRace(store).record({ operationId: "native_provenance_a", prepared: shared }),
      store => makeRace(store).record({ operationId: "native_provenance_b", prepared: shared }));
    assert.equal(corroboration.first.disposition, "corroborated"); assert.equal(corroboration.second.status, "fulfilled");
    if (corroboration.second.status !== "fulfilled") assert.fail("Corroborating competitor was refused");
    assert.equal(corroboration.second.value.disposition, "corroborated");
    let raceArchive = await makeRace(first).inspect();
    assert.equal(raceArchive.records.length, 3); assert.equal(raceArchive.state.payments.length, 1);
    assert.equal(raceArchive.state.payments[0]!.revisions.length, 1);
    checks.push("different operation keys serialize complete decisions while retaining one exclusive native payment attribution");
    raceFixture.observation.revision = 2; raceFixture.observation.status = "revoked";
    raceFixture.setNow(raceFixture.now() + 10); raceFixture.observation.observedAtMs = raceFixture.now() - 1;
    const revoked = await raceFixture.reader().prepare(raceFixture.request);
    stage = "revocation competing with stale settlement";
    const revocation = await contend(first, second, observer,
      store => makeRace(store).record({ operationId: "native_revocation", prepared: revoked }),
      store => makeRace(store).record({ operationId: "new_stale_settlement", prepared: shared }));
    assert.equal(revocation.first.disposition, "source-revocation-quarantined"); assert.equal(revocation.second.status, "rejected");
    if (revocation.second.status !== "rejected") assert.fail("A new stale settlement operation escaped committed revocation");
    assert.equal((revocation.second.reason as { code?: string }).code, "STOPPED");
    raceArchive = await makeRace(first).inspect();
    assert.equal(raceArchive.checkpoint.revision, 4); assert.equal(raceArchive.state.status, "quarantined");
    assert.deepEqual(raceArchive.state.payments[0]!.revisions.map(row => row.status), ["settled", "revoked"]);
    assert.deepEqual(await makeRace(second).record(sharedInput), exact.first);
    assert.deepEqual(await makeRace(first).inspect(), raceArchive);
    checks.push("committed source revocation forces the stale competitor to retry its whole decision and refuse a new settlement operation");
    checks.push("historical positive receipt recovery preserves the later negative revision and permanent quarantine");

    console.log(JSON.stringify({ kind: "development-trusted-payment-journal-native-proof", mode: MODE, executionAuthority: false, releaseAuthority: false,
      status: "passed", success: true, checks, checkCount: checks.length,
      native: { actualSourceCommitAcknowledgementLoss: sourceCommitted, actualRestoreCommitAcknowledgementLoss: restoreCommitted,
        races: { exactOperation: exact.evidence, corroboration: corroboration.evidence, revocation: revocation.evidence } },
      source: { physicalStoreId: sourceId, checkpoint: stopped.checkpoint, archiveSha256: stopped.archiveSha256, backupSha256: backup.backupSha256 },
      restore: { physicalStoreId: targetId, checkpoint: copyArchive.checkpoint, archiveSha256: copyArchive.archiveSha256, status: copyArchive.state.status },
      contention: { checkpoint: raceArchive.checkpoint, archiveSha256: raceArchive.archiveSha256,
        immutableCommands: raceArchive.records.length, nativePayments: raceArchive.state.payments.length, status: raceArchive.state.status } }, null, 2));
  } finally { await Promise.allSettled(stores.map(store => store.close())); }
}
main().catch(error => {
  // Connection strings and source records are intentionally absent from failure output.
  console.error(JSON.stringify({ kind: "development-trusted-payment-journal-native-proof", status: "failed", stage,
    error: error instanceof Error ? error.name : "unclassified refusal" }));
  process.exitCode = 1;
});
