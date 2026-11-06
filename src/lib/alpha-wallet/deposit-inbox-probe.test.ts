// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDepositObservationAdmissionFixture } from "../../../scripts/alpha-wallet/deposit-observation-fixtures";
import { captureDepositInboxCommand, createDepositInboxArchive, createDepositInboxPreparationContext,
  transitionDepositInbox, verifyDepositInboxArchive } from "./deposit-inbox-model";
import { createDevelopmentDepositInboxProbe, isCapturedDepositInboxUnsealedAttempt } from "./deposit-inbox-probe";
import type { AdmittedDevelopmentObservationReaderOptions } from "./deposit-observation-preparation";

type Row = Record<string, unknown>;
const row = (value: unknown) => value as Row;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function scenario(family: "bsc" | "tron" = "bsc") {
  const f = createDepositObservationAdmissionFixture(family), storeInstanceId = `${family}-probe-store`;
  const archive = createDepositInboxArchive({ mode: "simulation-only", manifest: f.manifest,
    storeInstanceId, requestId: "probe-bootstrap", atMs: f.fixture.now });
  const snapshot = createDepositInboxPreparationContext({ archive, workerId: f.workerId,
    candidate: f.candidate, capturedAtMs: f.fixture.now });
  const preparationContext = vi.fn(() => snapshot);
  const options: AdmittedDevelopmentObservationReaderOptions = { mode: "simulation-only", manifest: f.manifest,
    workerId: f.workerId, storeInstanceId, endpointConfig: f.endpointConfig, fetch: f.fixture.fetch,
    clock: f.fixture.clock, preparationContext };
  const create = (overrides: Row = {}) => createDevelopmentDepositInboxProbe({ ...options, ...overrides } as never);
  const request = { attemptId: "probe-attempt", candidate: f.candidate };
  const captureHold = (attempt: unknown, requestId = "hold-request") => captureDepositInboxCommand({ mode: "simulation-only",
    manifest: f.manifest, worker: { workerId: f.workerId, role: "worker" }, storeInstanceId,
    command: { type: "record-attempt-hold", requestId, attempt, candidateCursor: null } });
  return { ...f, storeInstanceId, archive, snapshot, preparationContext, options, create, request, captureHold };
}

async function refused(run: () => unknown | Promise<unknown>, code?: string) {
  let caught: unknown;
  try { await run(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ creditAuthority: false, ...(code === undefined ? {} : { code }) });
  return caught;
}

