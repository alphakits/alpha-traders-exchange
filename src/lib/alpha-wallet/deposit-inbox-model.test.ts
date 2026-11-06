// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDepositInboxFixture, DEPOSIT_INBOX_FIXTURE_UINT256_MAX, DEPOSIT_INBOX_FIXTURE_UINT64_MAX,
  type DepositInboxFixtureVariant } from "../../../scripts/alpha-wallet/deposit-inbox-fixtures";
import type { DepositInboxCandidate } from "./deposit-inbox-admission";
import { digestInboxValue } from "./deposit-inbox-data";
import { captureDepositInboxCommand, createDepositInboxArchive, createDepositInboxPreparationContext,
  findDepositInboxReceipt, planDepositInboxRestore, transitionDepositInbox, verifyDepositInboxArchive } from "./deposit-inbox-model";
import { measureDepositInboxPortable, serializeDepositInboxPortable } from "./deposit-inbox-portable";
import type { DepositInboxActor, DepositInboxArchive, DepositInboxCursorPrecondition, DepositInboxUserCommand } from "./deposit-inbox-protocol";
import type { PreparedDepositObservationV1 } from "./deposit-observation-preparation";

type Row = Record<string, unknown>;
const row = (value: unknown) => value as Row;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const plus = (value: string, amount: number) => (BigInt(value) + BigInt(amount)).toString();

function harness(family: "bsc" | "tron" = "bsc", fixtureOptions: { now?: number } = {}) {
  const fixture = createDepositInboxFixture(family, fixtureOptions), storeInstanceId = `${family}-model-store`;
  const worker: DepositInboxActor = { workerId: fixture.workerId, role: "worker" };
  const operator: DepositInboxActor = { workerId: fixture.workerId, role: "operator" };
  let archive = createDepositInboxArchive({ mode: "simulation-only", manifest: fixture.manifest,
    storeInstanceId, requestId: "bootstrap", atMs: fixture.now });
  const capture = (command: DepositInboxUserCommand, actor = worker) => captureDepositInboxCommand({ mode: "simulation-only",
    manifest: fixture.manifest, worker: actor, storeInstanceId: archive.projections.storeInstanceId, command });
  const apply = async (command: DepositInboxUserCommand, actor = worker, options: { atMs?: number; admissionNowMs?: number } = {}) => {
    const captured = await capture(command, actor);
    const result = await transitionDepositInbox(archive, captured, { atMs: options.atMs ?? fixture.now,
      ...(options.admissionNowMs === undefined ? {} : { admissionNowMs: options.admissionNowMs }) });
    if (result.kind === "append") archive = result.plan.archive;
    return result;
  };
  const context = (candidate: DepositInboxCandidate, jobId?: string, base = archive) => createDepositInboxPreparationContext({
    archive: base, workerId: fixture.workerId, candidate, capturedAtMs: fixture.now, ...(jobId === undefined ? {} : { jobId }),
  });
  const prepare = (attemptId: string, options: { candidate?: DepositInboxCandidate; variant?: DepositInboxFixtureVariant;
    jobId?: string; base?: DepositInboxArchive } = {}) => fixture.prepare({ attemptId, storeInstanceId,
      candidate: options.candidate, variant: options.variant, jobId: options.jobId,
      preparationContext: request => context(request.candidate, request.jobId ?? undefined, options.base ?? archive) });
  const record = (requestId: string, prepared: PreparedDepositObservationV1, candidateCursor: DepositInboxCursorPrecondition | null = null) =>
    apply({ type: "record-observation", requestId, prepared, candidateCursor });
  const register = (jobId = "candidate-job", orderedCandidates: readonly DepositInboxCandidate[] = fixture.candidates) =>
    apply({ type: "register-candidate-job", requestId: `register-${jobId}`, jobId, orderedCandidates });
  const cursor = (jobId = "candidate-job"): DepositInboxCursorPrecondition => {
    const current = [...archive.projections.candidateCursors].reverse().find(value => value.jobId === jobId)!;
    return { jobId, expectedCursorRevision: current.commandRevision, expectedNextOrdinal: current.nextOrdinal,
      candidateManifestSha256: current.candidateManifestSha256 };
  };
  return { fixture, worker, operator, storeInstanceId, get archive() { return archive; }, capture, apply, context, prepare, record, register, cursor };
}

