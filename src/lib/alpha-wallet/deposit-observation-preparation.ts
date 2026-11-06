import "server-only";

import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { z } from "zod";
import { checkCheckpointFreshness } from "./chain-observer-common";
import type { DevelopmentNodeSource, DevelopmentNodeTransportOptions } from "./chain-observer-rpc";
import { captureDepositInboxManifest, normalizeDepositInboxEndpoint, resolveDepositInboxCandidate,
  type DepositInboxAdmission, type DepositInboxCandidate, type ResolvedDepositInboxCandidate } from "./deposit-inbox-admission";
import { DepositInboxError, captureInboxData, captureInboxOptions, canonicalInboxJson, depositInboxError,
  digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";
import { captureTimedDevelopmentObservation, replayTimedDevelopmentObservation,
  type ReplayedDevelopmentObservationSemantics, type TimedDevelopmentObservationV1 } from "./observation-transcript";

const MAX_PREPARATION_MS = 30_000, MAX_ATTEMPTS = 256;
const MAX_UINT64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => !Object.is(value, -0));
const decimal = z.string().min(1).max(20).regex(/^(?:0|[1-9][0-9]*)$/)
  .refine(value => BigInt(value) <= MAX_UINT64);
const snapshotSchema = z.object({
  kind: z.literal("development-deposit-preparation-context"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false),
  inboxId: id, storeInstanceId: id, manifestSha256: sha256, assignmentId: id, sourceSetId: id,
  checkpoint: z.object({ revision: z.number().int().min(0).max(1000), eventHash: sha256, stateHash: sha256 }).strict(),
  sourceHead: z.object({ revision: z.number().int().min(1).max(1000), number: decimal,
    hash: z.string().min(64).max(66), timestampMs: instant }).strict().nullable(),
  candidateCursor: z.object({ jobId: id, candidateManifestSha256: sha256,
    revision: z.number().int().min(1).max(1000), nextOrdinal: z.number().int().min(0).max(255),
    candidateCount: z.number().int().min(1).max(256) }).strict().nullable(),
  capturedAtMs: instant,
}).strict();

export type DepositPreparationContextV1 = z.infer<typeof snapshotSchema>;
export interface DepositPreparationContextRequest {
  readonly inboxId: string;
  readonly storeInstanceId: string;
  readonly manifestSha256: string;
  readonly workerId: string;
  readonly candidate: DepositInboxCandidate;
  readonly jobId: string | null;
}
export interface AdmittedDevelopmentObservationReaderOptions {
  mode: "simulation-only";
  manifest: unknown;
  workerId: string;
  storeInstanceId: string;
  endpointConfig: readonly { sourceId: string; endpoint: string }[];
  fetch: DevelopmentNodeTransportOptions["fetch"];
  clock?: () => number;
  preparationContext: (request: DepositPreparationContextRequest) => unknown;
}
export interface PreparedDepositObservationV1 {
  readonly kind: "development-prepared-deposit-observation";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly assurance: "configured-node-consistency-only";
  readonly storeContextAssurance: "trusted-synthetic-context-only";
  readonly inboxId: string;
  readonly storeInstanceId: string;
  readonly workerId: string;
  readonly attemptId: string;
  readonly manifestSha256: string;
  readonly chainSha256: string;
  readonly assetSha256: string;
  readonly sourceSetSha256: string;
  readonly assignmentSha256: string;
  readonly workerSha256: string;
  readonly candidate: DepositInboxCandidate;
  readonly preparationContext: DepositPreparationContextV1;
  readonly timedObservation: TimedDevelopmentObservationV1;
  readonly preparedAtMs: number;
  readonly preparationSha256: string;
}
export interface PreparedDepositObservationIdentity {
  /** Native coordinates exclude asset, recipient, amount, assignment and block inclusion. */
  readonly nativeEventLocator: string;
  readonly transactionKey: string;
  readonly admittedEvidenceId: string;
  readonly eventFactsSha256: string;
  readonly transactionFactsSha256: string;
}
export interface ValidatedPreparedDepositObservationV1 {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly prepared: PreparedDepositObservationV1;
  readonly semantics: ReplayedDevelopmentObservationSemantics;
  readonly identity: PreparedDepositObservationIdentity;
}
export interface AdmittedDevelopmentObservationReader {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly manifestSha256: string;
  readonly workerId: string;
  readonly storeInstanceId: string;
  prepare(request: { attemptId: string; candidate: unknown; jobId?: string }): Promise<PreparedDepositObservationV1>;
}

