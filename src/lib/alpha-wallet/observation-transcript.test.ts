// @vitest-environment node
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDepositObservationFixture, type DepositObservationFixture } from "../../../scripts/alpha-wallet/deposit-observation-fixtures";
import { canonicalInboxJson, digestInboxValue, type DepositInboxErrorCode } from "./deposit-inbox-data";
import { observationDigest } from "./chain-observer-rpc";
import { captureTimedDevelopmentObservation, replayTimedDevelopmentObservation,
  type TimedDevelopmentObservationInput, type TimedDevelopmentObservationV1 } from "./observation-transcript";

type Mutable<T> = T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
type Bundle = Mutable<TimedDevelopmentObservationV1>;
type Row = Record<string, unknown>;
const clone = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value));
const row = (value: unknown) => value as Row;
const input = (fixture: DepositObservationFixture): TimedDevelopmentObservationInput => ({ mode: "simulation-only",
  sources: fixture.sources, context: fixture.context, fetch: fixture.fetch, clock: fixture.clock,
  executionSourceId: fixture.executionSourceId, finalitySourceId: fixture.finalitySourceId });
const capture = (family: "bsc" | "tron" = "bsc") => captureTimedDevelopmentObservation(input(createDepositObservationFixture(family)));

/** Recompute every public checksum, including the original observer's insertion-order seal. */
function rehash(bundle: Bundle): Bundle {
  const observation = bundle.observation, transfer = observation.transfer;
  const transferKeys = ["kind", "creditAuthority", "assurance", "family", "chainKey", "token", "recipient", "transactionId", "amountRaw",
    "eventIndex", "sender", "blockNumber", "blockHash", "transactionIndex", "finality", "checkpointNumber", "checkpointHash", "eventKey"] as const;
  const reads = observation.reads.map(read => ({ sourceId: read.sourceId, protocol: read.protocol, operation: read.operation,
    requestBody: read.requestBody, responseBody: read.responseBody, responseSha256: observationDigest(read.responseBody), completedAtMs: read.completedAtMs }));
  observation.reads = reads;
  observation.observationSha256 = observationDigest({ kind: observation.kind, mode: observation.mode,
    creditAuthority: observation.creditAuthority, assurance: observation.assurance,
    transfer: Object.fromEntries(transferKeys.map(key => [key, transfer[key]])), executionSourceId: observation.executionSourceId,
    finalitySourceId: observation.finalitySourceId, checkpointTimestampMs: observation.checkpointTimestampMs,
    startedAtMs: observation.startedAtMs, completedAtMs: observation.completedAtMs, reads });
  const { timedObservationSha256: ignored, ...body } = bundle;
  void ignored;
  bundle.timedObservationSha256 = digestInboxValue("timed-observation", body);
  return bundle;
}
function alterResponse(bundle: Bundle, ordinal: number, change: (value: Row) => void): void {
  const read = bundle.observation.reads[ordinal];
  const value = row(JSON.parse(read.responseBody)); change(value); read.responseBody = JSON.stringify(value);
}
async function rejected(value: unknown, code?: DepositInboxErrorCode) {
  await expect(replayTimedDevelopmentObservation(value)).rejects.toMatchObject({ name: "DepositInboxError", creditAuthority: false, ...(code ? { code } : {}) });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("timed development observation capture and exact offline replay", () => {
  it.each(["bsc", "tron"] as const)("captures and purely replays complete %s native evidence, including canonical outer JSON", async family => {
    const fixture = createDepositObservationFixture(family), bundle = await captureTimedDevelopmentObservation(input(fixture));
    expect(bundle).toMatchObject({ kind: "development-timed-observation", formatVersion: 1, mode: "simulation-only", creditAuthority: false });
    expect(bundle.timing.reads).toHaveLength(fixture.calls.length);
    expect(bundle.timing.semanticClocks).toHaveLength(3);
    expect(bundle.timing.reads.map(read => read.ordinal)).toEqual(fixture.calls.map(read => read.ordinal));
    for (const [index, read] of bundle.observation.reads.entries()) {
      expect(read.completedAtMs).toBeGreaterThanOrEqual(bundle.timing.reads[index].startedAtMs);
      expect(read.completedAtMs).toBeLessThanOrEqual(bundle.timing.reads[index].returnedAtMs);
      expect(bundle.timing.reads[index].elapsedUs).toBeLessThan(5_000_000);
    }
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Replay attempted ambient network IO"); }));
    const calls = fixture.calls.length;
    const result = await replayTimedDevelopmentObservation(JSON.parse(canonicalInboxJson(bundle)));
    expect(result.observation).toEqual(bundle.observation);
    expect(result.semantics.transfer).toEqual(bundle.observation.transfer);
    expect(result.semantics).toMatchObject({ family, mode: "simulation-only", creditAuthority: false,
      pinnedCheckpoint: { number: String(fixture.headHeight) }, lastValidatedHead: { number: String(fixture.headHeight) },
      containingBlock: { number: String(fixture.containingHeight), transactions: expect.arrayContaining([fixture.context.transactionId]) },
      transactionAnchor: { transactionId: fixture.context.transactionId, transactionIndex: "1" } });
    expect(result.semantics.blocks[0].number).toBe("0");
    expect(result.semantics.blocks[0].sourceIds).toEqual([fixture.executionSourceId, fixture.finalitySourceId].sort());
    expect(result.semantics.receiptSemanticsSha256).toBe(result.semantics.transactionAnchor.receiptSemanticsSha256);
    expect(fixture.calls).toHaveLength(calls);
    expect(fetch).not.toHaveBeenCalled();
    for (const value of [result, result.timedObservation, result.observation, result.observation.transfer,
      result.observation.reads, result.observation.reads[0], result.timedObservation.timing, result.timedObservation.timing.reads,
      result.semantics, result.semantics.blocks, result.semantics.containingBlock, result.semantics.containingBlock.transactions])
      expect(Object.isFrozen(value)).toBe(true);
    expect((await replayTimedDevelopmentObservation(rehash(clone(bundle)))).observation).toEqual(bundle.observation);
  });

  it.each(["bsc", "tron"] as const)("exposes the last fully validated advancing %s head while retaining the original checkpoint", async family => {
    const fixture = createDepositObservationFixture(family), pinned = fixture.headHeight;
    fixture.mutateResponse = (_, read) => { if (read.isHead && read.occurrence === 1) fixture.advanceHead(pinned + 2); };
    const bundle = await captureTimedDevelopmentObservation(input(fixture)), result = await replayTimedDevelopmentObservation(bundle);
    expect(result.semantics.pinnedCheckpoint.number).toBe(String(pinned));
    expect(result.semantics.lastValidatedHead.number).toBe(String(pinned + 2));
    expect(result.observation.transfer.checkpointNumber).toBe(String(pinned));
    const path = result.semantics.blocks.filter(block => block.number !== "0");
    expect(path.map(block => block.number)).toEqual(Array.from({ length: pinned + 3 - fixture.containingHeight }, (_, index) => String(fixture.containingHeight + index)));
    for (let index = 1; index < path.length; index++) expect(path[index].parentHash).toBe(path[index - 1].hash);
  });

  it("rejects an altered outer digest before accepting an observation", async () => {
    const bundle = clone(await capture()); bundle.timedObservationSha256 = "0".repeat(64);
    await rejected(bundle, "REPLAY_MISMATCH");
  });

  it.each(["rpc response ID", "rpc ordinal", "rpc session", "source", "operation", "args", "request whitespace", "request extra field", "response extra field"])(
    "rejects rewritten checksums with a changed %s", async mutation => {
      const bundle = clone(await capture()), read = bundle.observation.reads[0];
      const request = row(JSON.parse(read.requestBody));
      if (mutation === "rpc response ID") alterResponse(bundle, 0, value => { value.id = "other-request"; });
      if (mutation === "rpc ordinal") {
        request.id = String(request.id).replace(/-1$/, "-2");
        read.requestBody = JSON.stringify(request); alterResponse(bundle, 0, value => { value.id = request.id; });
      }
      if (mutation === "rpc session") {
        const second = bundle.observation.reads[1], changed = row(JSON.parse(second.requestBody));
        changed.id = String(changed.id).replace(/^aw-./, String(changed.id)[3] === "0" ? "aw-1" : "aw-0");
        second.requestBody = JSON.stringify(changed); alterResponse(bundle, 1, value => { value.id = changed.id; });
      }
      if (mutation === "source") read.sourceId = bundle.observation.finalitySourceId;
      if (mutation === "operation") read.operation = "eth_blockNumber";
      if (mutation === "args") { request.params = ["latest"]; read.requestBody = JSON.stringify(request); }
      if (mutation === "request whitespace") read.requestBody += " ";
      if (mutation === "request extra field") read.requestBody = JSON.stringify({ ...request, extra: true });
      if (mutation === "response extra field") alterResponse(bundle, 0, value => { value.extra = true; });
      await rejected(rehash(bundle));
    });

  it.each(["duplicate", "escaped duplicate", "BOM", "malformed", "provider error"])("rejects original native JSON %s even with all digests rewritten", async mutation => {
    const bundle = clone(await capture()), read = bundle.observation.reads[0];
    if (mutation === "duplicate") read.responseBody = read.responseBody.replace('"result":', '"result":"0x61","result":');
    if (mutation === "escaped duplicate") read.responseBody = read.responseBody.replace('"result":', '"r\\u0065sult":"0x61","result":');
    if (mutation === "BOM") read.responseBody = `\ufeff${read.responseBody}`;
    if (mutation === "malformed") read.responseBody += "x";
    if (mutation === "provider error") read.responseBody = JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(read.requestBody).id, error: { code: -1 } });
    await rejected(rehash(bundle), "INVALID_RESPONSE");
  });

  it.each(["bsc", "tron"] as const)("reruns %s transfer validation instead of trusting a rehashed claimed transfer", async family => {
    const bundle = clone(await capture(family));
    bundle.observation.transfer.amountRaw = "1";
    await rejected(rehash(bundle), "REPLAY_MISMATCH");
    const altered = clone(await capture(family));
    const index = altered.observation.reads.findIndex(read => read.operation.includes(family === "bsc" ? "Receipt" : "transactioninfobyid"));
    alterResponse(altered, index, envelope => {
      const receipt = family === "bsc" ? row(envelope.result) : envelope;
      const logs = (family === "bsc" ? receipt.logs : receipt.log) as Row[];
      logs[1].data = `${family === "bsc" ? "0x" : ""}${"0".repeat(63)}1`;
    });
    await rejected(rehash(altered), "INVALID_EVIDENCE");
  });

  it.each(["1.00000000000000001", "1e0", "-0", "9007199254740993", "1e400"])("rejects TRON numeric literal %s before rounded parsing can hide it", async numeric => {
    const bundle = clone(await capture("tron"));
    const read = bundle.observation.reads.find(read => read.operation.includes("transactioninfobyid"))!;
    read.responseBody = read.responseBody.replace('"fee":100', `"fee":${numeric}`);
    await rejected(rehash(bundle), "INVALID_EVIDENCE");
  });

  it.each(["path", "visible", "extra request", "error response"])("rejects rewritten TRON %s", async mutation => {
    const bundle = clone(await capture("tron")), read = bundle.observation.reads[0];
    if (mutation === "path") read.operation = "/wallet/getnowblock";
    if (mutation === "visible") read.requestBody = '{"num":0,"visible":true}';
    if (mutation === "extra request") read.requestBody = '{"num":0,"visible":false,"extra":1}';
    if (mutation === "error response") alterResponse(bundle, 0, value => { value.Error = "private-provider-detail"; });
    await rejected(rehash(bundle));
  });

  it.each(["omit read", "extra read", "reorder reads", "omit clock", "extra clock", "move clock"])("consumes exact observer order and refuses %s", async mutation => {
    const bundle = clone(await capture());
    if (mutation === "omit read") { bundle.observation.reads.pop(); bundle.timing.reads.pop(); }
    if (mutation === "extra read") { bundle.observation.reads.push(clone(bundle.observation.reads.at(-1)!)); bundle.timing.reads.push({ ...bundle.timing.reads.at(-1)!, ordinal: bundle.timing.reads.length + 1 }); }
    if (mutation === "reorder reads") [bundle.observation.reads[0], bundle.observation.reads[1]] = [bundle.observation.reads[1], bundle.observation.reads[0]];
    if (mutation === "omit clock") bundle.timing.semanticClocks.pop();
    if (mutation === "extra clock") bundle.timing.semanticClocks.push(clone(bundle.timing.semanticClocks.at(-1)!));
    if (mutation === "move clock") bundle.timing.semanticClocks[0].afterRead -= 1;
    await rejected(rehash(bundle), "REPLAY_MISMATCH");
  });

  it.each(["completion outside read", "overlap", "elapsed mismatch", "clock outside interval", "wall session limit", "monotonic session limit", "read limit"])(
    "refuses inconsistent timing: %s", async mutation => {
      const bundle = clone(await capture()), timing = bundle.timing, first = timing.reads[0];
      if (mutation === "completion outside read") bundle.observation.reads[0].completedAtMs = first.returnedAtMs + 1;
      if (mutation === "overlap") timing.reads[1].startedElapsedUs = 0;
      if (mutation === "elapsed mismatch") first.elapsedUs = first.returnedElapsedUs - first.startedElapsedUs + 2;
      if (mutation === "clock outside interval") timing.semanticClocks[0].elapsedUs = timing.elapsedUs + 1;
      if (mutation === "wall session limit") timing.returnedAtMs = timing.startedAtMs + 30_000;
      if (mutation === "monotonic session limit") timing.elapsedUs = 30_000_000;
      if (mutation === "read limit") {
        const delta = 5_000_000 - first.elapsedUs;
        first.elapsedUs += delta; first.returnedElapsedUs += delta;
        for (let index = 1; index < timing.reads.length; index++) { timing.reads[index].startedElapsedUs += delta; timing.reads[index].returnedElapsedUs += delta; }
        for (const sample of timing.semanticClocks) sample.elapsedUs += delta;
        timing.elapsedUs += delta;
      }
      await rejected(rehash(bundle), mutation.includes("limit") ? "TIMEOUT" : "REPLAY_MISMATCH");
    });

  it("keeps TRON complete ordered logs while normalizing only the established receipt semantics", async () => {
    const fixture = createDepositObservationFixture("tron");
    fixture.mutateResponse = (value, read) => { if (read.operation.includes("transactioninfobyid")) {
      row(value).fee = read.ordinal; row(row(value).receipt).energy_usage_total = read.ordinal;
    } };
    const result = await replayTimedDevelopmentObservation(await captureTimedDevelopmentObservation(input(fixture)));
    expect(result.semantics.receiptSemantics.logs).toHaveLength(2);
    expect(result.semantics.receiptSemantics).not.toHaveProperty("fee");
    expect(result.semantics.receiptSemantics).not.toHaveProperty("energy_usage_total");
    expect(result.semantics.transfer.eventIndex).toBe("1");
    expect(result.semantics.containingBlock.header).toHaveProperty("raw_data.version", 32);
  });

  it("preserves the maximum uint64 BSC height and uint256 transfer without Number conversion", async () => {
    const amount = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString(), height = ((BigInt(1) << BigInt(64)) - BigInt(1)).toString();
    const fixture = createDepositObservationFixture("bsc", { amountRaw: amount });
    const hex = `0x${BigInt(height).toString(16)}`, hash = `0x${"bb".repeat(32)}`;
    const nativeFetch = async (url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)); let result: unknown;
      if (request.method === "eth_chainId") result = "0x61";
      else if (request.method === "eth_getTransactionReceipt") {
        const receipt = fixture.receipt(); receipt.blockNumber = hex; receipt.blockHash = hash;
        for (const log of receipt.logs as Row[]) { log.blockNumber = hex; log.blockHash = hash; }
        result = receipt;
      } else if (request.params[0] === "0x0") result = fixture.blockAt(0);
      else { const block = fixture.blockAt(fixture.containingHeight); block.number = hex; block.hash = hash; result = block; }
      const response = new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json" } });
      Object.defineProperty(response, "url", { value: url }); return response;
    };
    const result = await replayTimedDevelopmentObservation(await captureTimedDevelopmentObservation({ ...input(fixture), fetch: nativeFetch }));
    expect(result.semantics.containingBlock.number).toBe(height);
    expect(result.semantics.lastValidatedHead.number).toBe(height);
    expect(result.semantics.transfer.amountRaw).toBe(amount);
  });

  it("captures inert options and refuses new transports, overrides, getters, proxies and hidden fields", async () => {
    const fixture = createDepositObservationFixture("bsc"), run = vi.fn(fixture.fetch), options = { ...input(fixture), fetch: run };
    for (const extra of [{ transport: {} }, { timeoutMs: 10_000 }, { maxResponseBytes: 1 }, { maxReads: 1 }])
      await expect(captureTimedDevelopmentObservation({ ...options, ...extra } as TimedDevelopmentObservationInput)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const getter = vi.fn(() => fixture.context), accessor = { ...options };
    Object.defineProperty(accessor, "context", { enumerable: true, get: getter });
    await expect(captureTimedDevelopmentObservation(accessor)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const trap = vi.fn();
    await expect(captureTimedDevelopmentObservation(new Proxy(options, { get: trap }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const key of ["fetch", "clock"] as const) {
      const capability = new Proxy(() => undefined, { apply: trap });
      await expect(captureTimedDevelopmentObservation({ ...options, [key]: capability } as TimedDevelopmentObservationInput))
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const identity = new Proxy({}, { get: trap });
    await expect(captureTimedDevelopmentObservation({ ...options, executionSourceId: identity } as unknown as TimedDevelopmentObservationInput))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    const hidden = { ...options }; Object.defineProperty(hidden, "unexpected", { value: true });
    await expect(captureTimedDevelopmentObservation(hidden)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(run).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });

  it("pins caller context, source configuration and policy before awaited IO", async () => {
    const fixture = createDepositObservationFixture("bsc"), policy = { maxAncestry: 64 }, expected = clone(fixture.context);
    fixture.mutateResponse = (_, read) => { if (read.ordinal === 1) {
      fixture.context.amountRaw = "1"; fixture.sources[1].endpoint = "https://altered.invalid"; policy.maxAncestry = 0;
    } };
    const bundle = await captureTimedDevelopmentObservation({ ...input(fixture), policy });
    expect(bundle.context).toEqual(expected); expect(bundle.policy.maxAncestry).toBe(64);
    await expect(replayTimedDevelopmentObservation(bundle)).resolves.toHaveProperty("observation.transfer.amountRaw", expected.amountRaw);
  });

  it.each(["production", "VERCEL", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])("refuses %s before untrusted capture or replay data is inspected", async setting => {
    vi.stubEnv(setting === "production" ? "NODE_ENV" : setting, setting === "production" ? setting : "1");
    const trap = vi.fn(), hostile = new Proxy({}, { get: trap, ownKeys: trap });
    await rejected(hostile, "RUNTIME_REFUSED");
    await expect(captureTimedDevelopmentObservation(hostile as TimedDevelopmentObservationInput)).rejects.toMatchObject({ code: "RUNTIME_REFUSED" });
    expect(trap).not.toHaveBeenCalled();
  });

  it.each(["fetch", "clock"])("rechecks runtime changes made by the injected %s", async phase => {
    const fixture = createDepositObservationFixture("bsc"), options = input(fixture);
    if (phase === "fetch") fixture.mutateResponse = () => { vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1"); };
    else options.clock = () => { vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "1"); return fixture.now; };
    await expect(captureTimedDevelopmentObservation(options)).rejects.toMatchObject({ code: "RUNTIME_REFUSED", creditAuthority: false });
  });

  it.each(["backwards", "fraction", "negative zero", "unsafe", "throw"])("refuses %s injected clocks without leaking callback errors", async failure => {
    const fixture = createDepositObservationFixture("bsc"); let calls = 0;
    const clock = () => {
      calls += 1;
      if (failure === "throw") throw new Error("private-clock-credential");
      if (failure === "fraction") return fixture.now + 0.5;
      if (failure === "negative zero") return -0;
      if (failure === "unsafe") return Number.MAX_SAFE_INTEGER + 1;
      return fixture.now - calls;
    };
    await expect(captureTimedDevelopmentObservation({ ...input(fixture), clock })).rejects.toMatchObject({ code: "RUNTIME_REFUSED", creditAuthority: false });
    await expect(captureTimedDevelopmentObservation({ ...input(fixture), clock })).rejects.not.toThrow("private-clock-credential");
  });

  it.each(["read", "session"])("enforces the real monotonic %s deadline with a fixed wall clock", async phase => {
    let mono = 100; vi.spyOn(performance, "now").mockImplementation(() => mono);
    const fixture = createDepositObservationFixture("bsc");
    fixture.mutateResponse = () => { mono += phase === "read" ? 5000 : 1500; };
    await expect(captureTimedDevelopmentObservation(input(fixture))).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("charges raw requests and raw responses against one 16 MiB session budget", async () => {
    const fixture = createDepositObservationFixture("bsc"), rawResponseBytes = Math.floor(16 * 1_048_576 / 20);
    fixture.mutateResponse = (value, read) => {
      const raw = JSON.stringify({ jsonrpc: "2.0", id: read.request.id, result: value });
      const response = new Response(raw + " ".repeat(rawResponseBytes - Buffer.byteLength(raw)), { headers: { "content-type": "application/json" } });
      Object.defineProperty(response, "url", { value: read.url }); return response;
    };
    await expect(captureTimedDevelopmentObservation(input(fixture))).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    expect(fixture.calls).toHaveLength(20);
  });

  it("refuses oversized strings, excess reads, clocks and unknown envelope fields before native replay", async () => {
    const baseline = await capture();
    const raw = clone(baseline); raw.observation.reads[0].responseBody = " ".repeat(1_048_577);
    await rejected(raw, "RESOURCE_LIMIT");
    const reads = clone(baseline); reads.observation.reads = Array.from({ length: 161 }, () => clone(reads.observation.reads[0]));
    await rejected(reads, "INVALID_INPUT");
    const clocks = clone(baseline); clocks.timing.semanticClocks = Array.from({ length: 9 }, () => clone(clocks.timing.semanticClocks[0]));
    await rejected(clocks, "INVALID_INPUT");
    await rejected({ ...baseline, authority: true }, "INVALID_INPUT");
  });
});
