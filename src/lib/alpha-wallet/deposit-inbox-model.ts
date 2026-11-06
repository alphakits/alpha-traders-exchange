import "server-only";

import { z } from "zod";
import { captureDepositInboxManifest, resolveDepositInboxCandidate,
  type DepositInboxAdmission, type DepositInboxCandidate } from "./deposit-inbox-admission";
import { captureInboxData, captureInboxOptions, canonicalInboxJson, depositInboxError,
  digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";
import { checkPreparedDepositAdmissionFreshness, verifyPreparedDepositObservation,
  type DepositPreparationContextV1, type PreparedDepositObservationV1,
  type ValidatedPreparedDepositObservationV1 } from "./deposit-observation-preparation";
import { isCapturedDepositInboxUnsealedAttempt } from "./deposit-inbox-probe";
import { assertDepositInboxPortableCapacity, assertDepositInboxPortableControlGrowth } from "./deposit-inbox-portable";
import { DEPOSIT_INBOX_LIMITS as LIMITS, DEPOSIT_INBOX_PROFILE,
  type DepositInboxActor, type DepositInboxAppendPlan, type DepositInboxArchive, type DepositInboxBootstrap,
  type DepositInboxCandidateCursor, type DepositInboxCheckpoint, type DepositInboxCompactPreparation,
  type DepositInboxCursorPrecondition, type DepositInboxEffects, type DepositInboxEvidenceBlob,
  type DepositInboxJournalRecord, type DepositInboxOutcome, type DepositInboxQuarantineReason,
  type DepositInboxReceipt, type DepositInboxSourceHead, type DepositInboxState, type DepositInboxStoredCommand,
  type DepositInboxTransition, type DepositInboxUnsealedAttempt, type DepositInboxUserCommand } from "./deposit-inbox-protocol";

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => !Object.is(value, -0));
const revision = z.number().int().min(0).max(LIMITS.commands);
const checkpointSchema = z.object({ revision, eventHash: sha, stateHash: sha }).strict();
const actorSchema = z.object({ workerId: id, role: z.enum(["worker", "operator"]) }).strict();
const cursorSchema = z.object({ jobId: id, expectedCursorRevision: revision,
  expectedNextOrdinal: z.number().int().min(0).max(255), candidateManifestSha256: sha }).strict();
const contextSchema = z.object({ kind: z.literal("development-deposit-preparation-context"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), inboxId: id, storeInstanceId: id,
  manifestSha256: sha, assignmentId: id, sourceSetId: id, checkpoint: checkpointSchema,
  sourceHead: z.object({ revision, number: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
    hash: z.string().min(64).max(66), timestampMs: instant }).strict().nullable(),
  candidateCursor: z.object({ jobId: id, candidateManifestSha256: sha, revision,
    nextOrdinal: z.number().int().min(0).max(255), candidateCount: z.number().int().min(1).max(256) }).strict().nullable(),
  capturedAtMs: instant }).strict();
const attemptSchema = z.object({ kind: z.literal("development-deposit-unsealed-attempt"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), inboxId: id, storeInstanceId: id,
  manifestSha256: sha, workerId: id, attemptId: id, candidate: z.unknown(), preparationContext: contextSchema,
  startedAtMs: instant, completedAtMs: instant,
  failureCode: z.enum(["TIMEOUT", "TRANSPORT", "INVALID_RESPONSE", "INVALID_EVIDENCE", "SOURCE_CONFLICT", "STALE_CHECKPOINT", "RESOURCE_LIMIT"]),
  attemptSha256: sha }).strict();
const userSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("register-candidate-job"), requestId: id, jobId: id,
    orderedCandidates: z.array(z.unknown()).min(1).max(LIMITS.candidatesPerJob) }).strict(),
  z.object({ type: z.literal("record-observation"), requestId: id, prepared: z.unknown(), candidateCursor: cursorSchema.nullable() }).strict(),
  z.object({ type: z.literal("record-attempt-hold"), requestId: id, attempt: z.unknown(), candidateCursor: cursorSchema.nullable() }).strict(),
  z.object({ type: z.literal("pause"), requestId: id, reason: z.string().min(1).max(160).refine(value => !value.includes("\u0000")) }).strict(),
]);
const resourceSchema = z.object({ type: z.literal("resource-quarantine"), requestId: id, rejectedRequestKey: z.string().min(1).max(1024),
  rejectedFingerprint: sha, scope: z.string().min(1).max(160), originalFingerprint: sha.nullable() }).strict();
const restoreSchema = z.object({ type: z.literal("restore-quarantine"), requestId: id,
  sourceStoreInstanceId: id, targetStoreInstanceId: id, sourceCheckpoint: checkpointSchema, backupChecksum: sha }).strict();
const bootstrapSchema = z.object({ kind: z.literal("development-deposit-inbox-bootstrap"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), inboxId: id, storeInstanceId: id,
  manifestSha256: sha, requestId: id, atMs: instant, bootstrapSha256: sha }).strict();
const archiveSchema = z.object({ manifest: z.unknown(), bootstrap: bootstrapSchema,
  commands: z.array(z.unknown()).max(LIMITS.commands), evidenceBlobs: z.array(z.unknown()).max(LIMITS.observations),
  projections: z.unknown(), checkpoint: checkpointSchema }).strict();
const blobSchema = z.object({ evidenceId: sha, observationSha256: sha, rawBytes: instant,
  commandRevision: revision, observation: z.unknown() }).strict();
const recordSchema = z.object({ kind: z.literal("development-deposit-inbox-command"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), revision, atMs: instant,
  workerId: z.string().min(1).max(100), actorRole: z.enum(["worker", "operator", "restore"]),
  requestKey: z.string().min(1).max(2048), inputFingerprint: sha, command: z.unknown(), effects: z.unknown(),
  result: z.unknown(), resultSha256: sha, previousEventHash: sha, eventHash: sha, stateHash: sha, receipt: z.unknown() }).strict();

