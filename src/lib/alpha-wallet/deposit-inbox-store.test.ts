// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDepositInboxFixture } from "../../../scripts/alpha-wallet/deposit-inbox-fixtures";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { canonicalInboxJson, captureInboxData, digestInboxValue } from "./deposit-inbox-data";
import { captureDepositInboxCommand, transitionDepositInbox } from "./deposit-inbox-model";
import { appendDepositInboxStore, captureDepositInboxStore, createDevelopmentDepositInboxRecorder, DEPOSIT_INBOX_SCHEMA,
  DepositInboxCommittedResponseUnavailableError, initializeDevelopmentDepositInbox, loadDepositInboxStore,
  withDepositInboxStoreTransaction, type DepositInboxUnknownCommand } from "./deposit-inbox-store";

const MODE = "simulation-only" as const, TIMEOUT = 120_000;
type Row = Record<string, unknown>;
const stores: WalletStore[] = [];
let directory: string, ordinal = 0;
function runtime() {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])
    vi.stubEnv(key, undefined);
}
function wrapped(store: WalletStore, adapt: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(adapt(tx))), close: async () => undefined };
}
function bound(tx: WalletSql): WalletStore { return { transaction: work => work(tx), close: async () => undefined }; }
async function fresh(family: "bsc" | "tron" = "bsc") {
  const fixture = createDepositInboxFixture(family), storeInstanceId = `deposit-test-store-${++ordinal}`;
  const store = await createFileWalletStore({ mode: MODE, dataDir: join(directory, storeInstanceId) }); stores.push(store);
  const initial = await initializeDevelopmentDepositInbox({ mode: MODE, store, manifest: fixture.manifest,
    storeInstanceId, requestId: "initialize", clock: fixture.clock });
  const make = (target = store, role: "worker" | "operator" = "operator", clock = fixture.clock) =>
    createDevelopmentDepositInboxRecorder({ mode: MODE, store: target, manifest: fixture.manifest, storeInstanceId,
      worker: { workerId: fixture.workerId, role }, clock });
  return { fixture, store, storeInstanceId, initial, make, inbox: make() };
}
beforeAll(async () => { runtime(); directory = await mkdtemp(join(tmpdir(), "alpha-deposit-inbox-store-")); });
beforeEach(runtime);
afterEach(async () => {
  await Promise.allSettled(stores.splice(0).map(store => store.close()));
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
}, TIMEOUT);
afterAll(async () => {
  runtime(); await Promise.allSettled(stores.map(store => store.close()));
  await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs();
}, TIMEOUT);

