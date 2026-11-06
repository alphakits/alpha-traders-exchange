import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { parseChainFixtureJson } from "./chain-evidence";
import { assertSimulationRuntime } from "./runtime";

export type NodeObservationErrorCode = "INVALID_INPUT" | "RUNTIME_REFUSED" | "RESOURCE_LIMIT" | "TIMEOUT"
  | "TRANSPORT" | "INVALID_RESPONSE" | "INVALID_EVIDENCE" | "SOURCE_CONFLICT" | "STALE_CHECKPOINT" | "SESSION_CLOSED";
export class NodeObservationError extends Error {
  readonly creditAuthority = false;
  constructor(readonly code: NodeObservationErrorCode, message: string) { super(message); this.name = "NodeObservationError"; }
}
export interface NodeReadTranscript {
  readonly sourceId: string;
  readonly protocol: "bsc-json-rpc" | "tron-http";
  readonly operation: string;
  readonly requestBody: string;
  readonly responseBody: string;
  readonly responseSha256: string;
  readonly completedAtMs: number;
}
export interface NodeObservationSession {
  readonly startedAtMs: number;
  bsc(sourceId: string, method: string, params: unknown): Promise<unknown>;
  tron(sourceId: string, path: string, body: unknown): Promise<unknown>;
  now(): number;
  finish(): readonly NodeReadTranscript[];
}
export interface DevelopmentNodeTransport {
  openSession(executionSourceId: string, finalitySourceId: string): NodeObservationSession;
}
export interface DevelopmentNodeSource { id: string; independenceGroup: string; endpoint: string }
export interface DevelopmentNodeTransportOptions {
  mode: "simulation-only";
  sources: DevelopmentNodeSource[];
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  clock?: () => number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
const MAX_RESPONSE = 1_048_576, MAX_SESSION_BYTES = 16 * MAX_RESPONSE, MAX_READS = 160, MAX_SESSION_MS = 30_000;
const idSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const sourceSchema = z.object({ id: idSchema, independenceGroup: idSchema, endpoint: z.string().min(1).max(2048) }).strict();
const optionsSchema = z.object({ mode: z.literal("simulation-only"), sources: z.array(sourceSchema).min(2).max(16),
  fetch: z.custom<DevelopmentNodeTransportOptions["fetch"]>(v => typeof v === "function"),
  clock: z.custom<() => number>(v => typeof v === "function").optional(),
  timeoutMs: z.number().int().min(1).max(10_000).default(5_000),
  maxResponseBytes: z.number().int().min(1).max(MAX_RESPONSE).default(MAX_RESPONSE),
}).strict();
const bscHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(s => s.toLowerCase());
const tronHash = z.string().regex(/^[0-9a-fA-F]{64}$/).transform(s => s.toLowerCase());
const exactHeight = z.string().max(18).regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/)
  .transform(s => s.toLowerCase());
const blockParams = z.tuple([z.union([z.literal("finalized"), exactHeight]), z.literal(false)]);
const tronBlockBody = z.object({ num: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  .refine(v => !Object.is(v, -0)), visible: z.literal(false) }).strict();
const tronTxBody = z.object({ value: tronHash, visible: z.literal(false) }).strict();
const tronHeadBody = z.object({ visible: z.literal(false) }).strict();

export function observationDigest(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}
export function observationRuntime(mode: unknown): void {
  try { assertSimulationRuntime(typeof mode === "string" ? mode : undefined); }
  catch { throw new NodeObservationError("RUNTIME_REFUSED", "Node observation requires a local simulation-only runtime"); }
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  try { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; }
  catch { /* Never expose a hostile input getter or schema conversion exception. */ }
  throw new NodeObservationError("INVALID_INPUT", "Node observation input is outside the closed read contract");
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
/** JSON.parse can round fractional/overflowing literals into apparently safe integers. */
function assertTronNativeIntegerTokens(raw: string): void {
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g;
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('"')) continue;
    if (token.length > 17 || !/^-?(?:0|[1-9][0-9]*)$/.test(token) || token === "-0")
      throw new NodeObservationError("INVALID_EVIDENCE", "TRON native numbers must use exact safe integer literals");
    const integer = BigInt(token);
    if (integer > limit || integer < -limit)
      throw new NodeObservationError("INVALID_EVIDENCE", "TRON native integer exceeds the supported exact range");
  }
}
function sourceEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new NodeObservationError("INVALID_INPUT", "Node source URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || value.includes("?") || value.includes("#") || isIP(url.hostname)
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(url.hostname)
    || url.hostname.length > 253) throw new NodeObservationError("INVALID_INPUT", "Node sources require explicit HTTPS DNS endpoints without credentials or URL parameters");
  return url;
}