export interface AdmittedDepositInboxCommand {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly worker: DepositInboxActor;
  readonly storeInstanceId: string;
  readonly manifestSha256: string;
  readonly requestKey: string;
  readonly inputFingerprint: string;
  readonly command: DepositInboxUserCommand;
}
const archives = new WeakMap<object, DepositInboxAdmission>();
const commands = new WeakMap<object, { admission: DepositInboxAdmission; validated?: ValidatedPreparedDepositObservationV1 }>();
type MutableEffects = { -readonly [K in keyof DepositInboxEffects]: Array<DepositInboxEffects[K][number]> };
type MutableOutcome = { -readonly [K in keyof DepositInboxOutcome]: DepositInboxOutcome[K] };
const projectionKeys = ["observations", "blockAnchors", "transactionAnchors", "events", "eventObservations", "sourceHeads",
  "candidateJobs", "candidateCursors", "quarantines", "recoveryReceipts"] as const;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  inboxCheck(result.success, "INVALID_INPUT", "Deposit inbox data is outside its closed development profile");
  return result.data;
}
function same(a: unknown, b: unknown): boolean { return canonicalInboxJson(a) === canonicalInboxJson(b); }
function effects(): MutableEffects {
  return { evidenceBlobs: [], observations: [], blockAnchors: [], transactionAnchors: [], events: [], eventObservations: [],
    sourceHeads: [], candidateJobs: [], candidateCursors: [], quarantines: [], recoveryReceipts: [] };
}
function requireArchive(archive: DepositInboxArchive): DepositInboxAdmission {
  inboxRuntime("simulation-only");
  inboxCheck(archive !== null && typeof archive === "object" && archives.has(archive),
    "INVALID_INPUT", "Deposit inbox operations require a verified immutable archive");
  return archives.get(archive)!;
}
function brandArchive(value: DepositInboxArchive, admission: DepositInboxAdmission): DepositInboxArchive {
  const frozen = captureInboxData<DepositInboxArchive>(value);
  archives.set(frozen, admission);
  return frozen;
}
function requestKey(inboxId: string, workerId: string, requestId: string): string {
  return canonicalInboxJson(["deposit-inbox-request-v1", inboxId, workerId, requestId]);
}
function faultKey(originalRequestKey: string, originalFingerprint: string, incomingFingerprint: string): string {
  return canonicalInboxJson(["deposit-inbox-fault-v1", originalRequestKey, originalFingerprint, incomingFingerprint]);
}
function latest<T extends { commandRevision: number }>(rows: readonly T[], predicate: (row: T) => boolean, at: number = LIMITS.commands): T | null {
  for (let index = rows.length - 1; index >= 0; index--) if (rows[index].commandRevision <= at && predicate(rows[index])) return rows[index];
  return null;
}
function atCheckpoint(archive: DepositInboxArchive, at: number): DepositInboxCheckpoint | undefined {
  if (at === 0) return { revision: 0, eventHash: digestInboxValue("inbox-genesis", archive.bootstrap),
    stateHash: digestInboxValue("inbox-state", initialState(archives.get(archive)!, archive.bootstrap)) };
  return archive.commands[at - 1]?.receipt.checkpoint;
}
function initialState(admission: DepositInboxAdmission, bootstrap: DepositInboxBootstrap): DepositInboxState {
  const { evidenceBlobs: ignored, ...empty } = effects(); void ignored;
  return { ...empty, kind: "development-deposit-inbox-state", formatVersion: 1, mode: "simulation-only", creditAuthority: false,
    profile: DEPOSIT_INBOX_PROFILE, inboxId: admission.manifest.inboxId, manifestSha256: admission.manifestSha256,
    originStoreInstanceId: bootstrap.storeInstanceId, storeInstanceId: bootstrap.storeInstanceId,
    status: "recording", haltReason: null, lastCommandAtMs: bootstrap.atMs, rawEvidenceBytes: 0 };
}

export function createDepositInboxArchive(supplied: {
  mode: "simulation-only"; manifest: unknown; storeInstanceId: string; requestId: string; atMs: number;
}): DepositInboxArchive {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxData<typeof supplied>(supplied);
    parse(z.object({ mode: z.literal("simulation-only"), manifest: z.unknown(), storeInstanceId: id, requestId: id, atMs: instant }).strict(), options);
    inboxRuntime(options.mode);
    const admission = captureDepositInboxManifest(options.manifest);
    const body = { kind: "development-deposit-inbox-bootstrap" as const, formatVersion: 1 as const,
      mode: "simulation-only" as const, creditAuthority: false as const, inboxId: admission.manifest.inboxId,
      storeInstanceId: options.storeInstanceId, manifestSha256: admission.manifestSha256, requestId: options.requestId, atMs: options.atMs };
    const bootstrap: DepositInboxBootstrap = { ...body, bootstrapSha256: digestInboxValue("inbox-bootstrap", body) };
    const state = initialState(admission, bootstrap);
    const archive = brandArchive({ manifest: admission.manifest, bootstrap, commands: [], evidenceBlobs: [], projections: state,
      checkpoint: { revision: 0, eventHash: digestInboxValue("inbox-genesis", bootstrap), stateHash: digestInboxValue("inbox-state", state) } }, admission);
    assertDepositInboxPortableCapacity(archive, "ordinary");
    return archive;
  } catch (error) { throw depositInboxError(error); }
}

function validateAttempt(value: unknown, admission: DepositInboxAdmission, workerId: string): DepositInboxUnsealedAttempt {
  const attempt = parse(attemptSchema, value);
  const resolved = resolveDepositInboxCandidate(admission, workerId, attempt.candidate);
  const { attemptSha256: ignored, ...body } = attempt; void ignored;
  inboxCheck(attempt.inboxId === admission.manifest.inboxId && attempt.manifestSha256 === admission.manifestSha256
    && attempt.workerId === workerId && same(attempt.candidate, resolved.candidate)
    && attempt.startedAtMs <= attempt.completedAtMs && attempt.preparationContext.capturedAtMs <= attempt.completedAtMs
    && digestInboxValue("unsealed-attempt", body) === attempt.attemptSha256,
  "REPLAY_MISMATCH", "Unsealed deposit attempt does not bind its admitted context and sanitized failure");
  return captureInboxData<DepositInboxUnsealedAttempt>({ ...attempt, candidate: resolved.candidate });
}

