// @vitest-environment node

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDevelopmentNodeTransport,
  NodeObservationError,
  observationDigest,
  type DevelopmentNodeSource,
  type DevelopmentNodeTransportOptions,
  type NodeObservationErrorCode,
  type NodeObservationSession,
} from "./chain-observer-rpc";
import {
  captureObservationContext,
  captureObservationPolicy,
  captureObserverInput,
  checkCheckpointFreshness,
  safeObservationVerification,
} from "./chain-observer-common";

const NOW = 1_794_000_000_000;
const TX = `0x${"ab".repeat(32)}`;
const TRON_TX = "ab".repeat(32);
const MAX_RESPONSE = 1_048_576;
const runtimeFlags = [
  "VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
  "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED",
] as const;
type Row = Record<string, unknown>;
type Handler = (url: string, body: Row, init: RequestInit) => Response | Promise<Response>;

function sources(): DevelopmentNodeSource[] {
  return [
    { id: "execution", independenceGroup: "operator-a", endpoint: "https://execution.fixture.invalid/rpc" },
    { id: "finality", independenceGroup: "operator-b", endpoint: "https://finality.fixture.invalid/api" },
  ];
}

function atUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function response(url: string, body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return atUrl(new Response(body, { ...init, headers }), url);
}

function rpc(url: string, request: Row, result: unknown = "0x61"): Response {
  return response(url, JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
}

function fixture(handler: Handler = (url, body) => rpc(url, body), overrides: Partial<DevelopmentNodeTransportOptions> = {}) {
  const fetch = vi.fn<DevelopmentNodeTransportOptions["fetch"]>(async (url, init) =>
    handler(url, JSON.parse(String(init.body)) as Row, init));
  const transport = createDevelopmentNodeTransport({
    mode: "simulation-only", sources: sources(), fetch, clock: () => NOW, ...overrides,
  });
  return { fetch, transport, session: transport.openSession("execution", "finality") };
}

function codeOf(work: () => unknown, code: NodeObservationErrorCode): NodeObservationError {
  let error: unknown;
  try { work(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(NodeObservationError);
  expect(error).toMatchObject({ code, creditAuthority: false });
  return error as NodeObservationError;
}

async function rejection(promise: Promise<unknown>, code: NodeObservationErrorCode): Promise<NodeObservationError> {
  let error: unknown;
  try { await promise; } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(NodeObservationError);
  expect(error).toMatchObject({ code, creditAuthority: false });
  return error as NodeObservationError;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function byteStream(chunks: Uint8Array[], cancel = vi.fn()) {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  return { stream, cancel };
}

function nativeRead(session: NodeObservationSession) {
  return session.tron("finality", "/walletsolidity/getnowblock", { visible: false });
}

function context() {
  return {
    mode: "development-fixture",
    chain: { family: "bsc", chainId: "97", genesisHash: `0x${"CD".repeat(32)}` },
    token: `0x${"AB".repeat(20)}`, recipient: `0x${"EF".repeat(20)}`,
    transactionId: `0x${"AB".repeat(32)}`, amountRaw: "42", eventIndex: "0",
  };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const flag of runtimeFlags) vi.stubEnv(flag, undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("explicit development node transport", () => {
  it("preserves the full receipt, ordered duplicate logs, exact transcript bytes and request isolation", async () => {
    const log = { address: `0x${"cd".repeat(20)}`, topics: [TX], data: "0x00", logIndex: "0x0" };
    const receipt = { transactionHash: TX, status: "0x1", logs: [log, log], unrelated: { retained: true } };
    let raw = "";
    const { session, fetch } = fixture((url, body) => {
      raw = ` { "jsonrpc": "2.0", "id": ${JSON.stringify(body.id)}, "result": ${JSON.stringify(receipt)} }\n`;
      return response(url, raw);
    });
    const result = await session.bsc("execution", "eth_getTransactionReceipt", [TX]);
    expect(result).toEqual(receipt);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as typeof receipt).logs)).toBe(true);
    expect(Object.isFrozen((result as typeof receipt).logs[0].topics)).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(sources()[0].endpoint);
    expect(init).toMatchObject({
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const reads = session.finish();
    expect(reads).toEqual([{
      sourceId: "execution", protocol: "bsc-json-rpc", operation: "eth_getTransactionReceipt",
      requestBody: init.body, responseBody: raw,
      responseSha256: createHash("sha256").update(raw).digest("hex"), completedAtMs: NOW,
    }]);
    expect(JSON.stringify(reads)).not.toContain("fixture.invalid");
    expect(Object.isFrozen(reads)).toBe(true);
    expect(Object.isFrozen(reads[0])).toBe(true);
    expect(() => { (reads[0] as { sourceId: string }).sourceId = "other"; }).toThrow(TypeError);
    codeOf(() => session.finish(), "SESSION_CLOSED");
    await rejection(session.bsc("execution", "eth_chainId", []), "SESSION_CLOSED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("admits the three BSC reads, canonicalizes values, and binds each response to a unique request ID", async () => {
    const { session, fetch } = fixture();
    await session.bsc("execution", "eth_chainId", []);
    await session.bsc("execution", "eth_getTransactionReceipt", [`0x${"AB".repeat(32)}`]);
    await session.bsc("finality", "eth_getBlockByNumber", ["0xAB", false]);
    await session.bsc("finality", "eth_getBlockByNumber", ["finalized", false]);
    const requests = fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as Row);
    expect(new Set(requests.map(item => item.id)).size).toBe(4);
    expect(requests[1].params).toEqual([TX]);
    expect(requests[2].params).toEqual(["0xab", false]);
    expect(session.finish()).toHaveLength(4);
  });

  it.each([
    ["/wallet/getblockbynum", { num: 17, visible: false }],
    ["/walletsolidity/getblockbynum", { num: 17, visible: false }],
    ["/wallet/gettransactioninfobyid", { value: TRON_TX, visible: false }],
    ["/walletsolidity/gettransactioninfobyid", { value: TRON_TX, visible: false }],
    ["/walletsolidity/getnowblock", { visible: false }],
  ])("preserves native TRON evidence for %s", async (path, body) => {
    const evidence = { id: TRON_TX, blockNumber: 17, receipt: { result: "SUCCESS" }, log: [{ data: "00" }, { data: "00" }] };
    const { session, fetch } = fixture(url => response(url, JSON.stringify(evidence)));
    expect(await session.tron("finality", path as string, body)).toEqual(evidence);
    expect(fetch.mock.calls[0][0]).toBe(`${sources()[1].endpoint}${path}`);
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual(body);
    expect(session.finish()[0]).toMatchObject({ protocol: "tron-http", operation: path });
  });

  it("serializes captured schema data without executing hidden caller toJSON methods", async () => {
    const poison = vi.fn(() => ({ method: "eth_sendRawTransaction", privateKey: "secret" }));
    const params = [TX];
    const body = { value: TRON_TX.toUpperCase(), visible: false };
    Object.defineProperty(params, "toJSON", { value: poison });
    Object.defineProperty(body, "toJSON", { value: poison });
    const { session, fetch } = fixture((url, request) => request.jsonrpc ? rpc(url, request) : response(url, "{}"));
    await session.bsc("execution", "eth_getTransactionReceipt", params);
    await session.tron("finality", "/walletsolidity/gettransactioninfobyid", body);
    expect(poison).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).params).toEqual([TX]);
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ value: TRON_TX, visible: false });
    session.finish();
  });

  it("captures configuration so later endpoint, operator, clock, and fetch mutations cannot redirect a session", async () => {
    const configuredSources = sources();
    const fetch = vi.fn<DevelopmentNodeTransportOptions["fetch"]>(async (url, init) => rpc(url, JSON.parse(String(init.body))));
    const poison = vi.fn<DevelopmentNodeTransportOptions["fetch"]>(async () => { throw new Error("must not run"); });
    const options: DevelopmentNodeTransportOptions = { mode: "simulation-only", sources: configuredSources, fetch, clock: () => NOW };
    const transport = createDevelopmentNodeTransport(options);
    configuredSources[0].endpoint = "https://other.fixture.invalid/";
    configuredSources[1].independenceGroup = "operator-a";
    options.fetch = poison;
    options.clock = () => -1;
    const session = transport.openSession("execution", "finality");
    await session.bsc("execution", "eth_chainId", []);
    expect(fetch.mock.calls[0][0]).toBe(sources()[0].endpoint);
    expect(poison).not.toHaveBeenCalled();
    expect(session.startedAtMs).toBe(NOW);
    session.finish();
  });
});