const preparedSchema = z.object({ kind: z.literal("development-prepared-deposit-observation"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false),
  assurance: z.literal("configured-node-consistency-only"), storeContextAssurance: z.literal("trusted-synthetic-context-only"),
  inboxId: id, storeInstanceId: id, workerId: id, attemptId: id,
  manifestSha256: sha256, chainSha256: sha256, assetSha256: sha256, sourceSetSha256: sha256,
  assignmentSha256: sha256, workerSha256: sha256, candidate: z.unknown(), preparationContext: snapshotSchema,
  timedObservation: z.unknown(), preparedAtMs: instant, preparationSha256: sha256 }).strict();
const validations = new WeakSet<object>();

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  inboxCheck(result.success, "INVALID_INPUT", "Prepared deposit data is outside its closed development profile");
  return result.data;
}
function identifier(value: unknown): string {
  inboxCheck(typeof value === "string", "INVALID_INPUT", "Deposit preparation identifiers must be strings");
  return parsed(id, value);
}
function same(left: unknown, right: unknown): boolean { return canonicalInboxJson(left) === canonicalInboxJson(right); }
function assertWorker(admission: DepositInboxAdmission, workerId: string): void {
  inboxCheck(admission.manifest.workers.some(worker => worker.workerId === workerId),
    "ADMISSION_REFUSED", "Deposit preparation requires a worker admitted by the immutable manifest");
}
function captureSnapshot(value: unknown): DepositPreparationContextV1 {
  return captureInboxData(parsed(snapshotSchema, captureInboxData(value,
    { maxBytes: 8192, maxNodes: 64, maxDepth: 4, maxStringBytes: 256 })));
}
function bindSnapshot(snapshot: DepositPreparationContextV1, admission: DepositInboxAdmission,
  resolved: ResolvedDepositInboxCandidate, storeInstanceId: string, jobId: string | null, now: number): void {
  inboxCheck(snapshot.inboxId === admission.manifest.inboxId && snapshot.storeInstanceId === storeInstanceId
    && snapshot.manifestSha256 === admission.manifestSha256 && snapshot.assignmentId === resolved.candidate.assignmentId
    && snapshot.sourceSetId === resolved.candidate.sourceSetId,
  "ADMISSION_REFUSED", "Deposit preparation context belongs to another immutable admission or physical store");
  inboxCheck(snapshot.capturedAtMs <= now && now - snapshot.capturedAtMs < MAX_PREPARATION_MS,
    "STALE_CHECKPOINT", "Deposit preparation context is not a current synthetic snapshot");
  const cursor = snapshot.candidateCursor;
  inboxCheck(jobId === null ? cursor === null : cursor !== null && cursor.jobId === jobId,
    "ADMISSION_REFUSED", "Deposit candidate context does not bind the requested finite job");
  if (cursor) inboxCheck(cursor.revision <= snapshot.checkpoint.revision && cursor.nextOrdinal < cursor.candidateCount,
    "INVALID_INPUT", "Deposit candidate cursor is outside its captured history");
  const head = snapshot.sourceHead;
  if (!head) return;
  inboxCheck(head.revision <= snapshot.checkpoint.revision && head.timestampMs - snapshot.capturedAtMs <= resolved.policy.maxFutureSkewMs,
    "INVALID_INPUT", "Deposit source head is outside its captured history");
  const height = BigInt(head.number);
  if (resolved.chain.family === "bsc") {
    inboxCheck(/^0x[0-9a-f]{64}$/.test(head.hash), "INVALID_INPUT", "Deposit source head has an invalid BSC hash");
  } else {
    inboxCheck(height <= BigInt(Number.MAX_SAFE_INTEGER) && /^[0-9a-f]{64}$/.test(head.hash)
      && head.hash.slice(0, 16) === height.toString(16).padStart(16, "0"),
    "INVALID_INPUT", "Deposit source head has an invalid TRON native height or block ID");
  }
  if (height === BigInt(0)) inboxCheck(head.hash === resolved.chain.genesisHash,
    "ADMISSION_REFUSED", "Deposit source history does not bind the admitted native genesis");
}
function preparedBody(prepared: PreparedDepositObservationV1) {
  const { preparationSha256: omitted, ...body } = prepared;
  void omitted;
  return body;
}
function identityFor(prepared: PreparedDepositObservationV1,
  semantics: ReplayedDevelopmentObservationSemantics): PreparedDepositObservationIdentity {
  const transfer = semantics.transfer;
  const indexKind = semantics.family === "bsc" ? "bsc-block-log-index" : "tron-receipt-log-offset";
  return captureInboxData({
    nativeEventLocator: canonicalInboxJson(["native-event-v1", semantics.chainKey, transfer.transactionId, indexKind, transfer.eventIndex]),
    transactionKey: canonicalInboxJson(["native-transaction-v1", semantics.chainKey, transfer.transactionId]),
    admittedEvidenceId: digestInboxValue("admitted-evidence", ["admitted-observation-v1", prepared.manifestSha256, prepared.sourceSetSha256,
      prepared.assignmentSha256, "native-node-observer-v1", prepared.timedObservation.observation.observationSha256]),
    eventFactsSha256: digestInboxValue("event-facts", { chainKey: semantics.chainKey, token: transfer.token,
      sender: transfer.sender, recipient: transfer.recipient, amountRaw: transfer.amountRaw, transactionId: transfer.transactionId,
      indexKind, eventIndex: transfer.eventIndex, assignmentSha256: prepared.assignmentSha256,
      transactionAnchor: semantics.transactionAnchor }),
    transactionFactsSha256: digestInboxValue("transaction-facts", semantics.transactionAnchor),
  });
}