async function captureCommand(supplied: {
  mode: "simulation-only"; manifest: unknown; worker: DepositInboxActor; storeInstanceId: string; command: unknown;
}, historical: boolean): Promise<AdmittedDepositInboxCommand> {
  inboxRuntime("simulation-only");
  const options = captureInboxOptions(supplied, ["mode", "manifest", "worker", "storeInstanceId", "command"]);
  inboxRuntime(options.mode);
  const admission = captureDepositInboxManifest(options.manifest), worker = parse(actorSchema, captureInboxData(options.worker));
  const storeInstanceId = parse(id, options.storeInstanceId);
  inboxCheck(admission.manifest.workers.some(row => row.workerId === worker.workerId), "ADMISSION_REFUSED", "Deposit worker is outside the immutable admission");
  // Check the capability before copying it. A checksum/reconstructed JSON must not manufacture a new live failure claim.
  if (!historical) {
    const raw = captureInboxOptions(options.command, ["type", "requestId", "jobId", "orderedCandidates", "prepared", "candidateCursor", "attempt", "reason"]);
    if (raw.type === "record-attempt-hold") inboxCheck(isCapturedDepositInboxUnsealedAttempt(raw.attempt),
      "ADMISSION_REFUSED", "A new failure hold requires the original trusted probe attempt");
  }
  const input = parse(userSchema, captureInboxData(options.command));
  let command: DepositInboxUserCommand;
  let validated: ValidatedPreparedDepositObservationV1 | undefined;
  if (input.type === "record-observation") {
    const prepared = captureInboxData<PreparedDepositObservationV1>(input.prepared);
    // Historical retries retain the original physical identity, including after a quarantined restore.
    validated = await verifyPreparedDepositObservation({ mode: "simulation-only", manifest: admission.manifest,
      workerId: worker.workerId, storeInstanceId: prepared.storeInstanceId, prepared });
    command = { ...input, prepared: validated.prepared };
  } else if (input.type === "record-attempt-hold") {
    command = { ...input, attempt: validateAttempt(input.attempt, admission, worker.workerId) };
  } else if (input.type === "register-candidate-job") {
    const orderedCandidates = input.orderedCandidates.map(candidate => resolveDepositInboxCandidate(admission, worker.workerId, candidate).candidate);
    const identities = new Map<string, DepositInboxCandidate>();
    for (const candidate of orderedCandidates) {
      const resolved = resolveDepositInboxCandidate(admission, worker.workerId, candidate);
      const nativeKey = canonicalInboxJson([resolved.chain.chainKey, candidate.transactionId, candidate.eventIndex]);
      const previous = identities.get(nativeKey);
      inboxCheck(!previous || same(previous, candidate), "ADMISSION_REFUSED", "A candidate job repeats native coordinates with different expectations");
      identities.set(nativeKey, candidate);
    }
    command = { ...input, orderedCandidates };
  } else {
    inboxCheck(worker.role === "operator", "ADMISSION_REFUSED", "Pausing a deposit inbox requires its explicit operator capability");
    command = input;
  }
  const captured = captureInboxData<AdmittedDepositInboxCommand>({ mode: "simulation-only", creditAuthority: false, worker,
    storeInstanceId, manifestSha256: admission.manifestSha256,
    requestKey: requestKey(admission.manifest.inboxId, worker.workerId, command.requestId),
    inputFingerprint: digestInboxValue("inbox-command-input", { profile: DEPOSIT_INBOX_PROFILE,
      manifestSha256: admission.manifestSha256, workerId: worker.workerId, command }), command });
  commands.set(captured, { admission, validated });
  inboxRuntime("simulation-only");
  return captured;
}

/** Native replay and the trusted failure capability are captured once, before any retried SQL callback. */
export async function captureDepositInboxCommand(options: {
  mode: "simulation-only"; manifest: unknown; worker: DepositInboxActor; storeInstanceId: string; command: unknown;
}): Promise<AdmittedDepositInboxCommand> {
  try { return await captureCommand(options, false); }
  catch (error) { throw depositInboxError(error); }
}

/** Reuse the original native validation after awaited SQL work; never re-observe to refresh an expiring command. */
export function recheckAdmittedDepositInboxCommandFreshness(captured: AdmittedDepositInboxCommand, now: number): void {
  inboxRuntime("simulation-only");
  const metadata = captured !== null && typeof captured === "object" ? commands.get(captured) : undefined;
  inboxCheck(metadata?.validated, "INVALID_INPUT", "Deposit freshness recheck requires the original validated observation command");
  checkPreparedDepositAdmissionFreshness(metadata.validated, now);
}

export function findDepositInboxReceipt(archive: DepositInboxArchive, supplied: {
  workerId: string; requestId: string; inputFingerprint: string;
}): DepositInboxReceipt | null {
  requireArchive(archive);
  const input = parse(z.object({ workerId: id, requestId: id, inputFingerprint: sha }).strict(), captureInboxData(supplied));
  const key = requestKey(archive.manifest.inboxId, input.workerId, input.requestId);
  const original = archive.commands.find(record => record.requestKey === key);
  if (!original) return null;
  if (original.inputFingerprint === input.inputFingerprint) return original.receipt;
  return archive.commands.find(record => record.requestKey === faultKey(key, original.inputFingerprint, input.inputFingerprint))?.receipt ?? null;
}

function sourceHeadAt(archive: DepositInboxArchive, sourceSetId: string, at = archive.checkpoint.revision) {
  return latest(archive.projections.sourceHeads, row => row.sourceSetId === sourceSetId, at);
}
function cursorAt(archive: DepositInboxArchive, jobId: string, at = archive.checkpoint.revision) {
  return latest(archive.projections.candidateCursors, row => row.jobId === jobId, at);
}
function contextFor(archive: DepositInboxArchive, workerId: string, candidate: DepositInboxCandidate,
  jobId: string | null, at: number, capturedAtMs: number): DepositPreparationContextV1 {
  const admission = requireArchive(archive);
  const resolved = resolveDepositInboxCandidate(admission, workerId, candidate);
  const checkpoint = atCheckpoint(archive, at);
  inboxCheck(checkpoint && at <= archive.checkpoint.revision, "ADMISSION_REFUSED", "Deposit preparation names an unknown history checkpoint");
  const lastAt = at === 0 ? archive.bootstrap.atMs : archive.commands[at - 1].atMs;
  inboxCheck(capturedAtMs >= lastAt, "ADMISSION_REFUSED", "Deposit context predates its retained checkpoint");
  const head = sourceHeadAt(archive, candidate.sourceSetId, at);
  let cursor: DepositInboxCandidateCursor | null = null;
  if (jobId !== null) {
    const job = archive.projections.candidateJobs.find(row => row.jobId === jobId && row.commandRevision <= at);
    cursor = cursorAt(archive, jobId, at);
    inboxCheck(job && cursor && job.workerId === workerId && cursor.nextOrdinal < cursor.candidateCount
      && same(job.candidates[cursor.nextOrdinal], candidate), "ADMISSION_REFUSED", "Deposit candidate is outside its exact finite job bookmark");
  }
  const recoveredAt = latest(archive.projections.recoveryReceipts, () => true, at);
  return captureInboxData<DepositPreparationContextV1>({ kind: "development-deposit-preparation-context", formatVersion: 1,
    mode: "simulation-only", creditAuthority: false, inboxId: admission.manifest.inboxId,
    storeInstanceId: recoveredAt?.targetStoreInstanceId ?? archive.bootstrap.storeInstanceId,
    manifestSha256: admission.manifestSha256, assignmentId: resolved.assignment.assignmentId, sourceSetId: resolved.sourceSet.sourceSetId,
    checkpoint, sourceHead: head ? { revision: head.commandRevision, number: head.number, hash: head.hash, timestampMs: head.timestampMs } : null,
    candidateCursor: cursor ? { jobId: cursor.jobId, candidateManifestSha256: cursor.candidateManifestSha256,
      revision: cursor.commandRevision, nextOrdinal: cursor.nextOrdinal, candidateCount: cursor.candidateCount } : null, capturedAtMs });
}

