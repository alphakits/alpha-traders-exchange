// @vitest-environment node

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeObservationError } from "./chain-observer-rpc";
import {
  DepositInboxError, canonicalInboxJson, captureInboxData, captureInboxOptions, depositInboxError,
  digestInboxValue, inboxCheck, inboxRuntime, type DepositInboxErrorCode, type InboxDataLimits,
} from "./deposit-inbox-data";

const runtimeFlags = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
  "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"] as const;
function refused(operation: () => unknown, code: DepositInboxErrorCode = "INVALID_INPUT"): DepositInboxError {
  let caught: unknown;
  try { operation(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(DepositInboxError);
  expect(caught).toMatchObject({ code, creditAuthority: false });
  return caught as DepositInboxError;
}
function assertFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertFrozen(child);
}
function proxyTrap() {
  const trap = vi.fn(() => { throw new Error("private-proxy-message"); });
  return { trap, proxy: new Proxy({}, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap }) };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const flag of runtimeFlags) vi.stubEnv(flag, undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("closed immutable JSON capture", () => {
  it("copies every level, isolates subsequent mutation and freezes ordinary and null-prototype input", () => {
    const original = { array: [{ value: 1 }], nullRecord: Object.assign(Object.create(null), { amountRaw: "9007199254740993" }) };
    const captured = captureInboxData<typeof original>(original);
    expect(captured).toEqual(original); assertFrozen(captured);
    expect(captured).not.toBe(original); expect(captured.array).not.toBe(original.array);
    expect(captured.array[0]).not.toBe(original.array[0]); expect(captured.nullRecord).not.toBe(original.nullRecord);
    original.array[0].value = 2; original.array.push({ value: 3 }); original.nullRecord.amountRaw = "1";
    expect(captured.array).toEqual([{ value: 1 }]); expect(captured.nullRecord.amountRaw).toBe("9007199254740993");
  });

  it("copies shared acyclic references but refuses actual object and array cycles", () => {
    const shared = { value: [1] }, captured = captureInboxData<{ left: typeof shared; right: typeof shared }>({ left: shared, right: shared });
    expect(captured.left).toEqual(captured.right); expect(captured.left).not.toBe(captured.right); assertFrozen(captured);
    const object: Record<string, unknown> = {}; object.loop = object;
    refused(() => captureInboxData(object));
    const array: unknown[] = []; array.push(array);
    refused(() => captureInboxData(array));
    const parent: Record<string, unknown> = { child: {} }; (parent.child as Record<string, unknown>).parent = parent;
    refused(() => captureInboxData(parent));
  });

  it.each(["record", "array", "option"] as const)("rejects a %s getter without reading it", kind => {
    const getter = vi.fn(() => "private-getter-message"), input = kind === "array" ? [0] : {};
    Object.defineProperty(input, kind === "array" ? "0" : "value", { enumerable: true, configurable: true, get: getter });
    const error = refused(() => kind === "option" ? captureInboxOptions(input, ["value"]) : captureInboxData(input));
    expect(getter).not.toHaveBeenCalled(); expect(error.message).not.toContain("private-getter-message");
  });

  it.each(["root", "nested", "options", "limits"] as const)("rejects a %s Proxy without invoking any trap", location => {
    const { trap, proxy } = proxyTrap();
    refused(() => location === "options" ? captureInboxOptions(proxy, ["value"])
      : location === "limits" ? captureInboxData({}, proxy)
      : captureInboxData(location === "nested" ? { value: proxy } : proxy));
    expect(trap).not.toHaveBeenCalled();
  });

  it("refuses a Proxy prototype without inspecting the prototype's properties", () => {
    const { trap, proxy } = proxyTrap(), input = Object.create(proxy);
    refused(() => captureInboxData(input)); refused(() => captureInboxOptions(input, []));
    expect(trap).not.toHaveBeenCalled();
  });

  it.each(["sparse", "extra-key", "symbol", "hidden-index", "subclass", "null-prototype"] as const)("rejects %s arrays", kind => {
    const input: unknown[] = [1];
    if (kind === "sparse") Reflect.deleteProperty(input, "0");
    if (kind === "extra-key") Object.assign(input, { extra: 1 });
    if (kind === "symbol") Object.assign(input, { [Symbol("extra")]: 1 });
    if (kind === "hidden-index") Object.defineProperty(input, "0", { enumerable: false });
    if (kind === "subclass") Object.setPrototypeOf(input, class extends Array {}.prototype);
    if (kind === "null-prototype") Object.setPrototypeOf(input, null);
    refused(() => captureInboxData(input));
  });

  it.each(["symbol", "hidden", "class", "toJSON", "constructor", "prototype", "__proto__"] as const)("rejects record %s fields or prototypes", kind => {
    const input = {}, callback = vi.fn(() => ({}));
    if (kind === "symbol") Object.assign(input, { [Symbol("extra")]: 1 });
    else if (kind === "hidden") Object.defineProperty(input, "extra", { value: 1 });
    else if (kind === "class") Object.setPrototypeOf(input, class Unsupported {}.prototype);
    else Object.defineProperty(input, kind, { enumerable: true, value: kind === "toJSON" ? callback : 1 });
    refused(() => captureInboxData(input)); expect(callback).not.toHaveBeenCalled();
  });

  it.each([undefined, BigInt(1), Symbol("unsupported"), () => 1, new Date(0), new Map(), new Set(), /pattern/, new Uint8Array([1]),
    Number.NaN, Infinity, -Infinity, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    "rejects unsupported JSON value %s", value => { refused(() => captureInboxData({ value })); });

  it.each(["\ud800", "\udfff", "prefix\ud800suffix", "\ud800\ud800", "\udc00\ud800"])("rejects ill-formed Unicode %# in keys and values", value => {
    refused(() => captureInboxData(value)); refused(() => captureInboxData({ [value]: 1 }));
  });

  it("preserves well-formed Unicode and both exact safe integer endpoints", () => {
    const value = ["é😀\u0000\"\\\n", Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0];
    expect(captureInboxData(value)).toEqual(value);
  });
});

describe("actual serialized byte and structure bounds", () => {
  it.each([null, true, false, 42, Number.MIN_SAFE_INTEGER, [], {}, "", "é", "😀", "\u0000\b\n\"\\", ["😀\n", true, null],
    { "\u0000\"é": ["😀\n\\", true, null, -9007199254740991] }].map(value => ({ value })))("counts exact UTF-8 and escaped JSON bytes for case %#", ({ value }) => {
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    expect(captureInboxData(value, { maxBytes: bytes })).toEqual(value);
    refused(() => captureInboxData(value, { maxBytes: bytes - 1 }), "RESOURCE_LIMIT");
  });

  it.each(["é", "😀", "abc😀", "\u0000"]) ("bounds raw UTF-8 string bytes separately from JSON escaping for case %#", value => {
    const bytes = Buffer.byteLength(value, "utf8");
    expect(captureInboxData(value, { maxStringBytes: bytes })).toBe(value);
    if (bytes > 1) refused(() => captureInboxData(value, { maxStringBytes: bytes - 1 }), "RESOURCE_LIMIT");
  });

  it("applies string limits to object keys as well as values", () => {
    expect(captureInboxData({ "😀": 1 }, { maxStringBytes: 4 })).toEqual({ "😀": 1 });
    refused(() => captureInboxData({ "😀": 1 }, { maxStringBytes: 3 }), "RESOURCE_LIMIT");
  });

  it("counts repeated acyclic references separately against structural limits", () => {
    const shared = { value: 1 }, value = [shared, shared];
    expect(captureInboxData(value, { maxNodes: 5 })).toEqual(value);
    refused(() => captureInboxData(value, { maxNodes: 4 }), "RESOURCE_LIMIT");
    expect(captureInboxData({ value: [1] }, { maxDepth: 2 })).toEqual({ value: [1] });
    refused(() => captureInboxData({ value: [1] }, { maxDepth: 1 }), "RESOURCE_LIMIT");
    refused(() => captureInboxData(new Array(10), { maxNodes: 9 }), "RESOURCE_LIMIT");
  });

  it.each<[keyof InboxDataLimits, number]>([["maxBytes", 64 * 1_048_576], ["maxNodes", 100_000], ["maxDepth", 64], ["maxStringBytes", 1_048_576]])(
    "allows explicit maximum %s but refuses increasing it", (key, maximum) => {
      expect(captureInboxData({}, { [key]: maximum })).toEqual({});
      refused(() => captureInboxData({}, { [key]: maximum + 1 }));
    });

  it.each([0, -0, -1, 1.5, Number.NaN, Infinity, "1", undefined, null])("rejects invalid bound value %s", value => {
    refused(() => captureInboxData({}, { maxBytes: value } as Partial<InboxDataLimits>));
  });

  it("rejects unknown limit options and refuses limit getters before visiting input", () => {
    refused(() => captureInboxData({}, { maxItems: 3 } as Partial<InboxDataLimits>));
    const getter = vi.fn(() => 10), inputGetter = vi.fn(() => 1);
    const limits = Object.defineProperty({}, "maxBytes", { enumerable: true, get: getter });
    const input = Object.defineProperty({}, "value", { enumerable: true, get: inputGetter });
    refused(() => captureInboxData(input, limits));
    expect(getter).not.toHaveBeenCalled(); expect(inputGetter).not.toHaveBeenCalled();
  });
});

describe("shallow capability options", () => {
  it("captures allowed own descriptors without invoking or freezing supplied capabilities", () => {
    const fetch = vi.fn(), nested = { value: 1 }, input = { fetch, nested };
    const result = captureInboxOptions(input, ["fetch", "nested"]);
    expect(result.fetch).toBe(fetch); expect(result.nested).toBe(nested); expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(false); expect(Object.isFrozen(fetch)).toBe(false);
    input.fetch = vi.fn(); expect(result.fetch).toBe(fetch); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ label: "null", value: null }, { label: "empty-array", value: [] }, { label: "date", value: new Date(0) },
    { label: "number", value: 1 }, { label: "string", value: "options" }, { label: "undefined", value: undefined }])("refuses non-record options $label", ({ label, value }) => {
    if (label === "empty-array") expect(Array.isArray(value) && value.length === 0).toBe(true);
    refused(() => captureInboxOptions(value, []));
  });

  it.each(["unknown", "symbol", "hidden", "constructor", "prototype", "__proto__"] as const)("refuses %s option fields", key => {
    const value = {};
    Object.defineProperty(value, key === "symbol" ? Symbol("field") : key, { enumerable: key !== "hidden", value: true });
    refused(() => captureInboxOptions(value, key === "unknown" ? [] : [key]));
  });
});

describe("versioned canonical serialization and domain hashes", () => {
  it("sorts numeric-looking keys lexicographically at every level, retaining array order", () => {
    const value = { "2": "second", "10": { "2": 2, "10": 10 }, a: [{ "2": 2, "10": 10 }, 1] };
    const expected = '{"10":{"10":10,"2":2},"2":"second","a":[{"10":10,"2":2},1]}';
    expect(canonicalInboxJson(value)).toBe(expected);
    expect(canonicalInboxJson({ a: value.a, "10": value["10"], "2": value["2"] })).toBe(expected);
    expect(canonicalInboxJson([2, 1])).not.toBe(canonicalInboxJson([1, 2]));
  });

  it("uses unambiguous UTF-8 version/domain tuples and canonical data", () => {
    const value = { "2": "é", "10": "😀" };
    const expected = createHash("sha256").update('["alpha-wallet-deposit-inbox-v1","manifest",{"10":"😀","2":"é"}]', "utf8").digest("hex");
    expect(digestInboxValue("manifest", value)).toBe(expected);
    expect(digestInboxValue("asset", value)).not.toBe(expected);
    expect(digestInboxValue("manifest", { "10": "😀", "2": "é" })).toBe(expected);
    expect(digestInboxValue("manifest", { "2": "😀", "10": "é" })).not.toBe(expected);
    expect(digestInboxValue("a-b", ["c"])).not.toBe(digestInboxValue("a", ["b-c"]));
  });

  it.each(["", "Manifest", "has space", "é", "-manifest", "x".repeat(101), 1, null])("refuses unsupported digest domain %s", value => {
    refused(() => digestInboxValue(value as string, {}));
  });

  it("rejects an invalid domain before touching hostile data", () => {
    const { proxy, trap } = proxyTrap();
    refused(() => digestInboxValue(proxy as unknown as string, proxy));
    expect(trap).not.toHaveBeenCalled();
  });
});

describe("sanitized errors and local runtime", () => {
  it.each(["INVALID_INPUT", "ADMISSION_REFUSED", "INVALID_EVIDENCE", "RESOURCE_LIMIT", "RUNTIME_REFUSED", "REPLAY_MISMATCH"] as const)(
    "preserves owned %s classification while removing the original message", code => {
      const original = new DepositInboxError(code, "private-original-message"), result = depositInboxError(original);
      expect(result).not.toBe(original); expect(result).toMatchObject({ code, creditAuthority: false });
      expect(result.message).not.toContain("private-original-message");
    });

  it.each(["TIMEOUT", "TRANSPORT", "INVALID_RESPONSE", "SOURCE_CONFLICT", "STALE_CHECKPOINT", "SESSION_CLOSED"] as const)(
    "preserves native %s classification without copying callback details", code => {
      const result = depositInboxError(new NodeObservationError(code, "private-node-url-and-token"));
      expect(result).toMatchObject({ code, creditAuthority: false }); expect(result.message).not.toContain("private-node-url-and-token");
    });

  it.each([new Error("private-error"), "private-string", { code: "TIMEOUT", message: "private-record" }, null, undefined, 1])(
    "uses the explicit closed fallback for unrecognized error case %#", value => {
      const result = depositInboxError(value, "INVALID_EVIDENCE");
      expect(result).toMatchObject({ code: "INVALID_EVIDENCE", creditAuthority: false }); expect(result.message).not.toContain("private-");
    });

  it.each(["code", "message", "name"] as const)("does not read malicious error %s getters", field => {
    const getter = vi.fn(() => { throw new Error("private-getter-message"); }), original = new DepositInboxError("TIMEOUT", "private-original-message");
    Object.defineProperty(original, field, { get: getter });
    const result = depositInboxError(original);
    expect(result.code).toBe(field === "code" ? "INVALID_INPUT" : "TIMEOUT"); expect(getter).not.toHaveBeenCalled();
    expect(result.message).not.toContain("private-");
  });

  it("refuses unknown own error codes without treating an inherited code as authority", () => {
    const original = new DepositInboxError("TIMEOUT", "private-original-message");
    Object.defineProperty(original, "code", { value: "ARBITRARY_PROVIDER_ERROR" });
    expect(depositInboxError(original).code).toBe("INVALID_INPUT");
    const inherited = Object.create(original);
    expect(depositInboxError(inherited).code).toBe("INVALID_INPUT");
  });

  it("sanitizes a Proxy error without invoking any traps", () => {
    const { proxy, trap } = proxyTrap();
    expect(depositInboxError(proxy)).toMatchObject({ code: "INVALID_INPUT", creditAuthority: false });
    expect(trap).not.toHaveBeenCalled();
  });

  it("sanitizes an error with a Proxy prototype without invoking its traps", () => {
    const { proxy, trap } = proxyTrap();
    const result = depositInboxError(Object.create(proxy));
    expect(result).toMatchObject({ code: "INVALID_INPUT", creditAuthority: false }); expect(trap).not.toHaveBeenCalled();
  });

  it("keeps assertions typed and never grants credit authority", () => {
    expect(inboxCheck(true, "INVALID_INPUT", "unused")).toBeUndefined();
    refused(() => inboxCheck(false, "ADMISSION_REFUSED", "closed assertion"), "ADMISSION_REFUSED");
  });

  it.each(runtimeFlags)("refuses truthy %s runtimes", flag => {
    vi.stubEnv(flag, "false"); refused(() => inboxRuntime("simulation-only"), "RUNTIME_REFUSED");
  });

  it.each([undefined, "production", "preview", "staging"])("refuses NODE_ENV=%s", value => {
    vi.stubEnv("NODE_ENV", value); refused(() => inboxRuntime("simulation-only"), "RUNTIME_REFUSED");
  });

  it.each([undefined, null, "", "live", "development-fixture", "SIMULATION-ONLY", 1])("refuses mode %s", value => {
    refused(() => inboxRuntime(value), "RUNTIME_REFUSED");
  });

  it("allows only explicit simulation mode and never coerces a hostile mode", () => {
    expect(inboxRuntime("simulation-only")).toBeUndefined();
    vi.stubEnv("NODE_ENV", "development"); expect(inboxRuntime("simulation-only")).toBeUndefined();
    const { proxy, trap } = proxyTrap(); refused(() => inboxRuntime(proxy), "RUNTIME_REFUSED"); expect(trap).not.toHaveBeenCalled();
  });
});