/** Historical consistency verification. It does not authenticate a provider, clock or persisted database checkpoint. */
export async function verifyPreparedDepositObservation(supplied: {
  mode: "simulation-only"; manifest: unknown; workerId: string; storeInstanceId: string; prepared: unknown;
}): Promise<ValidatedPreparedDepositObservationV1> {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxOptions(supplied, ["mode", "manifest", "workerId", "storeInstanceId", "prepared"]);
    inboxRuntime(options.mode);
    const admission = captureDepositInboxManifest(options.manifest), workerId = identifier(options.workerId), storeInstanceId = identifier(options.storeInstanceId);
    assertWorker(admission, workerId);
    const envelope = parsed(preparedSchema, captureInboxData(options.prepared));
    const resolved = resolveDepositInboxCandidate(admission, workerId, envelope.candidate);
    inboxCheck(envelope.inboxId === admission.manifest.inboxId && envelope.workerId === workerId && envelope.storeInstanceId === storeInstanceId
      && envelope.manifestSha256 === admission.manifestSha256 && envelope.chainSha256 === resolved.chainSha256
      && envelope.assetSha256 === resolved.assetSha256 && envelope.sourceSetSha256 === resolved.sourceSetSha256
      && envelope.assignmentSha256 === resolved.assignmentSha256 && envelope.workerSha256 === resolved.workerSha256
      && same(envelope.candidate, resolved.candidate),
    "ADMISSION_REFUSED", "Prepared deposit evidence does not bind its admitted worker, candidate or immutable records");
    const replay = await replayTimedDevelopmentObservation(envelope.timedObservation);
    inboxRuntime("simulation-only");
    const timed = replay.timedObservation;
    inboxCheck(same(timed.context, resolved.context) && same(timed.policy, resolved.policy)
      && timed.observation.executionSourceId === resolved.sourceSet.executionSourceId
      && timed.observation.finalitySourceId === resolved.sourceSet.finalitySourceId,
    "ADMISSION_REFUSED", "Prepared native reads do not bind the admitted transfer context and source roles");
    const snapshot = captureSnapshot(envelope.preparationContext);
    bindSnapshot(snapshot, admission, resolved, storeInstanceId, snapshot.candidateCursor?.jobId ?? null, envelope.preparedAtMs);
    inboxCheck(snapshot.capturedAtMs <= timed.timing.startedAtMs && timed.timing.returnedAtMs <= envelope.preparedAtMs
      && envelope.preparedAtMs - timed.timing.startedAtMs < MAX_PREPARATION_MS,
    "REPLAY_MISMATCH", "Prepared deposit timing does not enclose the original observation");
    const prepared = captureInboxData<PreparedDepositObservationV1>({ ...envelope, candidate: resolved.candidate,
      preparationContext: snapshot, timedObservation: timed });
    inboxCheck(digestInboxValue("prepared-observation", preparedBody(prepared)) === prepared.preparationSha256,
      "REPLAY_MISMATCH", "Prepared deposit checksum does not bind the complete captured evidence");
    const validated = captureInboxData<ValidatedPreparedDepositObservationV1>({ mode: "simulation-only", creditAuthority: false,
      prepared, semantics: replay.semantics, identity: identityFor(prepared, replay.semantics) });
    inboxRuntime("simulation-only");
    validations.add(validated);
    return validated;
  } catch (error) { throw depositInboxError(error, "INVALID_EVIDENCE"); }
}