export function createDepositInboxPreparationContext(supplied: {
  archive: DepositInboxArchive; workerId: string; candidate: unknown; jobId?: string; capturedAtMs: number;
}): DepositPreparationContextV1 {
  try {
    const options = captureInboxOptions(supplied, ["archive", "workerId", "candidate", "jobId", "capturedAtMs"]);
    const archive = options.archive as DepositInboxArchive, admission = requireArchive(archive);
    const workerId = parse(id, options.workerId), capturedAtMs = parse(instant, options.capturedAtMs);
    const candidate = resolveDepositInboxCandidate(admission, workerId, options.candidate).candidate;
    const jobId = options.jobId === undefined ? null : parse(id, options.jobId);
    inboxCheck(archive.projections.status === "recording", "ADMISSION_REFUSED", "Stopped deposit inboxes cannot begin new preparation");
    return contextFor(archive, workerId, candidate, jobId, archive.checkpoint.revision, capturedAtMs);
  } catch (error) { throw depositInboxError(error); }
}

function bindContext(archive: DepositInboxArchive, captured: AdmittedDepositInboxCommand,
  context: DepositPreparationContextV1, candidate: DepositInboxCandidate, cursor: DepositInboxCursorPrecondition | null): void {
  const expected = contextFor(archive, captured.worker.workerId, candidate, context.candidateCursor?.jobId ?? null,
    context.checkpoint.revision, context.capturedAtMs);
  inboxCheck(same(context, expected) && context.storeInstanceId === archive.projections.storeInstanceId,
    "ADMISSION_REFUSED", "Deposit preparation does not match the retained historical store checkpoint");
  const bookmark = context.candidateCursor;
  inboxCheck(bookmark ? cursor !== null && same(cursor, { jobId: bookmark.jobId, expectedCursorRevision: bookmark.revision,
    expectedNextOrdinal: bookmark.nextOrdinal, candidateManifestSha256: bookmark.candidateManifestSha256 }) : cursor === null,
  "ADMISSION_REFUSED", "Deposit request must retain its exact preparation cursor precondition");
}

function compact(prepared: PreparedDepositObservationV1, evidenceId: string): DepositInboxCompactPreparation {
  const { observation: ignored, ...timed } = prepared.timedObservation; void ignored;
  return { ...prepared, timedObservation: { ...timed, evidenceId } };
}
function appendPlan(archive: DepositInboxArchive, args: {
  command: DepositInboxStoredCommand; workerId: string; actorRole: DepositInboxJournalRecord["actorRole"];
  requestKey: string; inputFingerprint: string; atMs: number; effects: MutableEffects; blobs: DepositInboxEvidenceBlob[];
  result: Omit<DepositInboxOutcome, "mode" | "creditAuthority" | "requestId" | "requestKey" | "inputFingerprint" | "workerId" | "recordedAtMs" | "revision">;
  status?: DepositInboxState["status"]; haltReason?: string | null; storeInstanceId?: string;
}): DepositInboxAppendPlan {
  const admission = requireArchive(archive), revision = archive.checkpoint.revision + 1;
  const next = { ...archive.projections, lastCommandAtMs: args.atMs,
    rawEvidenceBytes: archive.projections.rawEvidenceBytes + args.blobs.reduce((sum, blob) => sum + blob.rawBytes, 0),
    status: args.status ?? archive.projections.status,
    haltReason: args.haltReason === undefined ? archive.projections.haltReason : args.haltReason,
    storeInstanceId: args.storeInstanceId ?? archive.projections.storeInstanceId };
  for (const key of projectionKeys) Object.assign(next, { [key]: [...archive.projections[key], ...args.effects[key]] });
  const nextState = captureInboxData<DepositInboxState>(next);
  const result: DepositInboxOutcome = { mode: "simulation-only", creditAuthority: false,
    requestId: args.command.requestId, requestKey: args.requestKey, inputFingerprint: args.inputFingerprint,
    workerId: args.workerId, recordedAtMs: args.atMs, revision, ...args.result };
  const body = { kind: "development-deposit-inbox-command" as const, formatVersion: 1 as const,
    mode: "simulation-only" as const, creditAuthority: false as const, revision, atMs: args.atMs,
    workerId: args.workerId, actorRole: args.actorRole, requestKey: args.requestKey, inputFingerprint: args.inputFingerprint,
    command: args.command, effects: args.effects, result, resultSha256: digestInboxValue("inbox-result", result),
    previousEventHash: archive.checkpoint.eventHash, stateHash: digestInboxValue("inbox-state", nextState) };
  const eventHash = digestInboxValue("inbox-command", body);
  const nextCheckpoint = { revision, eventHash, stateHash: body.stateHash };
  const record: DepositInboxJournalRecord = { ...body, eventHash, receipt: { ...result, checkpoint: nextCheckpoint } };
  const updated = brandArchive({ manifest: archive.manifest, bootstrap: archive.bootstrap, commands: [...archive.commands, record],
    evidenceBlobs: [...archive.evidenceBlobs, ...args.blobs], projections: nextState, checkpoint: nextCheckpoint }, admission);
  return Object.freeze({ previousCheckpoint: archive.checkpoint, record: updated.commands[revision - 1],
    evidenceBlobs: Object.freeze(updated.evidenceBlobs.slice(archive.evidenceBlobs.length)), nextState: updated.projections,
    nextCheckpoint: updated.checkpoint, archive: updated });
}

function addQuarantine(delta: MutableEffects, args: { reason: DepositInboxQuarantineReason; scope: string;
  firstEvidenceId?: string | null; incomingEvidenceId?: string | null; incomingFingerprint: string;
  originalRequestKey?: string | null; originalFingerprint?: string | null; commandRevision: number }): string {
  const body = { reason: args.reason, scope: args.scope, firstEvidenceId: args.firstEvidenceId ?? null,
    incomingEvidenceId: args.incomingEvidenceId ?? null, incomingFingerprint: args.incomingFingerprint,
    originalRequestKey: args.originalRequestKey ?? null, originalFingerprint: args.originalFingerprint ?? null,
    commandRevision: args.commandRevision };
  const quarantineId = digestInboxValue("inbox-quarantine", body);
  delta.quarantines.push({ quarantineId, ...body });
  return quarantineId;
}

