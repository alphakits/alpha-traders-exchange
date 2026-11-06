// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDepositInboxFixture, type DepositInboxFixture } from "../../../scripts/alpha-wallet/deposit-inbox-fixtures";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { canonicalInboxJson, digestInboxValue } from "./deposit-inbox-data";
import { createDevelopmentDepositInboxRecorder, initializeDevelopmentDepositInbox } from "./deposit-inbox-store";
import { captureDepositInboxCommand, createDepositInboxArchive, transitionDepositInbox } from "./deposit-inbox-model";
import { DEPOSIT_INBOX_LIMITS, type DepositInboxArchive, type DepositInboxReceipt } from "./deposit-inbox-protocol";
import { assertDepositInboxPortableCapacity, assertDepositInboxPortableControlGrowth,
  depositInboxBackupBody, measureDepositInboxPortable, serializeDepositInboxPortable } from "./deposit-inbox-portable";
import { MAX_DEPOSIT_INBOX_BACKUP_BYTES, exportDevelopmentDepositInboxBackup,
  inspectDevelopmentDepositInboxBackup, inspectRestoredDevelopmentDepositInbox,
  parseDevelopmentDepositInboxBackup, restoreDevelopmentDepositInboxBackup,
  type DepositInboxBackupEnvelopeV1 } from "./deposit-inbox-backup";
import { exportV5WalletBackup } from "./v5-backup";