function unreadResponse(url: string, cancel: () => void) {
  const response = new Response(new ReadableStream<Uint8Array>({ cancel }),
    { headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  vi.stubGlobal("fetch", () => { throw new Error("Ambient network is forbidden in deposit probe tests"); });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("trusted probe admission before any native IO", () => {
  it.each(["bsc", "tron"] as const)("returns fully prepared %s evidence without manufacturing a failure claim", async family => {
    const f = scenario(family), result = await f.create().prepare(f.request);
    expect(result.kind).toBe("prepared");
    if (result.kind !== "prepared") throw new Error("Expected complete native preparation");
    expect(result.prepared.preparationContext).toEqual(f.snapshot);
    expect(result).toMatchObject({ mode: "simulation-only", creditAuthority: false });
    expect(isCapturedDepositInboxUnsealedAttempt(result.prepared)).toBe(false);
    expect(f.fixture.calls.length).toBeGreaterThan(0);
  });

  it.each([
    { label: "manifest authority escalation", change: (f: ReturnType<typeof scenario>) => ({ manifest: { ...f.manifest, creditAuthority: true } }) },
    { label: "unadmitted worker", change: () => ({ workerId: "unknown-worker" }) },
    { label: "uncommitted endpoint", change: (f: ReturnType<typeof scenario>) => ({ endpointConfig: f.endpointConfig.map((value, index) => index ? value : { ...value, endpoint: `${value.endpoint}/other` }) }) },
    { label: "extra factory policy", change: () => ({ policy: { timeoutMs: 100_000 } }) },
    { label: "live mode", change: () => ({ mode: "live" }) },
  ])("refuses $label before callback or IO", async ({ change }) => {
    const f = scenario();
    await refused(() => f.create(change(f)));
    expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["fetch", "preparationContext", "clock"] as const)("refuses an executable %s option getter without invoking it", async key => {
    const f = scenario(), getter = vi.fn(() => f.options[key]), options = { ...f.options };
    Object.defineProperty(options, key, { enumerable: true, get: getter });
    await refused(() => createDevelopmentDepositInboxProbe(options), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["fetch", "preparationContext", "clock"] as const)("refuses a Proxy %s capability without evaluating traps", async key => {
    const f = scenario(), trap = vi.fn(() => { throw new Error("Capability trap executed"); });
    const capability = new Proxy(() => undefined, { apply: trap, get: trap, getPrototypeOf: trap, ownKeys: trap });
    await refused(() => f.create({ [key]: capability }), "INVALID_INPUT");
    expect(trap).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it.each([
    { label: "missing fetch", key: "fetch", value: undefined },
    { label: "nonfunction context", key: "preparationContext", value: {} },
    { label: "nonfunction clock", key: "clock", value: 0 },
  ])("refuses $label without granting a failure capability", async ({ key, value }) => {
    const f = scenario(); await refused(() => f.create({ [key]: value }), "INVALID_INPUT");
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each([
    { label: "beneficiary substitution", candidate: (f: ReturnType<typeof scenario>) => ({ ...f.candidate, beneficiaryRef: "other" }) },
    { label: "unknown assignment", candidate: (f: ReturnType<typeof scenario>) => ({ ...f.candidate, assignmentId: "unadmitted" }) },
    { label: "unknown source set", candidate: (f: ReturnType<typeof scenario>) => ({ ...f.candidate, sourceSetId: "unadmitted" }) },
    { label: "zero raw units", candidate: (f: ReturnType<typeof scenario>) => ({ ...f.candidate, amountRaw: "0" }) },
    { label: "numeric native index", candidate: (f: ReturnType<typeof scenario>) => ({ ...f.candidate, eventIndex: 1 }) },
  ])("rejects $label instead of returning an unsealed hold", async ({ candidate }) => {
    const f = scenario(), probe = f.create();
    await refused(() => probe.prepare({ ...f.request, candidate: candidate(f) }));
    expect(f.preparationContext).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it("rejects an executable candidate without invoking its getter or recording a hold", async () => {
    const f = scenario(), getter = vi.fn(() => f.candidate.transactionId), candidate = { ...f.candidate };
    Object.defineProperty(candidate, "transactionId", { enumerable: true, get: getter });
    await refused(() => f.create().prepare({ ...f.request, candidate }), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled(); expect(f.preparationContext).not.toHaveBeenCalled();
    expect(f.fixture.calls).toHaveLength(0);
  });
});

describe("probe context capture and failure capability", () => {
  it.each(["bsc", "tron"] as const)("sanitizes an injected %s transport failure after admitted IO", async family => {
    const f = scenario(family), fetch = vi.fn(async () => { throw new Error("secret-provider-detail-must-not-be-retained"); });
    const result = await f.create({ fetch }).prepare(f.request);
    expect(result.kind).toBe("held"); if (result.kind !== "held") throw new Error("Expected admitted failure hold");
    expect(result.attempt).toMatchObject({ mode: "simulation-only", creditAuthority: false, failureCode: "TRANSPORT",
      workerId: f.workerId, storeInstanceId: f.storeInstanceId, candidate: f.candidate, preparationContext: f.snapshot });
    expect(isCapturedDepositInboxUnsealedAttempt(result.attempt)).toBe(true);
    expect(Object.isFrozen(result.attempt) && Object.isFrozen(result.attempt.preparationContext)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-provider-detail");
    expect(row(result.attempt).observation).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    const transition = await transitionDepositInbox(f.archive, await f.captureHold(result.attempt), { atMs: f.fixture.now });
    expect(transition.receipt.disposition).toBe("attempt-held");
    if (transition.kind !== "append") throw new Error("Expected append");
    expect(transition.plan.archive.evidenceBlobs).toEqual([]);
    expect(await verifyDepositInboxArchive(clone(transition.plan.archive))).toEqual(transition.plan.archive);
  });

  it("does not treat inert matching fields or copied failure bytes as a live trusted capability", async () => {
    const f = scenario(), result = await f.create({ fetch: async () => { throw new Error("native failure"); } }).prepare(f.request);
    if (result.kind !== "held") throw new Error("Expected actual failure");
    for (const value of [null, {}, { ...result.attempt }, clone(result.attempt), Object.freeze(clone(result.attempt))]) {
      expect(isCapturedDepositInboxUnsealedAttempt(value)).toBe(false);
      await refused(() => f.captureHold(value), "ADMISSION_REFUSED");
    }
    expect(f.archive.checkpoint.revision).toBe(0);
  });

  it("rejects a getter pretending to be a live attempt without evaluating it", async () => {
    const f = scenario(), getter = vi.fn(() => "SOURCE_CONFLICT"), attempt = {};
    Object.defineProperty(attempt, "failureCode", { enumerable: true, get: getter });
    await refused(() => f.captureHold(attempt), "ADMISSION_REFUSED");
    expect(getter).not.toHaveBeenCalled();
  });

  it("retains a callback snapshot captured after preparation began and before failed IO", async () => {
    const f = scenario(), startedAtMs = f.fixture.now;
    const probe = f.create({ preparationContext: async () => {
      await Promise.resolve(); f.fixture.setNow(startedAtMs + 1);
      return createDepositInboxPreparationContext({ archive: f.archive, workerId: f.workerId,
        candidate: f.candidate, capturedAtMs: f.fixture.now });
    }, fetch: async () => { throw new Error("native failure after asynchronous context capture"); } });
    const result = await probe.prepare(f.request);
    if (result.kind !== "held") throw new Error("Expected admitted transport hold");
    expect(result.attempt.startedAtMs).toBe(startedAtMs);
    expect(result.attempt.preparationContext.capturedAtMs).toBe(startedAtMs + 1);
    const transition = await transitionDepositInbox(f.archive, await f.captureHold(result.attempt), { atMs: f.fixture.now });
    expect(transition.receipt.disposition).toBe("attempt-held");
    if (transition.kind !== "append") throw new Error("Expected append");
    expect(await verifyDepositInboxArchive(clone(transition.plan.archive))).toEqual(transition.plan.archive);
  });

  it("captures callback data before later caller mutation during native IO", async () => {
    const f = scenario(), snapshot = clone(f.snapshot);
    const probe = f.create({ preparationContext: () => snapshot, fetch: async () => {
      snapshot.checkpoint.eventHash = "ee".repeat(32);
      throw new Error("native failure");
    } });
    const result = await probe.prepare(f.request);
    if (result.kind !== "held") throw new Error("Expected actual failure");
    expect(result.attempt.preparationContext).toEqual(f.snapshot);
    expect((await f.captureHold(result.attempt)).creditAuthority).toBe(false);
  });

  it("propagates a pre-IO callback failure without inventing an admitted transport claim", async () => {
    const f = scenario(), error = { code: "SOURCE_CONFLICT", creditAuthority: false };
    await refused(() => f.create({ preparationContext: () => { throw error; } }).prepare(f.request));
    expect(isCapturedDepositInboxUnsealedAttempt(error)).toBe(false);
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("accepts an ordinary native context Promise on a successful preparation", async () => {
    const f = scenario(), result = await f.create({ preparationContext: () => Promise.resolve(f.snapshot) }).prepare(f.request);
    expect(result.kind).toBe("prepared"); expect(f.fixture.calls.length).toBeGreaterThan(0);
  });

  it("does not convert a rejected native context Promise into a hold before IO", async () => {
    const f = scenario();
    await refused(() => f.create({ preparationContext: () => Promise.reject(new Error("context unavailable")) }).prepare(f.request));
    expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["subclass", "own-then", "own-constructor"] as const)("rejects a %s context Promise without executing its overrides", async change => {
    const f = scenario(), getter = vi.fn(() => { throw new Error("Altered Promise getter executed"); });
    let promise: Promise<typeof f.snapshot>;
    if (change === "subclass") {
      class ContextPromise extends Promise<typeof f.snapshot> {}
      Object.defineProperty(ContextPromise.prototype, "then", { get: getter });
      promise = new ContextPromise(resolve => resolve(f.snapshot));
    } else {
      promise = Promise.resolve(f.snapshot);
      Object.defineProperty(promise, change === "own-then" ? "then" : "constructor", { get: getter });
    }
    await refused(() => f.create({ preparationContext: () => promise }).prepare(f.request), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it.each(["plain-method", "accessor"] as const)("rejects a %s thenable without executing it", async shape => {
    const f = scenario(), execute = vi.fn(), value: Row = shape === "plain-method" ? { then: execute } : {};
    if (shape === "accessor") Object.defineProperty(value, "then", { enumerable: true, get: execute });
    await refused(() => f.create({ preparationContext: () => value }).prepare(f.request), "INVALID_INPUT");
    expect(execute).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it.each([
    { label: "stale snapshot", delta: -30_000 },
    { label: "future snapshot", delta: 1 },
  ])("rejects a $label without granting a failure capability", async ({ delta }) => {
    const f = scenario(), snapshot = { ...f.snapshot, capturedAtMs: f.snapshot.capturedAtMs + delta };
    await refused(() => f.create({ preparationContext: () => snapshot }).prepare(f.request));
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("expires an unresolved callback without a hold and rejects its late snapshot before IO", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = scenario(); let release!: (value: typeof f.snapshot) => void;
    const promise = new Promise<typeof f.snapshot>(resolve => { release = resolve; });
    const refusal = refused(() => f.create({ preparationContext: () => promise }).prepare(f.request), "TIMEOUT");
    await vi.advanceTimersByTimeAsync(30_000); await refusal;
    release(f.snapshot); await vi.advanceTimersByTimeAsync(0);
    expect(f.fixture.calls).toHaveLength(0);
  });
});

describe("probe session poisoning, clocks and runtime boundaries", () => {
  it("poisons both concurrent preparations during context capture without creating held attempts", async () => {
    const f = scenario(); let release!: (value: typeof f.snapshot) => void;
    const promise = new Promise<typeof f.snapshot>(resolve => { release = resolve; });
    const probe = f.create({ preparationContext: () => promise });
    const first = refused(() => probe.prepare(f.request), "SESSION_CLOSED");
    const second = refused(() => probe.prepare({ ...f.request, attemptId: "concurrent" }), "SESSION_CLOSED");
    release(f.snapshot); await Promise.all([first, second]);
    await refused(() => probe.prepare({ ...f.request, attemptId: "after-poison" }), "SESSION_CLOSED");
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("poisons a context callback that reenters the same probe before native IO", async () => {
    const f = scenario(); let nested: Promise<unknown> | undefined;
    const probe = f.create({ preparationContext: () => {
      nested = refused(() => probe.prepare({ ...f.request, attemptId: "nested-context" }), "SESSION_CLOSED");
      return f.snapshot;
    } });
    await refused(() => probe.prepare(f.request), "SESSION_CLOSED"); await nested;
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("poisons fetch reentrancy and cancels the arriving response without an unsealed hold", async () => {
    const f = scenario(), cancel = vi.fn(); let nested: Promise<unknown> | undefined;
    const fetch = vi.fn(async (url: string) => {
      nested = refused(() => probe.prepare({ ...f.request, attemptId: "nested-fetch" }), "SESSION_CLOSED");
      return unreadResponse(url, cancel);
    });
    const probe = f.create({ fetch });
    await refused(() => probe.prepare(f.request), "SESSION_CLOSED"); await nested;
    expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
    await refused(() => probe.prepare({ ...f.request, attemptId: "after-fetch-poison" }), "SESSION_CLOSED");
  });

  it("consumes a failed attempt identifier while allowing a distinct later attempt", async () => {
    const f = scenario(), fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (fetch.mock.calls.length === 1) throw new Error("first native read fails");
      return f.fixture.fetch(url, init);
    });
    const probe = f.create({ fetch });
    expect((await probe.prepare(f.request)).kind).toBe("held");
    await refused(() => probe.prepare(f.request)); expect(fetch).toHaveBeenCalledOnce();
    expect((await probe.prepare({ ...f.request, attemptId: "replacement-attempt" })).kind).toBe("prepared");
  });

  it.each([
    { label: "NaN", value: NaN }, { label: "infinity", value: Infinity }, { label: "negative", value: -1 },
    { label: "negative zero", value: -0 }, { label: "fractional", value: 1.5 },
    { label: "unsafe integer", value: Number.MAX_SAFE_INTEGER + 1 },
  ])("refuses a $label clock before callback or IO", async ({ value }) => {
    const f = scenario();
    await refused(() => f.create({ clock: () => value }).prepare(f.request), "RUNTIME_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it("refuses a regressing clock after native IO without a branded failure claim", async () => {
    const f = scenario(); f.fixture.mutateResponse = value => { f.fixture.setNow(f.fixture.now - 1); return value; };
    await refused(() => f.create().prepare(f.request), "RUNTIME_REFUSED");
    expect(f.fixture.calls).toHaveLength(1);
  });

  it.each([
    { name: "NODE_ENV", value: "production" }, { name: "VERCEL", value: "1" },
    { name: "ALPHA_WALLET_MAINNET_ENABLED", value: "true" }, { name: "ALPHA_WALLET_SIGNING_ENABLED", value: "1" },
  ])("refuses $name=$value at construction without invoking capabilities", async ({ name, value }) => {
    const f = scenario(); vi.stubEnv(name, value);
    await refused(() => f.create(), "RUNTIME_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it("refuses a runtime switch before preparation without returning a hold", async () => {
    const f = scenario(), probe = f.create(); vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "true");
    await refused(() => probe.prepare(f.request), "RUNTIME_REFUSED");
    expect(f.preparationContext).not.toHaveBeenCalled(); expect(f.fixture.calls).toHaveLength(0);
  });

  it("refuses a runtime switch in an asynchronous context callback without native IO", async () => {
    const f = scenario();
    const probe = f.create({ preparationContext: async () => {
      await Promise.resolve(); vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "true"); return f.snapshot;
    } });
    await refused(() => probe.prepare(f.request), "RUNTIME_REFUSED");
    expect(f.fixture.calls).toHaveLength(0);
  });

  it("cancels a response after a runtime switch and refuses to disguise that switch as a node failure", async () => {
    const f = scenario(), cancel = vi.fn();
    const fetch = vi.fn(async (url: string) => {
      vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true"); return unreadResponse(url, cancel);
    });
    await refused(() => f.create({ fetch }).prepare(f.request), "RUNTIME_REFUSED");
    expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
  });
});