function capacity(archive: DepositInboxArchive): void {
  const state = archive.projections;
  inboxCheck(state.observations.length <= LIMITS.observations && archive.evidenceBlobs.length <= LIMITS.observations
    && state.blockAnchors.length <= LIMITS.blockAnchors && state.transactionAnchors.length <= LIMITS.transactionAnchors
    && state.events.length <= LIMITS.events && state.candidateJobs.length <= LIMITS.candidateJobs
    && state.rawEvidenceBytes <= LIMITS.rawBytes, "RESOURCE_LIMIT", "Deposit inbox has reached its retained-evidence capacity");
}

function resourcePlan(archive: DepositInboxArchive, args: { command: Extract<DepositInboxStoredCommand, {type: "resource-quarantine"}>;
  worker: DepositInboxActor; atMs: number; key: string; fingerprint: string }): DepositInboxAppendPlan {
  const command = args.command, delta = effects();
  inboxCheck(archive.projections.status === "recording", "ADMISSION_REFUSED", "Stopped inboxes cannot consume another terminal reserve");
  const quarantineId = addQuarantine(delta, { reason: "resource-limit", scope: command.scope, incomingFingerprint: command.rejectedFingerprint,
    originalRequestKey: command.originalFingerprint ? command.rejectedRequestKey : null, originalFingerprint: command.originalFingerprint,
    commandRevision: archive.checkpoint.revision + 1 });
  const plan = appendPlan(archive, { command, workerId: args.worker.workerId, actorRole: args.worker.role,
    requestKey: args.key, inputFingerprint: args.fingerprint, atMs: args.atMs, effects: delta, blobs: [],
    status: "quarantined", haltReason: "resource-limit", result: { disposition: "resource-quarantined", evidenceId: null,
      nativeEventLocator: null, quarantineId, cursorBefore: null, cursorAfter: null } });
  assertDepositInboxPortableCapacity(plan.archive, "terminal");
  assertDepositInboxPortableControlGrowth(archive, plan.archive);
  return plan;
}

function preparedBlob(validated: ValidatedPreparedDepositObservationV1, revision: number): DepositInboxEvidenceBlob {
  const observation = validated.prepared.timedObservation.observation;
  return { evidenceId: validated.identity.admittedEvidenceId, observationSha256: observation.observationSha256,
    rawBytes: observation.reads.reduce((sum, read) => sum + Buffer.byteLength(read.requestBody, "utf8") + Buffer.byteLength(read.responseBody, "utf8"), 0),
    commandRevision: revision, observation };
}
function retainObservation(archive: DepositInboxArchive, delta: MutableEffects, blobs: DepositInboxEvidenceBlob[],
  validated: ValidatedPreparedDepositObservationV1): void {
  const evidenceId = validated.identity.admittedEvidenceId;
  if (archive.evidenceBlobs.some(row => row.evidenceId === evidenceId)) return;
  const blob = preparedBlob(validated, archive.checkpoint.revision + 1);
  const { observation: ignored, ...reference } = blob; void ignored;
  blobs.push(blob); delta.evidenceBlobs.push(reference);
  delta.observations.push({ ...reference, sourceSetId: validated.prepared.candidate.sourceSetId,
    assignmentId: validated.prepared.candidate.assignmentId, nativeEventLocator: validated.identity.nativeEventLocator,
    eventFactsSha256: validated.identity.eventFactsSha256, transactionKey: validated.identity.transactionKey,
    transactionFactsSha256: validated.identity.transactionFactsSha256 });
}

function validateContinuity(head: DepositInboxSourceHead | null, validated: ValidatedPreparedDepositObservationV1): boolean {
  if (!head) return true;
  const { semantics } = validated;
  const blocks = new Map(semantics.blocks.map(block => [block.number, block]));
  const match = blocks.get(head.number);
  if (match && (match.hash !== head.hash || match.timestampMs !== head.timestampMs)) return false;
  const start = BigInt(head.number), end = BigInt(semantics.lastValidatedHead.number);
  if (end < start || end - start > BigInt(blocks.size)) return false;
  if (!match && BigInt(semantics.containingBlock.number) !== start + BigInt(1)) return false;
  // The genesis identity read is also in `blocks`; its presence alone never proves a bridge
  // to a distant candidate. Check every linked successor up to the full validated head.
  let previous = { hash: head.hash, timestampMs: head.timestampMs };
  for (let height = start + BigInt(1); height <= end; height += BigInt(1)) {
    const block = blocks.get(height.toString());
    if (!block || block.parentHash !== previous.hash || block.timestampMs <= previous.timestampMs) return false;
    previous = block;
  }
  return previous.hash === semantics.lastValidatedHead.hash && previous.timestampMs === semantics.lastValidatedHead.timestampMs;
}

