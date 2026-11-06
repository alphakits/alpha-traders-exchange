/**
 * Disposable native PostgreSQL evidence recovery only. Both isolated databases
 * must already exist and be empty; this drill never creates/drops a database.
 * NODE_ENV=test TZ=UTC node --conditions=react-server --import tsx \
 *   scripts/alpha-wallet/postgres-deposit-inbox-backup.ts \
 *   --fresh-simulation-databases \
 *   --source-connection-string postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_inbox_backup_source \
 *   --target-connection-string postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_inbox_backup_target
 */
import { strict as assert } from "node:assert";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { canonicalInboxJson, digestInboxValue } from "../../src/lib/alpha-wallet/deposit-inbox-data";
import { createDevelopmentDepositInboxRecorder, initializeDevelopmentDepositInbox } from "../../src/lib/alpha-wallet/deposit-inbox-store";
import { exportDevelopmentDepositInboxBackup, inspectDevelopmentDepositInboxBackup,
  inspectRestoredDevelopmentDepositInbox, parseDevelopmentDepositInboxBackup, restoreDevelopmentDepositInboxBackup } from "../../src/lib/alpha-wallet/deposit-inbox-backup";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createDepositInboxFixture } from "./deposit-inbox-fixtures";

const MODE = "simulation-only" as const;
let stage = "explicit argument validation";
const USAGE = "Pass --fresh-simulation-databases --source-connection-string <explicit loopback alpha_wallet_dev_ URL> --target-connection-string <different explicit loopback alpha_wallet_dev_ URL>. Both databases must already exist and be empty. No environment URL is read; no database is created or dropped.";
function argumentsOf(args: string[]) {
  assert.equal(args.length, 5, USAGE);
  let fresh = false, source: string | undefined, target: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (arg === "--source-connection-string") { assert(!source && args[index + 1] && !args[index + 1].startsWith("--"), USAGE); source = args[++index]; }
    else if (arg === "--target-connection-string") { assert(!target && args[index + 1] && !args[index + 1].startsWith("--"), USAGE); target = args[++index]; }
    else assert.fail(USAGE);
  }
  assert(fresh && source && target, USAGE);
  assert.notEqual(decodeURIComponent(new URL(source).pathname), decodeURIComponent(new URL(target).pathname), "Source and target database names must differ");
  return { source, target };
}
async function freshness(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = (await tx.query(`SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'`)).rows;
    const objects = (await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'`)).rows;
    const role = (await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user")).rows;
    assert.equal(schemas.length, 0, "Fixture target must be a fresh isolated database");
    assert.equal(objects[0]?.count, "0", "Fixture target must have no public relations");
    assert.equal(role[0]?.permitted, true, "Fixture role requires superuser/BYPASSRLS for the forced-RLS simulation schema");
  });
}
async function footprint(store: WalletStore) {
  return store.transaction(async tx => ({ namespaces: (await tx.query(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%' ORDER BY nspname`)).rows,
  relations: (await tx.query(`SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' OR n.nspname='alpha_wallet_deposit_inbox_simulation' ORDER BY n.nspname,c.relname,c.relkind`)).rows }));
}
function wrap(store: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(make(tx))), close: async () => undefined };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Native fixture barrier did not arrive: ${label}`)), 10_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function observeBootstrapWait(observer: WalletStore, waitingPid: number, blockingPid: number): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt++) {
    const row = await observer.transaction(async tx => (await tx.query<{ waiting: boolean; blocker: boolean }>(`SELECT
      EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting,
      $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocker`, [waitingPid, blockingPid])).rows[0]);
    if (row?.waiting && row.blocker) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail("Competing restore did not expose the actual bootstrap-lock wait");
}

async function verifyNativeRecovery(sourceConnection: string, targetConnection: string) {
  const stores: WalletStore[] = [], checks: string[] = [];
  try {
    stage = "explicit loopback store validation";
    const source = await createPostgresWalletStore({ mode: MODE, connectionString: sourceConnection }); stores.push(source);
    const target = await createPostgresWalletStore({ mode: MODE, connectionString: targetConnection }); stores.push(target);
    stage = "fresh source and target verification";
    await Promise.all([freshness(source), freshness(target)]);
    const untouched = await footprint(target);
    checks.push("Both explicit loopback databases are empty and isolated before any inbox write");

    stage = "synthetic admission and candidate evidence";
    const fixture = createDepositInboxFixture("bsc");
    const initial = await initializeDevelopmentDepositInbox({ mode: MODE, store: source, manifest: fixture.manifest,
      storeInstanceId: "native-inbox-backup-source", requestId: "native-backup-bootstrap", clock: fixture.clock });
    const sourceId = initial.state.storeInstanceId;
    const inbox = createDevelopmentDepositInboxRecorder({ mode: MODE, store: source, manifest: fixture.manifest,
      storeInstanceId: sourceId, worker: { workerId: fixture.workerId, role: "operator" }, clock: fixture.clock });
    const job = await inbox.registerCandidateJob({ requestId: "native-backup-job", jobId: "native-backup-candidates", orderedCandidates: fixture.candidates });
    const cursor = job.cursorAfter!;
    const prepared = await fixture.prepare({ attemptId: "native-backup-observation", storeInstanceId: sourceId,
      preparationContext: inbox.preparationContext, jobId: cursor.jobId });
    const originalReceipt = await inbox.record({ requestId: "native-backup-record", prepared, candidateCursor: {
      jobId: cursor.jobId, expectedCursorRevision: cursor.commandRevision, expectedNextOrdinal: cursor.nextOrdinal,
      candidateManifestSha256: cursor.candidateManifestSha256 } });
    assert.equal(originalReceipt.disposition, "recorded");
    assert.equal(originalReceipt.cursorAfter?.nextOrdinal, 1);
    checks.push("A real PostgreSQL inbox retains full synthetic native evidence and one atomic candidate ordinal");

    stage = "active export refusal";
    const activeSnapshot = await inbox.inspect();
    await assert.rejects(exportDevelopmentDepositInboxBackup({ mode: MODE, store: source, clock: fixture.clock }));
    assert.deepEqual((await inbox.inspect()).checkpoint, activeSnapshot.checkpoint);
    checks.push("An active source cannot export and its failed export does not change the retained checkpoint");

    stage = "paused historical export";
    await inbox.pause({ requestId: "native-backup-pause", reason: "Independent synthetic evidence recovery" });
    const sourceSnapshot = await inbox.inspect();
    const backup = await exportDevelopmentDepositInboxBackup({ mode: MODE, store: source, expectedStoreInstanceId: sourceId,
      clock: () => fixture.now + 200_000 });
    const inspected = await inspectDevelopmentDepositInboxBackup(backup), archive = (await parseDevelopmentDepositInboxBackup(backup)).archive;
    assert.deepEqual(inspected.checkpoint, sourceSnapshot.checkpoint);
    assert.equal(inspected.observationCount, 1); assert.equal(inspected.eventCount, 1);
    assert.equal(inspected.candidateJobCount, 1); assert.equal(inspected.status, "paused");
    assert.equal(archive.projections.candidateCursors.at(-1)?.nextOrdinal, 1);
    checks.push("Paused export replays complete original evidence after new-admission freshness has expired");
    const readsBeforeRecovery = fixture.calls.length;
    const restore = (store: WalletStore, requestId = "native-restore", serialized = backup, checksum = inspected.checksum) =>
      restoreDevelopmentDepositInboxBackup({ mode: MODE, store, backup: serialized, expectedChecksum: checksum,
        acknowledgeFreshTarget: true, requestId, clock: () => fixture.now + 500_000 });

    stage = "corrupt portable evidence refusal";
    const changed = JSON.parse(backup);
    changed.archive.evidenceBlobs[0].observation.reads[0].responseBody += " ";
    const { checksum: ignored, ...changedBody } = changed; void ignored;
    const changedChecksum = digestInboxValue("deposit-inbox-backup", changedBody);
    const tampered = canonicalInboxJson({ ...changedBody, checksum: changedChecksum });
    await assert.rejects(restore(target, "corrupt-native-restore", tampered, changedChecksum));
    await assert.rejects(restore(target, "wrong-native-checksum", backup, "0".repeat(64)));
    await assert.rejects(restore(target, "duplicate-native-json", backup.replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1')));
    assert.deepEqual(await footprint(target), untouched);
    checks.push("Rewritten checksums cannot conceal altered raw evidence and ambiguous JSON; the fresh target remains untouched");

    for (const boundary of ["schema", "blob", "original command", "restore command", "quarantine", "recovery receipt", "deferred seal"] as const) {
      stage = `native rollback at ${boundary}`; let reached = false;
      const matches = (sql: string, values?: unknown[]) => boundary === "schema" ? sql.includes("CREATE SCHEMA alpha_wallet_deposit_inbox_simulation")
        : boundary === "deferred seal" ? sql.includes("SET CONSTRAINTS ALL IMMEDIATE")
          : boundary === "blob" ? sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.evidence_blobs")
            : boundary === "quarantine" ? sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.quarantines")
              : boundary === "recovery receipt" ? sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.recovery_receipts")
                : sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.commands")
                  && JSON.stringify(values ?? []).includes("restore-quarantine") === (boundary === "restore command");
      const failed = wrap(target, tx => ({
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          const value = await tx.query<Row>(sql, values);
          if (matches(sql, values)) { reached = true; await tx.query("SELECT 1 / 0 /* synthetic deposit recovery rollback boundary */"); }
          return value;
        },
        async exec(sql: string) {
          await tx.exec(sql);
          if (matches(sql)) { reached = true; await tx.query("SELECT 1 / 0 /* synthetic deposit recovery rollback boundary */"); }
        },
      }));
      await assert.rejects(restore(failed, `failed-${boundary.replaceAll(" ", "-")}`));
      assert.equal(reached, true, `The ${boundary} boundary must actually execute`);
      assert.deepEqual(await footprint(target), untouched);
      checks.push(`A real SQL failure at ${boundary} rolls back the entire target installation and all imported history`);
    }

    stage = "swallowed certified restore refusal";
    let caught = false;
    await assert.rejects(target.transaction(async tx => {
      await tx.exec("CREATE SCHEMA swallowed_restore_probe");
      const scoped: WalletStore = { transaction: work => work(tx), close: async () => undefined };
      try { await restore(scoped, "swallowed-restore", backup, "0".repeat(64)); } catch { caught = true; }
    }));
    assert.equal(caught, true); assert.deepEqual(await footprint(target), untouched);
    checks.push("Catching a refused restore inside its certified owner cannot commit unrelated writes in that same physical transaction");

    stage = "competing fresh-target restores with actual bootstrap lock wait";
    const competitor = await createPostgresWalletStore({ mode: MODE, connectionString: targetConnection }); stores.push(competitor);
    const observer = await createPostgresWalletStore({ mode: MODE, connectionString: targetConnection }); stores.push(observer);
    const firstLocked = deferred<number>(), secondRequested = deferred<number>(), release = deferred<void>();
    let firstOnce = false, secondOnce = false, committedRepliesLost = 0;
    const firstGated = wrap(target, tx => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (!firstOnce && sql.includes("pg_advisory_xact_lock")) {
          firstOnce = true;
          const pid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          const value = await tx.query<Row>(sql, values);
          firstLocked.resolve(pid); await release.promise; return value;
        }
        return tx.query<Row>(sql, values);
      }, exec: sql => tx.exec(sql),
    }));
    const secondGated = wrap(competitor, tx => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (!secondOnce && sql.includes("pg_advisory_xact_lock")) {
          secondOnce = true;
          const pid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          secondRequested.resolve(pid);
        }
        return tx.query<Row>(sql, values);
      }, exec: sql => tx.exec(sql),
    }));
    const loseReply: WalletStore = { transaction: async work => {
      await firstGated.transaction(work); committedRepliesLost += 1;
      throw new CommitOutcomeUnknownError(new Error("synthetic lost reply after actual restore commit"));
    }, close: async () => undefined };
    const first = restore(loseReply, "native-winning-restore").then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
    let second: ReturnType<typeof first.then> | undefined;
    let firstPid = 0, secondPid = 0;
    try {
      firstPid = await within(firstLocked.promise, "first acquired bootstrap fence");
      second = restore(secondGated, "native-competing-restore").then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
      secondPid = await within(secondRequested.promise, "second requested bootstrap fence");
      assert.notEqual(firstPid, secondPid);
      await observeBootstrapWait(observer, secondPid, firstPid);
    } finally { release.resolve(); }
    const firstOutcome = await first, secondOutcome = await second;
    assert.equal(firstOutcome.status, "rejected");
    assert(firstOutcome.status === "rejected" && firstOutcome.reason instanceof CommitOutcomeUnknownError);
    assert.deepEqual({ requestId: Reflect.get(firstOutcome.reason, "requestId"),
      backupChecksum: Reflect.get(firstOutcome.reason, "backupChecksum"),
      creditAuthority: Reflect.get(firstOutcome.reason, "creditAuthority") },
    { requestId: "native-winning-restore", backupChecksum: inspected.checksum, creditAuthority: false });
    assert(secondOutcome && typeof secondOutcome === "object" && "status" in secondOutcome && secondOutcome.status === "rejected");
    assert.equal(committedRepliesLost, 1);
    checks.push("Distinct PostgreSQL backends expose an actual bootstrap-fence wait and only one fresh-target restore commits");
    checks.push("The winning restore loses its response only after actual COMMIT and preserves its stable recovery request identity");

    stage = "same-target recovery receipt and reopen";
    await Promise.all([target.close(), competitor.close(), observer.close()]);
    const reopened = await createPostgresWalletStore({ mode: MODE, connectionString: targetConnection }); stores.push(reopened);
    const result = await inspectRestoredDevelopmentDepositInbox({ mode: MODE, store: reopened,
      requestId: "native-winning-restore", expectedChecksum: inspected.checksum });
    assert.equal(result.quarantined, true); assert.equal(result.creditAuthority, false);
    assert.notEqual(result.recovery.targetStoreInstanceId, sourceId);
    assert.equal(result.restored.revision, archive.checkpoint.revision + 1);
    assert.equal(result.recovery.targetStoreInstanceId,
      (firstOutcome.reason as CommitOutcomeUnknownError & { targetStoreInstanceId: string }).targetStoreInstanceId);
    const restoredInbox = createDevelopmentDepositInboxRecorder({ mode: MODE, store: reopened, manifest: fixture.manifest,
      storeInstanceId: result.recovery.targetStoreInstanceId, worker: { workerId: fixture.workerId, role: "operator" }, clock: () => fixture.now + 500_000 });
    const restoredSnapshot = await restoredInbox.inspect();
    assert.equal(restoredSnapshot.state.status, "quarantined");
    assert.deepEqual(restoredSnapshot.state.candidateCursors, archive.projections.candidateCursors);
    assert.deepEqual(restoredSnapshot.state.events, archive.projections.events);
    assert.deepEqual(restoredSnapshot.state.observations, archive.projections.observations);
    const targetArchive = (await parseDevelopmentDepositInboxBackup(await exportDevelopmentDepositInboxBackup({ mode: MODE,
      store: reopened, clock: () => fixture.now + 500_000 }))).archive;
    assert.deepEqual(targetArchive.commands.slice(0, -1), archive.commands);
    assert.deepEqual(targetArchive.evidenceBlobs, archive.evidenceBlobs); assert.deepEqual(targetArchive.bootstrap, archive.bootstrap);
    assert.equal(targetArchive.projections.recoveryReceipts.length, 1);
    checks.push("A reopened target retains every original command, receipt, raw observation and cursor, plus exactly one restoration quarantine and recovery receipt");
    assert.deepEqual(await restoredInbox.lookupReceipt({ requestId: originalReceipt.requestId,
      inputFingerprint: originalReceipt.inputFingerprint, expectedStoreInstanceId: result.recovery.targetStoreInstanceId }), originalReceipt);
    checks.push("Historical receipt lookup returns the exact original source receipt after restore and expired observation freshness");
    const unresolved = await restoredInbox.reconcileUnknown({ requestId: "unknown-later-source-write", inputFingerprint: "1".repeat(64),
      expectedStoreInstanceId: sourceId, expectedPreCommandCheckpoint: archive.checkpoint });
    assert.equal(unresolved.status, "unresolved");
    checks.push("The new physical target never proves absence or resolves unknown post-backup commands from the original source");
    await assert.rejects(restore(reopened, "native-winning-restore"));
    await assert.rejects(restoredInbox.registerCandidateJob({ requestId: "forbidden-resume", jobId: "forbidden-resume", orderedCandidates: fixture.candidates }));
    assert.deepEqual((await restoredInbox.inspect()).checkpoint, result.restored);
    checks.push("An occupied target cannot be restored over and its quarantined candidate bookmarks cannot resume ingestion");
    assert.deepEqual((await inbox.inspect()).checkpoint, sourceSnapshot.checkpoint);
    assert.equal((await inbox.inspect()).state.status, "paused"); assert.equal(fixture.calls.length, readsBeforeRecovery);
    const namespaces = (await footprint(reopened)).namespaces;
    assert.deepEqual(namespaces, [{ nspname: "alpha_wallet_deposit_inbox_simulation" }]);
    checks.push("Source remains paused, recovery issues no new node reads, and neither database gains wallet or marketplace schemas");
    return { mode: MODE, creditAuthority: false, status: "passed", sourceCheckpoint: archive.checkpoint,
      restoredCheckpoint: result.restored, originalCommandCount: archive.commands.length, observationCount: archive.evidenceBlobs.length,
      eventCount: archive.projections.events.length, candidateNextOrdinal: archive.projections.candidateCursors.at(-1)?.nextOrdinal,
      independentBackendPids: [firstPid, secondPid], observedBootstrapLockWait: true, committedRepliesLost,
      newPhysicalIdentity: true, quarantined: true, checks };
  } finally { await Promise.allSettled(stores.map(store => store.close())); }
}

async function main() {
  assertSimulationRuntime(MODE);
  const args = argumentsOf(process.argv.slice(2));
  const result = await verifyNativeRecovery(args.source, args.target);
  assertSimulationRuntime(MODE);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch(error => {
  const name = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`${JSON.stringify({ mode: MODE, creditAuthority: false, status: "failed", stage, error: name })}\n`);
  process.exitCode = 1;
});