/** Apply only to genuinely new admissions; historical replay and exact receipt recovery use the verifier above. */
export function checkPreparedDepositAdmissionFreshness(validated: ValidatedPreparedDepositObservationV1, now: unknown): void {
  try {
    inboxRuntime("simulation-only");
    inboxCheck(validated !== null && typeof validated === "object" && validations.has(validated),
      "INVALID_INPUT", "Deposit admission freshness requires a verified immutable preparation");
    inboxCheck(typeof now === "number" && Number.isSafeInteger(now) && now >= 0 && !Object.is(now, -0),
      "INVALID_INPUT", "Deposit admission requires an exact current millisecond instant");
    const { prepared, semantics } = validated, timed = prepared.timedObservation, policy = timed.policy;
    inboxCheck(now - timed.observation.completedAtMs < MAX_PREPARATION_MS
      && prepared.preparedAtMs - now <= policy.maxFutureSkewMs,
    "STALE_CHECKPOINT", "Deposit evidence is outside its new-admission interval");
    checkCheckpointFreshness(semantics.pinnedCheckpoint.timestampMs, now, policy);
    checkCheckpointFreshness(semantics.lastValidatedHead.timestampMs, now, policy);
    inboxRuntime("simulation-only");
  } catch (error) { throw depositInboxError(error, "INVALID_EVIDENCE"); }
}

/**
 * A read-only, synthetic preparation capability. The context callback is trusted configuration;
 * this module supplies neither a persistent inbox nor credit, custody, signing or broadcast authority.
 */
