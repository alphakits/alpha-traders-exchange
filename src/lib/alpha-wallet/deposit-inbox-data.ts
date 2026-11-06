import "server-only";

import { createHash } from "node:crypto";
import { types } from "node:util";
import { NodeObservationError, type NodeObservationErrorCode } from "./chain-observer-rpc";
import { assertSimulationRuntime } from "./runtime";

export type DepositInboxErrorCode = NodeObservationErrorCode | "ADMISSION_REFUSED" | "REPLAY_MISMATCH";

export class DepositInboxError extends Error {
  readonly creditAuthority = false;
  constructor(readonly code: DepositInboxErrorCode, message: string) {
    super(message);
    this.name = "DepositInboxError";
  }
}

export function inboxCheck(condition: unknown, code: DepositInboxErrorCode, message: string): asserts condition {
  if (!condition) throw new DepositInboxError(code, message);
}

export function inboxRuntime(mode: unknown): void {
  try { assertSimulationRuntime(typeof mode === "string" ? mode : undefined); }
  catch { throw new DepositInboxError("RUNTIME_REFUSED", "Deposit evidence requires an explicit local simulation-only runtime"); }
}

/** Preserve only closed classifications; never copy provider or callback messages. */
export function depositInboxError(error: unknown, fallback: DepositInboxErrorCode = "INVALID_INPUT"): DepositInboxError {
  let code = fallback;
  let recognized = false;
  if (error !== null && typeof error === "object" && !types.isProxy(error)) {
    // instanceof can traverse a Proxy hidden in an otherwise ordinary object's prototype chain.
    let prototype = Object.getPrototypeOf(error);
    for (let depth = 0; prototype !== null && depth < 8; depth++) {
      if (types.isProxy(prototype)) break;
      if (prototype === DepositInboxError.prototype || prototype === NodeObservationError.prototype) {
        recognized = true;
        break;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
  }
  if (recognized && error !== null && typeof error === "object") {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const allowed = new Set<DepositInboxErrorCode>(["INVALID_INPUT", "ADMISSION_REFUSED", "INVALID_EVIDENCE", "RESOURCE_LIMIT",
      "RUNTIME_REFUSED", "REPLAY_MISMATCH", "TIMEOUT", "TRANSPORT", "INVALID_RESPONSE", "SOURCE_CONFLICT", "STALE_CHECKPOINT", "SESSION_CLOSED"]);
    if (descriptor && "value" in descriptor && allowed.has(descriptor.value)) code = descriptor.value;
  }
  return new DepositInboxError(code, "Deposit evidence did not satisfy the closed development contract");
}

export interface InboxDataLimits {
  maxBytes: number;
  maxNodes: number;
  maxDepth: number;
  maxStringBytes: number;
}

const LIMITS: InboxDataLimits = Object.freeze({ maxBytes: 64 * 1_048_576, maxNodes: 100_000,
  maxDepth: 64, maxStringBytes: 1_048_576 });
type JsonData = null | boolean | number | string | JsonData[] | { [key: string]: JsonData };
const UNSUPPORTED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function plainObject(value: unknown): asserts value is Record<string, unknown> {
  inboxCheck(value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value),
    "INVALID_INPUT", "Deposit evidence requires plain data records");
  const prototype = Object.getPrototypeOf(value);
  inboxCheck(prototype === Object.prototype || prototype === null, "INVALID_INPUT", "Deposit evidence requires plain data records");
}

/** Shallow constructor capture: capability functions are validated by the owning constructor. */
export function captureInboxOptions(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  try {
    plainObject(value);
    const allowed = new Set(allowedKeys), keys = Reflect.ownKeys(value);
    inboxCheck(keys.length <= allowed.size, "INVALID_INPUT", "Deposit evidence input has unsupported fields");
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      inboxCheck(typeof key === "string" && allowed.has(key) && !UNSUPPORTED_KEYS.has(key)
        && descriptor.enumerable && "value" in descriptor,
      "INVALID_INPUT", "Deposit evidence input has an unsupported or executable field");
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (error) { throw depositInboxError(error); }
}

/**
 * Capture JSON data without invoking getters, toJSON, iterators or Proxy traps.
 * Bounds count the actual UTF-8 JSON representation, including string escaping.
 * Object keys are sorted by JS string order; array order remains significant.
 */
export function captureInboxData<T = unknown>(value: unknown, suppliedLimits: Partial<InboxDataLimits> = {}): T {
  try {
    const options = captureInboxOptions(suppliedLimits, ["maxBytes", "maxNodes", "maxDepth", "maxStringBytes"]);
    const limits = { ...LIMITS };
    for (const key of Object.keys(limits) as Array<keyof InboxDataLimits>) {
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        const bound = options[key];
        inboxCheck(typeof bound === "number" && Number.isSafeInteger(bound) && bound > 0 && bound <= LIMITS[key],
          "INVALID_INPUT", "Deposit evidence capture bounds may only be reduced");
        limits[key] = bound;
      }
    }
    let bytes = 0, nodes = 0;
    const active = new WeakSet<object>();
    const add = (amount: number) => {
      bytes += amount;
      inboxCheck(bytes <= limits.maxBytes, "RESOURCE_LIMIT", "Deposit evidence exceeds its serialized byte bound");
    };
    const string = (text: string) => {
      inboxCheck(text.length <= limits.maxStringBytes, "RESOURCE_LIMIT", "Deposit evidence string exceeds its bound");
      inboxCheck(isWellFormed(text), "INVALID_INPUT", "Deposit evidence strings must contain well-formed Unicode");
      inboxCheck(Buffer.byteLength(text, "utf8") <= limits.maxStringBytes,
        "RESOURCE_LIMIT", "Deposit evidence string exceeds its UTF-8 bound");
      add(Buffer.byteLength(JSON.stringify(text), "utf8"));
    };
    const visit = (input: unknown, depth: number): JsonData => {
      nodes += 1;
      inboxCheck(nodes <= limits.maxNodes && depth <= limits.maxDepth,
        "RESOURCE_LIMIT", "Deposit evidence exceeds its structural bounds");
      if (input === null) { add(4); return null; }
      if (typeof input === "boolean") { add(input ? 4 : 5); return input; }
      if (typeof input === "number") {
        inboxCheck(Number.isSafeInteger(input) && !Object.is(input, -0),
          "INVALID_INPUT", "Deposit evidence numbers must be exact safe integers");
        add(String(input).length); return input;
      }
      if (typeof input === "string") { string(input); return input; }
      inboxCheck(input !== null && typeof input === "object" && !types.isProxy(input),
        "INVALID_INPUT", "Deposit evidence may contain only inert JSON data");
      inboxCheck(!active.has(input), "INVALID_INPUT", "Deposit evidence must be acyclic");
      active.add(input);
      try {
        if (Array.isArray(input)) {
          inboxCheck(Object.getPrototypeOf(input) === Array.prototype, "INVALID_INPUT", "Deposit evidence arrays must be ordinary JSON arrays");
          const length = Object.getOwnPropertyDescriptor(input, "length")!.value as number;
          inboxCheck(length <= limits.maxNodes, "RESOURCE_LIMIT", "Deposit evidence array exceeds its item bound");
          const keys = Reflect.ownKeys(input);
          inboxCheck(keys.length === length + 1, "INVALID_INPUT", "Deposit evidence arrays must be dense and closed");
          add(2 + Math.max(0, length - 1));
          const result: JsonData[] = [];
          for (let index = 0; index < length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
            inboxCheck(descriptor && descriptor.enumerable && "value" in descriptor,
              "INVALID_INPUT", "Deposit evidence arrays may not execute accessors or contain holes");
            result.push(visit(descriptor.value, depth + 1));
          }
          return Object.freeze(result) as JsonData[];
        }
        plainObject(input);
        const keys = Reflect.ownKeys(input);
        inboxCheck(keys.length <= limits.maxNodes - nodes,
          "RESOURCE_LIMIT", "Deposit evidence record exceeds its field bound");
        const values: Array<[string, unknown]> = [];
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
          inboxCheck(typeof key === "string" && !UNSUPPORTED_KEYS.has(key) && descriptor.enumerable && "value" in descriptor,
            "INVALID_INPUT", "Deposit evidence records may contain only enumerable data fields");
          values.push([key, descriptor.value]);
        }
        values.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        add(2 + Math.max(0, values.length - 1));
        const result: Record<string, JsonData> = {};
        for (const [key, child] of values) {
          string(key); add(1);
          result[key] = visit(child, depth + 1);
        }
        return Object.freeze(result);
      } finally { active.delete(input); }
    };
    return visit(value, 0) as T;
  } catch (error) { throw depositInboxError(error); }
}

export function canonicalInboxJson(value: unknown): string {
  const serialize = (item: JsonData): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(serialize).join(",")}]`;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${serialize(item[key])}`).join(",")}}`;
  };
  return serialize(captureInboxData<JsonData>(value));
}

/** Closed versioned domain + canonical JSON; checksums establish consistency only. */
export function digestInboxValue(domain: string, value: unknown): string {
  inboxCheck(typeof domain === "string" && /^[a-z][a-z0-9-]{0,99}$/.test(domain),
    "INVALID_INPUT", "Deposit evidence digest domain is invalid");
  const captured = canonicalInboxJson(value);
  return createHash("sha256").update(`["alpha-wallet-deposit-inbox-v1",${JSON.stringify(domain)},${captured}]`, "utf8").digest("hex");
}
