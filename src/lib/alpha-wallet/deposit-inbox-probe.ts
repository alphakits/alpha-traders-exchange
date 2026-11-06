import "server-only";

import { types } from "node:util";
import { captureDepositInboxManifest } from "./deposit-inbox-admission";
import { captureInboxData, captureInboxOptions, depositInboxError, digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";
import { createAdmittedDevelopmentObservationReader, type AdmittedDevelopmentObservationReaderOptions,
  type DepositPreparationContextRequest, type DepositPreparationContextV1, type PreparedDepositObservationV1 } from "./deposit-observation-preparation";
import type { DepositInboxFailureCode, DepositInboxUnsealedAttempt } from "./deposit-inbox-protocol";

const attempts = new WeakSet<object>();
const failures = new Set<DepositInboxFailureCode>(["TIMEOUT", "TRANSPORT", "INVALID_RESPONSE", "INVALID_EVIDENCE",
  "SOURCE_CONFLICT", "STALE_CHECKPOINT", "RESOURCE_LIMIT"]);

export type DepositInboxProbeResult =
  | { readonly kind: "prepared"; readonly mode: "simulation-only"; readonly creditAuthority: false;
      readonly prepared: PreparedDepositObservationV1 }
  | { readonly kind: "held"; readonly mode: "simulation-only"; readonly creditAuthority: false;
      readonly attempt: DepositInboxUnsealedAttempt };

/** An in-process capability, deliberately not a checksum or a caller-supplied error classification. */
export function isCapturedDepositInboxUnsealedAttempt(value: unknown): value is DepositInboxUnsealedAttempt {
  return value !== null && typeof value === "object" && attempts.has(value);
}

/**
 * Captures a sanitized failure only after the admitted reader has validated its snapshot and begun native IO.
 * A failure is an unresolved attempt, never a failed transfer, a complete transcript or authority to credit.
 */
export function createDevelopmentDepositInboxProbe(supplied: AdmittedDevelopmentObservationReaderOptions) {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxOptions(supplied,
      ["mode", "manifest", "workerId", "storeInstanceId", "endpointConfig", "fetch", "clock", "preparationContext"]);
    inboxRuntime(options.mode);
    inboxCheck(typeof options.fetch === "function" && !types.isProxy(options.fetch)
      && typeof options.preparationContext === "function" && !types.isProxy(options.preparationContext)
      && (options.clock === undefined || typeof options.clock === "function" && !types.isProxy(options.clock)),
    "INVALID_INPUT", "Deposit probe requires trusted reader capabilities");
    const admission = captureDepositInboxManifest(options.manifest);
    const fetch = options.fetch as AdmittedDevelopmentObservationReaderOptions["fetch"];
    const context = options.preparationContext as AdmittedDevelopmentObservationReaderOptions["preparationContext"];
    const clock = options.clock as (() => number) | undefined;
    type Active = { ioStarted: boolean; request?: DepositPreparationContextRequest; snapshot?: DepositPreparationContextV1;
      firstClock?: number; lastClock?: number; clocksValid: boolean };
    let active: Active | undefined;
    const captureContext = (value: unknown, owner: Active) => {
      const captured = captureInboxData<DepositPreparationContextV1>(value,
        { maxBytes: 8192, maxNodes: 64, maxDepth: 4, maxStringBytes: 256 });
      owner.snapshot = captured;
      return captured;
    };
    const reader = createAdmittedDevelopmentObservationReader({
      mode: options.mode as "simulation-only", manifest: admission.manifest,
      workerId: options.workerId as string, storeInstanceId: options.storeInstanceId as string,
      endpointConfig: options.endpointConfig as AdmittedDevelopmentObservationReaderOptions["endpointConfig"],
      preparationContext(request) {
        inboxCheck(active, "SESSION_CLOSED", "Deposit probe is outside its active reader");
        const owner = active;
        owner.request = request;
        const returned = context(request);
        if (types.isPromise(returned)) {
          inboxCheck(!types.isProxy(returned) && Object.getPrototypeOf(returned) === Promise.prototype
            && Reflect.ownKeys(returned).length === 0,
          "INVALID_INPUT", "Deposit probe context promises must be native and unmodified");
          return returned.then(value => captureContext(value, owner));
        }
        return captureContext(returned, owner);
      },
      clock() {
        const value = clock ? clock() : Date.now();
        if (active) {
          if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)
            || active.lastClock !== undefined && value < active.lastClock) active.clocksValid = false;
          active.firstClock ??= value;
          active.lastClock = value;
        }
        return value;
      },
      fetch(url, init) {
        inboxCheck(active, "SESSION_CLOSED", "Deposit probe is outside its active reader");
        active.ioStarted = true;
        return fetch(url, init);
      },
    });
    const prepare = async (request: { attemptId: string; candidate: unknown; jobId?: string }): Promise<DepositInboxProbeResult> => {
      inboxRuntime("simulation-only");
      // Let the underlying single-flight reader poison/abort reentrant attempts before touching the active capture.
      if (active) {
        await reader.prepare(request);
        throw depositInboxError(undefined, "SESSION_CLOSED");
      }
      const input = captureInboxData<typeof request>(request);
      const owner: Active = { ioStarted: false, clocksValid: true };
      active = owner;
      try {
        const prepared = await reader.prepare(input);
        return Object.freeze({ kind: "prepared", mode: "simulation-only", creditAuthority: false, prepared });
      } catch (error) {
        const failure = depositInboxError(error);
        if (!owner.ioStarted || !owner.request || !owner.snapshot || !owner.clocksValid
          || owner.firstClock === undefined || owner.lastClock === undefined
          || !failures.has(failure.code as DepositInboxFailureCode)) throw failure;
        inboxRuntime("simulation-only");
        const body = { kind: "development-deposit-unsealed-attempt" as const, formatVersion: 1 as const,
          mode: "simulation-only" as const, creditAuthority: false as const, inboxId: owner.request.inboxId,
          storeInstanceId: owner.request.storeInstanceId, manifestSha256: admission.manifestSha256,
          workerId: owner.request.workerId, attemptId: input.attemptId, candidate: owner.request.candidate,
          preparationContext: owner.snapshot, startedAtMs: owner.firstClock, completedAtMs: owner.lastClock,
          failureCode: failure.code as DepositInboxFailureCode };
        const attempt = captureInboxData<DepositInboxUnsealedAttempt>({ ...body, attemptSha256: digestInboxValue("unsealed-attempt", body) });
        attempts.add(attempt);
        return Object.freeze({ kind: "held", mode: "simulation-only", creditAuthority: false, attempt });
      } finally { if (active === owner) active = undefined; }
    };
    return Object.freeze({ mode: "simulation-only" as const, creditAuthority: false as const,
      manifestSha256: reader.manifestSha256, workerId: reader.workerId, storeInstanceId: reader.storeInstanceId, prepare });
  } catch (error) { throw depositInboxError(error); }
}