describe("isolated persistent development deposit inbox", () => {
  it.each(["bsc", "tron"] as const)("persists %s evidence, exact receipts and finite job progress across reopen", async family => {
    const { fixture, store, storeInstanceId, initial, inbox } = await fresh(family);
    expect(initial.state).toMatchObject({ status: "recording", storeInstanceId, creditAuthority: false, events: [] });
    const job = await inbox.registerCandidateJob({ requestId: "register", jobId: "job", orderedCandidates: fixture.candidates });
    const prepared = await fixture.prepare({ attemptId: "first-attempt", storeInstanceId, preparationContext: inbox.preparationContext, jobId: "job" });
    const cursor = job.cursorAfter!;
    const input = { requestId: "record", prepared, candidateCursor: { jobId: "job", expectedCursorRevision: cursor.commandRevision,
      expectedNextOrdinal: cursor.nextOrdinal, candidateManifestSha256: cursor.candidateManifestSha256 } };
    const receipt = await inbox.record(input), calls = fixture.calls.length;
    expect(receipt).toMatchObject({ disposition: "recorded", mode: MODE, creditAuthority: false, revision: 2,
      cursorAfter: { nextOrdinal: 1, candidateCount: 2 } });
    expect(await inbox.record(input)).toEqual(receipt);
    expect(await inbox.lookupReceipt({ requestId: "record", inputFingerprint: receipt.inputFingerprint })).toEqual(receipt);
    const before = await inbox.inspect();
    expect(before.state.events).toHaveLength(1); expect(before.state.observations).toHaveLength(1);
    await store.close();
    const reopened = await createFileWalletStore({ mode: MODE, dataDir: join(directory, storeInstanceId) }); stores.push(reopened);
    const reopenedInbox = createDevelopmentDepositInboxRecorder({ mode: MODE, store: reopened, manifest: fixture.manifest,
      storeInstanceId, worker: { workerId: fixture.workerId, role: "operator" }, clock: fixture.clock });
    expect(await reopenedInbox.inspect()).toEqual(before);
    fixture.setNow(fixture.now + 5_000_000);
    expect(await reopenedInbox.record(input)).toEqual(receipt);
    expect(fixture.calls).toHaveLength(calls);
    const paused = await reopenedInbox.pause({ requestId: "pause", reason: "Synthetic evidence retained" });
    expect(paused.disposition).toBe("paused"); expect(await reopenedInbox.record(input)).toEqual(receipt);
    await expect(reopenedInbox.registerCandidateJob({ requestId: "late", jobId: "late", orderedCandidates: fixture.candidates })).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
    expect((await reopenedInbox.inspect()).checkpoint).toEqual(paused.checkpoint);
  }, TIMEOUT);

  it("retains one immutable initialization request and refuses a different bootstrap or physical identity", async () => {
    const { fixture, store, storeInstanceId, initial, inbox } = await fresh();
    const repeated = await initializeDevelopmentDepositInbox({ mode: MODE, store, manifest: fixture.manifest,
      requestId: "initialize", clock: () => fixture.now + 1_000 });
    expect(repeated).toEqual(initial);
    await expect(initializeDevelopmentDepositInbox({ mode: MODE, store, manifest: fixture.manifest,
      storeInstanceId, requestId: "different", clock: fixture.clock })).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
    await expect(initializeDevelopmentDepositInbox({ mode: MODE, store, manifest: fixture.manifest,
      storeInstanceId: "another-instance", requestId: "initialize", clock: fixture.clock })).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
    expect(await inbox.inspect()).toEqual(initial);
  }, TIMEOUT);

  it("returns the exact original and fault receipts without reopening an absorbing quarantine", async () => {
    const { fixture, inbox } = await fresh();
    const originalInput = { requestId: "same-request", jobId: "original-job", orderedCandidates: fixture.candidates };
    const original = await inbox.registerCandidateJob(originalInput);
    const conflictInput = { ...originalInput, jobId: "conflicting-job" };
    const fault = await inbox.registerCandidateJob(conflictInput);
    expect(fault.disposition).toBe("request-conflict-quarantined");
    expect(await inbox.registerCandidateJob(originalInput)).toEqual(original);
    expect(await inbox.registerCandidateJob(conflictInput)).toEqual(fault);
    expect(await inbox.lookupReceipt({ requestId: originalInput.requestId, inputFingerprint: fault.inputFingerprint })).toEqual(fault);
    await expect(inbox.registerCandidateJob({ ...conflictInput, jobId: "third-job" })).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
    const snapshot = await inbox.inspect();
    expect(snapshot.state).toMatchObject({ status: "quarantined", haltReason: "request-conflict" });
    expect(snapshot.state.candidateJobs).toHaveLength(1); expect(snapshot.checkpoint.revision).toBe(2);
  }, TIMEOUT);

  it("distinguishes committed, absent, stale absence and a different physical store under the singleton fence", async () => {
    const { fixture, inbox, initial, storeInstanceId } = await fresh();
    const query: DepositInboxUnknownCommand = { requestId: "absent", inputFingerprint: "a".repeat(64), expectedStoreInstanceId: storeInstanceId,
      expectedPreCommandCheckpoint: initial.checkpoint };
    expect((await inbox.reconcileUnknown(query)).status).toBe("not-recorded");
    const receipt = await inbox.registerCandidateJob({ requestId: "registered", jobId: "job", orderedCandidates: fixture.candidates });
    expect((await inbox.reconcileUnknown(query)).status).toBe("not-recorded-stale");
    const committed = await inbox.reconcileUnknown({ ...query, requestId: "registered", inputFingerprint: receipt.inputFingerprint });
    expect(committed).toMatchObject({ status: "committed", receipt });
    expect((await inbox.reconcileUnknown({ ...query, expectedStoreInstanceId: "different-store" })).status).toBe("unresolved");
    expect((await inbox.reconcileUnknown({ ...query, expectedPreCommandCheckpoint: { ...initial.checkpoint, stateHash: "b".repeat(64) } })).status).toBe("unresolved");
  }, TIMEOUT);

  it("keeps actual committed acknowledgement loss distinct and recovers the complete stored receipt", async () => {
    const { fixture, store, make, inbox } = await fresh();
    let committed = false, failure: unknown;
    const lost: WalletStore = { close: async () => undefined, async transaction(work) {
      await store.transaction(work); committed = true;
      throw new CommitOutcomeUnknownError(new Error("Synthetic reply lost after the real commit"));
    } };
    try { await make(lost).registerCandidateJob({ requestId: "lost-commit", jobId: "job", orderedCandidates: fixture.candidates }); }
    catch (error) { failure = error; }
    expect(committed).toBe(true); expect(failure).toBeInstanceOf(CommitOutcomeUnknownError);
    const metadata = (failure as CommitOutcomeUnknownError & { depositInboxRecovery: DepositInboxUnknownCommand }).depositInboxRecovery;
    expect(Object.isFrozen(metadata)).toBe(true);
    const recovered = await inbox.reconcileUnknown(metadata);
    expect(recovered).toMatchObject({ status: "committed", receipt: { disposition: "job-registered", requestId: "lost-commit" } });
    expect((await inbox.inspect()).checkpoint.revision).toBe(1);
  }, TIMEOUT);

  it.each(["missing", "substituted", "getter"] as const)("classifies an acknowledged %s response through exact receipt recovery", async kind => {
    const { fixture, store, make, inbox } = await fresh(); let getters = 0;
    const adapter: WalletStore = { close: async () => undefined, async transaction(work) {
      const result = await store.transaction(work);
      void result;
      if (kind === "missing") return undefined as typeof result;
      if (kind === "substituted") return { mode: MODE, creditAuthority: false, revision: 999 } as typeof result;
      return Object.defineProperty({}, "revision", { enumerable: true, get() { getters++; return 1; } }) as typeof result;
    } };
    let failure: unknown;
    try { await make(adapter).registerCandidateJob({ requestId: "acknowledged", jobId: "job", orderedCandidates: fixture.candidates }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DepositInboxCommittedResponseUnavailableError); expect(getters).toBe(0);
    const recovered = await inbox.reconcileUnknown((failure as DepositInboxCommittedResponseUnavailableError).depositInboxRecovery);
    expect(recovered).toMatchObject({ status: "committed", receipt: { requestId: "acknowledged", disposition: "job-registered" } });
    expect((await inbox.inspect()).checkpoint.revision).toBe(1);
  }, TIMEOUT);

  it("rechecks accepted freshness after awaited persistence and rolls back every staged evidence effect", async () => {
    const { fixture, store, storeInstanceId, make, inbox, initial } = await fresh();
    const prepared = await fixture.prepare({ attemptId: "expires-during-insert", storeInstanceId, preparationContext: inbox.preparationContext });
    let expired = false;
    const slow = wrapped(store, tx => ({ exec: sql => tx.exec(sql), async query<T extends Row>(sql: string, params?: unknown[]) {
      const result = await tx.query<T>(sql, params);
      if (sql.startsWith(`INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.events`)) { fixture.setNow(fixture.now + 30_001); expired = true; }
      return result;
    } }));
    await expect(make(slow).record({ requestId: "expired", prepared })).rejects.toMatchObject({ code: "STALE_CHECKPOINT" });
    expect(expired).toBe(true); expect(await inbox.inspect()).toEqual(initial);
  }, TIMEOUT);

  it("pins caller-owned store, actor, manifest and command data before asynchronous work", async () => {
    const { fixture, store, make, inbox } = await fresh(); let replacements = 0;
    const mutableStore: WalletStore = { transaction: work => store.transaction(work), close: async () => undefined };
    const recorder = make(mutableStore);
    mutableStore.transaction = async () => { replacements++; throw new Error("Caller swapped storage"); };
    const input = { requestId: "captured", jobId: "captured-job", orderedCandidates: fixture.candidates.map(item => ({ ...item })) };
    const pending = recorder.registerCandidateJob(input);
    input.jobId = "changed-after-call"; input.orderedCandidates[0].amountRaw = "1";
    const receipt = await pending;
    expect(receipt.disposition).toBe("job-registered"); expect(replacements).toBe(0);
    expect((await inbox.inspect()).state.candidateJobs[0]).toMatchObject({ jobId: "captured-job", candidates: fixture.candidates });
  }, TIMEOUT);

  it("supports valid bounded archives even when a redundant append wrapper exceeds the common capture node budget", async () => {
    const { fixture, store, storeInstanceId, inbox } = await fresh();
    const candidates = Array.from({ length: 256 }, () => fixture.standardCandidate);
    let oversizedWrapperSeen = false;
    for (let index = 0; index < 16; index++) {
      const command = await captureDepositInboxCommand({ mode: MODE, manifest: fixture.manifest, storeInstanceId,
        worker: { workerId: fixture.workerId, role: "operator" }, command: { type: "register-candidate-job",
          requestId: `bounded-request-${index}`, jobId: `bounded-job-${index}`, orderedCandidates: candidates } });
      await withDepositInboxStoreTransaction({ mode: MODE, store, expectedStoreInstanceId: storeInstanceId }, async owner => {
        const archive = await loadDepositInboxStore(owner), transition = await transitionDepositInbox(archive, command, { atMs: fixture.now });
        expect(transition.kind).toBe("append"); if (transition.kind !== "append") return;
        expect(() => captureInboxData(transition.plan.archive)).not.toThrow();
        try { captureInboxData(transition.plan); } catch { oversizedWrapperSeen = true; }
        await appendDepositInboxStore(owner, transition.plan);
      });
    }
    expect(oversizedWrapperSeen).toBe(true);
    const terminal = await inbox.registerCandidateJob({ requestId: "capacity-stop", jobId: "seventeenth", orderedCandidates: candidates });
    expect(terminal.disposition).toBe("resource-quarantined");
    const snapshot = await inbox.inspect();
    expect(snapshot.state.candidateJobs).toHaveLength(16); expect(snapshot.state.candidateCursors).toHaveLength(16);
    expect(snapshot.state.events).toHaveLength(0); expect(fixture.calls).toHaveLength(0);
  }, 180_000);

  it.each(["paused", "quarantined"] as const)("independently refuses an update-first direct SQL revival of a %s inbox", async status => {
    const { fixture, store, inbox } = await fresh();
    if (status === "paused") await inbox.pause({ requestId: "terminal-pause", reason: "Must remain stopped" });
    else {
      await inbox.registerCandidateJob({ requestId: "terminal-key", jobId: "first", orderedCandidates: fixture.candidates });
      await inbox.registerCandidateJob({ requestId: "terminal-key", jobId: "different", orderedCandidates: fixture.candidates });
    }
    const stopped = await inbox.inspect(); expect(stopped.state.status).toBe(status);
    await expect(store.transaction(async tx => {
      await tx.query(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
      await tx.query(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head SET revision=revision+1,
        state_json=jsonb_set(state_json,'{status}','"recording"'::jsonb),
        state_hash=${DEPOSIT_INBOX_SCHEMA}.value_digest('inbox-state',jsonb_set(state_json,'{status}','"recording"'::jsonb)) WHERE singleton`);
    })).rejects.toThrow(/absorbing/);
    expect(await inbox.inspect()).toEqual(stopped);
  }, TIMEOUT);
});

describe("independent SQL seals and certified transaction ownership", () => {
  let guarded: Awaited<ReturnType<typeof fresh>>;
  let retained: Awaited<ReturnType<ReturnType<typeof createDevelopmentDepositInboxRecorder>["inspect"]>>;
  beforeAll(async () => {
    runtime(); guarded = await fresh(); stores.splice(stores.indexOf(guarded.store), 1);
    await guarded.inbox.registerCandidateJob({ requestId: "guard-job", jobId: "guard-job", orderedCandidates: guarded.fixture.candidates });
    const prepared = await guarded.fixture.prepare({ attemptId: "guard-evidence", storeInstanceId: guarded.storeInstanceId,
      preparationContext: guarded.inbox.preparationContext });
    await guarded.inbox.record({ requestId: "guard-record", prepared }); retained = await guarded.inbox.inspect();
  }, TIMEOUT);
  afterAll(async () => { runtime(); expect(await guarded.inbox.inspect()).toEqual(retained); await guarded.store.close(); }, TIMEOUT);

  const immutable = ["admission", "admission_records", "commands", "command_seals", "evidence_blobs", "observations", "block_anchors",
    "transaction_anchors", "events", "event_observations", "source_heads", "candidate_jobs", "candidate_cursors", "quarantines", "recovery_receipts"];
  it.each(immutable)("refuses direct update, removal and truncation of immutable %s", async table => {
    const column = table === "admission" ? "manifest" : table === "commands" ? "record_json" : table === "command_seals" ? "owner_transaction_id" : "payload";
    for (const sql of [`UPDATE ${DEPOSIT_INBOX_SCHEMA}.${table} SET ${column}=${column}`,
      `DELETE FROM ${DEPOSIT_INBOX_SCHEMA}.${table}`, `TRUNCATE ${DEPOSIT_INBOX_SCHEMA}.${table} CASCADE`])
      await expect(guarded.store.transaction(tx => tx.exec(sql))).rejects.toThrow();
  });

  it.each([
    ["empty wallet namespace", "CREATE SCHEMA alpha_wallet_simulation"],
    ["empty marketplace namespace", "CREATE SCHEMA alpha_wallet_marketplace_simulation"],
    ["empty unrelated namespace", "CREATE SCHEMA unrelated_development_data"],
    ["public relation", "CREATE TABLE public.inbox_companion(id integer)"],
    ["public function", "CREATE FUNCTION public.inbox_companion() RETURNS integer LANGUAGE sql AS 'SELECT 1'"],
    ["public domain", "CREATE DOMAIN public.inbox_companion AS text"],
    ["temporary relation", "CREATE TEMP TABLE inbox_companion(id integer)"],
  ])("refuses %s and poisons a swallowed same-transaction refusal", async (_label, ddl) => {
    await expect(guarded.store.transaction(async tx => {
      await tx.exec(ddl);
      try { await guarded.make(bound(tx)).inspect(); } catch { /* A swallowed owner refusal cannot commit the companion object. */ }
    })).rejects.toThrow();
  });

  it.each(["Europe/London", "Asia/Tokyo"])("refuses the nonfixed UTC session %s even when the caller swallows it", async timeZone => {
    await expect(guarded.store.transaction(async tx => {
      await tx.query("SELECT set_config('TimeZone',$1,true)", [timeZone]);
      try { await guarded.make(bound(tx)).inspect(); } catch { /* Physical owner must remain poisoned. */ }
    })).rejects.toThrow();
  });

  it("matches SQL inbox commitments to exact UTF-16 key order, escaped strings and safe numeric JSON", async () => {
    const value = { "10": "ten", "2": "two", "\ue000": 3, "😀": 4, escaped: "\"\\\n\t", nested: [{ z: null, a: false }] };
    const result = await guarded.store.transaction(tx => tx.query<{ canonical: string; digest: string }>(`SELECT
      ${DEPOSIT_INBOX_SCHEMA}.canonical_json($1::jsonb) AS canonical,${DEPOSIT_INBOX_SCHEMA}.value_digest('test-canonical',$1::jsonb) AS digest`, [JSON.stringify(value)]));
    expect(result.rows[0]).toEqual({ canonical: canonicalInboxJson(value), digest: digestInboxValue("test-canonical", value) });
  });

  it("rejects unowned direct journal writes before their claimed record can influence the head", async () => {
    await expect(guarded.store.transaction(tx => tx.query(`INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.commands
      (revision,request_key,input_fingerprint,at_ms,record_json,previous_event_hash,event_hash,state_hash,owner_transaction_id)
      SELECT revision+20,request_key||'-unowned',input_fingerprint,at_ms,record_json,previous_event_hash,event_hash,state_hash,txid_current()::text
      FROM ${DEPOSIT_INBOX_SCHEMA}.commands LIMIT 1`))).rejects.toThrow(/physical singleton write fence/);
  });

  it("rejects an advanced head with no matching command at deferred completion", async () => {
    await expect(guarded.store.transaction(async tx => {
      await tx.query(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
      await tx.query(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head SET revision=revision+1 WHERE singleton`);
    })).rejects.toThrow(/history and head are incomplete/);
  });

  it("rejects effects added to an already sealed command even under a newly acquired fence", async () => {
    await expect(guarded.store.transaction(async tx => {
      await tx.query(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
      await tx.query(`INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.source_heads(command_revision,ordinal,payload)
        SELECT command_revision,ordinal+1,payload FROM ${DEPOSIT_INBOX_SCHEMA}.source_heads LIMIT 1`);
    })).rejects.toThrow(/exact unsealed owner command/);
  });

  it("rolls back an earlier valid append when a later helper refusal is swallowed", async () => {
    const captured = await captureDepositInboxCommand({ mode: MODE, manifest: guarded.fixture.manifest,
      storeInstanceId: guarded.storeInstanceId, worker: { workerId: guarded.fixture.workerId, role: "operator" },
      command: { type: "pause", requestId: "rolled-back-pause", reason: "Must not persist after helper failure" } });
    await expect(withDepositInboxStoreTransaction({ mode: MODE, store: guarded.store }, async owner => {
      const archive = await loadDepositInboxStore(owner), transition = await transitionDepositInbox(archive, captured, { atMs: guarded.fixture.now });
      if (transition.kind !== "append") throw new Error("Expected new pause plan");
      await appendDepositInboxStore(owner, transition.plan);
      try { await appendDepositInboxStore(owner, {} as never); } catch { /* Outer owner must still abort. */ }
    })).rejects.toThrow();
  });

  it("expires certified owners after the physical transaction and rejects proxy substitution without traps", async () => {
    const owner = await withDepositInboxStoreTransaction({ mode: MODE, store: guarded.store }, async supplied => supplied);
    await expect(loadDepositInboxStore(owner)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    let traps = 0;
    const proxy = new Proxy(owner, { get() { traps++; throw new Error("Proxy invoked"); }, getPrototypeOf() { traps++; throw new Error("Proxy invoked"); } });
    await expect(loadDepositInboxStore(proxy)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(traps).toBe(0);
  });

  it("captures storage capabilities without invoking accessors or proxy traps", () => {
    let traps = 0;
    const getter = { get transaction() { traps++; return guarded.store.transaction; }, close: guarded.store.close };
    expect(() => captureDepositInboxStore(getter)).toThrow();
    expect(() => captureDepositInboxStore(new Proxy(guarded.store, { getOwnPropertyDescriptor() { traps++; throw new Error("Proxy invoked"); } }))).toThrow();
    expect(traps).toBe(0);
  });
});
