/** Native PostgreSQL evidence for one isolated simulation inbox. No provider, ledger, custody or signing IO. */
import { strict as assert } from "node:assert";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createDevelopmentDepositInboxRecorder, initializeDevelopmentDepositInbox, type DepositInboxUnknownCommand } from "../../src/lib/alpha-wallet/deposit-inbox-store";
import { createDepositInboxFixture } from "./deposit-inbox-fixtures";

const MODE = "simulation-only" as const, SCHEMA = "alpha_wallet_deposit_inbox_simulation";
const USAGE = "Pass --fresh-simulation-databases --atomic-url <explicit loopback alpha_wallet_dev_ URL> --races-url <different empty loopback fixture URL>. No ambient URL is read and no database is created or dropped.";
let stage = "argument validation";
function argumentsOf(args: string[]) {
  assert.equal(args.length, 5, USAGE);
  let fresh = false; const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (key === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (key === "--atomic-url" || key === "--races-url") {
      assert(!values.has(key) && args[index + 1] && !args[index + 1]!.startsWith("--"), USAGE);
      values.set(key, args[++index]!);
    } else assert.fail(USAGE);
  }
  assert(fresh && values.size === 2, USAGE);
  assert.notEqual(decodeURIComponent(new URL(values.get("--atomic-url")!).pathname), decodeURIComponent(new URL(values.get("--races-url")!).pathname), USAGE);
  return { atomic: values.get("--atomic-url")!, races: values.get("--races-url")! };
}
function bound(tx: WalletSql): WalletStore { return { transaction: work => work(tx), close: async () => undefined }; }
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined); return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 15_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function waitForLock(observer: WalletStore, pid: number) {
  const deadline = Date.now() + 7_000;
  while (Date.now() < deadline) {
    const result = await observer.transaction(tx => tx.query<{ waiting: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting", [pid]));
    if (result.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Native inbox singleton lock wait was not observed");
}
async function assertFresh(store: WalletStore) {
  await store.transaction(async tx => {
    assert.equal((await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'")).rows.length, 0);
    assert.equal((await tx.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows.length, 0);
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(role.rows[0]?.permitted, true, "Native development proof requires the supplied fixture owner");
  });
}
async function refused(work: () => Promise<unknown>) {
  let rejected = false;
  try { await work(); } catch { rejected = true; }
  assert(rejected, "Expected explicit independent refusal");
}
async function contend<First, Second>(first: WalletStore, second: WalletStore, observer: WalletStore,
  firstAction: (store: WalletStore) => Promise<First>, secondAction: (store: WalletStore) => Promise<Second>) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0;
  const firstHeld: WalletStore = { close: async () => undefined, transaction: work => first.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const result = await work(tx); held.resolve(); await bounded(release.promise, "first native writer release"); return result;
  }) };
  const secondObserved: WalletStore = { close: async () => undefined, transaction: work => second.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid,revision FROM ${SCHEMA}.head WHERE singleton`)).rows[0]!.pid;
    if (secondAttempts === 1) started.resolve(); return work(tx);
  }) };
  const winner = firstAction(firstHeld); void winner.catch(held.reject);
  await bounded(held.promise, "first native writer fence");
  const follower = secondAction(secondObserved); void follower.catch(started.reject);
  try {
    await bounded(started.promise, "second native writer snapshot");
    assert.notEqual(firstPid, secondPid); await waitForLock(observer, secondPid); release.resolve();
    const outcomes = await bounded(Promise.allSettled([winner, follower]), "native competing writer outcomes");
    assert.equal(outcomes[0].status, "fulfilled"); assert(secondAttempts >= 2);
    if (outcomes[0].status !== "fulfilled") assert.fail("The held first writer did not commit");
    return { first: outcomes[0].value, second: outcomes[1], evidence: { firstBackendPid: firstPid,
      secondBackendPid: secondPid, distinctBackends: true, lockWaitObserved: true, serializationAttempts: secondAttempts } };
  } finally { release.resolve(); await Promise.allSettled([winner, follower]); }
}

async function main() {
  assertSimulationRuntime(MODE);
  const args = argumentsOf(process.argv.slice(2));
  const [atomic, atomicReopen, first, second, observer] = await Promise.all([
    createPostgresWalletStore({ mode: MODE, connectionString: args.atomic }),
    createPostgresWalletStore({ mode: MODE, connectionString: args.atomic }),
    createPostgresWalletStore({ mode: MODE, connectionString: args.races }),
    createPostgresWalletStore({ mode: MODE, connectionString: args.races }),
    createPostgresWalletStore({ mode: MODE, connectionString: args.races }),
  ]);
  const stores = [atomic, atomicReopen, first, second, observer], checks: string[] = [];
  try {
    stage = "fresh isolated targets";
    await assertFresh(atomic); await assertFresh(first);
    checks.push("two explicit empty loopback development databases admitted without ambient targets");
    const fixture = createDepositInboxFixture("bsc"), atomicIdentity = "native-inbox-atomic";
    const makeAtomic = (store: WalletStore) => createDevelopmentDepositInboxRecorder({ mode: MODE, store, manifest: fixture.manifest,
      storeInstanceId: atomicIdentity, worker: { workerId: fixture.workerId, role: "operator" }, clock: fixture.clock });
    const initial = await initializeDevelopmentDepositInbox({ mode: MODE, store: atomic, manifest: fixture.manifest,
      storeInstanceId: atomicIdentity, requestId: "initialize-atomic", clock: fixture.clock });
    assert.equal(initial.state.status, "recording");
    assert.deepEqual(await initializeDevelopmentDepositInbox({ mode: MODE, store: atomic, manifest: fixture.manifest,
      requestId: "initialize-atomic", clock: fixture.clock }), initial);
    checks.push("immutable inbox bootstrap is idempotent for its retained admission and request");
    const inbox = makeAtomic(atomic);
    const job = await inbox.registerCandidateJob({ requestId: "register-atomic-job", jobId: "atomic-job", orderedCandidates: fixture.candidates });
    const prepared = await fixture.prepare({ attemptId: "atomic-observation", storeInstanceId: atomicIdentity,
      preparationContext: inbox.preparationContext, jobId: "atomic-job" });
    const cursor = job.cursorAfter!;
    const input = { requestId: "lost-commit-observation", prepared, candidateCursor: { jobId: cursor.jobId,
      expectedCursorRevision: cursor.commandRevision, expectedNextOrdinal: cursor.nextOrdinal, candidateManifestSha256: cursor.candidateManifestSha256 } };
    const nodeReadsBefore = fixture.calls.length;
    let committed = false, unknown: unknown;
    const lost: WalletStore = { close: async () => undefined, async transaction(work) {
      await atomic.transaction(work); committed = true;
      throw new CommitOutcomeUnknownError(new Error("Synthetic reply loss after actual native PostgreSQL COMMIT"));
    } };
    stage = "native acknowledged commit reply loss";
    try { await makeAtomic(lost).record(input); } catch (error) { unknown = error; }
    assert(committed && unknown instanceof CommitOutcomeUnknownError);
    const recovery = (unknown as CommitOutcomeUnknownError & { depositInboxRecovery: DepositInboxUnknownCommand }).depositInboxRecovery;
    assert(recovery);
    const recovered = await makeAtomic(atomicReopen).reconcileUnknown(recovery);
    assert.equal(recovered.status, "committed"); assert.equal(recovered.receipt?.disposition, "recorded");
    const original = recovered.receipt!;
    assert.deepEqual(await makeAtomic(atomicReopen).record(input), original);
    assert.equal(fixture.calls.length, nodeReadsBefore);
    checks.push("actual native COMMIT reply loss preserves unknown outcome and exact receipt lookup metadata");
    checks.push("a separate connection recovers the original receipt without repeating node reads or advancing the cursor");
    const retained = await inbox.inspect();
    assert.equal(retained.state.events.length, 1); assert.equal(retained.state.observations.length, 1);
    assert.equal(retained.state.candidateCursors.at(-1)?.nextOrdinal, 1);
    stage = "independent SQL writer refusals";
    await refused(() => atomic.transaction(tx => tx.query(`INSERT INTO ${SCHEMA}.commands
      (revision,request_key,input_fingerprint,at_ms,record_json,previous_event_hash,event_hash,state_hash,owner_transaction_id)
      SELECT revision+50,request_key||'-unowned',input_fingerprint,at_ms,record_json,previous_event_hash,event_hash,state_hash,txid_current()::text
      FROM ${SCHEMA}.commands ORDER BY revision LIMIT 1`)));
    checks.push("direct journal inserts without the physical singleton fence are refused");
    for (const table of ["commands", "evidence_blobs", "events", "candidate_cursors", "admission"] as const) {
      await refused(() => atomic.transaction(tx => tx.exec(`TRUNCATE ${SCHEMA}.${table} CASCADE`)));
    }
    checks.push("direct journal evidence attribution cursor and admission removal is refused");
    await refused(() => atomic.transaction(async tx => {
      await tx.query(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
      await tx.query(`UPDATE ${SCHEMA}.head SET revision=revision+1 WHERE singleton`);
    }));
    checks.push("deferred SQL completeness rejects a forged advanced head without its command and effects");
    await refused(() => atomic.transaction(async tx => {
      await tx.exec("CREATE SCHEMA alpha_wallet_simulation");
      try { await makeAtomic(bound(tx)).inspect(); } catch { /* The owned refusal must poison the caller's original transaction. */ }
    }));
    checks.push("an empty companion wallet schema is refused and a swallowed refusal rolls back its same physical owner");
    await refused(() => atomic.transaction(async tx => {
      await tx.exec("SET LOCAL TIME ZONE 'Europe/London'");
      try { await makeAtomic(bound(tx)).inspect(); } catch { /* Fixed UTC is required even when an alias currently has zero offset. */ }
    }));
    checks.push("nonfixed UTC sessions cannot commit after a swallowed inbox runtime refusal");
    assert.deepEqual(await inbox.inspect(), retained);
    const corroborating = await fixture.prepare({ attemptId: "atomic-corroboration", storeInstanceId: atomicIdentity, preparationContext: inbox.preparationContext });
    assert.equal((await inbox.record({ requestId: "corroboration", prepared: corroborating })).disposition, "corroborating-observation");
    assert.equal((await inbox.inspect()).state.events.length, 1);
    checks.push("new corroborating provenance retains one immutable native event attribution");
    const faultInput = { requestId: "register-atomic-job", jobId: "different-native-job", orderedCandidates: fixture.candidates };
    const fault = await inbox.registerCandidateJob(faultInput);
    assert.equal(fault.disposition, "request-conflict-quarantined");
    assert.deepEqual(await inbox.registerCandidateJob(faultInput), fault);
    assert.deepEqual(await inbox.registerCandidateJob({ requestId: "register-atomic-job", jobId: "atomic-job", orderedCandidates: fixture.candidates }), job);
    assert.deepEqual(await inbox.record(input), original);
    await refused(() => inbox.registerCandidateJob({ requestId: "after-fault", jobId: "after-fault", orderedCandidates: fixture.candidates }));
    assert.deepEqual((await inbox.inspect()).checkpoint, fault.checkpoint);
    checks.push("same-key different valid payloads create one immutable fault while original and exact fault receipts remain recoverable");

    stage = "native cursor contention";
    const raceFixture = createDepositInboxFixture("tron"), raceIdentity = "native-inbox-races";
    const makeRace = (store: WalletStore) => createDevelopmentDepositInboxRecorder({ mode: MODE, store, manifest: raceFixture.manifest,
      storeInstanceId: raceIdentity, worker: { workerId: raceFixture.workerId, role: "operator" }, clock: raceFixture.clock });
    await initializeDevelopmentDepositInbox({ mode: MODE, store: first, manifest: raceFixture.manifest,
      storeInstanceId: raceIdentity, requestId: "initialize-races", clock: raceFixture.clock });
    const raceInbox = makeRace(first);
    const shared = await raceFixture.prepare({ attemptId: "shared-native-request", storeInstanceId: raceIdentity, preparationContext: raceInbox.preparationContext });
    const sharedInput = { requestId: "native-same-key", prepared: shared };
    const sameKey = await contend(first, second, observer, store => makeRace(store).record(sharedInput), store => makeRace(store).record(sharedInput));
    assert.equal(sameKey.second.status, "fulfilled");
    if (sameKey.second.status !== "fulfilled") assert.fail("Same-key recovery was refused");
    assert.deepEqual(sameKey.first, sameKey.second.value);
    let raceSnapshot = await raceInbox.inspect();
    assert.equal(raceSnapshot.checkpoint.revision, 1); assert.equal(raceSnapshot.state.events.length, 1); assert.equal(raceSnapshot.state.observations.length, 1);
    checks.push("same-key native competitors serialize and return one exact original receipt with one event");
    stage = "same-event different-key native writers";
    raceFixture.setNow(raceFixture.now + 1);
    const provenanceA = await raceFixture.prepare({ attemptId: "native-provenance-a", storeInstanceId: raceIdentity, preparationContext: raceInbox.preparationContext });
    raceFixture.setNow(raceFixture.now + 1);
    const provenanceB = await raceFixture.prepare({ attemptId: "native-provenance-b", storeInstanceId: raceIdentity, preparationContext: raceInbox.preparationContext });
    const sameEvent = await contend(first, second, observer,
      store => makeRace(store).record({ requestId: "native-provenance-a", prepared: provenanceA }),
      store => makeRace(store).record({ requestId: "native-provenance-b", prepared: provenanceB }));
    assert.equal(sameEvent.first.disposition, "corroborating-observation"); assert.equal(sameEvent.second.status, "fulfilled");
    if (sameEvent.second.status !== "fulfilled") assert.fail("Different-key corroboration was refused");
    assert.equal(sameEvent.second.value.disposition, "corroborating-observation");
    raceSnapshot = await raceInbox.inspect();
    assert.equal(raceSnapshot.checkpoint.revision, 3); assert.equal(raceSnapshot.state.observations.length, 3); assert.equal(raceSnapshot.state.events.length, 1);
    checks.push("same-event different-key native competitors retain both observations without duplicating event attribution");
    stage = "native cursor contention";
    const raceJob = await raceInbox.registerCandidateJob({ requestId: "register-race-job", jobId: "race-job", orderedCandidates: raceFixture.candidates });
    raceFixture.setNow(raceFixture.now + 1);
    const a = await raceFixture.prepare({ attemptId: "cursor-attempt-a", storeInstanceId: raceIdentity, preparationContext: raceInbox.preparationContext, jobId: "race-job" });
    raceFixture.setNow(raceFixture.now + 1);
    const b = await raceFixture.prepare({ attemptId: "cursor-attempt-b", storeInstanceId: raceIdentity, preparationContext: raceInbox.preparationContext, jobId: "race-job" });
    const bookmark = raceJob.cursorAfter!, candidateCursor = { jobId: bookmark.jobId, expectedCursorRevision: bookmark.commandRevision,
      expectedNextOrdinal: bookmark.nextOrdinal, candidateManifestSha256: bookmark.candidateManifestSha256 };
    const beforeCursorRace = await raceInbox.inspect();
    const cursorRace = await contend(first, second, observer,
      store => makeRace(store).record({ requestId: "race-first", prepared: a, candidateCursor }),
      store => makeRace(store).record({ requestId: "race-second", prepared: b, candidateCursor }));
    assert.equal(cursorRace.second.status, "rejected");
    if (cursorRace.second.status !== "rejected") assert.fail("A stale candidate ordinal was committed");
    assert.equal(cursorRace.second.reason.code, "ADMISSION_REFUSED");
    const winningReceipt = cursorRace.first;
    checks.push("separate native backends visibly contend on the singleton cursor fence");
    checks.push("the actual PostgreSQL serialization loser retries then refuses its stale ordinal without partial evidence");
    raceSnapshot = await makeRace(observer).inspect();
    assert.equal(raceSnapshot.checkpoint.revision, beforeCursorRace.checkpoint.revision + 1);
    assert.equal(raceSnapshot.state.events.length, beforeCursorRace.state.events.length);
    assert.equal(raceSnapshot.state.observations.length, beforeCursorRace.state.observations.length + 1);
    assert.equal(raceSnapshot.state.candidateCursors.at(-1)?.nextOrdinal, 1);
    assert.deepEqual(await raceInbox.record({ requestId: "race-first", prepared: a, candidateCursor }), winningReceipt);
    checks.push("cursor contention stores one command observation and ordinal advance without repeating the known event");
    const secondCandidate = await raceFixture.prepare({ attemptId: "second-native-candidate", storeInstanceId: raceIdentity,
      preparationContext: raceInbox.preparationContext, candidate: raceFixture.candidates[1], jobId: "race-job" });
    const next = raceSnapshot.state.candidateCursors.at(-1)!;
    await raceInbox.record({ requestId: "second-candidate", prepared: secondCandidate, candidateCursor: { jobId: next.jobId,
      expectedCursorRevision: next.commandRevision, expectedNextOrdinal: next.nextOrdinal, candidateManifestSha256: next.candidateManifestSha256 } });
    raceSnapshot = await raceInbox.inspect();
    assert.equal(raceSnapshot.state.candidateCursors.at(-1)?.nextOrdinal, 2); assert.equal(raceSnapshot.state.events.length, 2);
    checks.push("the next enumerated candidate commits from its new exact bookmark without skipping or rediscovering positions");
    stage = "validated contradictory native writers";
    raceFixture.setNow(raceFixture.now + 1);
    const laterVariant = { containingHeight: (BigInt(raceFixture.checkpointHeight) + BigInt(1)).toString() };
    const later = await raceFixture.prepare({ attemptId: "valid-later-native-event", storeInstanceId: raceIdentity,
      preparationContext: raceInbox.preparationContext, candidate: raceFixture.laterCandidate, variant: laterVariant });
    raceFixture.setNow(raceFixture.now + 1);
    const conflicting = await raceFixture.prepare({ attemptId: "contradictory-native-event", storeInstanceId: raceIdentity,
      preparationContext: raceInbox.preparationContext, candidate: { ...raceFixture.laterCandidate, amountRaw: "1" }, variant: laterVariant });
    const beforeConflict = await raceInbox.inspect();
    const conflictRace = await contend(first, second, observer,
      store => makeRace(store).record({ requestId: "valid-later-event", prepared: later }),
      store => makeRace(store).record({ requestId: "contradictory-event", prepared: conflicting }));
    assert.equal(conflictRace.first.disposition, "recorded"); assert.equal(conflictRace.second.status, "fulfilled");
    if (conflictRace.second.status !== "fulfilled") assert.fail("Validated contradiction was not durably quarantined");
    assert.equal(conflictRace.second.value.disposition, "conflict-quarantined");
    const terminal = await raceInbox.inspect();
    assert.equal(terminal.state.status, "quarantined"); assert.equal(terminal.state.events.length, beforeConflict.state.events.length + 1);
    assert.equal(terminal.state.observations.length, beforeConflict.state.observations.length + 2);
    assert.equal(terminal.state.sourceHeads.length, beforeConflict.state.sourceHeads.length + 1);
    assert.deepEqual(terminal.state.candidateCursors, beforeConflict.state.candidateCursors);
    assert.equal(terminal.state.events.at(-1)?.amountRaw, raceFixture.laterCandidate.amountRaw);
    assert.equal(terminal.checkpoint.revision, beforeConflict.checkpoint.revision + 2);
    checks.push("contradictory native competitors preserve the first committed facts and durably quarantine the conflicting observation");
    console.log(JSON.stringify({ kind: "development-deposit-inbox-native-proof", mode: MODE, creditAuthority: false,
      status: "passed", success: true, checks, checkCount: checks.length,
      native: { actualCommitAcknowledgementLoss: committed, races: { sameKey: sameKey.evidence, sameEvent: sameEvent.evidence,
        cursor: cursorRace.evidence, contradiction: conflictRace.evidence } },
      atomic: { retainedOriginalReceipt: original, stoppedCheckpoint: fault.checkpoint, nodeReadsUnchangedDuringRetry: true },
      contention: { winningReceipt: winningReceipt!, committedCandidateOrdinals: terminal.state.candidateCursors.map(row => row.nextOrdinal),
        finalCheckpoint: terminal.checkpoint, eventCount: terminal.state.events.length, observationCount: terminal.state.observations.length,
        quarantineCount: terminal.state.quarantines.length, status: terminal.state.status } }, null, 2));
  } finally { await Promise.allSettled(stores.map(store => store.close())); }
}
main().catch(error => {
  console.error(`Deposit inbox native proof failed during ${stage}: ${error instanceof Error ? error.message : "unclassified refusal"}`);
  process.exitCode = 1;
});
