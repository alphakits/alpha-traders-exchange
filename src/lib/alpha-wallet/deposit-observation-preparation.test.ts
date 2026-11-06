// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDepositObservationAdmissionFixture, type DepositObservationFixtureFamily } from "../../../scripts/alpha-wallet/deposit-observation-fixtures";
import { captureDepositInboxManifest } from "./deposit-inbox-admission";
import { checkPreparedDepositAdmissionFreshness, createAdmittedDevelopmentObservationReader,
  verifyPreparedDepositObservation } from "./deposit-observation-preparation";

type Row = Record<string, unknown>;
const row = (value: unknown) => value as Row;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function scenario(family: DepositObservationFixtureFamily = "bsc") {
  const f = createDepositObservationAdmissionFixture(family);
  const admission = captureDepositInboxManifest(f.manifest);
  const storeInstanceId = "synthetic-store";
  const snapshot = {
    kind: "development-deposit-preparation-context" as const, formatVersion: 1 as const,
    mode: "simulation-only" as const, creditAuthority: false as const,
    inboxId: f.inboxId, storeInstanceId, manifestSha256: admission.manifestSha256,
    assignmentId: f.assignmentId, sourceSetId: f.sourceSetId,
    checkpoint: { revision: 0, eventHash: "00".repeat(32), stateHash: "11".repeat(32) },
    sourceHead: null, candidateCursor: null, capturedAtMs: f.fixture.now,
  };
  const preparationContext = vi.fn((request: unknown) => { void request; return snapshot; });
  const options = { mode: "simulation-only" as const, manifest: f.manifest, workerId: f.workerId, storeInstanceId,
    endpointConfig: f.endpointConfig, fetch: f.fixture.fetch, clock: f.fixture.clock, preparationContext };
  const create = (overrides: Row = {}) => createAdmittedDevelopmentObservationReader({ ...options, ...overrides } as never);
  return { ...f, admission, storeInstanceId, snapshot, preparationContext, options, create };
}

async function refused(run: () => unknown | Promise<unknown>, code?: string) {
  let caught: unknown;
  try { await run(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ creditAuthority: false, ...(code ? { code } : {}) });
  return caught as Error;
}

const verify = (f: ReturnType<typeof scenario>, prepared: unknown, overrides: Row = {}) => verifyPreparedDepositObservation({
  mode: "simulation-only", manifest: f.manifest, workerId: f.workerId, storeInstanceId: f.storeInstanceId, prepared, ...overrides,
} as never);