export function createAdmittedDevelopmentObservationReader(supplied: AdmittedDevelopmentObservationReaderOptions): AdmittedDevelopmentObservationReader {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxOptions(supplied,
      ["mode", "manifest", "workerId", "storeInstanceId", "endpointConfig", "fetch", "clock", "preparationContext"]);
    inboxRuntime(options.mode);
    inboxCheck(typeof options.fetch === "function" && !types.isProxy(options.fetch)
      && typeof options.preparationContext === "function" && !types.isProxy(options.preparationContext)
      && (options.clock === undefined || typeof options.clock === "function" && !types.isProxy(options.clock)),
    "INVALID_INPUT", "Deposit preparation requires explicit trusted context, read IO and optional clock functions");
    const admission = captureDepositInboxManifest(options.manifest), workerId = identifier(options.workerId), storeInstanceId = identifier(options.storeInstanceId);
    assertWorker(admission, workerId);
    const configured = parsed(z.array(z.object({ sourceId: id, endpoint: z.string().min(1).max(2048) }).strict()).min(2).max(8),
      captureInboxData(options.endpointConfig, { maxBytes: 20_000, maxNodes: 40, maxDepth: 3, maxStringBytes: 2048 }));
    const byId = new Map(configured.map(source => [source.sourceId, source]));
    inboxCheck(byId.size === configured.length && byId.size === admission.manifest.sources.length,
      "ADMISSION_REFUSED", "Deposit endpoints must cover the exact admitted source set once");
    const sources: DevelopmentNodeSource[] = admission.manifest.sources.map(source => {
      const config = byId.get(source.sourceId);
      inboxCheck(config, "ADMISSION_REFUSED", "Deposit endpoint configuration omits an admitted source");
      const endpoint = normalizeDepositInboxEndpoint(config.endpoint);
      inboxCheck(endpoint.host === source.host && endpoint.endpointSha256 === source.endpointSha256,
        "ADMISSION_REFUSED", "Deposit endpoint configuration does not match its immutable source commitment");
      return Object.freeze({ id: source.sourceId, independenceGroup: source.independenceGroup, endpoint: endpoint.endpoint });
    });
    const fetch = options.fetch as DevelopmentNodeTransportOptions["fetch"];
    const clock = options.clock as (() => number) | undefined;
    const preparationContext = options.preparationContext as AdmittedDevelopmentObservationReaderOptions["preparationContext"];
    const attempts = new Set<string>();
    let busy = false, poisoned = false, activeAbort: AbortController | undefined;

    const prepare: AdmittedDevelopmentObservationReader["prepare"] = async request => {
      if (busy) {
        poisoned = true;
        activeAbort?.abort();
        throw new DepositInboxError("SESSION_CLOSED", "Concurrent or reentrant preparation closed this reader");
      }
      busy = true;
      const abort = new AbortController();
      activeAbort = abort;
      let active = true, clockBusy = false, lastWall = -1, firstWall: number | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined, boundaryFailure: DepositInboxError | undefined;
      const origin = performance.now();
      let lastMono = origin;
      const guard = () => {
        try {
          inboxRuntime("simulation-only");
          inboxCheck(active && !poisoned && !abort.signal.aborted, "SESSION_CLOSED", "Deposit preparation is closed");
          const mono = performance.now();
          inboxCheck(Number.isFinite(mono) && mono >= lastMono, "RUNTIME_REFUSED", "Deposit preparation monotonic time regressed");
          lastMono = mono;
          inboxCheck(mono - origin < MAX_PREPARATION_MS, "TIMEOUT", "Deposit preparation exceeded its complete time budget");
        } catch (error) {
          boundaryFailure ??= depositInboxError(error);
          throw boundaryFailure;
        }
      };
      const now = () => {
        try {
          guard();
          inboxCheck(!clockBusy, "RUNTIME_REFUSED", "Deposit preparation clock is reentrant");
          clockBusy = true;
          const value = clock ? clock() : Date.now();
          guard();
          inboxCheck(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value >= lastWall,
            "RUNTIME_REFUSED", "Deposit preparation clock must advance through exact nonnegative instants");
          firstWall ??= value;
          inboxCheck(value - firstWall < MAX_PREPARATION_MS, "TIMEOUT", "Deposit preparation exceeded its complete wall-clock budget");
          lastWall = value;
          return value;
        } catch (error) {
          boundaryFailure ??= depositInboxError(error, "RUNTIME_REFUSED");
          throw boundaryFailure;
        } finally { clockBusy = false; }
      };
      try {
        guard();
        const input = parsed(z.object({ attemptId: id, candidate: z.unknown(), jobId: id.optional() }).strict(),
          captureInboxData(request, { maxBytes: 8192, maxNodes: 32, maxDepth: 3, maxStringBytes: 256 }));
        inboxCheck(!attempts.has(input.attemptId), "ADMISSION_REFUSED", "A preparation attempt must retain its original evidence instead of observing again");
        inboxCheck(attempts.size < MAX_ATTEMPTS, "RESOURCE_LIMIT", "This reader reached its bounded preparation attempt capacity");
        attempts.add(input.attemptId);
        const resolved = resolveDepositInboxCandidate(admission, workerId, input.candidate);
        const startedAtMs = now();
        const contextRequest = captureInboxData<DepositPreparationContextRequest>({ inboxId: admission.manifest.inboxId,
          storeInstanceId, manifestSha256: admission.manifestSha256, workerId, candidate: resolved.candidate, jobId: input.jobId ?? null });
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            boundaryFailure ??= new DepositInboxError("TIMEOUT", "Deposit preparation exceeded its complete time budget");
            active = false;
            abort.abort();
            reject(boundaryFailure);
          }, Math.max(0, MAX_PREPARATION_MS - (performance.now() - origin)));
        });
        const work = async (): Promise<PreparedDepositObservationV1> => {
          guard();
          const returned = preparationContext(contextRequest);
          guard();
          let snapshotData = returned;
          // Plain thenables are data and never awaited. Genuine promises may not replace then/constructor or subclass Promise.
          if (types.isPromise(returned)) {
            inboxCheck(!types.isProxy(returned) && Object.getPrototypeOf(returned) === Promise.prototype && Reflect.ownKeys(returned).length === 0,
              "INVALID_INPUT", "Deposit context promises must be native and unmodified");
            snapshotData = await returned;
            guard();
          }
          const snapshot = captureSnapshot(snapshotData);
          bindSnapshot(snapshot, admission, resolved, storeInstanceId, input.jobId ?? null, now());
          const guardedFetch: DevelopmentNodeTransportOptions["fetch"] = async (url, init) => {
            guard();
            const signal = init.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal;
            try {
              const response = await fetch(url, { ...init, signal });
              try { guard(); }
              catch (error) {
                // A response arriving after local refusal never reaches the native transport's own cleanup.
                try { void response.body?.cancel().catch(() => undefined); } catch { /* Preserve the bounded original refusal. */ }
                throw error;
              }
              return response;
            } catch (error) {
              guard();
              throw error;
            }
          };
          const timedObservation = await captureTimedDevelopmentObservation({ mode: "simulation-only", sources,
            fetch: guardedFetch, clock: now, context: resolved.context, executionSourceId: resolved.sourceSet.executionSourceId,
            finalitySourceId: resolved.sourceSet.finalitySourceId, policy: resolved.policy });
          guard();
          const preparedAtMs = now();
          inboxCheck(preparedAtMs - startedAtMs < MAX_PREPARATION_MS, "TIMEOUT", "Deposit preparation exceeded its wall-clock budget");
          const body = { kind: "development-prepared-deposit-observation" as const, formatVersion: 1 as const,
            mode: "simulation-only" as const, creditAuthority: false as const,
            assurance: "configured-node-consistency-only" as const, storeContextAssurance: "trusted-synthetic-context-only" as const,
            inboxId: admission.manifest.inboxId, storeInstanceId, workerId, attemptId: input.attemptId,
            manifestSha256: admission.manifestSha256, chainSha256: resolved.chainSha256, assetSha256: resolved.assetSha256,
            sourceSetSha256: resolved.sourceSetSha256, assignmentSha256: resolved.assignmentSha256, workerSha256: resolved.workerSha256,
            candidate: resolved.candidate, preparationContext: snapshot, timedObservation, preparedAtMs };
          const prepared = captureInboxData<PreparedDepositObservationV1>({ ...body,
            preparationSha256: digestInboxValue("prepared-observation", body) });
          const validated = await verifyPreparedDepositObservation({ mode: "simulation-only", manifest: admission.manifest,
            workerId, storeInstanceId, prepared });
          guard();
          const completedAtMs = now();
          inboxCheck(completedAtMs - startedAtMs < MAX_PREPARATION_MS, "TIMEOUT", "Deposit preparation exceeded its complete wall-clock budget");
          checkPreparedDepositAdmissionFreshness(validated, completedAtMs);
          guard();
          return validated.prepared;
        };
        return await Promise.race([work(), timeout]);
      } catch (error) { throw depositInboxError(boundaryFailure ?? error); }
      finally {
        active = false;
        if (timer !== undefined) clearTimeout(timer);
        abort.abort();
        if (activeAbort === abort) activeAbort = undefined;
        busy = false;
      }
    };
    inboxRuntime("simulation-only");
    return Object.freeze({ mode: "simulation-only", creditAuthority: false, manifestSha256: admission.manifestSha256,
      workerId, storeInstanceId, prepare });
  } catch (error) { throw depositInboxError(error); }
}