async function transition(archive: DepositInboxArchive, captured: AdmittedDepositInboxCommand,
  options: { atMs: number; admissionNowMs?: number }, historical: boolean): Promise<DepositInboxTransition> {
  const admission = requireArchive(archive), capturedMeta = captured && typeof captured === "object" ? commands.get(captured) : undefined;
  inboxCheck(capturedMeta && captured.manifestSha256 === admission.manifestSha256,
    "ADMISSION_REFUSED", "Deposit command does not bind the verified inbox admission");
  const time = parse(z.object({ atMs: instant, admissionNowMs: instant.optional() }).strict(), captureInboxData(options));
  const original = archive.commands.find(record => record.requestKey === captured.requestKey);
  const key = original && original.inputFingerprint !== captured.inputFingerprint
    ? faultKey(captured.requestKey, original.inputFingerprint, captured.inputFingerprint) : captured.requestKey;
  const known = archive.commands.find(record => record.requestKey === key);
  if (known) {
    inboxCheck(known.inputFingerprint === captured.inputFingerprint, "REPLAY_MISMATCH", "Deposit receipt fingerprint conflicts with its immutable key");
    return { kind: "recovered", receipt: known.receipt };
  }
  inboxCheck(archive.projections.status === "recording" && captured.storeInstanceId === archive.projections.storeInstanceId,
    "ADMISSION_REFUSED", "New commands require the same physical recording inbox");
  inboxCheck(time.atMs >= archive.projections.lastCommandAtMs, "ADMISSION_REFUSED", "Deposit command time regressed behind retained history");
  const command = captured.command, revision = archive.checkpoint.revision + 1, delta = effects(), blobs: DepositInboxEvidenceBlob[] = [];
  const validated = capturedMeta.validated;
  let stored: DepositInboxStoredCommand = command.type === "record-observation"
    ? { ...command, prepared: compact(command.prepared, validated!.identity.admittedEvidenceId) } : command;
  let status: DepositInboxState["status"] = "recording", haltReason: string | null = null;
  const result: Omit<MutableOutcome, "mode" | "creditAuthority" | "requestId" | "requestKey" | "inputFingerprint" | "workerId" | "recordedAtMs" | "revision"> = { disposition: "attempt-held", evidenceId: null,
    nativeEventLocator: null, quarantineId: null, cursorBefore: null, cursorAfter: null };
  const setQuarantine = (reason: DepositInboxQuarantineReason, scope: string, firstEvidenceId?: string | null) => {
    status = "quarantined"; haltReason = reason;
    result.quarantineId = addQuarantine(delta, { reason, scope, firstEvidenceId,
      incomingEvidenceId: validated?.identity.admittedEvidenceId, incomingFingerprint: captured.inputFingerprint,
      originalRequestKey: original ? captured.requestKey : null, originalFingerprint: original?.inputFingerprint,
      commandRevision: revision });
  };
  if (command.type === "record-observation") {
    inboxCheck(validated, "INVALID_INPUT", "Observation command lost its native verification");
    bindContext(archive, captured, command.prepared.preparationContext, command.prepared.candidate, command.candidateCursor);
  } else if (command.type === "record-attempt-hold") {
    inboxCheck(command.attempt.storeInstanceId === archive.projections.storeInstanceId,
      "ADMISSION_REFUSED", "Unsealed attempt belongs to another physical inbox");
    bindContext(archive, captured, command.attempt.preparationContext, command.attempt.candidate, command.candidateCursor);
  }
  if (original) {
    if (validated) {
      retainObservation(archive, delta, blobs, validated);
      result.evidenceId = validated.identity.admittedEvidenceId; result.nativeEventLocator = validated.identity.nativeEventLocator;
    }
    result.disposition = "request-conflict-quarantined";
    setQuarantine("request-conflict", captured.requestKey, original.receipt.evidenceId);
  } else if (command.type === "register-candidate-job") {
    inboxCheck(!archive.projections.candidateJobs.some(row => row.jobId === command.jobId), "ADMISSION_REFUSED", "Deposit candidate job identifier is already immutable");
    const candidateManifestSha256 = digestInboxValue("candidate-job", { manifestSha256: admission.manifestSha256,
      workerId: captured.worker.workerId, jobId: command.jobId, candidates: command.orderedCandidates });
    delta.candidateJobs.push({ jobId: command.jobId, workerId: captured.worker.workerId, manifestSha256: admission.manifestSha256,
      candidateManifestSha256, candidates: command.orderedCandidates, commandRevision: revision });
    const cursor: DepositInboxCandidateCursor = { jobId: command.jobId, candidateManifestSha256, previousRevision: null,
      previousNextOrdinal: null, nextOrdinal: 0, candidateCount: command.orderedCandidates.length, commandRevision: revision };
    delta.candidateCursors.push(cursor); result.cursorAfter = cursor; result.disposition = "job-registered";
  } else if (command.type === "pause") {
    status = "paused"; haltReason = command.reason; result.disposition = "paused";
  } else if (command.type === "record-attempt-hold") {
    const bookmark = command.candidateCursor;
    result.cursorBefore = bookmark ? cursorAt(archive, bookmark.jobId) : null;
    result.cursorAfter = result.cursorBefore;
    result.disposition = "attempt-held";
    if (command.attempt.failureCode === "SOURCE_CONFLICT") {
      result.disposition = "source-conflict-unsealed";
      setQuarantine("source-conflict-unsealed", command.attempt.attemptId);
    }
  } else {
    const { identity, semantics, prepared } = validated!;
    const state = archive.projections;
    const existingEvent = state.events.find(row => row.nativeEventLocator === identity.nativeEventLocator);
    const existingTransaction = state.transactionAnchors.find(row => row.transactionKey === identity.transactionKey);
    const currentHead = sourceHeadAt(archive, prepared.candidate.sourceSetId);
    const baseHead = sourceHeadAt(archive, prepared.candidate.sourceSetId, prepared.preparationContext.checkpoint.revision);
    result.evidenceId = identity.admittedEvidenceId; result.nativeEventLocator = identity.nativeEventLocator;
    result.cursorBefore = command.candidateCursor ? cursorAt(archive, command.candidateCursor.jobId) : null;
    result.cursorAfter = result.cursorBefore;
    retainObservation(archive, delta, blobs, validated!);
    if (existingTransaction && existingTransaction.transactionFactsSha256 !== identity.transactionFactsSha256) {
      setQuarantine("validated-transaction-conflict", identity.transactionKey, existingTransaction.evidenceId);
    } else if (existingEvent && existingEvent.eventFactsSha256 !== identity.eventFactsSha256) {
      setQuarantine("validated-event-conflict", identity.nativeEventLocator, existingEvent.evidenceId);
    } else {
      for (const block of semantics.blocks) {
        const old = state.blockAnchors.find(row => row.chainKey === semantics.chainKey && row.number === block.number);
        if (old && old.blockSemanticsSha256 !== block.blockSemanticsSha256) {
          setQuarantine("validated-block-conflict", old.blockKey, old.evidenceId); break;
        }
      }
      if (!delta.quarantines.length && baseHead && BigInt(semantics.lastValidatedHead.number) < BigInt(baseHead.number))
        setQuarantine("validated-head-regression", prepared.candidate.sourceSetId, baseHead.evidenceId);
    }
    if (delta.quarantines.length) result.disposition = "conflict-quarantined";
    else if (currentHead && BigInt(semantics.lastValidatedHead.number) < BigInt(currentHead.number)) result.disposition = "stale-preparation-held";
    else if (!validateContinuity(baseHead, validated!) || !validateContinuity(currentHead, validated!)) result.disposition = "continuity-unproved-held";
    else {
      const bookmark = command.candidateCursor;
      if (bookmark) {
        const current = result.cursorBefore;
        inboxCheck(current && current.commandRevision === bookmark.expectedCursorRevision
          && current.nextOrdinal === bookmark.expectedNextOrdinal && current.candidateManifestSha256 === bookmark.candidateManifestSha256,
        "ADMISSION_REFUSED", "Deposit candidate cursor changed after preparation");
        const advanced: DepositInboxCandidateCursor = { ...current, previousRevision: current.commandRevision,
          previousNextOrdinal: current.nextOrdinal, nextOrdinal: current.nextOrdinal + 1, commandRevision: revision };
        delta.candidateCursors.push(advanced); result.cursorAfter = advanced;
      }
      result.disposition = archive.evidenceBlobs.some(row => row.evidenceId === identity.admittedEvidenceId)
        ? "duplicate-evidence" : existingEvent ? "corroborating-observation" : "recorded";
      const transfer = semantics.transfer;
      if (!existingEvent) delta.events.push({ nativeEventLocator: identity.nativeEventLocator, eventKey: transfer.eventKey,
        chainKey: semantics.chainKey, token: transfer.token, sender: transfer.sender, recipient: transfer.recipient,
        amountRaw: transfer.amountRaw, eventIndex: transfer.eventIndex, assignmentId: prepared.candidate.assignmentId,
        assignmentSha256: prepared.assignmentSha256, transactionKey: identity.transactionKey, eventFactsSha256: identity.eventFactsSha256,
        evidenceId: identity.admittedEvidenceId, commandRevision: revision });
      if (!existingTransaction) delta.transactionAnchors.push({ ...semantics.transactionAnchor, transactionKey: identity.transactionKey,
        transactionFactsSha256: identity.transactionFactsSha256, evidenceId: identity.admittedEvidenceId, commandRevision: revision });
      if (!state.eventObservations.some(row => row.nativeEventLocator === identity.nativeEventLocator && row.evidenceId === identity.admittedEvidenceId))
        delta.eventObservations.push({ nativeEventLocator: identity.nativeEventLocator, evidenceId: identity.admittedEvidenceId, commandRevision: revision });
      for (const block of semantics.blocks) {
        if (state.blockAnchors.some(row => row.chainKey === semantics.chainKey && row.number === block.number)) continue;
        delta.blockAnchors.push({ blockKey: canonicalInboxJson(["native-block-v1", semantics.chainKey, block.number]),
          chainKey: semantics.chainKey, number: block.number, hash: block.hash, parentHash: block.parentHash,
          timestampMs: block.timestampMs, blockSemanticsSha256: block.blockSemanticsSha256,
          evidenceId: identity.admittedEvidenceId, commandRevision: revision });
      }
      if (!currentHead || BigInt(semantics.lastValidatedHead.number) > BigInt(currentHead.number)) delta.sourceHeads.push({
        sourceSetId: prepared.candidate.sourceSetId, chainKey: semantics.chainKey, ...semantics.lastValidatedHead,
        previousRevision: currentHead?.commandRevision ?? null, evidenceId: identity.admittedEvidenceId, commandRevision: revision });
    }
  }
  // Conflicts and diagnostic holds preserve historically valid evidence even if a delayed arrival is no longer fresh.
  // Accepted progression alone requires a new-admission clock sample on every physical transaction attempt.
  if (!historical && validated && ["recorded", "duplicate-evidence", "corroborating-observation"].includes(result.disposition))
    checkPreparedDepositAdmissionFreshness(validated, time.admissionNowMs ?? time.atMs);
  const build = () => appendPlan(archive, { command: stored, workerId: captured.worker.workerId, actorRole: captured.worker.role,
    requestKey: key, inputFingerprint: captured.inputFingerprint, atMs: time.atMs, effects: delta, blobs, result, status, haltReason });
  let plan: DepositInboxAppendPlan;
  try {
    plan = build(); capacity(plan.archive);
    const terminal = delta.quarantines.length > 0 || status !== "recording";
    assertDepositInboxPortableCapacity(plan.archive, terminal ? "terminal" : "ordinary");
    if (terminal) {
      // Complete contradictory evidence may use remaining ordinary space. Only the reserved final slot
      // is restricted to a small control; a large retained transcript must fit without spending that reserve.
      try { assertDepositInboxPortableControlGrowth(archive, plan.archive); }
      catch (error) {
        if (depositInboxError(error).code !== "RESOURCE_LIMIT") throw error;
        assertDepositInboxPortableCapacity(plan.archive, "ordinary");
      }
    }
  } catch (error) {
    if (depositInboxError(error).code !== "RESOURCE_LIMIT") throw error;
    stored = { type: "resource-quarantine", requestId: command.requestId, rejectedRequestKey: captured.requestKey,
      rejectedFingerprint: captured.inputFingerprint, scope: command.type, originalFingerprint: original?.inputFingerprint ?? null };
    plan = resourcePlan(archive, { command: stored, worker: captured.worker, atMs: time.atMs, key, fingerprint: captured.inputFingerprint });
  }
  return { kind: "append", plan, receipt: plan.record.receipt };
}