function unreadResponse(url: string, cancel: () => void): Response {
  const response = new Response(new ReadableStream<Uint8Array>({ cancel }),
    { headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  vi.stubGlobal("fetch", () => { throw new Error("Ambient network IO is forbidden"); });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("admitted development deposit preparation before native IO", () => {
  it.each(["bsc", "tron"] as const)("requires a closed %s manifest before consulting the trusted callback", async family => {
    const f = scenario(family);
    row(f.manifest).creditAuthority = true;
    await refused(() => f.create(), "INVALID_INPUT");
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each([
    ["uncommitted path", (f: ReturnType<typeof scenario>) => { f.endpointConfig[0].endpoint += "/other"; }],
    ["uncommitted port", (f: ReturnType<typeof scenario>) => { f.endpointConfig[0].endpoint = f.endpointConfig[0].endpoint.replace(".invalid", ".invalid:8443"); }],
    ["changed source ID", (f: ReturnType<typeof scenario>) => { f.endpointConfig[0].sourceId = "unknown-node"; }],
    ["missing source", (f: ReturnType<typeof scenario>) => { f.endpointConfig.pop(); }],
    ["duplicated source", (f: ReturnType<typeof scenario>) => { f.endpointConfig.push(clone(f.endpointConfig[0])); }],
  ] as const)("rejects %s before any trusted callback or node fetch", async (_label, change) => {
    const f = scenario(); change(f);
    await refused(() => f.create());
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("rejects a caller-selected worker outside the admission manifest", async () => {
    const f = scenario();
    await refused(() => f.create({ workerId: "unadmitted-worker" }), "ADMISSION_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["beneficiaryRef", "recipient", "token", "purpose", "context", "policy", "sourceHead"])(
    "does not let the candidate substitute %s", async field => {
      const f = scenario(), reader = f.create();
      const candidate = { ...f.candidate, [field]: "caller-selected" };
      await refused(() => reader.prepare({ attemptId: "candidate-override", candidate }), "INVALID_INPUT");
      expect(f.preparationContext).not.toHaveBeenCalled();
      expect(f.fixture.calls).toHaveLength(0);
    });

  it.each(["assignmentId", "sourceSetId"] as const)("rejects an unauthorized candidate %s before the callback", async key => {
    const f = scenario(), reader = f.create();
    await refused(() => reader.prepare({ attemptId: "unadmitted-candidate", candidate: { ...f.candidate, [key]: "unknown" } }), "ADMISSION_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["0", "01", "1e6", "-1", ((BigInt(1) << BigInt(256))).toString()])(
    "rejects noncanonical or out-of-range raw units %s", async amountRaw => {
      const f = scenario(), reader = f.create();
      await refused(() => reader.prepare({ attemptId: "invalid-units", candidate: { ...f.candidate, amountRaw } }), "INVALID_INPUT");
      expect(f.preparationContext).not.toHaveBeenCalled();
      expect(f.fixture.calls).toHaveLength(0);
    });

  it("does not evaluate an executable candidate field", async () => {
    const f = scenario(), reader = f.create(), getter = vi.fn(() => f.candidate.transactionId);
    const candidate = { ...f.candidate };
    Object.defineProperty(candidate, "transactionId", { enumerable: true, get: getter });
    await refused(() => reader.prepare({ attemptId: "candidate-getter", candidate }), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("does not evaluate an executable factory capability field", async () => {
    const f = scenario(), getter = vi.fn(() => f.fixture.fetch), options = { ...f.options };
    Object.defineProperty(options, "fetch", { enumerable: true, get: getter });
    await refused(() => createAdmittedDevelopmentObservationReader(options), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["clock", "fetch", "preparationContext"])("refuses a Proxy %s capability without invoking its traps", async key => {
    const f = scenario(), trap = vi.fn(() => { throw new Error("A Proxy trap must not execute"); });
    const capability = new Proxy(() => undefined, { get: trap, apply: trap, getPrototypeOf: trap, ownKeys: trap });
    await refused(() => f.create({ [key]: capability }), "INVALID_INPUT");
    expect(trap).not.toHaveBeenCalled();
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each([
    ["NODE_ENV", "production"], ["VERCEL", "1"], ["ALPHA_WALLET_MAINNET_ENABLED", "true"], ["ALPHA_WALLET_SIGNING_ENABLED", "1"],
  ])("refuses %s=%s at construction", async (name, value) => {
    const f = scenario(); vi.stubEnv(name, value);
    await refused(() => f.create(), "RUNTIME_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("checks the runtime again before a captured reader prepares anything", async () => {
    const f = scenario(), reader = f.create(); vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1");
    await refused(() => reader.prepare({ attemptId: "runtime-changed", candidate: f.candidate }), "RUNTIME_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });
});

describe("trusted deposit preparation context", () => {
  it.each(["inboxId", "storeInstanceId", "manifestSha256", "assignmentId", "sourceSetId"])(
    "rejects a callback snapshot for another %s before node reads", async key => {
      const f = scenario(); row(f.snapshot)[key] = key === "manifestSha256" ? "ee".repeat(32) : "other-context";
      const reader = f.create();
      await refused(() => reader.prepare({ attemptId: "wrong-context", candidate: f.candidate }));
      expect(f.preparationContext).toHaveBeenCalledOnce();
      expect(f.fixture.calls).toHaveLength(0);
    });

  it.each([-30_001, 1])("rejects a context timestamp displaced by %s ms", async delta => {
    const f = scenario(); f.snapshot.capturedAtMs += delta;
    const reader = f.create();
    await refused(() => reader.prepare({ attemptId: "stale-context", candidate: f.candidate }));
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["bsc", "tron"] as const)("binds a finite job cursor and captured %s source history", async family => {
    const f = scenario(family), block = f.fixture.blockAt(f.fixture.containingHeight), jobId = "fixture-job";
    f.snapshot.checkpoint.revision = 2;
    row(f.snapshot).sourceHead = { revision: 1, number: String(f.fixture.containingHeight),
      hash: family === "bsc" ? block.hash : block.blockID,
      timestampMs: family === "bsc" ? Number(BigInt(block.timestamp as string)) * 1000 : row(row(block.block_header).raw_data).timestamp };
    row(f.snapshot).candidateCursor = { jobId, candidateManifestSha256: "22".repeat(32), revision: 2, nextOrdinal: 1, candidateCount: 2 };
    const prepared = await f.create().prepare({ attemptId: "captured-job-history", candidate: f.candidate, jobId });
    expect(row(f.preparationContext.mock.calls[0][0]).jobId).toBe(jobId);
    expect(prepared.preparationContext).toEqual(f.snapshot);
    expect((await verify(f, prepared)).creditAuthority).toBe(false);
  });

  it.each(["missing", "unrequested", "different", "exhausted", "future-revision"] as const)(
    "rejects a %s candidate cursor before native IO", async variant => {
      const f = scenario(); f.snapshot.checkpoint.revision = 2;
      const cursor = { jobId: "fixture-job", candidateManifestSha256: "22".repeat(32), revision: 2, nextOrdinal: 0, candidateCount: 2 };
      if (variant !== "missing") row(f.snapshot).candidateCursor = cursor;
      if (variant === "different") cursor.jobId = "different-job";
      if (variant === "exhausted") cursor.nextOrdinal = cursor.candidateCount;
      if (variant === "future-revision") cursor.revision = 3;
      const reader = f.create();
      await refused(() => reader.prepare({ attemptId: "invalid-job-cursor", candidate: f.candidate,
        ...(variant === "unrequested" ? {} : { jobId: "fixture-job" }) }));
      expect(f.fixture.calls).toHaveLength(0);
    });

  it.each(["wrong-family-hash", "wrong-height-prefix", "future-revision", "future-time"] as const)(
    "rejects a captured TRON head with %s", async variant => {
      const f = scenario("tron"), block = f.fixture.blockAt(f.fixture.containingHeight);
      f.snapshot.checkpoint.revision = 1;
      const head = { revision: 1, number: String(f.fixture.containingHeight), hash: block.blockID as string,
        timestampMs: row(row(block.block_header).raw_data).timestamp as number };
      if (variant === "wrong-family-hash") head.hash = `0x${head.hash}`;
      if (variant === "wrong-height-prefix") head.number = String(f.fixture.containingHeight + 1);
      if (variant === "future-revision") head.revision = 2;
      if (variant === "future-time") head.timestampMs = f.fixture.now + 5_001;
      row(f.snapshot).sourceHead = head;
      await refused(() => f.create().prepare({ attemptId: "invalid-captured-head", candidate: f.candidate }), "INVALID_INPUT");
      expect(f.fixture.calls).toHaveLength(0);
    });

  it("sanitizes a failing trusted callback without invoking a node", async () => {
    const f = scenario();
    const reader = f.create({ preparationContext: () => { throw new Error("private-store-error-do-not-copy"); } });
    const error = await refused(() => reader.prepare({ attemptId: "callback-failure", candidate: f.candidate }));
    expect(error.message).not.toContain("private-store-error-do-not-copy");
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("captures callback data without executing snapshot getters", async () => {
    const f = scenario(), getter = vi.fn(() => f.snapshot.checkpoint);
    Object.defineProperty(f.snapshot, "checkpoint", { enumerable: true, get: getter });
    const reader = f.create();
    await refused(() => reader.prepare({ attemptId: "snapshot-getter", candidate: f.candidate }), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("does not await an executable thenable disguised as trusted snapshot data", async () => {
    const f = scenario(), getter = vi.fn(() => () => f.snapshot), thenable = {};
    Object.defineProperty(thenable, "then", { enumerable: true, get: getter });
    const reader = f.create({ preparationContext: () => thenable });
    await refused(() => reader.prepare({ attemptId: "snapshot-thenable", candidate: f.candidate }), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("does not invoke a plain thenable callback result", async () => {
    const f = scenario(), then = vi.fn((resolve: (value: typeof f.snapshot) => void) => resolve(f.snapshot));
    const reader = f.create({ preparationContext: () => ({ then }) });
    await refused(() => reader.prepare({ attemptId: "plain-thenable", candidate: f.candidate }), "INVALID_INPUT");
    expect(then).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["subclass", "own-then", "own-constructor"] as const)(
    "refuses a %s context promise without executing its altered properties", async variant => {
      const f = scenario(), getter = vi.fn(() => { throw new Error("A promise override must not execute"); });
      let promise: Promise<typeof f.snapshot>;
      if (variant === "subclass") {
        class ContextPromise extends Promise<typeof f.snapshot> {}
        Object.defineProperty(ContextPromise.prototype, "then", { get: getter });
        promise = new ContextPromise(resolve => resolve(f.snapshot));
      } else {
        promise = Promise.resolve(f.snapshot);
        Object.defineProperty(promise, variant === "own-then" ? "then" : "constructor", { get: getter });
      }
      const reader = f.create({ preparationContext: () => promise });
      await refused(() => reader.prepare({ attemptId: "modified-context-promise", candidate: f.candidate }), "INVALID_INPUT");
      expect(getter).not.toHaveBeenCalled();
      expect(f.fixture.calls).toHaveLength(0);
    });

  it("includes the trusted callback interval in the complete preparation deadline", async () => {
    const f = scenario();
    const reader = f.create({ preparationContext: async () => {
      await Promise.resolve(); f.fixture.setNow(f.fixture.now + 30_000); f.snapshot.capturedAtMs = f.fixture.now;
      return f.snapshot;
    } });
    await refused(() => reader.prepare({ attemptId: "callback-deadline", candidate: f.candidate }), "TIMEOUT");
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("expires a never-settling callback and rejects its late snapshot before node IO", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = scenario();
    let release!: (value: typeof f.snapshot) => void;
    const promise = new Promise<typeof f.snapshot>(resolve => { release = resolve; });
    const reader = f.create({ preparationContext: () => promise });
    const result = refused(() => reader.prepare({ attemptId: "unresolved-callback", candidate: f.candidate }), "TIMEOUT");
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    release(f.snapshot);
    await Promise.resolve(); await Promise.resolve();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("does not restart the full preparation budget when native observation begins", async () => {
    const f = scenario();
    const reader = f.create({ preparationContext: () => {
      f.fixture.setNow(f.fixture.now + 29_000); f.snapshot.capturedAtMs = f.fixture.now;
      return f.snapshot;
    } });
    f.fixture.mutateResponse = value => { f.fixture.setNow(f.fixture.now + 1_500); return value; };
    await refused(() => reader.prepare({ attemptId: "combined-deadline", candidate: f.candidate }), "TIMEOUT");
    expect(f.fixture.calls).toHaveLength(1);
  });

  it.each([NaN, Infinity, -1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects an inexact injected preparation clock %s", async value => {
    const f = scenario(), reader = f.create({ clock: () => value });
    await refused(() => reader.prepare({ attemptId: "invalid-clock", candidate: f.candidate }), "RUNTIME_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("refuses a runtime change while awaiting the trusted callback", async () => {
    const f = scenario();
    const reader = f.create({ preparationContext: async () => {
      await Promise.resolve(); vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "1"); return f.snapshot;
    } });
    await refused(() => reader.prepare({ attemptId: "late-runtime", candidate: f.candidate }), "RUNTIME_REFUSED");
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("refuses a runtime change during the injected native fetch", async () => {
    const f = scenario();
    f.fixture.mutateResponse = value => { vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1"); return value; };
    const reader = f.create();
    await refused(() => reader.prepare({ attemptId: "read-runtime", candidate: f.candidate }), "RUNTIME_REFUSED");
    expect(f.fixture.calls).toHaveLength(1);
  });
});

describe("complete admitted preparation and archival verification", () => {
  it.each(["bsc", "tron"] as const)("binds %s native evidence to immutable admission and trusted context", async family => {
    const f = scenario(family), reader = f.create();
    const prepared = await reader.prepare({ attemptId: `${family}-accepted`, candidate: f.candidate });
    expect(prepared).toMatchObject({ kind: "development-prepared-deposit-observation", formatVersion: 1,
      mode: "simulation-only", creditAuthority: false, assurance: "configured-node-consistency-only",
      storeContextAssurance: "trusted-synthetic-context-only", inboxId: f.inboxId, storeInstanceId: f.storeInstanceId,
      workerId: f.workerId, attemptId: `${family}-accepted`, manifestSha256: f.admission.manifestSha256,
      chainSha256: f.admission.chainHashes[f.chainKey], assetSha256: f.admission.assetHashes[f.assetRef],
      sourceSetSha256: f.admission.sourceSetHashes[f.sourceSetId], assignmentSha256: f.admission.assignmentHashes[f.assignmentId],
      workerSha256: f.admission.workerHashes[f.workerId], candidate: f.candidate, preparationContext: f.snapshot,
      preparedAtMs: f.fixture.now });
    expect(prepared.timedObservation.context).toEqual(f.fixture.context);
    const callbackRequest = f.preparationContext.mock.calls[0][0];
    expect(callbackRequest).toEqual({ inboxId: f.inboxId, storeInstanceId: f.storeInstanceId,
      manifestSha256: f.admission.manifestSha256, workerId: f.workerId, candidate: f.candidate, jobId: null });
    expect(Object.isFrozen(callbackRequest)).toBe(true);
    expect(Object.isFrozen(row(callbackRequest).candidate)).toBe(true);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.preparationContext.checkpoint)).toBe(true);
    expect(Object.isFrozen(prepared.timedObservation.observation.reads)).toBe(true);
    expect(Object.isFrozen(prepared.timedObservation.observation.reads[0])).toBe(true);
    const validated = await verify(f, prepared);
    expect(validated).toMatchObject({ mode: "simulation-only", creditAuthority: false,
      semantics: { creditAuthority: false, family, chainKey: f.chainKey,
        transfer: { amountRaw: f.candidate.amountRaw, token: f.fixture.context.token, recipient: f.fixture.context.recipient,
          transactionId: f.candidate.transactionId, eventIndex: f.candidate.eventIndex, transactionIndex: "1" } } });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.identity)).toBe(true);
    expect(() => checkPreparedDepositAdmissionFreshness(validated, f.fixture.now)).not.toThrow();
  });

  it.each(["bsc", "tron"] as const)("replays serialized %s data without consulting a node or current wall clock", async family => {
    const f = scenario(family), reader = f.create();
    const prepared = await reader.prepare({ attemptId: "archive-roundtrip", candidate: f.candidate });
    const first = await verify(f, prepared), readCount = f.fixture.calls.length;
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Archive replay must not consult current wall time"); });
    const replayed = await verify(f, clone(prepared));
    expect(replayed.prepared).toEqual(first.prepared);
    expect(replayed.semantics).toEqual(first.semantics);
    expect(replayed.identity).toEqual(first.identity);
    expect(f.fixture.calls).toHaveLength(readCount);
    expect(f.preparationContext).toHaveBeenCalledOnce();
  });

  it.each(["bsc", "tron"] as const)("exposes the advanced validated %s head independently from its pinned checkpoint", async family => {
    const f = scenario(family), pinned = f.fixture.headHeight;
    f.fixture.mutateResponse = (value, read) => {
      if (read.isHead && read.occurrence === 1) f.fixture.advanceHead(pinned + 2);
      return value;
    };
    const prepared = await f.create().prepare({ attemptId: "advancing-head", candidate: f.candidate });
    const validated = await verify(f, prepared);
    expect(validated.semantics.pinnedCheckpoint.number).toBe(String(pinned));
    expect(validated.semantics.lastValidatedHead.number).toBe(String(pinned + 2));
    expect(validated.semantics.transfer.checkpointNumber).toBe(String(pinned));
    expect(validated.semantics.blocks.map(block => block.number)).toContain(String(pinned + 1));
    expect(validated.semantics.blocks.map(block => block.number)).toContain(String(pinned + 2));
  });

  it("captures constructor capabilities and candidate/context values across asynchronous mutation", async () => {
    const f = scenario(), originalManifest = clone(f.manifest), originalCandidate = clone(f.candidate), originalSnapshot = clone(f.snapshot);
    const reader = createAdmittedDevelopmentObservationReader(f.options), replacement = vi.fn(() => { throw new Error("Mutated capability must not execute"); });
    f.options.fetch = replacement;
    f.options.preparationContext = replacement as never;
    f.options.clock = replacement;
    f.options.workerId = "substituted-worker";
    f.endpointConfig[0].endpoint = "https://substituted.invalid/rpc";
    f.manifest.assignments[0].beneficiaryRef = "substituted-beneficiary";
    f.fixture.mutateResponse = value => {
      f.candidate.amountRaw = "1";
      f.candidate.assignmentId = "substituted-assignment";
      f.snapshot.checkpoint.stateHash = "ee".repeat(32);
      f.snapshot.manifestSha256 = "ff".repeat(32);
      return value;
    };
    const prepared = await reader.prepare({ attemptId: "captured-inputs", candidate: f.candidate });
    expect(prepared.candidate).toEqual(originalCandidate);
    expect(prepared.preparationContext).toEqual(originalSnapshot);
    expect(prepared.timedObservation.observation.transfer.amountRaw).toBe(originalCandidate.amountRaw);
    expect(replacement).not.toHaveBeenCalled();
    const validated = await verify(f, prepared, { manifest: originalManifest });
    expect(validated.prepared.assignmentSha256).toBe(f.admission.assignmentHashes[f.assignmentId]);
  });

  it("captures a synchronous trusted snapshot before its queued mutation can run", async () => {
    const f = scenario(), original = clone(f.snapshot);
    const reader = f.create({ preparationContext: () => {
      queueMicrotask(() => { f.snapshot.checkpoint.stateHash = "ee".repeat(32); });
      return f.snapshot;
    } });
    const prepared = await reader.prepare({ attemptId: "synchronous-snapshot", candidate: f.candidate });
    expect(f.snapshot.checkpoint.stateHash).toBe("ee".repeat(32));
    expect(prepared.preparationContext).toEqual(original);
  });

  it("keeps native event coordinates and admitted facts stable across fresh attempts and differing RPC IDs", async () => {
    const f = scenario(), reader = f.create();
    const first = await reader.prepare({ attemptId: "stable-event-first", candidate: f.candidate });
    const second = await reader.prepare({ attemptId: "stable-event-second", candidate: f.candidate });
    const a = await verify(f, first), b = await verify(f, second);
    expect(first.preparationSha256).not.toBe(second.preparationSha256);
    expect(first.timedObservation.observation.reads[0].requestBody).not.toBe(second.timedObservation.observation.reads[0].requestBody);
    expect(a.identity.nativeEventLocator).toBe(b.identity.nativeEventLocator);
    expect(a.identity.transactionKey).toBe(b.identity.transactionKey);
    expect(a.identity.eventFactsSha256).toBe(b.identity.eventFactsSha256);
    expect(a.identity.transactionFactsSha256).toBe(b.identity.transactionFactsSha256);
    expect(a.identity.admittedEvidenceId).not.toBe(b.identity.admittedEvidenceId);
    expect(a.identity.eventFactsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.identity.transactionFactsSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the admitted evidence identity when the trusted beneficiary assignment changes", async () => {
    const first = scenario(), second = scenario();
    second.manifest.assignments[0].beneficiaryRef = "different-admitted-beneficiary";
    const secondAdmission = captureDepositInboxManifest(second.manifest);
    second.snapshot.manifestSha256 = secondAdmission.manifestSha256;
    const a = await verify(first, await first.create().prepare({ attemptId: "original-beneficiary", candidate: first.candidate }));
    const b = await verify(second, await second.create().prepare({ attemptId: "changed-beneficiary", candidate: second.candidate }));
    expect(a.identity.nativeEventLocator).toBe(b.identity.nativeEventLocator);
    expect(a.identity.transactionKey).toBe(b.identity.transactionKey);
    expect(a.identity.admittedEvidenceId).not.toBe(b.identity.admittedEvidenceId);
    expect(a.identity.eventFactsSha256).not.toBe(b.identity.eventFactsSha256);
    expect(a.identity.transactionFactsSha256).toBe(b.identity.transactionFactsSha256);
  });

  it("requires fresh branded validation for an admission freshness check", async () => {
    const f = scenario("tron"), prepared = await f.create().prepare({ attemptId: "freshness-boundary", candidate: f.candidate });
    const validated = await verify(f, prepared);
    await refused(() => checkPreparedDepositAdmissionFreshness(clone(validated), f.fixture.now));
    await refused(() => checkPreparedDepositAdmissionFreshness(validated, f.fixture.now + 30_000));
    await refused(() => checkPreparedDepositAdmissionFreshness(validated, f.fixture.now - 5_001));
    expect(() => checkPreparedDepositAdmissionFreshness(validated, f.fixture.now - 5_000)).not.toThrow();
    expect(() => checkPreparedDepositAdmissionFreshness(validated, f.fixture.now)).not.toThrow();
  });

  it.each(["beneficiary", "store", "worker"] as const)("refuses archival reuse under a different %s admission", async field => {
    const f = scenario(), prepared = await f.create().prepare({ attemptId: "cross-context", candidate: f.candidate });
    const overrides: Row = {};
    if (field === "beneficiary") {
      const manifest = clone(f.manifest); manifest.assignments[0].beneficiaryRef = "other-beneficiary"; overrides.manifest = manifest;
    } else if (field === "store") overrides.storeInstanceId = "other-store";
    else overrides.workerId = "other-worker";
    await refused(() => verify(f, prepared, overrides));
  });

  it.each(["candidate", "checkpoint", "head", "raw-response"] as const)("refuses serialized %s tampering", async field => {
    const f = scenario(), prepared = clone(await f.create().prepare({ attemptId: "tamper-evidence", candidate: f.candidate }));
    if (field === "candidate") row(prepared.candidate).amountRaw = "1";
    else if (field === "checkpoint") row(prepared.preparationContext.checkpoint).stateHash = "ee".repeat(32);
    else if (field === "head") row(prepared.timedObservation.observation.transfer).checkpointNumber = "103";
    else row(prepared.timedObservation.observation.reads[0]).responseBody = "{}";
    await refused(() => verify(f, prepared), field === "candidate" ? "ADMISSION_REFUSED" : "REPLAY_MISMATCH");
  });
});

describe("single-flight admitted preparation", () => {
  it("consumes successful attempt IDs without issuing another callback or node read", async () => {
    const f = scenario(), reader = f.create();
    await reader.prepare({ attemptId: "used-attempt", candidate: f.candidate });
    const readCount = f.fixture.calls.length;
    await refused(() => reader.prepare({ attemptId: "used-attempt", candidate: f.candidate }));
    expect(f.preparationContext).toHaveBeenCalledOnce();
    expect(f.fixture.calls).toHaveLength(readCount);
  });

  it("requires a new attempt ID after failure and permits a fresh independent attempt", async () => {
    const f = scenario(), reader = f.create();
    f.fixture.mutateResponse = (_value, read) => {
      if (read.operation === "eth_chainId") return "0x38";
    };
    await refused(() => reader.prepare({ attemptId: "failed-attempt", candidate: f.candidate }), "SOURCE_CONFLICT");
    const readCount = f.fixture.calls.length;
    f.fixture.mutateResponse = undefined;
    await refused(() => reader.prepare({ attemptId: "failed-attempt", candidate: f.candidate }));
    expect(f.fixture.calls).toHaveLength(readCount);
    const prepared = await reader.prepare({ attemptId: "replacement-attempt", candidate: f.candidate });
    expect(prepared.creditAuthority).toBe(false);
  });

  it("poisons pending and future attempts after a concurrent prepare during the trusted callback", async () => {
    const f = scenario();
    let release!: (value: typeof f.snapshot) => void;
    const pendingSnapshot = new Promise<typeof f.snapshot>(resolve => { release = resolve; });
    const reader = f.create({ preparationContext: () => pendingSnapshot });
    const first = reader.prepare({ attemptId: "pending-callback", candidate: f.candidate });
    const second = reader.prepare({ attemptId: "concurrent-callback", candidate: f.candidate });
    const secondError = refused(() => second, "SESSION_CLOSED");
    release(f.snapshot);
    await Promise.all([refused(() => first, "SESSION_CLOSED"), secondError]);
    await refused(() => reader.prepare({ attemptId: "after-concurrent-callback", candidate: f.candidate }), "SESSION_CLOSED");
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("poisons preparation reentered by the trusted callback before any node read", async () => {
    const f = scenario();
    let nested: Promise<unknown> | undefined;
    const reader = f.create({ preparationContext: () => {
      nested = refused(() => reader.prepare({ attemptId: "inner-callback", candidate: f.candidate }), "SESSION_CLOSED");
      return f.snapshot;
    } });
    await refused(() => reader.prepare({ attemptId: "outer-callback", candidate: f.candidate }), "SESSION_CLOSED");
    await nested;
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("poisons preparation reentered by the native fetch and prevents further reads", async () => {
    const f = scenario(), reader = f.create();
    let nested: Promise<unknown> | undefined;
    f.fixture.mutateResponse = value => {
      nested = refused(() => reader.prepare({ attemptId: "inner-fetch", candidate: f.candidate }), "SESSION_CLOSED");
      return value;
    };
    await refused(() => reader.prepare({ attemptId: "outer-fetch", candidate: f.candidate }), "SESSION_CLOSED");
    await nested;
    expect(f.fixture.calls).toHaveLength(1);
    await refused(() => reader.prepare({ attemptId: "after-reentrant-fetch", candidate: f.candidate }), "SESSION_CLOSED");
  });
});

describe("unread native response cleanup after preparation refusal", () => {
  it("cancels the unread body of a response returned after a runtime switch", async () => {
    const f = scenario(), cancel = vi.fn();
    const fetch = vi.fn(async (url: string) => {
      const response = unreadResponse(url, cancel);
      vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1");
      return response;
    });
    const reader = f.create({ fetch });
    await refused(() => reader.prepare({ attemptId: "late-runtime-response", candidate: f.candidate }), "RUNTIME_REFUSED");
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels the unread body of a response returned after reentrant poisoning", async () => {
    const f = scenario(), cancel = vi.fn();
    let nested: Promise<unknown> | undefined;
    const fetch = vi.fn(async (url: string) => {
      const response = unreadResponse(url, cancel);
      nested = refused(() => reader.prepare({ attemptId: "cleanup-inner", candidate: f.candidate }), "SESSION_CLOSED");
      return response;
    });
    const reader = f.create({ fetch });
    await refused(() => reader.prepare({ attemptId: "cleanup-outer", candidate: f.candidate }), "SESSION_CLOSED");
    await nested;
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a response arriving after the full preparation deadline without granting it to replay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = scenario(), cancel = vi.fn();
    let releaseSnapshot!: (value: typeof f.snapshot) => void, releaseResponse!: (value: Response) => void;
    let responseUrl = "";
    const snapshotPromise = new Promise<typeof f.snapshot>(resolve => { releaseSnapshot = resolve; });
    const responsePromise = new Promise<Response>(resolve => { releaseResponse = resolve; });
    const fetch = vi.fn((url: string) => { responseUrl = url; return responsePromise; });
    const reader = f.create({ fetch, preparationContext: () => snapshotPromise });
    const refusal = refused(() => reader.prepare({ attemptId: "late-deadline-response", candidate: f.candidate }), "TIMEOUT");
    await vi.advanceTimersByTimeAsync(29_000);
    releaseSnapshot(f.snapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    await refusal;
    releaseResponse(unreadResponse(responseUrl, cancel));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