/** Explicit injected read IO only. Nothing here discovers credentials, creates keys or invokes a ledger. */
export function createDevelopmentNodeTransport(value: DevelopmentNodeTransportOptions): DevelopmentNodeTransport {
  const options = input(optionsSchema, value);
  observationRuntime(options.mode);
  const fetcher = options.fetch, clock = options.clock ?? Date.now;
  const sources = new Map<string, { id: string; independenceGroup: string; endpoint: string; host: string }>();
  for (const item of options.sources) {
    if (sources.has(item.id)) throw new NodeObservationError("INVALID_INPUT", "Node source IDs must be unique");
    const url = sourceEndpoint(item.endpoint);
    sources.set(item.id, { ...item, endpoint: url.href, host: url.hostname.toLowerCase() });
  }
  const readClock = () => {
    let now: unknown;
    try { now = clock(); } catch { throw new NodeObservationError("RUNTIME_REFUSED", "Observation clock is unavailable"); }
    if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0)
      throw new NodeObservationError("RUNTIME_REFUSED", "Observation clock must return an exact nonnegative millisecond instant");
    return now;
  };
  return Object.freeze({ openSession(executionSourceId: string, finalitySourceId: string): NodeObservationSession {
    observationRuntime(options.mode);
    const execution = sources.get(input(idSchema, executionSourceId)), finality = sources.get(input(idSchema, finalitySourceId));
    if (!execution || !finality || execution.id === finality.id || execution.host === finality.host
      || execution.independenceGroup === finality.independenceGroup)
      throw new NodeObservationError("INVALID_INPUT", "Execution and finality require distinct configured source IDs, hosts and operator groups");
    const admittedIds = new Set([execution.id, finality.id]);
    const startedAtMs = readClock(), startedMono = performance.now(), sessionId = randomUUID();
    let lastWall = startedAtMs, failed = false, sealed = false, busy = false, count = 0, bytes = 0;
    let controller: AbortController | undefined;
    const transcripts: NodeReadTranscript[] = [];
    function fail(error: unknown, code: NodeObservationErrorCode = "TRANSPORT"): never {
      failed = true;
      controller?.abort();
      if (error instanceof NodeObservationError) throw error;
      throw new NodeObservationError(code, "Node observation could not complete its required reads");
    }
    function active(): number {
      if (failed || sealed) throw new NodeObservationError("SESSION_CLOSED", "Node observation session is closed");
      observationRuntime(options.mode);
      const current = readClock(), mono = performance.now();
      if (!Number.isFinite(mono) || mono < startedMono || current < lastWall
        || current - startedAtMs >= MAX_SESSION_MS || mono - startedMono >= MAX_SESSION_MS)
        throw new NodeObservationError("TIMEOUT", "Node observation exceeded its monotonic session window");
      // An injected clock must not hide reentrant session closure or runtime changes.
      if (failed || sealed) throw new NodeObservationError("SESSION_CLOSED", "Node observation session is closed");
      observationRuntime(options.mode);
      lastWall = current;
      return current;
    }
    function bscParams(method: string, params: unknown): unknown {
      if (method === "eth_chainId") return input(z.tuple([]), params);
      if (method === "eth_getTransactionReceipt") return input(z.tuple([bscHash]), params);
      if (method === "eth_getBlockByNumber") return input(blockParams, params);
      throw new NodeObservationError("INVALID_INPUT", "Unsupported BSC node operation");
    }
    function tronBody(path: string, body: unknown): unknown {
      if (path === "/wallet/getblockbynum" || path === "/walletsolidity/getblockbynum") return input(tronBlockBody, body);
      if (path === "/wallet/gettransactioninfobyid" || path === "/walletsolidity/gettransactioninfobyid") return input(tronTxBody, body);
      if (path === "/walletsolidity/getnowblock") return input(tronHeadBody, body);
      throw new NodeObservationError("INVALID_INPUT", "Unsupported TRON node operation");
    }
    async function request(sourceId: string, protocol: NodeReadTranscript["protocol"], operation: string, data: unknown): Promise<unknown> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      // A second call must fail the first session without replacing its controller or busy marker.
      if (busy) return fail(new NodeObservationError("INVALID_INPUT", "Concurrent reads in one observation are unsupported"));
      // Hold the serial-read guard during validation too: input getters can reenter.
      busy = true;
      try {
        active();
        if (!admittedIds.has(sourceId)) throw new NodeObservationError("INVALID_INPUT", "Read source is outside this observation");
        const source = sources.get(sourceId)!;
        const parsed = protocol === "bsc-json-rpc" ? bscParams(operation, data) : tronBody(operation, data);
        if (count >= MAX_READS) throw new NodeObservationError("RESOURCE_LIMIT", "Node observation exhausted its read budget");
        count += 1;
        const requestId = `aw-${sessionId}-${count}`;
        // Serialize only parsed data, never a caller object with an uninspected toJSON method.
        const requestBody = JSON.stringify(protocol === "bsc-json-rpc" ? { jsonrpc: "2.0", id: requestId, method: operation, params: parsed } : parsed);
        const endpoint = new URL(source.endpoint);
        if (protocol === "tron-http") endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + operation;
        const url = endpoint.href, readStarted = performance.now();
        controller = new AbortController();
        const readController = controller;
        const readActive = () => {
          const now = active(), elapsed = performance.now() - readStarted;
          if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= options.timeoutMs)
            throw new NodeObservationError("TIMEOUT", "Node read exceeded its complete response deadline");
          return now;
        };
        const remainingSession = Math.min(MAX_SESSION_MS - (performance.now() - startedMono), MAX_SESSION_MS - (lastWall - startedAtMs));
        const work = async () => {
          let response: Response | undefined;
          try {
            readActive();
            response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: requestBody, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: readController.signal });
            readActive();
            if (!(response instanceof Response) || response.status !== 200 || response.redirected || response.url !== url)
              throw new NodeObservationError("INVALID_RESPONSE", "Node response status or endpoint identity is invalid");
            const contentType = response.headers.get("content-type") ?? "";
            if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType))
              throw new NodeObservationError("INVALID_RESPONSE", "Node response must be UTF-8 application/json");
            const declared = response.headers.get("content-length");
            if (declared !== null && (declared.length > 7 || !/^(?:0|[1-9][0-9]*)$/.test(declared) || BigInt(declared) > BigInt(options.maxResponseBytes)))
              throw new NodeObservationError("RESOURCE_LIMIT", "Node response exceeds its declared byte bound");
            if (!response.body) throw new NodeObservationError("INVALID_RESPONSE", "Node response body is missing");
            reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let length = 0;
            for (;;) {
              readActive();
              const next = await reader.read();
              readActive();
              if (next.done) break;
              if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0)
                throw new NodeObservationError("INVALID_RESPONSE", "Node response stream contains an invalid byte chunk");
              length += next.value.byteLength; bytes += next.value.byteLength;
              if (length > options.maxResponseBytes || bytes > MAX_SESSION_BYTES)
                throw new NodeObservationError("RESOURCE_LIMIT", "Node response exhausted its byte budget");
              chunks.push(new Uint8Array(next.value));
            }
            const body = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
            let responseBody: string, decoded: unknown;
            try {
              responseBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
              if (responseBody.charCodeAt(0) === 0xfeff) throw new Error("BOM");
              decoded = parseChainFixtureJson(responseBody);
            } catch { throw new NodeObservationError("INVALID_RESPONSE", "Node response has invalid or ambiguous JSON bytes"); }
            readActive();
            if (protocol === "tron-http") assertTronNativeIntegerTokens(responseBody);
            let result = decoded;
            if (protocol === "bsc-json-rpc") {
              if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded))
                throw new NodeObservationError("INVALID_RESPONSE", "Node JSON-RPC envelope is invalid");
              const row = decoded as Record<string, unknown>, keys = Object.keys(row).sort().join(",");
              if (row.jsonrpc !== "2.0" || row.id !== requestId || (keys !== "id,jsonrpc,result" && keys !== "error,id,jsonrpc"))
                throw new NodeObservationError("INVALID_RESPONSE", "Node JSON-RPC response identity is invalid");
              if (keys === "error,id,jsonrpc") throw new NodeObservationError("INVALID_RESPONSE", "Node JSON-RPC provider reported a read failure");
              result = row.result;
            } else {
              if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded))
                throw new NodeObservationError("INVALID_RESPONSE", "TRON node response must be a native object");
              const row = decoded as Record<string, unknown>;
              if (["Error", "error", "code"].some(key => Object.prototype.hasOwnProperty.call(row, key)))
                throw new NodeObservationError("INVALID_RESPONSE", "TRON provider reported a read failure");
            }
            const completedAtMs = readActive();
            const frozenResult = deepFreeze(result);
            const transcript = Object.freeze({ sourceId, protocol, operation, requestBody, responseBody,
              responseSha256: observationDigest(responseBody), completedAtMs });
            readActive();
            transcripts.push(transcript);
            return frozenResult;
          } finally {
            // A response can arrive after Promise.race has already timed out. Close
            // its unread stream here, including identity/header rejection paths.
            if (!reader && response instanceof Response) {
              try { void response.body?.cancel().catch(() => undefined); } catch { /* Preserve the read failure. */ }
            }
          }
        };
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
          readController.abort(); reject(new NodeObservationError("TIMEOUT", "Node read exceeded its complete response deadline"));
        }, Math.max(1, Math.min(options.timeoutMs, remainingSession))); });
        return await Promise.race([work(), timeout]);
      } catch (error) { return fail(error); }
      finally {
        if (timer !== undefined) clearTimeout(timer);
        try { void reader?.cancel().catch(() => undefined); } catch { /* Cleanup never replaces the original failure. */ }
        busy = false; controller = undefined;
      }
    }
    return Object.freeze({ startedAtMs,
      bsc: (sourceId: string, method: string, params: unknown) => request(sourceId, "bsc-json-rpc", method, params),
      tron: (sourceId: string, path: string, body: unknown) => request(sourceId, "tron-http", path, body),
      now() { try { return active(); } catch (error) { return fail(error); } },
      finish() {
        try {
          active();
          if (busy || transcripts.length === 0) throw new NodeObservationError("INVALID_INPUT", "Only a completed nonempty observation may be sealed");
          sealed = true;
          return Object.freeze([...transcripts]);
        } catch (error) { return fail(error); }
      },
    });
  } });
}