export async function transitionDepositInbox(archive: DepositInboxArchive, captured: AdmittedDepositInboxCommand,
  options: { atMs: number; admissionNowMs?: number }): Promise<DepositInboxTransition> {
  try { return await transition(archive, captured, options, false); }
  catch (error) { throw depositInboxError(error); }
}

export async function planDepositInboxRestore(archive: DepositInboxArchive, supplied: {
  requestId: string; targetStoreInstanceId: string; atMs: number; backupChecksum: string;
}): Promise<DepositInboxAppendPlan> {
  try {
    requireArchive(archive);
    const input = parse(z.object({ requestId: id, targetStoreInstanceId: id, atMs: instant, backupChecksum: sha }).strict(), captureInboxData(supplied));
    inboxCheck(archive.projections.status !== "recording" && input.atMs >= archive.projections.lastCommandAtMs
      && input.targetStoreInstanceId !== archive.bootstrap.storeInstanceId
      && !archive.projections.recoveryReceipts.some(row => row.targetStoreInstanceId === input.targetStoreInstanceId),
    "ADMISSION_REFUSED", "Deposit restore requires a stopped source and a new physical target identity");
    assertDepositInboxPortableCapacity(archive, "terminal");
    const delta = effects(), revision = archive.checkpoint.revision + 1;
    const command: Extract<DepositInboxStoredCommand, {type: "restore-quarantine"}> = { type: "restore-quarantine", requestId: input.requestId,
      sourceStoreInstanceId: archive.projections.storeInstanceId, targetStoreInstanceId: input.targetStoreInstanceId,
      sourceCheckpoint: archive.checkpoint, backupChecksum: input.backupChecksum };
    const fingerprint = digestInboxValue("inbox-restore-input", command);
    const key = canonicalInboxJson(["deposit-inbox-restore-v1", archive.manifest.inboxId, input.targetStoreInstanceId, input.requestId]);
    const quarantineId = addQuarantine(delta, { reason: "restored-target", scope: input.targetStoreInstanceId,
      incomingFingerprint: fingerprint, commandRevision: revision });
    const recoveryBody = { requestId: input.requestId, sourceStoreInstanceId: command.sourceStoreInstanceId,
      targetStoreInstanceId: command.targetStoreInstanceId, sourceCheckpoint: archive.checkpoint, backupChecksum: input.backupChecksum,
      targetRevision: revision, commandRevision: revision };
    delta.recoveryReceipts.push({ recoveryId: digestInboxValue("inbox-recovery", recoveryBody), ...recoveryBody });
    const plan = appendPlan(archive, { command, workerId: "@restore", actorRole: "restore", requestKey: key,
      inputFingerprint: fingerprint, atMs: input.atMs, effects: delta, blobs: [], status: "quarantined", haltReason: "restored-target",
      storeInstanceId: input.targetStoreInstanceId, result: { disposition: "restored-quarantined", evidenceId: null,
        nativeEventLocator: null, quarantineId, cursorBefore: null, cursorAfter: null } });
    capacity(plan.archive); assertDepositInboxPortableCapacity(plan.archive, "restore");
    assertDepositInboxPortableControlGrowth(archive, plan.archive);
    return plan;
  } catch (error) { throw depositInboxError(error); }
}