describe("closed read operations and failure latching", () => {
  it.each([
    ["eth_sendRawTransaction", [TX]], ["eth_sendTransaction", [{}]], ["eth_sign", [TX]],
    ["personal_sign", [TX]], ["eth_call", [{}]], ["batch", []],
    ["eth_chainId", [1]], ["eth_getTransactionReceipt", []],
    ["eth_getBlockByNumber", ["latest", false]], ["eth_getBlockByNumber", ["safe", false]],
    ["eth_getBlockByNumber", ["pending", false]], ["eth_getBlockByNumber", ["0x00", false]],
    ["eth_getBlockByNumber", ["0x1", true]],
  ])("refuses BSC operation/parameters %s %j before IO and closes the session", async (method, params) => {
    const { session, fetch } = fixture();
    await rejection(session.bsc("execution", method as string, params), "INVALID_INPUT");
    await rejection(session.bsc("execution", "eth_chainId", []), "SESSION_CLOSED");
    codeOf(() => session.now(), "SESSION_CLOSED");
    codeOf(() => session.finish(), "SESSION_CLOSED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/wallet/broadcasttransaction", {}], ["/wallet/gettransactionsign", {}],
    ["/wallet/triggersmartcontract", {}], ["/walletsolidity/getnowblock?x=1", { visible: false }],
    ["/wallet/../walletsolidity/getnowblock", { visible: false }],
    ["/wallet/getblockbynum", { num: -0, visible: false }],
    ["/wallet/getblockbynum", { num: 1.5, visible: false }],
    ["/wallet/getblockbynum", { num: Number.MAX_SAFE_INTEGER + 1, visible: false }],
    ["/wallet/getblockbynum", { num: "1", visible: false }],
    ["/wallet/getblockbynum", { num: 1, visible: true }],
    ["/wallet/gettransactioninfobyid", { value: TRON_TX, visible: false, privateKey: "secret" }],
  ])("refuses TRON operation/parameters %s %j before IO", async (path, body) => {
    const { session, fetch } = fixture();
    await rejection(session.tron("execution", path as string, body), "INVALID_INPUT");
    codeOf(() => session.finish(), "SESSION_CLOSED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not admit an otherwise configured third source into an existing source pair", async () => {
    const { session, fetch } = fixture(undefined, { sources: [...sources(), {
      id: "third", independenceGroup: "operator-c", endpoint: "https://third.fixture.invalid/",
    }] });
    await rejection(session.bsc("third", "eth_chainId", []), "INVALID_INPUT");
    expect(fetch).not.toHaveBeenCalled();
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("holds the serial guard during input getters, closing both reentrant reads before either fetch", async () => {
    const { session, fetch } = fixture();
    let nested: Promise<unknown> | undefined;
    const params = [TX];
    Object.defineProperty(params, "0", { get() {
      nested = session.bsc("finality", "eth_chainId", []);
      return TX;
    } });
    const outer = session.bsc("execution", "eth_getTransactionReceipt", params);
    expect(nested).toBeDefined();
    const outcomes = await Promise.allSettled([outer, nested!]);
    expect(outcomes).toEqual([
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ code: "SESSION_CLOSED", creditAuthority: false }) }),
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ code: "INVALID_INPUT", creditAuthority: false }) }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("latches a seal attempt from an input getter even when the getter catches its own failure", async () => {
    const { session, fetch } = fixture();
    const params = [TX];
    Object.defineProperty(params, "0", { get() {
      codeOf(() => session.finish(), "INVALID_INPUT");
      return TX;
    } });
    await rejection(session.bsc("execution", "eth_getTransactionReceipt", params), "SESSION_CLOSED");
    expect(fetch).not.toHaveBeenCalled();
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("rejects concurrent reads, aborts the outstanding request, and cannot seal its late result", async () => {
    const pending = deferred<Response>();
    const { session, fetch } = fixture(() => pending.promise);
    const first = session.bsc("execution", "eth_chainId", []);
    const firstError = rejection(first, "SESSION_CLOSED");
    await rejection(session.bsc("finality", "eth_chainId", []), "INVALID_INPUT");
    const [url, init] = fetch.mock.calls[0];
    expect(init.signal?.aborted).toBe(true);
    pending.resolve(rpc(url, JSON.parse(String(init.body))));
    await firstError;
    expect(fetch).toHaveBeenCalledTimes(1);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("an empty seal attempt permanently closes a session", async () => {
    const { session, fetch } = fixture();
    codeOf(() => session.finish(), "INVALID_INPUT");
    await rejection(session.bsc("execution", "eth_chainId", []), "SESSION_CLOSED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechecks closure after an injected clock attempts to seal during a later read", async () => {
    let action: (() => void) | undefined;
    const { session, fetch } = fixture(undefined, { clock: () => { const next = action; action = undefined; next?.(); return NOW; } });
    await session.bsc("execution", "eth_chainId", []);
    action = () => { codeOf(() => session.finish(), "INVALID_INPUT"); };
    await rejection(session.bsc("finality", "eth_chainId", []), "SESSION_CLOSED");
    expect(fetch).toHaveBeenCalledTimes(1);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("rechecks runtime after an injected clock enables signing and retains the failure after restoration", async () => {
    let enable = false;
    const { session, fetch } = fixture(undefined, { clock: () => {
      if (enable) vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true");
      return NOW;
    } });
    enable = true;
    await rejection(session.bsc("execution", "eth_chainId", []), "RUNTIME_REFUSED");
    vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", undefined);
    expect(fetch).not.toHaveBeenCalled();
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });
});

describe("response identity, JSON and native numeric evidence", () => {
  it.each([
    ["numeric ID", (id: unknown) => ({ jsonrpc: "2.0", id: 1, result: id })],
    ["null ID", () => ({ jsonrpc: "2.0", id: null, result: {} })],
    ["missing ID", () => ({ jsonrpc: "2.0", result: {} })],
    ["different ID", () => ({ jsonrpc: "2.0", id: "another-session", result: {} })],
    ["wrong version", (id: unknown) => ({ jsonrpc: "1.0", id, result: {} })],
    ["both result and error", (id: unknown) => ({ jsonrpc: "2.0", id, result: {}, error: {} })],
    ["neither result nor error", (id: unknown) => ({ jsonrpc: "2.0", id })],
    ["extra envelope field", (id: unknown) => ({ jsonrpc: "2.0", id, result: {}, debug: "private" })],
    ["batch response", (id: unknown) => [{ jsonrpc: "2.0", id, result: {} }]],
  ] as const)("rejects JSON-RPC %s", async (_name, make) => {
    const { session, fetch } = fixture((url, body) => response(url, JSON.stringify(make(body.id))));
    await rejection(session.bsc("execution", "eth_chainId", []), "INVALID_RESPONSE");
    codeOf(() => session.finish(), "SESSION_CLOSED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["escaped result", '"result":{},"res\\u0075lt":{}'],
    ["nested escaped key", '"result":{"status":1,"st\\u0061tus":1}'],
    ["duplicate inside array", '"result":{"logs":[{"x":1,"x":2}]}'],
  ])("rejects ambiguous duplicate JSON keys: %s", async (_name, fields) => {
    const { session } = fixture((url, body) => response(url, `{"jsonrpc":"2.0","id":${JSON.stringify(body.id)},${fields}}`));
    await rejection(session.bsc("execution", "eth_chainId", []), "INVALID_RESPONSE");
  });

  it.each(["{", "{} trailing", "[", '{"n":NaN}', '{"x":1,}'])("rejects invalid JSON bytes %s", async raw => {
    const { session } = fixture(url => response(url, raw));
    await rejection(nativeRead(session), "INVALID_RESPONSE");
  });

  it.each(["null", "[]", '"text"', "false", '{"Error":"provider detail"}', '{"error":{}}', '{"code":"FAIL"}'])
  ("rejects native TRON failure/nonobject payload %s", async raw => {
    const { session } = fixture(url => response(url, raw));
    await rejection(nativeRead(session), "INVALID_RESPONSE");
  });

  it.each(["1.0000000000000001", "9007199254740991.1", "1e3", "1e-9999", "9007199254740992", "-9007199254740992", "-0"])
  ("checks original TRON numeric token %s before accepting rounded JSON numbers", async token => {
    const { session } = fixture(url => response(url, `{"nested":{"items":[{"number":${token}}]}}`));
    await rejection(nativeRead(session), "INVALID_EVIDENCE");
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("accepts exact native integer bounds and does not reinterpret digits inside escaped strings", async () => {
    const evidence = { zero: 0, low: -Number.MAX_SAFE_INTEGER, high: Number.MAX_SAFE_INTEGER,
      text: '1.0000000000000001 1e3 -0 9007199254740992 "quoted" \\123', "1e3": "-0" };
    const { session } = fixture(url => response(url, JSON.stringify(evidence)));
    expect(await nativeRead(session)).toEqual(evidence);
    expect(session.finish()).toHaveLength(1);
  });

  it.each([
    ["service error", (url: string) => response(url, "{}", { status: 503 })],
    ["redirect status", (url: string) => response(url, "{}", { status: 302 })],
    ["empty status", (url: string) => response(url, null, { status: 204 })],
    ["HTML", (url: string) => response(url, "{}", { headers: { "content-type": "text/html" } })],
    ["wrong charset", (url: string) => response(url, "{}", { headers: { "content-type": "application/json; charset=latin1" } })],
    ["missing content type", (url: string) => atUrl(new Response(new Uint8Array([123, 125])), url)],
    ["wrong endpoint", () => response("https://other.fixture.invalid/", "{}")],
    ["redirected response", (url: string) => {
      const result = response(url, "{}"); Object.defineProperty(result, "redirected", { value: true }); return result;
    }],
    ["non-Response", () => ({ status: 200, url: sources()[0].endpoint } as Response)],
  ] as const)("rejects response transport mismatch: %s", async (_name, make) => {
    const { session } = fixture(url => make(url));
    await rejection(nativeRead(session), "INVALID_RESPONSE");
  });

  it.each(["fetch", "rpc", "tron"] as const)("scrubs %s provider details and does not retry or seal after failure", async kind => {
    const secret = "https://user:super-secret@node.fixture.invalid/private?api-key=hidden";
    const { session, fetch } = fixture((url, body) => {
      if (kind === "fetch") throw new Error(`provider failure ${secret}`);
      if (kind === "rpc") return response(url, JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: secret } }));
      return response(url, JSON.stringify({ Error: secret }));
    });
    const error = await rejection(kind === "tron" ? nativeRead(session) : session.bsc("execution", "eth_chainId", []),
      kind === "fetch" ? "TRANSPORT" : "INVALID_RESPONSE");
    expect(`${String(error)} ${JSON.stringify(error)} ${error.stack}`).not.toMatch(/super-secret|api-key|hidden|node\.fixture\.invalid/);
    await rejection(session.bsc("execution", "eth_chainId", []), "SESSION_CLOSED");
    codeOf(() => session.finish(), "SESSION_CLOSED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("streamed byte bounds and complete response deadlines", () => {
  it("counts UTF-8 bytes without Content-Length and accepts the exact bound", async () => {
    const raw = '{"text":"€"}';
    const encoded = new TextEncoder().encode(raw);
    expect(encoded.length).toBeGreaterThan(raw.length);
    const exact = fixture(url => response(url, byteStream([encoded.subarray(0, 10), encoded.subarray(10)]).stream), { maxResponseBytes: encoded.length });
    expect(await nativeRead(exact.session)).toEqual({ text: "€" });
    exact.session.finish();
    const tooSmall = fixture(url => response(url, byteStream([encoded]).stream), { maxResponseBytes: encoded.length - 1 });
    await rejection(nativeRead(tooSmall.session), "RESOURCE_LIMIT");
  });

  it("rejects and cancels an oversized stream before reading its later chunks", async () => {
    const chunk = new TextEncoder().encode("0123456789");
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(chunk); }, cancel,
    }, { highWaterMark: 0 });
    const { session } = fixture(url => response(url, stream), { maxResponseBytes: 15 });
    await rejection(nativeRead(session), "RESOURCE_LIMIT");
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformed UTF-8", new Uint8Array([123, 34, 120, 34, 58, 34, 0xc0, 0xaf, 34, 125])],
    ["truncated UTF-8", new Uint8Array([123, 34, 120, 34, 58, 34, 0xe2, 0x82])],
    ["UTF-8 BOM", new Uint8Array([0xef, 0xbb, 0xbf, 123, 125])],
  ])("rejects %s as a typed response failure", async (_name, encoded) => {
    const { session } = fixture(url => response(url, byteStream([encoded as Uint8Array]).stream));
    await rejection(nativeRead(session), "INVALID_RESPONSE");
  });

  it("rejects a non-final empty chunk and cancels instead of spinning without a byte charge", async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(0)); }, cancel,
    }, { highWaterMark: 0 });
    const { session } = fixture(url => response(url, stream));
    await rejection(nativeRead(session), "INVALID_RESPONSE");
    expect(pulls).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it.each([
    ["status", { status: 503 }, "INVALID_RESPONSE"],
    ["content type", { headers: { "content-type": "text/plain" } }, "INVALID_RESPONSE"],
    ["declared bytes", { headers: { "content-length": "1048577" } }, "RESOURCE_LIMIT"],
  ] as const)("cancels an unread stream rejected on %s", async (_name, init, code) => {
    const { stream, cancel } = byteStream([new TextEncoder().encode("{}")]);
    const { session } = fixture(url => response(url, stream, init));
    await rejection(nativeRead(session), code);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("bounds Content-Length before BigInt conversion and cancels the unread body", async () => {
    const longLength = "9".repeat(100_000);
    const bigint = vi.spyOn(globalThis, "BigInt");
    const { stream, cancel } = byteStream([new TextEncoder().encode("{}")]);
    const { session } = fixture(url => response(url, stream, { headers: { "content-length": longLength } }));
    await rejection(nativeRead(session), "RESOURCE_LIMIT");
    expect(bigint.mock.calls.some(([value]) => value === longLength)).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("times out a fetch that ignores abort and cancels its response when it eventually arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(100);
    const pending = deferred<Response>();
    const { session, fetch } = fixture(() => pending.promise, { timeoutMs: 10 });
    const result = rejection(nativeRead(session), "TIMEOUT");
    await vi.advanceTimersByTimeAsync(10);
    await result;
    const [url, init] = fetch.mock.calls[0];
    expect(init.signal?.aborted).toBe(true);
    const { stream, cancel } = byteStream([new TextEncoder().encode("{}")]);
    pending.resolve(response(url, stream));
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("keeps the timeout active while a streamed body stalls after its first chunk", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(100);
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('{"n":')); }, cancel,
    }, { highWaterMark: 0 });
    const { session, fetch } = fixture(url => response(url, stream), { timeoutMs: 10 });
    const result = rejection(nativeRead(session), "TIMEOUT");
    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it.each(["fetch", "body"] as const)("enforces the monotonic read deadline after %s before a delayed timer callback runs", async phase => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let mono = 100;
    vi.spyOn(performance, "now").mockImplementation(() => mono);
    const cancel = vi.fn();
    const { session } = fixture(url => {
      if (phase === "fetch") {
        mono += 10;
        return response(url, byteStream([new TextEncoder().encode("{}")], cancel).stream);
      }
      return response(url, new ReadableStream<Uint8Array>({
        pull(controller) { mono += 10; controller.enqueue(new TextEncoder().encode("{}")); }, cancel,
      }, { highWaterMark: 0 }));
    }, { timeoutMs: 10 });
    await rejection(nativeRead(session), "TIMEOUT");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it.each(["read", "seal", "clock"] as const)("enforces the real monotonic session budget with a fixed wall clock at %s", async step => {
    let mono = 100;
    vi.spyOn(performance, "now").mockImplementation(() => mono);
    const { session, fetch } = fixture();
    await session.bsc("execution", "eth_chainId", []);
    mono += 30_000;
    if (step === "read") await rejection(session.bsc("execution", "eth_chainId", []), "TIMEOUT");
    else codeOf(() => step === "seal" ? session.finish() : session.now(), "TIMEOUT");
    expect(fetch).toHaveBeenCalledTimes(1);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it.each([-1, 30_000])("latches a wall-clock rollback/session expiry of %i ms", async delta => {
    let wall = NOW;
    const { session, fetch } = fixture(undefined, { clock: () => wall });
    await session.bsc("execution", "eth_chainId", []);
    wall += delta;
    codeOf(() => session.now(), "TIMEOUT");
    wall = NOW;
    codeOf(() => session.finish(), "SESSION_CLOSED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("caps a session at 160 reads and closes it without making read 161", async () => {
    const { session, fetch } = fixture();
    for (let index = 0; index < 160; index += 1) await session.bsc("execution", "eth_chainId", []);
    await rejection(session.bsc("execution", "eth_chainId", []), "RESOURCE_LIMIT");
    expect(fetch).toHaveBeenCalledTimes(160);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });

  it("caps aggregate session bytes even when each response fits its own limit", async () => {
    const raw = JSON.stringify({ padding: "x".repeat(MAX_RESPONSE - 14) });
    expect(new TextEncoder().encode(raw).length).toBe(MAX_RESPONSE);
    const { session, fetch } = fixture(url => response(url, raw));
    for (let index = 0; index < 16; index += 1) await nativeRead(session);
    await rejection(nativeRead(session), "RESOURCE_LIMIT");
    expect(fetch).toHaveBeenCalledTimes(17);
    codeOf(() => session.finish(), "SESSION_CLOSED");
  });
});

describe("configuration, source independence and runtime refusal", () => {
  it.each([
    "http://node.fixture.invalid/", "https://user:password@node.fixture.invalid/",
    "https://node.fixture.invalid/?key=secret", "https://node.fixture.invalid/#fragment",
    "https://127.0.0.1/", "https://[::1]/", "https://localhost/", "https://node.fixture.invalid./",
  ])("rejects unsupported node endpoint %s", endpoint => {
    const configured = sources(); configured[0].endpoint = endpoint;
    codeOf(() => fixture(undefined, { sources: configured }), "INVALID_INPUT");
  });

  it("requires an injected fetch and never substitutes ambient network access", () => {
    const ambient = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ambient IO must never run"));
    codeOf(() => createDevelopmentNodeTransport({ mode: "simulation-only", sources: sources() } as DevelopmentNodeTransportOptions), "INVALID_INPUT");
    expect(ambient).not.toHaveBeenCalled();
  });

  it.each(["duplicate ID", "same host", "same operator"] as const)("requires independent configured sources: %s", conflict => {
    const configured = sources();
    if (conflict === "duplicate ID") configured[1].id = configured[0].id;
    if (conflict === "same host") configured[1].endpoint = "https://EXECUTION.fixture.invalid:8443/other";
    if (conflict === "same operator") configured[1].independenceGroup = configured[0].independenceGroup;
    codeOf(() => fixture(undefined, { sources: configured }), "INVALID_INPUT");
  });

  it("rejects identical or unknown source IDs when opening a session", () => {
    const { transport, fetch } = fixture();
    codeOf(() => transport.openSession("execution", "execution"), "INVALID_INPUT");
    codeOf(() => transport.openSession("execution", "unknown"), "INVALID_INPUT");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { timeoutMs: 0 }, { timeoutMs: 10_001 }, { maxResponseBytes: MAX_RESPONSE + 1 },
    { mode: "production" }, { batch: true },
  ])("rejects options outside configured bounds %j", overrides => {
    codeOf(() => fixture(undefined, overrides as Partial<DevelopmentNodeTransportOptions>), "INVALID_INPUT");
  });

  it.each(["production", "unknown"])("refuses NODE_ENV=%s", env => {
    vi.stubEnv("NODE_ENV", env);
    codeOf(() => fixture(), "RUNTIME_REFUSED");
  });

  it.each(runtimeFlags)("refuses a %s environment on creation and latches a mid-session change", async flag => {
    const { session, fetch } = fixture();
    vi.stubEnv(flag, "true");
    codeOf(() => fixture(), "RUNTIME_REFUSED");
    await rejection(session.bsc("execution", "eth_chainId", []), "RUNTIME_REFUSED");
    vi.stubEnv(flag, undefined);
    codeOf(() => session.finish(), "SESSION_CLOSED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("refuses an inexact injected clock %s", now => {
    codeOf(() => fixture(undefined, { clock: () => now }), "RUNTIME_REFUSED");
  });
});

describe("shared observation input, context and policy capture", () => {
  it("captures and freezes normalized transfer context independently of caller mutation", () => {
    const original = context();
    const captured = captureObservationContext(original, "bsc");
    original.chain.genesisHash = TX;
    original.amountRaw = "999";
    expect(captured.amountRaw).toBe("42");
    expect(captured.token).toBe(`0x${"ab".repeat(20)}`);
    expect(captured.recipient).toBe(`0x${"ef".repeat(20)}`);
    expect(captured.transactionId).toBe(TX);
    expect(captured.chain.genesisHash).toBe(`0x${"cd".repeat(32)}`);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.chain)).toBe(true);
  });

  it("accepts exact uint256 amount and uint64 event index upper bounds", () => {
    const value = { ...context(), amountRaw: ((BigInt(1) << BigInt(256)) - BigInt(1)).toString(),
      eventIndex: ((BigInt(1) << BigInt(64)) - BigInt(1)).toString() };
    expect(captureObservationContext(value, "bsc")).toMatchObject({ amountRaw: value.amountRaw, eventIndex: value.eventIndex });
  });

  it.each([
    ["amountRaw", "0"], ["amountRaw", "01"], ["amountRaw", "1e3"], ["amountRaw", "-1"],
    ["amountRaw", "1.5"], ["amountRaw", 1], ["amountRaw", null], ["amountRaw", {}],
    ["amountRaw", (BigInt(1) << BigInt(256)).toString()],
    ["eventIndex", (BigInt(1) << BigInt(64)).toString()], ["eventIndex", "-0"],
  ])("rejects inexact/out-of-range context %s=%j with a typed error", (key, value) => {
    codeOf(() => captureObservationContext({ ...context(), [key as string]: value }, "bsc"), "INVALID_INPUT");
  });

  it("rejects an overlength decimal before passing it to BigInt", () => {
    const overlength = "9".repeat(79);
    const bigint = vi.spyOn(globalThis, "BigInt");
    codeOf(() => captureObservationContext({ ...context(), amountRaw: overlength }, "bsc"), "INVALID_INPUT");
    expect(bigint.mock.calls.some(([value]) => value === overlength)).toBe(false);
  });

  it("requires matching chain family and captures native TRON addresses/genesis", () => {
    codeOf(() => captureObservationContext(context(), "tron"), "INVALID_INPUT");
    const value = { ...context(), chain: { family: "tron", network: "nile", genesisHash: `0000000000000000${"CD".repeat(24)}` },
      token: `41${"AB".repeat(20)}`, recipient: `41${"EF".repeat(20)}`, transactionId: TRON_TX.toUpperCase() };
    expect(captureObservationContext(value, "tron")).toMatchObject({ token: `41${"ab".repeat(20)}`, transactionId: TRON_TX });
    codeOf(() => captureObservationContext({ ...value, chain: { ...value.chain, genesisHash: TRON_TX } }, "tron"), "INVALID_INPUT");
  });

  it("captures default and maximal policy values without retaining mutable caller objects", () => {
    expect(captureObservationPolicy()).toEqual({ maxAncestry: 64, maxCheckpointAgeMs: 120_000, maxFutureSkewMs: 5_000 });
    const original = { maxAncestry: 0, maxCheckpointAgeMs: 600_000, maxFutureSkewMs: 30_000 };
    const captured = captureObservationPolicy(original);
    original.maxCheckpointAgeMs = 1;
    expect(captured.maxCheckpointAgeMs).toBe(600_000);
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it.each([
    { maxAncestry: 65 }, { maxAncestry: -1 }, { maxAncestry: 0.5 },
    { maxCheckpointAgeMs: 600_001 }, { maxCheckpointAgeMs: 0 },
    { maxFutureSkewMs: 30_001 }, { maxFutureSkewMs: -1 }, { maxFutureSkewMs: "1" },
    { allowStale: true }, null,
  ])("rejects unbounded or malformed policy %j", value => {
    codeOf(() => captureObservationPolicy(value), "INVALID_INPUT");
  });

  it("uses inclusive freshness boundaries and refuses inexact timestamp evidence", () => {
    const policy = captureObservationPolicy();
    expect(() => checkCheckpointFreshness(NOW - 120_000, NOW, policy)).not.toThrow();
    expect(() => checkCheckpointFreshness(NOW + 5_000, NOW, policy)).not.toThrow();
    codeOf(() => checkCheckpointFreshness(NOW - 120_001, NOW, policy), "STALE_CHECKPOINT");
    codeOf(() => checkCheckpointFreshness(NOW + 5_001, NOW, policy), "STALE_CHECKPOINT");
    codeOf(() => checkCheckpointFreshness(1.5, NOW, policy), "INVALID_EVIDENCE");
    codeOf(() => checkCheckpointFreshness(NOW, NaN, policy), "INVALID_EVIDENCE");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["number", 1],
    ["string", "input"],
  ])("rejects nonobject observer input %s as a typed error", (_label, value) => {
    codeOf(() => captureObserverInput(value), "INVALID_INPUT");
  });

  it.each(["mode", "context", "policy", "transport"])("rejects an executable top-level %s getter without invoking it", field => {
    const { transport } = fixture();
    const getter = vi.fn(() => { throw new Error("private endpoint secret"); });
    const value = { mode: "simulation-only", transport, context: context(), executionSourceId: "execution", finalitySourceId: "finality" };
    Object.defineProperty(value, field, { enumerable: true, get: getter });
    const error = codeOf(() => captureObserverInput(value), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
    expect(String(error)).not.toContain("private endpoint secret");
  });

  it("rejects hidden/symbol fields and nonplain observer objects", () => {
    const { transport } = fixture();
    const value = { mode: "simulation-only", transport, context: context(), executionSourceId: "execution", finalitySourceId: "finality" };
    const hidden = { ...value }; Object.defineProperty(hidden, "policy", { value: {} });
    codeOf(() => captureObserverInput(hidden), "INVALID_INPUT");
    codeOf(() => captureObserverInput({ ...value, [Symbol("hidden")]: true }), "INVALID_INPUT");
    codeOf(() => captureObserverInput(Object.assign(Object.create({ inherited: true }), value)), "INVALID_INPUT");
  });

  it("checks runtime before inspecting the injected transport and captures its original method", () => {
    const { session } = fixture();
    const openSession = vi.fn(() => session);
    const transport = { openSession };
    const value = { mode: "simulation-only", transport, context: context(), executionSourceId: "execution", finalitySourceId: "finality" };
    const captured = captureObserverInput(value);
    transport.openSession = vi.fn(() => { throw new Error("replaced"); });
    expect(captured.transport.openSession("execution", "finality")).toBe(session);
    expect(openSession).toHaveBeenCalledWith("execution", "finality");
    expect(openSession.mock.contexts[0]).toBe(transport);
    const getter = vi.fn(() => { throw new Error("transport secret"); });
    const hostile = {}; Object.defineProperty(hostile, "openSession", { get: getter });
    vi.stubEnv("NODE_ENV", "production");
    codeOf(() => captureObserverInput({ ...value, transport: hostile }), "RUNTIME_REFUSED");
    expect(getter).not.toHaveBeenCalled();
  });

  it("scrubs native decoder exceptions while preserving already-typed observation errors", () => {
    const error = codeOf(() => safeObservationVerification(() => { throw new Error("https://secret:credential@node.invalid/"); }), "INVALID_EVIDENCE");
    expect(String(error)).not.toContain("credential");
    const typed = new NodeObservationError("SOURCE_CONFLICT", "sources disagree");
    expect(codeOf(() => safeObservationVerification(() => { throw typed; }), "SOURCE_CONFLICT")).toBe(typed);
    expect(safeObservationVerification(() => 42)).toBe(42);
  });

  it("digests the complete UTF-8 string and serialized object with SHA-256", () => {
    const raw = ' {"receipt":"€","logs":[1,1]}\n';
    expect(observationDigest(raw)).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(observationDigest({ logs: [1, 1] })).toBe(createHash("sha256").update('{"logs":[1,1]}').digest("hex"));
    expect(observationDigest(raw)).not.toBe(observationDigest(raw.trim()));
  });
});