const MODE = "simulation-only" as const, TIMEOUT = 120_000;
type Mutable<T> = T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
type Envelope = Mutable<DepositInboxBackupEnvelopeV1>;
const clone = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value));
let root: string, caseDirectory: string, source: WalletStore, emptySource: WalletStore;
let fixture: DepositInboxFixture, serialized: string, emptySerialized: string, sourceArchive: DepositInboxArchive;
let originalReceipt: DepositInboxReceipt, sourceInstanceId: string;
const stores: WalletStore[] = [];
const restoreAt = () => fixture.now + 500_000;
function runtime() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])
    vi.stubEnv(key, undefined);
}
function recorder(store: WalletStore, fixtureValue: DepositInboxFixture, storeInstanceId: string) {
  return createDevelopmentDepositInboxRecorder({ mode: MODE, store, manifest: fixtureValue.manifest,
    storeInstanceId, worker: { workerId: fixtureValue.workerId, role: "operator" }, clock: fixtureValue.clock });
}
async function target(name = "target") {
  const store = await createFileWalletStore({ mode: MODE, dataDir: join(caseDirectory, name) });
  stores.push(store); return store;
}
function restore(store: WalletStore, backup = serialized, requestId = "restore-request") {
  return restoreDevelopmentDepositInboxBackup({ mode: MODE, store, backup, expectedChecksum: JSON.parse(backup).checksum,
    acknowledgeFreshTarget: true, requestId, clock: restoreAt });
}
function resign(value: Envelope): string {
  const { checksum: ignored, ...body } = value; void ignored;
  return canonicalInboxJson({ ...body, checksum: digestInboxValue("deposit-inbox-backup", body) });
}
const document = (): Envelope => JSON.parse(serialized);
function wrapped(backing: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => backing.transaction(tx => work(make(tx))), close: async () => undefined };
}
async function footprint(store: WalletStore) {
  return store.transaction(async tx => ({
    namespaces: (await tx.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public')
      AND nspname NOT LIKE 'pg_%' ORDER BY nspname`)).rows,
    objects: (await tx.query(`SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' OR n.nspname='alpha_wallet_deposit_inbox_simulation' ORDER BY n.nspname,c.relname,c.relkind`)).rows,
  }));
}

beforeAll(async () => {
  runtime(); root = await mkdtemp(join(tmpdir(), "alpha-inbox-backup-source-"));
  source = await createFileWalletStore({ mode: MODE, dataDir: join(root, "populated") });
  fixture = createDepositInboxFixture("bsc");
  const initial = await initializeDevelopmentDepositInbox({ mode: MODE, store: source, manifest: fixture.manifest,
    storeInstanceId: "inbox-backup-source", requestId: "initialize-source", clock: fixture.clock });
  sourceInstanceId = initial.state.storeInstanceId;
  const inbox = recorder(source, fixture, sourceInstanceId);
  const job = await inbox.registerCandidateJob({ requestId: "register-candidates", jobId: "backup-candidates", orderedCandidates: fixture.candidates });
  const cursor = job.cursorAfter!;
  const prepared = await fixture.prepare({ attemptId: "original-evidence", storeInstanceId: sourceInstanceId,
    preparationContext: inbox.preparationContext, jobId: cursor.jobId });
  originalReceipt = await inbox.record({ requestId: "first-candidate", prepared, candidateCursor: {
    jobId: cursor.jobId, expectedCursorRevision: cursor.commandRevision, expectedNextOrdinal: cursor.nextOrdinal,
    candidateManifestSha256: cursor.candidateManifestSha256 } });
  const corroborating = await fixture.prepare({ attemptId: "corroborating-evidence", storeInstanceId: sourceInstanceId,
    preparationContext: inbox.preparationContext });
  await inbox.record({ requestId: "corroborating-candidate", prepared: corroborating });
  await inbox.pause({ requestId: "pause-for-backup", reason: "Synthetic retained-evidence recovery exercise" });
  serialized = await exportDevelopmentDepositInboxBackup({ mode: MODE, store: source, expectedStoreInstanceId: sourceInstanceId,
    clock: () => fixture.now + 200_000 });
  sourceArchive = (await parseDevelopmentDepositInboxBackup(serialized)).archive;

  emptySource = await createFileWalletStore({ mode: MODE, dataDir: join(root, "empty") });
  const emptyFixture = createDepositInboxFixture("tron");
  const emptyInitial = await initializeDevelopmentDepositInbox({ mode: MODE, store: emptySource, manifest: emptyFixture.manifest,
    storeInstanceId: "empty-inbox-backup-source", requestId: "initialize-empty", clock: emptyFixture.clock });
  await recorder(emptySource, emptyFixture, emptyInitial.state.storeInstanceId).pause({ requestId: "pause-empty", reason: "Empty evidence archive" });
  emptySerialized = await exportDevelopmentDepositInboxBackup({ mode: MODE, store: emptySource, clock: emptyFixture.clock });
}, TIMEOUT);
beforeEach(async () => { runtime(); caseDirectory = await mkdtemp(join(tmpdir(), "alpha-inbox-backup-case-")); });
afterEach(async () => {
  try { await Promise.allSettled(stores.splice(0).map(store => store.close())); }
  finally { await rm(caseDirectory, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
}, TIMEOUT);
afterAll(async () => {
  runtime();
  try { await Promise.allSettled([source?.close(), emptySource?.close()]); }
  finally { await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); }
}, TIMEOUT);

describe("complete isolated deposit inbox portable evidence", () => {
  it("exports the entire stopped archive and replays historical observations without node IO or today's freshness", async () => {
    const calls = fixture.calls.length;
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live or ambient node access is permitted"); }));
    vi.spyOn(Date, "now").mockReturnValue(restoreAt() + 10_000_000_000);
    const inspected = await inspectDevelopmentDepositInboxBackup(serialized);
    expect(inspected).toMatchObject({ mode: MODE, creditAuthority: false, sourcePaused: true, sourceStoreInstanceId: sourceInstanceId,
      status: "paused", observationCount: 2, eventCount: 1, candidateJobCount: 1, commandCount: sourceArchive.commands.length,
      checkpoint: sourceArchive.checkpoint, checksum: document().checksum });
    const parsed = await parseDevelopmentDepositInboxBackup(JSON.stringify(document(), null, 2), { expectedChecksum: inspected.checksum });
    expect(parsed.archive).toEqual(sourceArchive);
    expect(parsed.archive.projections.candidateCursors.at(-1)).toMatchObject({ nextOrdinal: 1, candidateCount: 2 });
    expect(fixture.calls).toHaveLength(calls); expect(fetch).not.toHaveBeenCalled();
    expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.archive.commands)).toBe(true);
    expect(Object.isFrozen(parsed.archive.evidenceBlobs[0].observation.reads)).toBe(true);
    for (const forbidden of ["privateKey", "seedPhrase", "connectionString", "endpointConfig", "walletBalance", "creditReady"])
      expect(serialized).not.toContain(forbidden);
  });

  it("shares exact UTF-8 serialization and reserves control capacity independently of journal counts", () => {
    const measured = measureDepositInboxPortable(sourceArchive);
    expect(measured.bytes).toBe(Buffer.byteLength(serializeDepositInboxPortable(sourceArchive, Number.MAX_SAFE_INTEGER), "utf8"));
    expect(depositInboxBackupBody(sourceArchive, 1).archive).toEqual(sourceArchive);
    const nonAscii = clone(sourceArchive);
    nonAscii.projections.haltReason = "توقف";
    const utf8 = serializeDepositInboxPortable(nonAscii, Number.MAX_SAFE_INTEGER);
    expect(Buffer.byteLength(utf8, "utf8")).toBeGreaterThan(utf8.length);
    expect(measureDepositInboxPortable(nonAscii).bytes).toBe(Buffer.byteLength(utf8, "utf8"));
    const atOrdinaryLimit = clone(sourceArchive); atOrdinaryLimit.checkpoint.revision = 998;
    expect(() => assertDepositInboxPortableCapacity(atOrdinaryLimit, "ordinary")).not.toThrow();
    atOrdinaryLimit.checkpoint.revision = 999;
    expect(() => assertDepositInboxPortableCapacity(atOrdinaryLimit, "ordinary")).toThrow();
    expect(() => assertDepositInboxPortableCapacity(atOrdinaryLimit, "terminal")).not.toThrow();
    atOrdinaryLimit.checkpoint.revision = 1000;
    expect(() => assertDepositInboxPortableCapacity(atOrdinaryLimit, "terminal")).toThrow();
    expect(() => assertDepositInboxPortableCapacity(atOrdinaryLimit, "restore")).not.toThrow();
    const overgrown = clone(sourceArchive);
    overgrown.projections.haltReason = `${overgrown.projections.haltReason ?? ""}${"x".repeat(DEPOSIT_INBOX_LIMITS.controlReserveBytes + 1)}`;
    expect(() => assertDepositInboxPortableControlGrowth(sourceArchive, overgrown)).toThrow();
  });

  it.each([
    ["unknown envelope field", (value: Envelope) => { Object.assign(value, { extra: true }); }],
    ["another format", (value: Envelope) => { Object.assign(value, { format: "alpha-wallet-backup" }); }],
    ["another profile", (value: Envelope) => { Object.assign(value, { profile: "wallet-ledger" }); }],
    ["false source pause", (value: Envelope) => { Object.assign(value, { sourcePaused: false }); }],
    ["changed immutable attribution", (value: Envelope) => { value.archive.manifest.assignments[0].beneficiaryRef = "different-beneficiary"; }],
    ["changed original receipt", (value: Envelope) => { value.archive.commands[0].receipt.inputFingerprint = "1".repeat(64); }],
    ["changed original timestamp", (value: Envelope) => { value.archive.commands[0].atMs += 1; }],
    ["reordered history", (value: Envelope) => { [value.archive.commands[0], value.archive.commands[1]] = [value.archive.commands[1], value.archive.commands[0]]; }],
    ["omitted command", (value: Envelope) => { value.archive.commands.splice(1, 1); }],
    ["omitted evidence", (value: Envelope) => { value.archive.evidenceBlobs.pop(); }],
    ["changed raw bytes", (value: Envelope) => { value.archive.evidenceBlobs[0].observation.reads[0].responseBody += " "; }],
    ["forged cursor", (value: Envelope) => { value.archive.projections.candidateCursors.at(-1)!.nextOrdinal = 2; }],
    ["changed first event facts", (value: Envelope) => { value.archive.projections.events[0].amountRaw = "1"; }],
    ["cleared terminal state", (value: Envelope) => { value.archive.projections.status = "recording"; value.archive.projections.haltReason = null; }],
    ["export predating history", (value: Envelope) => { value.exportedAtMs = 0; }],
  ] as const)("rejects %s even with a recomputed portable checksum", async (_name, mutate) => {
    const value = document(); mutate(value);
    await expect(inspectDevelopmentDepositInboxBackup(resign(value))).rejects.toMatchObject({ creditAuthority: false });
  });

  it.each([
    ["duplicate ordinary key", (raw: string) => raw.replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1')],
    ["escaped duplicate key", (raw: string) => raw.replace('"formatVersion":1', '"formatVersion":1,"format\\u0056ersion":1')],
    ["fraction rounded to integer", (raw: string) => raw.replace('"formatVersion":1', '"formatVersion":1.00000000000000001')],
    ["integer exponent", (raw: string) => raw.replace('"formatVersion":1', '"formatVersion":1e0')],
    ["negative zero", (raw: string) => raw.replace('"formatVersion":1', '"formatVersion":-0')],
    ["unsafe numeric literal", (raw: string) => raw.replace('"formatVersion":1', '"formatVersion":9007199254740993')],
    ["BOM", (raw: string) => `\ufeff${raw}`],
    ["literal unpaired surrogate", (raw: string) => `${raw}\ud800`],
    ["truncated JSON", (raw: string) => raw.slice(0, -1)],
    ["trailing second document", (raw: string) => `${raw}{}`],
  ] as const)("rejects %s without ambiguous JSON coercion", async (_name, change) => {
    await expect(inspectDevelopmentDepositInboxBackup(change(serialized))).rejects.toMatchObject({ creditAuthority: false });
  });

  it("rejects a document whose character count fits but exact UTF-8 byte count exceeds64MiB", async () => {
    const oversized = `"${"é".repeat(MAX_DEPOSIT_INBOX_BACKUP_BYTES / 2)}"`;
    expect(oversized.length).toBeLessThan(MAX_DEPOSIT_INBOX_BACKUP_BYTES);
    await expect(inspectDevelopmentDepositInboxBackup(oversized)).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
  });

  it("requires a stopped source and refuses legacy wallet-only export of the isolated inbox", async () => {
    const active = await target(), f = createDepositInboxFixture("bsc");
    await initializeDevelopmentDepositInbox({ mode: MODE, store: active, manifest: f.manifest, requestId: "active-bootstrap", clock: f.clock });
    await expect(exportDevelopmentDepositInboxBackup({ mode: MODE, store: active, clock: f.clock })).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
    await expect(exportV5WalletBackup({ mode: MODE, store: source, clock: restoreAt })).rejects.toThrow();
  }, TIMEOUT);

  it("retains and replays a complete native response at the exact1MiB message bound", async () => {
    const store = await target("maximum-message-source"), f = createDepositInboxFixture("bsc");
    const initial = await initializeDevelopmentDepositInbox({ mode: MODE, store, manifest: f.manifest,
      storeInstanceId: "maximum-message-source", requestId: "maximum-message-bootstrap", clock: f.clock });
    const inbox = recorder(store, f, initial.state.storeInstanceId);
    const prepared = await f.prepare({ attemptId: "maximum-message-evidence", storeInstanceId: initial.state.storeInstanceId,
      preparationContext: inbox.preparationContext, variant: { mutateResponse(value, read) {
        if (read.ordinal !== 1) return;
        const body = JSON.stringify({ jsonrpc: "2.0", id: read.request.id, result: value });
        const response = new Response(body.padEnd(1_048_576, " "), { headers: { "content-type": "application/json" } });
        Object.defineProperty(response, "url", { value: read.url }); return response;
      } } });
    expect(Buffer.byteLength(prepared.timedObservation.observation.reads[0].responseBody)).toBe(1_048_576);
    await inbox.record({ requestId: "maximum-message-record", prepared });
    await inbox.pause({ requestId: "maximum-message-pause", reason: "Retain the entire supported raw native message" });
    const backup = await exportDevelopmentDepositInboxBackup({ mode: MODE, store, clock: f.clock });
    const parsed = await parseDevelopmentDepositInboxBackup(backup);
    expect(Buffer.byteLength(parsed.archive.evidenceBlobs[0].observation.reads[0].responseBody)).toBe(1_048_576);
    expect(parsed.archive.evidenceBlobs[0].observation).toEqual(prepared.timedObservation.observation);
  }, TIMEOUT);
});

describe("fresh-target inbox restoration and original receipts", () => {
  it("durably restores sixteen full candidate manifests within the structural bound and seals the entire imported history", async () => {
    const f = createDepositInboxFixture("bsc"), storeInstanceId = "substantial-portable-source";
    let archive = createDepositInboxArchive({ mode: MODE, manifest: f.manifest, storeInstanceId,
      requestId: "substantial-portable-bootstrap", atMs: f.now });
    const orderedCandidates = Array.from({ length: 256 }, () => f.standardCandidate);
    for (let index = 0; index <= 16; index++) {
      const captured = await captureDepositInboxCommand({ mode: MODE, manifest: f.manifest, storeInstanceId,
        worker: { workerId: f.workerId, role: "worker" }, command: { type: "register-candidate-job",
          requestId: `substantial-register-${index}`, jobId: `substantial-job-${index}`, orderedCandidates } });
      const result = await transitionDepositInbox(archive, captured, { atMs: f.now });
      expect(result.kind).toBe("append");
      if (result.kind !== "append") throw new Error("Substantial archive must append each unique fixture command");
      expect(result.receipt.disposition).toBe(index === 16 ? "resource-quarantined" : "job-registered");
      archive = result.plan.archive;
    }
    const measured = measureDepositInboxPortable(archive);
    expect(measured.nodes).toBeGreaterThan(75_000);
    expect(measured.nodes).toBeLessThanOrEqual(100_000 - 2048);
    expect(measured.bytes).toBeGreaterThan(2_500_000);
    const backup = serializeDepositInboxPortable(archive, f.now);
    let store = await target("substantial-target");
    const result = await restore(store, backup, "substantial-restore");
    expect(result.restored.revision).toBe(18);
    await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir: join(caseDirectory, "substantial-target") }); stores.push(store);
    const recovered = await inspectRestoredDevelopmentDepositInbox({ mode: MODE, store, requestId: "substantial-restore",
      expectedChecksum: JSON.parse(backup).checksum, expectedStoreInstanceId: result.recovery.targetStoreInstanceId });
    expect(recovered).toEqual(result);
    const exported = await parseDevelopmentDepositInboxBackup(await exportDevelopmentDepositInboxBackup({ mode: MODE, store, clock: restoreAt }));
    expect(exported.archive.commands.slice(0, -1)).toEqual(archive.commands);
    expect(exported.archive.projections.candidateJobs).toEqual(archive.projections.candidateJobs);
    expect(exported.archive.projections.candidateJobs).toHaveLength(16);
    expect(exported.archive.projections.candidateJobs.every(job => job.candidates.length === 256)).toBe(true);
    expect(exported.archive.projections.candidateCursors).toEqual(archive.projections.candidateCursors);
    expect(exported.archive.projections.status).toBe("quarantined");
    expect(measureDepositInboxPortable(exported.archive).nodes).toBeLessThanOrEqual(100_000);
    expect(f.calls).toHaveLength(0);
  }, 180_000);

  it("reproduces original rows and raw evidence exactly, appends one quarantine and reopens with a new physical identity", async () => {
    let store = await target();
    const result = await restore(store);
    expect(result).toMatchObject({ mode: MODE, creditAuthority: false, quarantined: true,
      restored: { revision: sourceArchive.checkpoint.revision + 1 }, recovery: { sourceStoreInstanceId: sourceInstanceId,
        sourceCheckpoint: sourceArchive.checkpoint, backupChecksum: document().checksum, requestId: "restore-request" } });
    const targetId = result.recovery.targetStoreInstanceId;
    expect(targetId).not.toBe(sourceInstanceId);
    await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir: join(caseDirectory, "target") }); stores.push(store);
    const recovered = await inspectRestoredDevelopmentDepositInbox({ mode: MODE, store, requestId: "restore-request",
      expectedChecksum: document().checksum, expectedStoreInstanceId: targetId });
    expect(recovered).toEqual(result);
    const inbox = recorder(store, fixture, targetId), snapshot = await inbox.inspect();
    expect(snapshot.state).toMatchObject({ storeInstanceId: targetId, originStoreInstanceId: sourceArchive.projections.originStoreInstanceId,
      status: "quarantined", rawEvidenceBytes: sourceArchive.projections.rawEvidenceBytes });
    expect(snapshot.state.candidateCursors).toEqual(sourceArchive.projections.candidateCursors);
    expect(snapshot.state.events).toEqual(sourceArchive.projections.events);
    expect(snapshot.state.observations).toEqual(sourceArchive.projections.observations);
    const reexport = await parseDevelopmentDepositInboxBackup(await exportDevelopmentDepositInboxBackup({ mode: MODE, store, clock: restoreAt }));
    expect(reexport.archive.commands.slice(0, -1)).toEqual(sourceArchive.commands);
    expect(reexport.archive.evidenceBlobs).toEqual(sourceArchive.evidenceBlobs);
    expect(reexport.archive.bootstrap).toEqual(sourceArchive.bootstrap);
    expect(reexport.archive.projections.recoveryReceipts).toHaveLength(1);
    expect(await inbox.lookupReceipt({ requestId: originalReceipt.requestId, inputFingerprint: originalReceipt.inputFingerprint,
      expectedStoreInstanceId: targetId })).toEqual(originalReceipt);
    await expect(inbox.registerCandidateJob({ requestId: "no-resume", jobId: "new-job", orderedCandidates: fixture.candidates })).rejects.toThrow();
    await expect(restore(store)).rejects.toThrow();
    expect((await inbox.inspect()).checkpoint).toEqual(result.restored);
  }, TIMEOUT);

  it("restores an empty paused inbox without fabricating observations, events or candidate progress", async () => {
    const store = await target(), result = await restore(store, emptySerialized, "restore-empty");
    const inspected = await inspectDevelopmentDepositInboxBackup(emptySerialized);
    expect(inspected).toMatchObject({ observationCount: 0, eventCount: 0, candidateJobCount: 0, rawEvidenceBytes: 0 });
    expect(result.restored.revision).toBe(inspected.checkpoint.revision + 1);
    expect(result.recovery.targetStoreInstanceId).not.toBe(inspected.sourceStoreInstanceId);
    expect((await inspectRestoredDevelopmentDepositInbox({ mode: MODE, store, requestId: "restore-empty", expectedChecksum: inspected.checksum })).quarantined).toBe(true);
  }, TIMEOUT);

  it.each(["missing acknowledgment", "missing expected checksum", "wrong expected checksum", "early clock"])("refuses %s without installing a target", async failure => {
    const store = await target(), before = await footprint(store);
    const options = { mode: MODE, store, backup: serialized, expectedChecksum: document().checksum, acknowledgeFreshTarget: true as const,
      requestId: "invalid-restore", clock: restoreAt };
    if (failure === "missing acknowledgment") Object.assign(options, { acknowledgeFreshTarget: false });
    if (failure === "missing expected checksum") Object.assign(options, { expectedChecksum: undefined });
    if (failure === "wrong expected checksum") options.expectedChecksum = "0".repeat(64);
    if (failure === "early clock") options.clock = () => 0;
    await expect(restoreDevelopmentDepositInboxBackup(options)).rejects.toMatchObject({ creditAuthority: false });
    expect(await footprint(store)).toEqual(before);
  }, TIMEOUT);

  it.each(["schema", "evidence blob", "original command", "restore command", "quarantine", "recovery receipt", "deferred seal"])(
    "rolls back the entire fresh target after a failure at %s", async stage => {
      const store = await target(), before = await footprint(store); let reached = false;
      const matches = (sql: string, values?: unknown[]) => stage === "schema" ? sql.includes("CREATE SCHEMA alpha_wallet_deposit_inbox_simulation")
        : stage === "deferred seal" ? sql.includes("SET CONSTRAINTS ALL IMMEDIATE")
          : stage === "evidence blob" ? sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.evidence_blobs")
            : stage === "quarantine" ? sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.quarantines")
              : stage === "recovery receipt" ? sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.recovery_receipts")
                : sql.startsWith("INSERT INTO alpha_wallet_deposit_inbox_simulation.commands")
                  && JSON.stringify(values ?? []).includes("restore-quarantine") === (stage === "restore command");
      const broken = wrapped(store, tx => ({
        async query<SqlRow extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          const result = await tx.query<SqlRow>(sql, values);
          if (matches(sql, values)) { reached = true; throw new Error("synthetic restore boundary failure"); }
          return result;
        },
        async exec(sql: string) {
          await tx.exec(sql);
          if (matches(sql)) { reached = true; throw new Error("synthetic restore boundary failure"); }
        },
      }));
      await expect(restore(broken)).rejects.toThrow();
      expect(reached).toBe(true); expect(await footprint(store)).toEqual(before);
    }, TIMEOUT);

  it("marks the same physical owner failed even when its caller catches a malformed restore refusal", async () => {
    const store = await target(), before = await footprint(store); let caught = false;
    await expect(store.transaction(async tx => {
      await tx.exec("CREATE SCHEMA caught_restore_probe");
      const scoped: WalletStore = { transaction: work => work(tx), close: async () => undefined };
      try { await restoreDevelopmentDepositInboxBackup({ mode: MODE, store: scoped, backup: serialized,
        expectedChecksum: "0".repeat(64), acknowledgeFreshTarget: true, requestId: "caught-refusal", clock: restoreAt }); }
      catch { caught = true; }
    })).rejects.toThrow();
    expect(caught).toBe(true); expect(await footprint(store)).toEqual(before);
  }, TIMEOUT);

  it("recovers a complete restore after its actual COMMIT reply is lost without restoring over the target", async () => {
    const store = await target(); let committed = false;
    const uncertain: WalletStore = { transaction: async work => {
      await store.transaction(work); committed = true; throw new CommitOutcomeUnknownError(new Error("private database connection detail"));
    }, close: async () => undefined };
    const error = await restore(uncertain, serialized, "lost-restore-reply").catch(error => error);
    expect(error).toBeInstanceOf(CommitOutcomeUnknownError);
    expect(error).toMatchObject({ mode: MODE, creditAuthority: false, requestId: "lost-restore-reply", backupChecksum: document().checksum });
    expect(String(error.cause)).not.toContain("private database connection detail"); expect(committed).toBe(true);
    const result = await inspectRestoredDevelopmentDepositInbox({ mode: MODE, store, requestId: "lost-restore-reply", expectedChecksum: document().checksum });
    expect(result.recovery.targetStoreInstanceId).toBe(error.targetStoreInstanceId);
    await expect(restore(store, serialized, "lost-restore-reply")).rejects.toThrow();
    expect(await inspectRestoredDevelopmentDepositInbox({ mode: MODE, store, requestId: "lost-restore-reply", expectedChecksum: document().checksum })).toEqual(result);
  }, TIMEOUT);

  it("never treats a restored physical target as proof of an unknown original-source command", async () => {
    const store = await target(), result = await restore(store), targetId = result.recovery.targetStoreInstanceId;
    const inbox = recorder(store, fixture, targetId);
    const outcome = await inbox.reconcileUnknown({ requestId: "later-original-source-command", inputFingerprint: "1".repeat(64),
      expectedStoreInstanceId: sourceInstanceId, expectedPreCommandCheckpoint: sourceArchive.checkpoint });
    expect(outcome.status).toBe("unresolved");
    for (const options of [
      { requestId: "wrong-request", expectedChecksum: document().checksum },
      { requestId: "restore-request", expectedChecksum: "0".repeat(64) },
      { requestId: "restore-request", expectedChecksum: document().checksum, expectedStoreInstanceId: sourceInstanceId },
    ]) await expect(inspectRestoredDevelopmentDepositInbox({ mode: MODE, store, ...options })).rejects.toThrow();
    expect((await inbox.inspect()).checkpoint).toEqual(result.restored);
  }, TIMEOUT);

  it("pins the target capability and caller options before asynchronous replay or clock callbacks", async () => {
    const backing = await target("captured-target"), alternate = await target("alternate-target");
    const mutable: WalletStore = { transaction: work => backing.transaction(work), close: async () => undefined };
    const options = { mode: MODE, store: mutable, backup: serialized, expectedChecksum: document().checksum,
      acknowledgeFreshTarget: true as const, requestId: "captured-restore", clock: () => {
        mutable.transaction = work => alternate.transaction(work);
        options.backup = "{}"; options.expectedChecksum = "0".repeat(64); options.requestId = "mutated-restore";
        return restoreAt();
      } };
    const empty = await footprint(alternate), restored = await restoreDevelopmentDepositInboxBackup(options);
    expect(restored.recovery.requestId).toBe("captured-restore"); expect(restored.recovery.backupChecksum).toBe(document().checksum);
    expect(await footprint(alternate)).toEqual(empty);
    expect(await inspectRestoredDevelopmentDepositInbox({ mode: MODE, store: backing,
      requestId: "captured-restore", expectedChecksum: document().checksum })).toEqual(restored);
  }, TIMEOUT);

  it("preserves a validated conflict and both original observations through independent quarantine restore", async () => {
    const source = await target("conflicted-source"), f = createDepositInboxFixture("tron");
    const initial = await initializeDevelopmentDepositInbox({ mode: MODE, store: source, manifest: f.manifest,
      storeInstanceId: "conflicted-source", requestId: "conflict-bootstrap", clock: f.clock });
    const inbox = recorder(source, f, initial.state.storeInstanceId);
    const original = await f.prepare({ attemptId: "first-conflict-view", storeInstanceId: initial.state.storeInstanceId,
      preparationContext: inbox.preparationContext });
    await inbox.record({ requestId: "first-conflict-record", prepared: original });
    const changed = await f.prepare({ attemptId: "changed-conflict-view", storeInstanceId: initial.state.storeInstanceId,
      preparationContext: inbox.preparationContext, candidate: { ...f.standardCandidate, amountRaw: "1" } });
    const conflict = await inbox.record({ requestId: "changed-conflict-record", prepared: changed });
    expect(conflict.disposition).toBe("conflict-quarantined");
    const snapshot = await inbox.inspect(), backup = await exportDevelopmentDepositInboxBackup({ mode: MODE, store: source, clock: f.clock });
    expect((await inspectDevelopmentDepositInboxBackup(backup)).observationCount).toBe(2);
    const targetStore = await target("conflicted-target"), restored = await restore(targetStore, backup, "restore-conflicted");
    const reopened = recorder(targetStore, f, restored.recovery.targetStoreInstanceId);
    const final = await reopened.inspect();
    expect(final.state.events).toEqual(snapshot.state.events);
    expect(final.state.events[0].amountRaw).toBe(f.standardCandidate.amountRaw);
    expect(final.state.observations).toEqual(snapshot.state.observations);
    expect(final.state.quarantines.slice(0, -1)).toEqual(snapshot.state.quarantines);
    const omitted = JSON.parse(backup) as Envelope; omitted.archive.projections.quarantines = [];
    await expect(inspectDevelopmentDepositInboxBackup(resign(omitted))).rejects.toThrow();
  }, TIMEOUT);

  it.each(["empty wallet namespace", "public table"])("refuses %s without disturbing it", async companion => {
    const store = await target();
    await store.transaction(tx => tx.exec(companion === "empty wallet namespace" ? "CREATE SCHEMA alpha_wallet_simulation" : "CREATE TABLE public.unrelated_fixture(id integer)"));
    const before = await footprint(store);
    await expect(restore(store)).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
    expect(await footprint(store)).toEqual(before);
  }, TIMEOUT);

  it.each(["production", "VERCEL", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])("rejects %s before store access or executable options", async setting => {
    vi.stubEnv(setting === "production" ? "NODE_ENV" : setting, setting === "production" ? "production" : "1");
    const trap = vi.fn();
    const options = new Proxy({}, { get: trap, ownKeys: trap });
    await expect(restoreDevelopmentDepositInboxBackup(options as Parameters<typeof restoreDevelopmentDepositInboxBackup>[0])).rejects.toMatchObject({ code: "RUNTIME_REFUSED" });
    await expect(exportDevelopmentDepositInboxBackup(options as Parameters<typeof exportDevelopmentDepositInboxBackup>[0])).rejects.toMatchObject({ code: "RUNTIME_REFUSED" });
    await expect(inspectDevelopmentDepositInboxBackup(serialized)).rejects.toMatchObject({ code: "RUNTIME_REFUSED" });
    expect(trap).not.toHaveBeenCalled();
  });
});