/** Complete semantic replay at original recorded times; this function performs no network or current-clock reads. */
export async function verifyDepositInboxArchive(value: unknown): Promise<DepositInboxArchive> {
  try {
    inboxRuntime("simulation-only");
    const captured = captureInboxData(value), input = parse(archiveSchema, captured);
    let archive = createDepositInboxArchive({ mode: "simulation-only", manifest: input.manifest,
      storeInstanceId: input.bootstrap.storeInstanceId, requestId: input.bootstrap.requestId, atMs: input.bootstrap.atMs });
    inboxCheck(same(archive.bootstrap, input.bootstrap) && same(archive.manifest, input.manifest),
      "REPLAY_MISMATCH", "Deposit bootstrap or immutable manifest was changed");
    const blobs = new Map<string, ReturnType<typeof blobSchema.parse>>();
    for (const value of input.evidenceBlobs) {
      const blob = parse(blobSchema, value);
      inboxCheck(!blobs.has(blob.evidenceId), "REPLAY_MISMATCH", "Deposit backup repeats an evidence blob");
      blobs.set(blob.evidenceId, blob);
    }
    for (const value of input.commands) {
      const record = parse(recordSchema, value), raw = captureInboxOptions(record.command,
        ["type", "requestId", "jobId", "orderedCandidates", "prepared", "candidateCursor", "attempt", "reason",
          "rejectedRequestKey", "rejectedFingerprint", "scope", "originalFingerprint", "sourceStoreInstanceId",
          "targetStoreInstanceId", "sourceCheckpoint", "backupChecksum"]);
      inboxCheck(record.revision === archive.checkpoint.revision + 1 && record.atMs >= archive.projections.lastCommandAtMs,
        "REPLAY_MISMATCH", "Deposit history was reordered or its original time regressed");
      let plan: DepositInboxAppendPlan;
      if (raw.type === "restore-quarantine") {
        const command = parse(restoreSchema, raw);
        plan = await planDepositInboxRestore(archive, { requestId: command.requestId, targetStoreInstanceId: command.targetStoreInstanceId,
          atMs: record.atMs, backupChecksum: command.backupChecksum });
      } else if (raw.type === "resource-quarantine") {
        const command = parse(resourceSchema, raw), worker = parse(actorSchema, { workerId: record.workerId, role: record.actorRole });
        inboxCheck(archive.manifest.workers.some(row => row.workerId === worker.workerId), "ADMISSION_REFUSED", "Resource quarantine worker is not admitted");
        const originalKey = requestKey(archive.manifest.inboxId, worker.workerId, command.requestId);
        const original = archive.commands.find(row => row.requestKey === originalKey);
        const key = original ? faultKey(originalKey, original.inputFingerprint, command.rejectedFingerprint) : originalKey;
        inboxCheck(command.rejectedRequestKey === originalKey && command.originalFingerprint === (original?.inputFingerprint ?? null)
          && (!original || original.inputFingerprint !== command.rejectedFingerprint)
          && ["register-candidate-job", "record-observation", "record-attempt-hold", "pause"].includes(command.scope),
        "REPLAY_MISMATCH", "Resource quarantine does not bind its rejected request and retained original");
        plan = resourcePlan(archive, { command, worker, atMs: record.atMs, key, fingerprint: command.rejectedFingerprint });
      } else {
        inboxCheck(record.actorRole !== "restore", "REPLAY_MISMATCH", "Ordinary deposit history cannot claim restore authority");
        let command: unknown = raw;
        if (raw.type === "record-observation") {
          const prepared = captureInboxOptions(raw.prepared, ["kind", "formatVersion", "mode", "creditAuthority", "assurance", "storeContextAssurance",
            "inboxId", "storeInstanceId", "workerId", "attemptId", "manifestSha256", "chainSha256", "assetSha256", "sourceSetSha256",
            "assignmentSha256", "workerSha256", "candidate", "preparationContext", "timedObservation", "preparedAtMs", "preparationSha256"]);
          const timed = captureInboxOptions(prepared.timedObservation,
            ["kind", "formatVersion", "mode", "creditAuthority", "context", "policy", "timing", "timedObservationSha256", "evidenceId"]);
          const evidenceId = parse(sha, timed.evidenceId), blob = blobs.get(evidenceId);
          inboxCheck(blob, "REPLAY_MISMATCH", "Deposit history omits its original native evidence");
          const { evidenceId: ignored, ...body } = timed; void ignored;
          command = { ...raw, prepared: { ...prepared, timedObservation: { ...body, observation: blob.observation } } };
        }
        const admitted = await captureCommand({ mode: "simulation-only", manifest: archive.manifest,
          worker: { workerId: record.workerId, role: record.actorRole }, storeInstanceId: archive.projections.storeInstanceId, command }, true);
        const outcome = await transition(archive, admitted, { atMs: record.atMs }, true);
        inboxCheck(outcome.kind === "append", "REPLAY_MISMATCH", "Deposit history contains an extra exact retry instead of one immutable receipt");
        plan = outcome.plan;
      }
      inboxCheck(same(plan.record, record), "REPLAY_MISMATCH", "Deposit command, effects, receipt or journal hash changed under replay");
      archive = plan.archive;
    }
    inboxCheck(same(archive, captured), "REPLAY_MISMATCH", "Deposit archive has omitted, extra, changed or reordered projections or evidence");
    capacity(archive);
    assertDepositInboxPortableCapacity(archive, archive.projections.recoveryReceipts.length ? "restore"
      : archive.projections.status === "recording" ? "ordinary" : "terminal");
    inboxRuntime("simulation-only");
    return archive;
  } catch (error) { throw depositInboxError(error, "REPLAY_MISMATCH"); }
}