async function refused(run: () => unknown | Promise<unknown>, code?: string) {
  let caught: unknown;
  try { await run(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ creditAuthority: false, ...(code === undefined ? {} : { code }) });
  return caught as Error;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  vi.stubGlobal("fetch", () => { throw new Error("Ambient network is forbidden in inbox model tests"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(["bsc", "tron"] as const)("durable deposit model with complete %s native evidence", family => {
  it("creates immutable empty state with no financial authority and replays its bootstrap", async () => {
    const h = harness(family), archive = h.archive;
    expect(archive.projections).toMatchObject({ mode: "simulation-only", creditAuthority: false, status: "recording",
      inboxId: h.fixture.inboxId, storeInstanceId: h.storeInstanceId, rawEvidenceBytes: 0 });
    expect(archive.checkpoint.revision).toBe(0);
    expect(archive.commands).toEqual([]); expect(archive.evidenceBlobs).toEqual([]);
    expect(archive.projections.events).toEqual([]); expect(archive.projections.sourceHeads).toEqual([]);
    expect(Object.isFrozen(archive) && Object.isFrozen(archive.projections) && Object.isFrozen(archive.manifest)).toBe(true);
    expect(await verifyDepositInboxArchive(clone(archive))).toEqual(archive);
  });

  it("records one complete observation with event, transaction, block and last-head facts", async () => {
    const h = harness(family), prepared = await h.prepare("first-observation"), reads = h.fixture.calls.length;
    const result = await h.record("record-first", prepared);
    expect(result.kind).toBe("append");
    expect(result.receipt).toMatchObject({ mode: "simulation-only", creditAuthority: false, disposition: "recorded", revision: 1 });
    expect(h.archive.projections.events).toHaveLength(1);
    expect(h.archive.projections.events[0]).toMatchObject({ amountRaw: h.fixture.standardCandidate.amountRaw,
      assignmentId: h.fixture.assignmentId, eventIndex: h.fixture.standardCandidate.eventIndex });
    expect(h.archive.projections.transactionAnchors).toHaveLength(1);
    expect(h.archive.projections.blockAnchors).toHaveLength(family === "bsc" ? 4 : 5);
    expect(h.archive.projections.sourceHeads.at(-1)?.number).toBe(h.fixture.checkpointHeight);
    expect(h.archive.evidenceBlobs).toHaveLength(1);
    expect(h.archive.evidenceBlobs[0].observation).toEqual(prepared.timedObservation.observation);
    expect(h.archive.projections.rawEvidenceBytes).toBeGreaterThan(0);
    expect(h.fixture.calls).toHaveLength(reads);
    expect(await verifyDepositInboxArchive(clone(h.archive))).toEqual(h.archive);
  });

  it("recovers an exact command after pause and expired freshness without another observation", async () => {
    const h = harness(family), prepared = await h.prepare("exact-retry");
    const command: DepositInboxUserCommand = { type: "record-observation", requestId: "stable-request", prepared, candidateCursor: null };
    const first = await h.apply(command);
    await h.apply({ type: "pause", requestId: "pause-after-record", reason: "fixture-pause" }, h.operator);
    const before = clone(h.archive), reads = h.fixture.calls.length;
    h.fixture.setNow(h.fixture.now + 1_000_000);
    const recovered = await h.apply(clone(command));
    expect(recovered).toEqual({ kind: "recovered", receipt: first.receipt });
    expect(h.archive).toEqual(before); expect(h.fixture.calls).toHaveLength(reads);
    expect(findDepositInboxReceipt(h.archive, { workerId: h.fixture.workerId, requestId: command.requestId,
      inputFingerprint: first.receipt.inputFingerprint })).toEqual(first.receipt);
  });

  it("deduplicates the same exact evidence under new requests and changed attempt provenance", async () => {
    const h = harness(family), prepared = await h.prepare("original-attempt");
    await h.record("original-request", prepared);
    const rebound = await h.fixture.rebindAttempt(prepared, "another-attempt"), reads = h.fixture.calls.length;
    expect((await h.record("second-request", prepared)).receipt.disposition).toBe("duplicate-evidence");
    expect((await h.record("third-request", rebound)).receipt.disposition).toBe("duplicate-evidence");
    expect(h.archive.commands).toHaveLength(3);
    expect(h.archive.evidenceBlobs).toHaveLength(1);
    expect(h.archive.projections.observations).toHaveLength(1);
    expect(h.archive.projections.events).toHaveLength(1);
    expect(new Set(h.archive.projections.eventObservations.map(value => value.evidenceId)).size).toBe(1);
    expect(h.fixture.calls).toHaveLength(reads);
  });

  it("retains fresh consistent observation bytes as corroboration without creating another event", async () => {
    const h = harness(family);
    await h.record("first-record", await h.prepare("first-read"));
    const firstEvent = clone(h.archive.projections.events[0]);
    h.fixture.setNow(h.fixture.now + 1);
    expect((await h.record("second-record", await h.prepare("second-read"))).receipt.disposition).toBe("corroborating-observation");
    expect(h.archive.evidenceBlobs).toHaveLength(2);
    expect(h.archive.projections.observations).toHaveLength(2);
    expect(h.archive.projections.events).toEqual([firstEvent]);
    expect(h.archive.projections.transactionAnchors).toHaveLength(1);
    expect(h.archive.projections.status).toBe("recording");
  });

  it("records both known transactions against identical complete block membership", async () => {
    const h = harness(family);
    await h.record("first-transaction", await h.prepare("first-tx", { candidate: h.fixture.candidates[0] }));
    expect((await h.record("second-transaction", await h.prepare("second-tx", { candidate: h.fixture.candidates[1] }))).receipt.disposition).toBe("recorded");
    expect(h.archive.projections.events).toHaveLength(2);
    expect(h.archive.projections.transactionAnchors).toHaveLength(2);
    expect(h.archive.projections.blockAnchors).toHaveLength(family === "bsc" ? 4 : 5);
  });

  it("retains identical transfer payloads at distinct native positions in the same full receipt", async () => {
    const h = harness(family), variant = { duplicateTransferLog: true };
    const first = await h.prepare("first-position", { variant });
    await h.record("first-position-record", first);
    const next = { ...h.fixture.standardCandidate, eventIndex: family === "bsc" ? "9" : "2" };
    expect((await h.record("second-position-record", await h.prepare("second-position", { candidate: next, variant }))).receipt.disposition).toBe("recorded");
    expect(h.archive.projections.events).toHaveLength(2);
    expect(h.archive.projections.transactionAnchors).toHaveLength(1);
    expect(new Set(h.archive.projections.events.map(value => value.nativeEventLocator)).size).toBe(2);
    expect(h.archive.projections.events.map(value => value.amountRaw)).toEqual([next.amountRaw, next.amountRaw]);
  });

  it.each(["raw amount", "recipient assignment", "token assignment"] as const)(
    "quarantines a second fully valid observation with changed %s and preserves first facts", async change => {
      const h = harness(family);
      await h.record("first-facts", await h.prepare("first-facts-read"));
      const before = clone(h.archive.projections);
      const candidate = { ...h.fixture.standardCandidate,
        ...(change === "raw amount" ? { amountRaw: "7" } : { assignmentId: change === "recipient assignment"
          ? h.fixture.assignments.otherRecipient : h.fixture.assignments.otherToken }) };
      const conflicting = await h.prepare("different-facts-read", { candidate });
      const result = await h.record("different-facts", conflicting);
      expect(result.receipt.disposition).toBe("conflict-quarantined");
      expect(h.archive.projections.status).toBe("quarantined");
      expect(h.archive.projections.events).toEqual(before.events);
      expect(h.archive.projections.transactionAnchors).toEqual(before.transactionAnchors);
      expect(h.archive.projections.blockAnchors).toEqual(before.blockAnchors);
      expect(h.archive.projections.sourceHeads).toEqual(before.sourceHeads);
      expect(h.archive.evidenceBlobs).toHaveLength(2);
      expect(h.archive.projections.quarantines[0]).toMatchObject({ firstEvidenceId: before.events[0].evidenceId,
        incomingEvidenceId: result.receipt.evidenceId });
      expect(await verifyDepositInboxArchive(clone(h.archive))).toEqual(h.archive);
    });

  it("detects an overlapping finalized block fork across different selected transactions", async () => {
    const h = harness(family);
    await h.record("original-chain", await h.prepare("original-chain-read"));
    const fork = await h.prepare("forked-chain-read", { candidate: h.fixture.candidates[1],
      variant: { forkFromHeight: h.fixture.containingHeight, forkTag: "competing-history" } });
    expect((await h.record("forked-chain", fork)).receipt.disposition).toBe("conflict-quarantined");
    expect(h.archive.projections.quarantines.at(-1)?.reason).toBe("validated-block-conflict");
    expect(h.archive.projections.events).toHaveLength(1);
  });

  it("holds compatible older work prepared before a newer head without inventing a regression", async () => {
    const h = harness(family), base = h.archive;
    const old = await h.prepare("earlier-prepared", { base });
    const advanced = await h.prepare("later-prepared", { base, variant: { headHeight: plus(h.fixture.checkpointHeight, 2) } });
    await h.record("newer-arrives-first", advanced);
    const currentHeads = clone(h.archive.projections.sourceHeads);
    h.fixture.setNow(h.fixture.now + 30_000);
    expect((await h.record("older-arrives-second", old)).receipt.disposition).toBe("stale-preparation-held");
    expect(h.archive.projections.status).toBe("recording");
    expect(h.archive.projections.sourceHeads).toEqual(currentHeads);
    expect(h.archive.projections.quarantines).toEqual([]);
  });

  it("uses the last validated head and quarantines a genuine regression below its captured base", async () => {
    const h = harness(family);
    const advanced = await h.prepare("validated-advancing-head", { variant: { headHeight: plus(h.fixture.checkpointHeight, 2) } });
    expect(advanced.timedObservation.observation.transfer.checkpointNumber).toBe(h.fixture.checkpointHeight);
    await h.record("accept-advanced-head", advanced);
    expect(h.archive.projections.sourceHeads.at(-1)?.number).toBe(plus(h.fixture.checkpointHeight, 2));
    const regressed = await h.prepare("regressed-head", { variant: { checkpointHeight: plus(h.fixture.checkpointHeight, 1) } });
    expect(regressed.preparationContext.sourceHead?.number).toBe(plus(h.fixture.checkpointHeight, 2));
    expect((await h.record("record-regressed-head", regressed)).receipt.disposition).toBe("conflict-quarantined");
    expect(h.archive.projections.quarantines.at(-1)?.reason).toBe("validated-head-regression");
    expect(h.archive.projections.sourceHeads.at(-1)?.number).toBe(plus(h.fixture.checkpointHeight, 2));
  });

  it("holds a later candidate separated by an unproved ancestry gap", async () => {
    const h = harness(family);
    await h.record("base-chain", await h.prepare("base-chain-read"));
    const before = clone(h.archive.projections);
    const later = await h.prepare("gapped-proof", { candidate: h.fixture.laterCandidate,
      variant: { containingHeight: plus(h.fixture.checkpointHeight, 8) } });
    expect((await h.record("gapped-candidate", later)).receipt.disposition).toBe("continuity-unproved-held");
    expect(h.archive.projections.sourceHeads).toEqual(before.sourceHeads);
    expect(h.archive.projections.events).toEqual(before.events);
    expect(h.archive.projections.status).toBe("recording");
  });

  it("accepts a genuinely new containing block immediately succeeding the retained head", async () => {
    const h = harness(family);
    await h.record("first-window", await h.prepare("first-window-read"));
    const later = await h.prepare("linked-successor-read", { candidate: h.fixture.laterCandidate,
      variant: { containingHeight: plus(h.fixture.checkpointHeight, 1) } });
    expect((await h.record("linked-successor", later)).receipt.disposition).toBe("recorded");
    expect(h.archive.projections.events).toHaveLength(2);
    expect(h.archive.projections.transactionAnchors).toHaveLength(2);
    expect(h.archive.projections.status).toBe("recording");
  });

  it("holds an immediate successor whose timestamp equals the retained head", async () => {
    const h = harness(family);
    await h.record("timestamp-base", await h.prepare("timestamp-base-read"));
    const before = clone(h.archive.projections);
    const later = await h.prepare("equal-timestamp-read", { candidate: h.fixture.laterCandidate,
      variant: { containingHeight: plus(h.fixture.checkpointHeight, 1), timestampOriginHeight: plus(h.fixture.containingHeight, 1) } });
    expect((await h.record("equal-timestamp-successor", later)).receipt.disposition).toBe("continuity-unproved-held");
    expect(h.archive.projections.sourceHeads).toEqual(before.sourceHeads);
    expect(h.archive.projections.events).toEqual(before.events);
    expect(h.archive.projections.status).toBe("recording");
  });

  it("does not treat an isolated genesis identity read as a bridge to a distant new candidate", async () => {
    const h = harness(family, { now: 100_000 });
    const genesisVariant = { containingHeight: "0", checkpointHeight: "0", timestampOriginHeight: "0" };
    const genesisBlock = h.fixture.blockAt("0", genesisVariant);
    await h.record("genesis-head", await h.prepare("genesis-head-read", { variant: genesisVariant }));
    expect(h.archive.projections.sourceHeads.at(-1)?.number).toBe("0");
    const before = clone(h.archive.projections);
    const later = await h.prepare("isolated-genesis-read", { candidate: h.fixture.laterCandidate, variant: {
      containingHeight: "10", timestampOriginHeight: "0",
      mutateResponse: (value, read) => {
        if (family === "bsc" && read.operation === "eth_getBlockByNumber" && row(value).number === "0x0") return clone(genesisBlock);
        if (family === "tron" && read.operation.endsWith("getblockbynum") && read.request.num === 0) return clone(genesisBlock);
        return value;
      },
    } });
    expect((await h.record("isolated-genesis-gap", later)).receipt.disposition).toBe("continuity-unproved-held");
    expect(h.archive.projections.sourceHeads).toEqual(before.sourceHeads);
    expect(h.archive.projections.blockAnchors).toEqual(before.blockAnchors);
    expect(h.archive.projections.quarantines).toEqual([]);
  });

  it("keeps maximum uint256 transfer units as exact decimal facts", async () => {
    const h = harness(family), candidate = { ...h.fixture.standardCandidate, amountRaw: DEPOSIT_INBOX_FIXTURE_UINT256_MAX };
    await h.record("maximum-units", await h.prepare("maximum-units-read", { candidate }));
    expect(h.archive.projections.events[0].amountRaw).toBe(DEPOSIT_INBOX_FIXTURE_UINT256_MAX);
    expect((await verifyDepositInboxArchive(clone(h.archive))).projections.events[0].amountRaw).toBe(DEPOSIT_INBOX_FIXTURE_UINT256_MAX);
  });
});

describe("deposit inbox transaction identity and candidate progress", () => {
  it.each(["bsc", "tron"] as const)("retains an exact 256-entry %s job without claiming native coverage", async family => {
    const h = harness(family), candidates = Array.from({ length: 256 }, (_, index) => ({ ...h.fixture.standardCandidate,
      transactionId: `${family === "bsc" ? "0x" : ""}${BigInt(index + 1).toString(16).padStart(64, "0")}` }));
    await h.register("maximum-candidate-job", candidates);
    expect(h.archive.projections.candidateJobs[0].candidates).toEqual(candidates);
    expect(h.archive.projections.candidateCursors[0]).toMatchObject({ nextOrdinal: 0, candidateCount: 256 });
    expect(h.archive.projections.events).toEqual([]); expect(h.archive.projections.sourceHeads).toEqual([]);
    expect(h.fixture.calls).toHaveLength(0);
    expect(await verifyDepositInboxArchive(clone(h.archive))).toEqual(h.archive);
  });

  it.each([
    { label: "empty", count: 0 }, { label: "257-entry", count: 257 },
  ])("refuses an $label candidate job without a partial registration", async ({ count }) => {
    const h = harness(), before = clone(h.archive);
    await refused(() => h.register("out-of-range-job", Array.from({ length: count }, () => h.fixture.standardCandidate)), "INVALID_INPUT");
    expect(h.archive).toEqual(before); expect(h.fixture.calls).toHaveLength(0);
  });

  it.each(["bsc", "tron"] as const)("advances repeated identical %s job coordinates separately while retaining one event", async family => {
    const h = harness(family); await h.register("repeated-job", [h.fixture.standardCandidate, h.fixture.standardCandidate]);
    const firstPrepared = await h.prepare("repeated-first-read", { jobId: "repeated-job" }), firstCursor = h.cursor("repeated-job");
    const firstCommand: DepositInboxUserCommand = { type: "record-observation", requestId: "repeated-first-record",
      prepared: firstPrepared, candidateCursor: firstCursor };
    const first = await h.apply(firstCommand);
    const second = await h.record("repeated-second-record", await h.prepare("repeated-second-read", { jobId: "repeated-job" }), h.cursor("repeated-job"));
    expect(second.receipt.disposition).toBe(family === "bsc" ? "corroborating-observation" : "duplicate-evidence");
    expect(second.receipt.cursorAfter?.nextOrdinal).toBe(2);
    expect(h.archive.projections.events).toHaveLength(1); expect(h.archive.projections.transactionAnchors).toHaveLength(1);
    const before = clone(h.archive);
    expect(await h.apply(firstCommand)).toEqual({ kind: "recovered", receipt: first.receipt });
    expect(h.archive).toEqual(before);
  });

  it("refuses reuse of an immutable job identifier under a new request without changing its cursor", async () => {
    const h = harness(); await h.register("immutable-job"); const before = clone(h.archive);
    await refused(() => h.apply({ type: "register-candidate-job", requestId: "different-register-request", jobId: "immutable-job",
      orderedCandidates: [...h.fixture.candidates].reverse() }), "ADMISSION_REFUSED");
    expect(h.archive).toEqual(before);
  });

  it("retains sixteen jobs and converts a seventeenth into recoverable resource quarantine", async () => {
    const h = harness();
    for (let index = 0; index < 16; index++) expect((await h.register(`bounded-job-${index}`)).receipt.disposition).toBe("job-registered");
    const before = clone(h.archive);
    const result = await h.register("overflow-job");
    expect(result.receipt.disposition).toBe("resource-quarantined");
    expect(h.archive.projections.status).toBe("quarantined");
    expect(h.archive.projections.haltReason).toBe("resource-limit");
    expect(h.archive.projections.candidateJobs).toEqual(before.projections.candidateJobs);
    expect(h.archive.projections.candidateCursors).toEqual(before.projections.candidateCursors);
    expect(h.archive.commands.at(-1)?.command.type).toBe("resource-quarantine");
    expect(h.archive.evidenceBlobs).toEqual([]); expect(h.fixture.calls).toHaveLength(0);
    const terminal = clone(h.archive);
    expect(await h.register("overflow-job")).toEqual({ kind: "recovered", receipt: result.receipt });
    expect(h.archive).toEqual(terminal);
    await refused(() => h.register("after-resource-stop"));
    expect(await verifyDepositInboxArchive(terminal)).toEqual(h.archive);
    const restored = await planDepositInboxRestore(h.archive, { requestId: "resource-recovery", targetStoreInstanceId: "resource-recovery-target",
      atMs: h.fixture.now, backupChecksum: "ab".repeat(32) });
    expect(restored.nextState.status).toBe("quarantined"); expect(restored.nextState.candidateJobs).toHaveLength(16);
    expect(await verifyDepositInboxArchive(clone(restored.archive))).toEqual(restored.archive);
  });

  it("preserves full 256-candidate jobs at capacity and through the terminal restore reserve", async () => {
    const h = harness(), candidates = Array.from({ length: 256 }, () => h.fixture.standardCandidate);
    let retained = clone(h.archive), terminalRequest: string | undefined;
    for (let index = 0; index <= 16; index++) {
      const jobId = `structural-job-${index}`, result = await h.register(jobId, candidates);
      if (result.receipt.disposition === "resource-quarantined") { terminalRequest = jobId; break; }
      expect(result.receipt.disposition).toBe("job-registered"); retained = clone(h.archive);
    }
    expect(terminalRequest).toBe("structural-job-16");
    expect(retained.projections.candidateJobs).toHaveLength(16);
    expect(h.archive.projections.candidateJobs).toEqual(retained.projections.candidateJobs);
    expect(h.archive.projections.candidateCursors).toEqual(retained.projections.candidateCursors);
    expect(h.archive.projections.candidateJobs.every(job => job.candidates.length === 256)).toBe(true);
    expect(h.archive.projections.status).toBe("quarantined");
    expect(h.fixture.calls).toHaveLength(0); expect(h.archive.evidenceBlobs).toEqual([]);
    expect(measureDepositInboxPortable(h.archive).nodes).toBeLessThanOrEqual(100_000 - 2048);
    const serialized = serializeDepositInboxPortable(h.archive, h.fixture.now);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(64 * 1024 * 1024);
    const restored = await planDepositInboxRestore(h.archive, { requestId: "structural-restore", targetStoreInstanceId: "structural-restore-target",
      atMs: h.fixture.now, backupChecksum: "bc".repeat(32) });
    expect(restored.nextState.candidateJobs).toEqual(retained.projections.candidateJobs);
    expect(restored.nextState.candidateCursors).toEqual(retained.projections.candidateCursors);
    expect(measureDepositInboxPortable(restored.archive).nodes).toBeLessThanOrEqual(100_000);
    expect(await verifyDepositInboxArchive(clone(restored.archive))).toEqual(restored.archive);
  }, 60_000);

  it("quarantines BSC reinclusion with a changed log index through the transaction anchor", async () => {
    const h = harness();
    await h.record("original-inclusion", await h.prepare("original-inclusion-read"));
    const reincluded = await h.prepare("different-inclusion-read", { candidate: { ...h.fixture.standardCandidate, eventIndex: "12" },
      variant: { containingHeight: plus(h.fixture.checkpointHeight, 1) } });
    expect((await h.record("different-inclusion", reincluded)).receipt.disposition).toBe("conflict-quarantined");
    expect(h.archive.projections.quarantines.at(-1)?.reason).toBe("validated-transaction-conflict");
    expect(h.archive.projections.events).toHaveLength(1);
    expect(h.archive.projections.events[0].eventIndex).toBe("8");
    expect(h.archive.projections.transactionAnchors[0].blockNumber).toBe("100");
  });

  it("preserves exact maximum BSC uint64 block and event indices", async () => {
    const h = harness(), candidate = { ...h.fixture.standardCandidate, eventIndex: DEPOSIT_INBOX_FIXTURE_UINT64_MAX };
    const variant = { containingHeight: DEPOSIT_INBOX_FIXTURE_UINT64_MAX, checkpointHeight: DEPOSIT_INBOX_FIXTURE_UINT64_MAX,
      timestampOriginHeight: DEPOSIT_INBOX_FIXTURE_UINT64_MAX };
    await h.record("maximum-native-position", await h.prepare("maximum-native-position-read", { candidate, variant }));
    expect(h.archive.projections.events[0].eventIndex).toBe(DEPOSIT_INBOX_FIXTURE_UINT64_MAX);
    expect(h.archive.projections.transactionAnchors[0].blockNumber).toBe(DEPOSIT_INBOX_FIXTURE_UINT64_MAX);
    expect(h.archive.projections.sourceHeads.at(-1)?.number).toBe(DEPOSIT_INBOX_FIXTURE_UINT64_MAX);
  });

  it.each(["bsc", "tron"] as const)("advances a finite %s job exactly one ordinal per accepted command", async family => {
    const h = harness(family);
    expect((await h.register()).receipt.disposition).toBe("job-registered");
    const firstCursor = h.cursor();
    const first = await h.record("job-first", await h.prepare("job-first-read", { jobId: "candidate-job" }), firstCursor);
    expect(first.receipt.cursorBefore?.nextOrdinal).toBe(0); expect(first.receipt.cursorAfter?.nextOrdinal).toBe(1);
    const second = await h.record("job-second", await h.prepare("job-second-read", { candidate: h.fixture.candidates[1], jobId: "candidate-job" }), h.cursor());
    expect(second.receipt.cursorBefore?.nextOrdinal).toBe(1); expect(second.receipt.cursorAfter?.nextOrdinal).toBe(2);
    expect(h.archive.projections.candidateCursors.at(-1)?.candidateCount).toBe(2);
    expect(h.archive.projections.events).toHaveLength(2);
    await refused(() => h.prepare("job-exhausted-read", { jobId: "candidate-job" }));
  });

  it("refuses an ordinary stale cursor CAS without partial evidence or progress", async () => {
    const h = harness(); await h.register();
    const cursor = h.cursor(), base = h.archive;
    const first = await h.prepare("same-ordinal-first", { jobId: "candidate-job", base });
    const second = await h.prepare("same-ordinal-second", { jobId: "candidate-job", base });
    await h.record("advance-ordinal", first, cursor);
    const before = clone(h.archive);
    await refused(() => h.record("stale-ordinal", second, cursor));
    expect(h.archive).toEqual(before);
  });

  it("quarantines validated conflicting history before an ordinary stale-cursor refusal", async () => {
    const h = harness(); await h.register();
    const cursor = h.cursor(), base = h.archive;
    const first = await h.prepare("cursor-first", { jobId: "candidate-job", base });
    const fork = await h.prepare("cursor-fork", { jobId: "candidate-job", base,
      variant: { forkFromHeight: h.fixture.containingHeight } });
    await h.record("cursor-winner", first, cursor);
    const currentCursor = clone(h.archive.projections.candidateCursors);
    expect((await h.record("cursor-conflict", fork, cursor)).receipt.disposition).toBe("conflict-quarantined");
    expect(h.archive.projections.candidateCursors).toEqual(currentCursor);
  });

  it("persists an older compatible preparation hold even when its candidate cursor is stale", async () => {
    const h = harness(); await h.register();
    const cursor = h.cursor(), base = h.archive;
    const old = await h.prepare("cursor-old-head", { jobId: "candidate-job", base });
    const newer = await h.prepare("cursor-new-head", { jobId: "candidate-job", base,
      variant: { headHeight: plus(h.fixture.checkpointHeight, 2) } });
    await h.record("cursor-newer-first", newer, cursor);
    const currentCursor = clone(h.archive.projections.candidateCursors);
    expect((await h.record("cursor-older-later", old, cursor)).receipt.disposition).toBe("stale-preparation-held");
    expect(h.archive.projections.candidateCursors).toEqual(currentCursor);
    expect(h.archive.projections.status).toBe("recording");
  });

  it("does not advance a job when its candidate lacks continuity", async () => {
    const h = harness(); await h.record("prior-head", await h.prepare("prior-head-read"));
    await h.register("later-job", [h.fixture.laterCandidate]);
    const cursor = h.cursor("later-job"), before = clone(h.archive.projections.candidateCursors);
    const later = await h.prepare("job-gap-read", { jobId: "later-job", candidate: h.fixture.laterCandidate,
      variant: { containingHeight: plus(h.fixture.checkpointHeight, 8) } });
    expect((await h.record("job-gap", later, cursor)).receipt.disposition).toBe("continuity-unproved-held");
    expect(h.archive.projections.candidateCursors).toEqual(before);
  });

  it("rejects ambiguous duplicate native positions in a candidate job", async () => {
    const h = harness(), before = clone(h.archive);
    await refused(() => h.register("ambiguous-job", [h.fixture.standardCandidate, { ...h.fixture.standardCandidate, amountRaw: "7" }]));
    expect(h.archive).toEqual(before); expect(h.fixture.calls).toHaveLength(0);
  });
});

describe("deposit inbox request collisions, boundaries and replay", () => {
  it("retains an original receipt and recovers a separately stored deterministic request-conflict fault", async () => {
    const h = harness(), firstPrepared = await h.prepare("request-original"), different = await h.prepare("request-different");
    const first = await h.record("same-request", firstPrepared);
    const fault = await h.record("same-request", different);
    expect(fault.receipt.disposition).toBe("request-conflict-quarantined");
    expect(h.archive.projections.status).toBe("quarantined");
    expect(h.archive.commands[0].receipt).toEqual(first.receipt);
    const before = clone(h.archive), reads = h.fixture.calls.length;
    expect(await h.record("same-request", different)).toEqual({ kind: "recovered", receipt: fault.receipt });
    expect(await h.record("same-request", firstPrepared)).toEqual({ kind: "recovered", receipt: first.receipt });
    expect(h.archive).toEqual(before); expect(h.fixture.calls).toHaveLength(reads);
  });

  it("does not let an existing request identity switch command type", async () => {
    const h = harness(); await h.record("shared-command-key", await h.prepare("type-original"));
    const result = await h.apply({ type: "register-candidate-job", requestId: "shared-command-key", jobId: "changed-type", orderedCandidates: h.fixture.candidates });
    expect(result.receipt.disposition).toBe("request-conflict-quarantined");
    expect(h.archive.projections.candidateJobs).toEqual([]);
    expect(h.archive.projections.status).toBe("quarantined");
  });

  it.each(["record", "job"] as const)("refuses a new %s command after an irreversible pause", async kind => {
    const h = harness(), prepared = await h.prepare("before-pause");
    await h.apply({ type: "pause", requestId: "stop", reason: "fixture-pause" }, h.operator);
    const before = clone(h.archive);
    await refused(() => kind === "record" ? h.record("after-pause-record", prepared) : h.register("after-pause-job"));
    expect(h.archive).toEqual(before);
  });

  it("refuses worker-only pause authority", async () => {
    const h = harness();
    await refused(() => h.apply({ type: "pause", requestId: "worker-pause", reason: "not-operator" }));
    expect(h.archive.checkpoint.revision).toBe(0); expect(h.archive.projections.status).toBe("recording");
  });

  it("rejects genuinely new expired evidence without changing history", async () => {
    const h = harness("tron"), prepared = await h.prepare("expiring-read"), before = clone(h.archive);
    h.fixture.setNow(h.fixture.now + 30_000);
    await refused(() => h.record("expired-new-record", prepared));
    expect(h.archive).toEqual(before);
  });

  it("captures a command before caller mutation and preserves the admitted amount", async () => {
    const h = harness(), prepared = clone(await h.prepare("mutation-read"));
    const command: DepositInboxUserCommand = { type: "record-observation", requestId: "immutable-command", prepared, candidateCursor: null };
    const captured = await h.capture(command);
    row(command).requestId = "mutated-command"; row(prepared.candidate).amountRaw = "7";
    const transition = await transitionDepositInbox(h.archive, captured, { atMs: h.fixture.now });
    expect(transition.receipt.requestId).toBe("immutable-command");
    expect(transition.kind).toBe("append");
    if (transition.kind === "append") expect(transition.plan.nextState.events[0].amountRaw).toBe(h.fixture.standardCandidate.amountRaw);
  });

  it("rejects a copied command object that lacks its live captured admission capability", async () => {
    const h = harness(), captured = await h.capture({ type: "register-candidate-job", requestId: "captured-job", jobId: "captured-job", orderedCandidates: h.fixture.candidates });
    await refused(() => transitionDepositInbox(h.archive, clone(captured), { atMs: h.fixture.now }));
    expect(h.archive.checkpoint.revision).toBe(0);
  });

  it("rejects preparation bound to a different physical store identity", async () => {
    const h = harness(), prepared = await h.prepare("wrong-target-read");
    const target = createDepositInboxArchive({ mode: "simulation-only", manifest: h.fixture.manifest,
      storeInstanceId: "other-physical-store", requestId: "other-bootstrap", atMs: h.fixture.now });
    const captured = await captureDepositInboxCommand({ mode: "simulation-only", manifest: h.fixture.manifest,
      worker: h.worker, storeInstanceId: "other-physical-store", command: {
        type: "record-observation", requestId: "wrong-target-command", prepared, candidateCursor: null,
      } });
    await refused(() => transitionDepositInbox(target, captured, { atMs: h.fixture.now }));
    expect(h.archive.checkpoint.revision).toBe(0);
    expect(target.checkpoint.revision).toBe(0);
  });

  it.each(["checkpoint hash", "source head", "candidate manifest"] as const)(
    "refuses a fully replayable native preparation with a fabricated retained %s binding", async change => {
      const h = harness();
      if (change === "source head") await h.record("real-retained-head", await h.prepare("real-retained-head-read"));
      if (change === "candidate manifest") await h.register();
      const jobId = change === "candidate manifest" ? "candidate-job" : undefined;
      const prepared = await h.fixture.prepare({ attemptId: `forged-${change.replaceAll(" ", "-")}`, storeInstanceId: h.storeInstanceId,
        ...(jobId === undefined ? {} : { jobId }), preparationContext: request => {
          const context = clone(h.context(request.candidate, request.jobId ?? undefined));
          if (change === "checkpoint hash") context.checkpoint.eventHash = "ee".repeat(32);
          if (change === "source head") context.sourceHead!.hash = `0x${"ee".repeat(32)}`;
          if (change === "candidate manifest") context.candidateCursor!.candidateManifestSha256 = "ee".repeat(32);
          return context;
        } });
      const before = clone(h.archive);
      await refused(() => h.record("forged-retained-context", prepared, jobId === undefined ? null : h.cursor()));
      expect(h.archive).toEqual(before);
    });

  it.each(["NODE_ENV", "ALPHA_WALLET_SIGNING_ENABLED"] as const)("refuses %s runtime changes before transition", async name => {
    const h = harness(), command: DepositInboxUserCommand = { type: "register-candidate-job", requestId: "runtime-job", jobId: "runtime-job", orderedCandidates: h.fixture.candidates };
    const captured = await h.capture(command); vi.stubEnv(name, name === "NODE_ENV" ? "production" : "1");
    await refused(() => transitionDepositInbox(h.archive, captured, { atMs: h.fixture.now }), "RUNTIME_REFUSED");
    expect(h.archive.checkpoint.revision).toBe(0); expect(h.fixture.calls).toHaveLength(0);
  });

  it.each(["event amount", "source head", "cursor", "receipt", "raw bytes", "missing blob"] as const)(
    "rejects serialized history with altered %s", async change => {
      const h = harness(); await h.register();
      await h.record("retained-command", await h.prepare("retained-read", { jobId: "candidate-job" }), h.cursor());
      const archive = clone(h.archive);
      if (change === "event amount") row(archive.projections.events[0]).amountRaw = "7";
      if (change === "source head") row(archive.projections.sourceHeads[0]).number = "1";
      if (change === "cursor") row(archive.projections.candidateCursors.at(-1)).nextOrdinal = 2;
      if (change === "receipt") row(archive.commands.at(-1)?.receipt).disposition = "duplicate-evidence";
      if (change === "raw bytes") row(archive.evidenceBlobs[0].observation.reads[0]).responseBody = "{}";
      if (change === "missing blob") row(archive).evidenceBlobs = [];
      await refused(() => verifyDepositInboxArchive(archive));
    });

  it("replays serialized history after current freshness expires without node or wall-clock IO", async () => {
    const h = harness(); await h.record("archive-record", await h.prepare("archive-read"));
    const archive = clone(h.archive), reads = h.fixture.calls.length;
    h.fixture.setNow(h.fixture.now + 1_000_000);
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Historical replay must not consult today's wall clock"); });
    expect(await verifyDepositInboxArchive(archive)).toEqual(h.archive);
    expect(h.fixture.calls).toHaveLength(reads);
  });

  it("retains a validated contradiction even after its new-progress freshness expires", async () => {
    const h = harness(); await h.record("fresh-first-facts", await h.prepare("fresh-first-facts-read"));
    const conflicting = await h.prepare("delayed-conflict-read", { candidate: { ...h.fixture.standardCandidate, amountRaw: "7" } });
    h.fixture.setNow(h.fixture.now + 30_000);
    expect((await h.record("delayed-conflict", conflicting)).receipt.disposition).toBe("conflict-quarantined");
    expect(h.archive.projections.events[0].amountRaw).toBe(h.fixture.standardCandidate.amountRaw);
    expect(h.archive.evidenceBlobs).toHaveLength(2);
    expect(await verifyDepositInboxArchive(clone(h.archive))).toEqual(h.archive);
  });

  it.each(["event units", "transaction placement", "block meaning", "last validated head"] as const)(
    "rejects altered retained %s even when every outer state and journal digest is recomputed", async change => {
      const h = harness(); await h.record("semantic-replay-record", await h.prepare("semantic-replay-read"));
      const archive = clone(h.archive), record = archive.commands[0], effects = row(record.effects);
      const key = change === "event units" ? "events" : change === "transaction placement" ? "transactionAnchors"
        : change === "block meaning" ? "blockAnchors" : "sourceHeads";
      const projection = row((row(archive.projections)[key] as unknown[])[0]);
      const delta = row((effects[key] as unknown[])[0]);
      const modification = change === "event units" ? { amountRaw: "7" }
        : change === "transaction placement" ? { blockNumber: "99" }
          : change === "block meaning" ? { blockSemanticsSha256: "ef".repeat(32) } : { number: "103" };
      Object.assign(projection, modification); Object.assign(delta, modification);
      row(record).stateHash = digestInboxValue("inbox-state", archive.projections);
      const { eventHash: ignoredHash, receipt: ignoredReceipt, ...body } = record; void ignoredHash; void ignoredReceipt;
      row(record).eventHash = digestInboxValue("inbox-command", body);
      row(archive).checkpoint = { revision: record.revision, eventHash: record.eventHash, stateHash: record.stateHash };
      row(record.receipt).checkpoint = archive.checkpoint;
      expect(archive.checkpoint.stateHash).toBe(digestInboxValue("inbox-state", archive.projections));
      await refused(() => verifyDepositInboxArchive(archive), "REPLAY_MISMATCH");
    });

  it.each(["omitted command", "reordered commands", "duplicate receipt", "extra evidence blob"] as const)(
    "rejects complete-looking history containing an %s", async change => {
      const h = harness(); await h.register();
      await h.record("journal-record", await h.prepare("journal-read", { jobId: "candidate-job" }), h.cursor());
      const archive = clone(h.archive);
      if (change === "omitted command") row(archive).commands = archive.commands.slice(1);
      if (change === "reordered commands") row(archive).commands = [...archive.commands].reverse();
      if (change === "duplicate receipt") row(archive).commands = [...archive.commands, clone(archive.commands.at(-1))];
      if (change === "extra evidence blob") row(archive).evidenceBlobs = [...archive.evidenceBlobs, { ...clone(archive.evidenceBlobs[0]), evidenceId: "ef".repeat(32) }];
      await refused(() => verifyDepositInboxArchive(archive));
    });
});

describe("admitted unsealed attempts and terminal recovery", () => {
  it("refuses a PostgreSQL-unrepresentable NUL pause reason before changing the portable history", async () => {
    const h = harness(), before = clone(h.archive);
    await refused(() => h.apply({ type: "pause", requestId: "nul-pause", reason: "before\u0000after" }, h.operator), "INVALID_INPUT");
    expect(h.archive).toEqual(before);
  });

  it.each(["missing-receipt", "invalid-evidence", "timeout"] as const)("records an admitted %s probe as a nonadvancing hold", async failure => {
    const h = harness(); await h.register();
    const cursor = h.cursor(), beforeCursor = clone(h.archive.projections.candidateCursors);
    const result = await h.fixture.probe({ attemptId: `probe-${failure}`, storeInstanceId: h.storeInstanceId, jobId: "candidate-job",
      preparationContext: request => h.context(request.candidate, request.jobId ?? undefined), variant: { failure } });
    expect(result.kind).toBe("held"); if (result.kind !== "held") throw new Error("Expected an actual unsealed probe result");
    const recorded = await h.apply({ type: "record-attempt-hold", requestId: `hold-${failure}`, attempt: result.attempt, candidateCursor: cursor });
    expect(recorded.receipt.disposition).toBe("attempt-held");
    expect(h.archive.projections.candidateCursors).toEqual(beforeCursor);
    expect(h.archive.projections.events).toEqual([]); expect(h.archive.evidenceBlobs).toEqual([]);
    expect(h.archive.projections.status).toBe("recording");
    expect(await verifyDepositInboxArchive(clone(h.archive))).toEqual(h.archive);
  });

  it("quarantines a genuine source conflict without fabricating a sealed observation", async () => {
    const h = harness("tron");
    const result = await h.fixture.probe({ attemptId: "unsealed-conflict", storeInstanceId: h.storeInstanceId,
      preparationContext: request => h.context(request.candidate), variant: { failure: "source-conflict" } });
    expect(result.kind).toBe("held"); if (result.kind !== "held") throw new Error("Expected an actual source-conflict probe result");
    const outcome = await h.apply({ type: "record-attempt-hold", requestId: "unsealed-source-conflict", attempt: result.attempt, candidateCursor: null });
    expect(outcome.receipt.disposition).toBe("source-conflict-unsealed");
    expect(h.archive.projections.status).toBe("quarantined");
    expect(h.archive.evidenceBlobs).toEqual([]); expect(h.archive.projections.observations).toEqual([]);
    expect(h.archive.projections.quarantines[0]).toMatchObject({ reason: "source-conflict-unsealed", incomingEvidenceId: null });
  });

  it("rejects a serialized copied failure claim at the live command boundary", async () => {
    const h = harness();
    const result = await h.fixture.probe({ attemptId: "live-held-capability", storeInstanceId: h.storeInstanceId,
      preparationContext: request => h.context(request.candidate), variant: { failure: "missing-receipt" } });
    if (result.kind !== "held") throw new Error("Expected a real held probe");
    await refused(() => h.apply({ type: "record-attempt-hold", requestId: "copied-failure", attempt: clone(result.attempt), candidateCursor: null }));
    expect(h.archive.checkpoint.revision).toBe(0);
  });

  it.each([false, true])("restores a paused source into absorbing quarantine with populated=%s", async populated => {
    const h = harness();
    if (populated) await h.record("pre-restore-observation", await h.prepare("pre-restore-read"));
    await h.apply({ type: "pause", requestId: "pause-for-restore", reason: "recovery-fixture" }, h.operator);
    const original = clone(h.archive);
    const plan = await planDepositInboxRestore(h.archive, { requestId: "restore-fixture", targetStoreInstanceId: "different-target-store",
      atMs: h.fixture.now, backupChecksum: "aa".repeat(32) });
    expect(plan.nextState.status).toBe("quarantined");
    expect(plan.nextState.storeInstanceId).toBe("different-target-store");
    expect(plan.nextState.originStoreInstanceId).toBe(h.storeInstanceId);
    expect(plan.record.receipt.disposition).toBe("restored-quarantined");
    expect(plan.nextState.recoveryReceipts).toHaveLength(1);
    expect(plan.nextState.events).toEqual(original.projections.events);
    expect(plan.archive.evidenceBlobs).toEqual(original.evidenceBlobs);
    expect(h.archive).toEqual(original);
    expect(await verifyDepositInboxArchive(clone(plan.archive))).toEqual(plan.archive);
  });
});
