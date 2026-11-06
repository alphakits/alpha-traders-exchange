import "server-only";

import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { z } from "zod";
import { parseChainFixtureJson, type TransferFixtureContext, type VerifiedFixtureTransfer } from "./chain-evidence";
import { observeBscNodeTransfer } from "./bsc-node-observer";
import { observeTronNodeTransfer } from "./tron-node-observer";
import { captureObservationContext, captureObservationPolicy,
  type DevelopmentChainObservation, type ObservationPolicy } from "./chain-observer-common";
import { createDevelopmentNodeTransport, observationDigest, type DevelopmentNodeSource,
  type DevelopmentNodeTransport, type DevelopmentNodeTransportOptions, type NodeReadTranscript } from "./chain-observer-rpc";
import { captureInboxData, captureInboxOptions, canonicalInboxJson, depositInboxError,
  digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";

const MAX_RESPONSE_BYTES = 1_048_576, MAX_RAW_BYTES = 16 * MAX_RESPONSE_BYTES;
const MAX_READS = 160, MAX_CLOCKS = 8, MAX_READ_US = 5_000_000, MAX_SESSION_US = 30_000_000;
const MAX_REQUEST_BYTES = 1024;
type Row = Record<string, unknown>;

export interface ObservationReadTiming {
  readonly ordinal: number;
  readonly startedAtMs: number;
  readonly returnedAtMs: number;
  readonly startedElapsedUs: number;
  readonly returnedElapsedUs: number;
  readonly elapsedUs: number;
}
export interface ObservationSemanticClock {
  readonly afterRead: number;
  readonly atMs: number;
  readonly elapsedUs: number;
}
export interface DevelopmentObservationTiming {
  readonly startedAtMs: number;
  readonly returnedAtMs: number;
  readonly elapsedUs: number;
  readonly reads: readonly ObservationReadTiming[];
  readonly semanticClocks: readonly ObservationSemanticClock[];
}
export interface TimedDevelopmentObservationV1 {
  readonly kind: "development-timed-observation";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly context: TransferFixtureContext;
  readonly policy: ObservationPolicy;
  readonly observation: DevelopmentChainObservation;
  readonly timing: DevelopmentObservationTiming;
  readonly timedObservationSha256: string;
}
export interface TimedDevelopmentObservationInput {
  mode: "simulation-only";
  sources: DevelopmentNodeSource[];
  fetch: DevelopmentNodeTransportOptions["fetch"];
  clock?: () => number;
  context: unknown;
  executionSourceId: string;
  finalitySourceId: string;
  policy?: unknown;
}
export interface NativeBlockSemantics {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly timestampMs: number;
  readonly transactions: readonly string[];
  readonly header?: Readonly<Row>;
  readonly blockSemanticsSha256: string;
  readonly sourceIds: readonly string[];
}
export interface ReplayedDevelopmentObservationSemantics {
  readonly kind: "replayed-development-observation-semantics";
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly family: "bsc" | "tron";
  readonly chainKey: string;
  readonly transfer: VerifiedFixtureTransfer;
  readonly pinnedCheckpoint: Readonly<{ number: string; hash: string; timestampMs: number }>;
  readonly lastValidatedHead: Readonly<{ number: string; hash: string; timestampMs: number }>;
  readonly containingBlock: NativeBlockSemantics;
  readonly receiptSemantics: Readonly<Row>;
  readonly receiptSemanticsSha256: string;
  readonly transactionAnchor: Readonly<{ chainKey: string; transactionId: string; blockNumber: string;
    blockHash: string; transactionIndex: string; receiptSemanticsSha256: string }>;
  readonly blocks: readonly NativeBlockSemantics[];
}
export interface ReplayedDevelopmentObservation {
  readonly timedObservation: TimedDevelopmentObservationV1;
  readonly observation: DevelopmentChainObservation;
  readonly semantics: ReplayedDevelopmentObservationSemantics;
}

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => !Object.is(value, -0));
const sourceId = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(512);
const transferSchema = z.object({ kind: z.literal("verified-development-transfer-evidence"),
  creditAuthority: z.literal(false), assurance: z.literal("supplied-fixture-consistency-only"),
  family: z.enum(["bsc", "tron"]), chainKey: text, token: text, sender: text, recipient: text, amountRaw: text,
  transactionId: text, transactionIndex: text, eventIndex: text, eventKey: text, blockNumber: text, blockHash: text,
  finality: z.enum(["bsc-finalized", "tron-solidified"]), checkpointNumber: text, checkpointHash: text }).strict();
const transcriptSchema = z.object({ sourceId, protocol: z.enum(["bsc-json-rpc", "tron-http"]), operation: text,
  requestBody: z.string().min(1).max(MAX_REQUEST_BYTES), responseBody: z.string().min(1).max(MAX_RESPONSE_BYTES),
  responseSha256: sha256, completedAtMs: integer }).strict();
const observationSchema = z.object({ kind: z.literal("development-chain-observation"), mode: z.literal("simulation-only"),
  creditAuthority: z.literal(false), assurance: z.literal("configured-node-consistency-only"), transfer: transferSchema,
  executionSourceId: sourceId, finalitySourceId: sourceId, checkpointTimestampMs: integer,
  startedAtMs: integer, completedAtMs: integer, reads: z.array(transcriptSchema).min(1).max(MAX_READS), observationSha256: sha256 }).strict();
const readTimingSchema = z.object({ ordinal: integer, startedAtMs: integer, returnedAtMs: integer,
  startedElapsedUs: integer, returnedElapsedUs: integer, elapsedUs: integer }).strict();
const semanticClockSchema = z.object({ afterRead: integer, atMs: integer, elapsedUs: integer }).strict();
const timingSchema = z.object({ startedAtMs: integer, returnedAtMs: integer, elapsedUs: integer,
  reads: z.array(readTimingSchema).min(1).max(MAX_READS), semanticClocks: z.array(semanticClockSchema).min(1).max(MAX_CLOCKS) }).strict();
const timedSchema = z.object({ kind: z.literal("development-timed-observation"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), context: z.unknown(), policy: z.unknown(),
  observation: observationSchema, timing: timingSchema, timedObservationSha256: sha256 }).strict();

function familyOf(value: unknown): "bsc" | "tron" {
  const family = (value as { chain?: { family?: unknown } } | null)?.chain?.family;
  inboxCheck(family === "bsc" || family === "tron", "INVALID_INPUT", "Observation chain family is invalid");
  return family;
}
function sameData(actual: unknown, expected: unknown): boolean {
  return canonicalInboxJson(actual) === canonicalInboxJson(expected);
}
function timedBody(bundle: TimedDevelopmentObservationV1) {
  const { timedObservationSha256: ignored, ...body } = bundle;
  void ignored;
  return body;
}
function rawBudget(reads: readonly NodeReadTranscript[]): void {
  let total = 0;
  inboxCheck(reads.length > 0 && reads.length <= MAX_READS, "RESOURCE_LIMIT", "Observation read count exceeds its bound");
  for (const read of reads) {
    const requestBytes = Buffer.byteLength(read.requestBody, "utf8"), responseBytes = Buffer.byteLength(read.responseBody, "utf8");
    inboxCheck(requestBytes > 0 && requestBytes <= MAX_REQUEST_BYTES && responseBytes > 0 && responseBytes <= MAX_RESPONSE_BYTES,
      "RESOURCE_LIMIT", "Observation raw message exceeds its byte bound");
    total += requestBytes + responseBytes;
    inboxCheck(total <= MAX_RAW_BYTES, "RESOURCE_LIMIT", "Observation raw request and response bytes exceed their aggregate bound");
  }
}

/** Checks internal timing consistency, not the authenticity of clocks or node operators. */
function validateTiming(observation: DevelopmentChainObservation, timing: DevelopmentObservationTiming): void {
  inboxCheck(timing.startedAtMs === observation.startedAtMs && timing.returnedAtMs >= observation.completedAtMs
    && observation.completedAtMs >= observation.startedAtMs && timing.returnedAtMs - timing.startedAtMs < MAX_SESSION_US / 1000
    && timing.elapsedUs < MAX_SESSION_US, "TIMEOUT", "Observation exceeds its complete session interval");
  inboxCheck(timing.reads.length === observation.reads.length && timing.semanticClocks.length > 0
    && timing.semanticClocks.length <= MAX_CLOCKS, "REPLAY_MISMATCH", "Observation timing does not account for every action");
  let wall = timing.startedAtMs, offset = 0, elapsedSum = 0;
  for (let index = 0; index < timing.reads.length; index++) {
    const read = timing.reads[index], completion = observation.reads[index].completedAtMs;
    const difference = read.returnedElapsedUs - read.startedElapsedUs;
    inboxCheck(read.ordinal === index + 1 && read.startedAtMs >= wall && read.returnedAtMs >= read.startedAtMs
      && completion >= read.startedAtMs && completion <= read.returnedAtMs && read.returnedAtMs <= timing.returnedAtMs
      && read.startedElapsedUs >= offset && read.returnedElapsedUs >= read.startedElapsedUs && read.returnedElapsedUs <= timing.elapsedUs
      && (read.elapsedUs === difference || read.elapsedUs === difference + 1),
    "REPLAY_MISMATCH", "Observation read timing is not a sequential enclosing interval");
    inboxCheck(read.returnedAtMs - read.startedAtMs < MAX_READ_US / 1000 && read.elapsedUs < MAX_READ_US,
      "TIMEOUT", "Observation read exceeded its complete response interval");
    wall = read.returnedAtMs; offset = read.returnedElapsedUs; elapsedSum += read.elapsedUs;
  }
  // Each separately rounded-up duration may contribute at most one extra microsecond.
  inboxCheck(elapsedSum <= timing.elapsedUs + timing.reads.length, "REPLAY_MISMATCH", "Observation elapsed intervals are inconsistent");
  let previousRead = 0, previousWall = timing.startedAtMs, previousOffset = 0;
  for (const sample of timing.semanticClocks) {
    const previous = timing.reads[sample.afterRead - 1], next = timing.reads[sample.afterRead];
    inboxCheck(sample.afterRead >= previousRead && sample.afterRead <= timing.reads.length
      && sample.atMs >= previousWall && sample.elapsedUs >= previousOffset
      && sample.atMs >= (previous?.returnedAtMs ?? timing.startedAtMs) && sample.atMs <= (next?.startedAtMs ?? timing.returnedAtMs)
      && sample.elapsedUs >= (previous?.returnedElapsedUs ?? 0) && sample.elapsedUs <= (next?.startedElapsedUs ?? timing.elapsedUs),
    "REPLAY_MISMATCH", "Observation semantic clock is not at its recorded read boundary");
    previousRead = sample.afterRead; previousWall = sample.atMs; previousOffset = sample.elapsedUs;
  }
}

/** Fixed-budget collection through the existing native transport; no caller-supplied transport or budget overrides. */
export async function captureTimedDevelopmentObservation(supplied: TimedDevelopmentObservationInput): Promise<TimedDevelopmentObservationV1> {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxOptions(supplied, ["mode", "sources", "fetch", "clock", "context", "executionSourceId", "finalitySourceId", "policy"]);
    inboxRuntime(options.mode);
    inboxCheck(typeof options.fetch === "function" && !types.isProxy(options.fetch)
      && (options.clock === undefined || (typeof options.clock === "function" && !types.isProxy(options.clock))),
      "INVALID_INPUT", "Observation requires explicit read IO and an optional clock");
    const sources = captureInboxData<DevelopmentNodeSource[]>(options.sources, { maxBytes: 64_000, maxNodes: 128, maxDepth: 3, maxStringBytes: 2048 });
    const contextData = captureInboxData(options.context, { maxBytes: 4096, maxNodes: 24, maxDepth: 3, maxStringBytes: 256 });
    const family = familyOf(contextData), context = captureObservationContext(contextData, family);
    const policy = captureObservationPolicy(options.policy === undefined ? undefined : captureInboxData(options.policy, { maxBytes: 256, maxNodes: 4, maxDepth: 1 }));
    inboxCheck(typeof options.executionSourceId === "string" && typeof options.finalitySourceId === "string",
      "INVALID_INPUT", "Observation source identities must be primitive strings");
    const pair = z.object({ executionSourceId: sourceId, finalitySourceId: sourceId }).safeParse({ executionSourceId: options.executionSourceId, finalitySourceId: options.finalitySourceId });
    inboxCheck(pair.success, "INVALID_INPUT", "Observation source identities are invalid");
    const { executionSourceId, finalitySourceId } = pair.data;
    const suppliedClock = options.clock as (() => number) | undefined;
    let clockBusy = false, lastWall = -1, failed = false;
    const clock = () => {
      inboxCheck(!failed && !clockBusy, "RUNTIME_REFUSED", "Observation clock is closed or reentrant");
      clockBusy = true;
      try {
        inboxRuntime("simulation-only");
        const value = suppliedClock ? suppliedClock() : Date.now();
        inboxRuntime("simulation-only");
        inboxCheck(typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value >= lastWall,
          "RUNTIME_REFUSED", "Observation clock must advance through exact nonnegative instants");
        lastWall = value; return value;
      } catch (error) { failed = true; throw depositInboxError(error, "RUNTIME_REFUSED"); }
      finally { clockBusy = false; }
    };
    const base = createDevelopmentNodeTransport({ mode: "simulation-only", sources,
      fetch: options.fetch as DevelopmentNodeTransportOptions["fetch"], clock });
    let opened = false, sealed = false, busy = false, origin = 0, lastMono = 0, startedAtMs = 0;
    const reads: ObservationReadTiming[] = [], semanticClocks: ObservationSemanticClock[] = [];
    const monotonic = () => {
      const now = performance.now();
      inboxCheck(Number.isFinite(now) && now >= lastMono && now >= origin, "RUNTIME_REFUSED", "Observation monotonic clock regressed");
      lastMono = now;
      inboxCheck(now - origin < MAX_SESSION_US / 1000, "TIMEOUT", "Observation exceeded its monotonic session interval");
      return now;
    };
    const offset = (now: number) => Math.ceil((now - origin) * 1000);
    const active = () => {
      inboxRuntime("simulation-only");
      inboxCheck(!failed && !sealed && !busy, "SESSION_CLOSED", "Observation session is closed or busy");
    };
    const transport: DevelopmentNodeTransport = Object.freeze({ openSession(execution: string, finality: string) {
      inboxRuntime("simulation-only");
      inboxCheck(!opened && execution === executionSourceId && finality === finalitySourceId,
        "REPLAY_MISMATCH", "Observation session source selection changed");
      opened = true; origin = performance.now(); lastMono = origin;
      inboxCheck(Number.isFinite(origin), "RUNTIME_REFUSED", "Observation monotonic clock is unavailable");
      const inner = base.openSession(execution, finality);
      startedAtMs = inner.startedAtMs;
      const read = async (protocol: "bsc" | "tron", source: string, operation: string, args: unknown) => {
        try {
          active(); busy = true;
          inboxCheck(reads.length < MAX_READS, "RESOURCE_LIMIT", "Observation exhausted its read budget");
          const start = monotonic(), startWall = inner.now();
          inboxCheck(Math.ceil((monotonic() - start) * 1000) < MAX_READ_US, "TIMEOUT", "Observation clock exhausted the whole-read interval");
          const result = await inner[protocol](source, operation, args);
          inboxRuntime("simulation-only");
          const returnWall = inner.now(), returned = monotonic();
          const elapsedUs = Math.ceil((returned - start) * 1000);
          inboxCheck(elapsedUs < MAX_READ_US && returnWall - startWall < MAX_READ_US / 1000,
            "TIMEOUT", "Observation read exceeded its complete response interval");
          reads.push(Object.freeze({ ordinal: reads.length + 1, startedAtMs: startWall, returnedAtMs: returnWall,
            startedElapsedUs: offset(start), returnedElapsedUs: offset(returned), elapsedUs }));
          return result;
        } catch (error) { failed = true; throw depositInboxError(error); }
        finally { busy = false; }
      };
      return Object.freeze({ startedAtMs,
        bsc: (source: string, operation: string, args: unknown) => read("bsc", source, operation, args),
        tron: (source: string, operation: string, args: unknown) => read("tron", source, operation, args),
        now() {
          try {
            active(); busy = true;
            inboxCheck(semanticClocks.length < MAX_CLOCKS, "RESOURCE_LIMIT", "Observation exhausted its semantic clock budget");
            const atMs = inner.now(), elapsedUs = offset(monotonic());
            semanticClocks.push(Object.freeze({ afterRead: reads.length, atMs, elapsedUs }));
            return atMs;
          } catch (error) { failed = true; throw depositInboxError(error); }
          finally { busy = false; }
        },
        finish() {
          try {
            active(); busy = true;
            const transcript = inner.finish();
            inboxRuntime("simulation-only"); monotonic(); rawBudget(transcript);
            inboxCheck(transcript.length === reads.length, "REPLAY_MISMATCH", "Observation timing omitted a read");
            sealed = true; return transcript;
          } catch (error) { failed = true; throw depositInboxError(error); }
          finally { busy = false; }
        },
      });
    } });
    const observe = family === "bsc" ? observeBscNodeTransfer : observeTronNodeTransfer;
    const observation = await observe({ mode: "simulation-only", transport, context, executionSourceId, finalitySourceId, policy });
    inboxRuntime("simulation-only");
    inboxCheck(opened && sealed && !failed, "SESSION_CLOSED", "Observation did not complete its session");
    const returnedAtMs = clock(), elapsedUs = offset(monotonic());
    const timing: DevelopmentObservationTiming = { startedAtMs, returnedAtMs, elapsedUs, reads, semanticClocks };
    validateTiming(observation, timing);
    const body = { kind: "development-timed-observation" as const, formatVersion: 1 as const,
      mode: "simulation-only" as const, creditAuthority: false as const, context, policy, observation, timing };
    const result = captureInboxData<TimedDevelopmentObservationV1>({ ...body, timedObservationSha256: digestInboxValue("timed-observation", body) });
    inboxRuntime("simulation-only");
    return result;
  } catch (error) { throw depositInboxError(error); }
}

function nativeJson(raw: string): unknown {
  inboxCheck(raw.charCodeAt(0) !== 0xfeff, "INVALID_RESPONSE", "Native JSON may not start with a byte order mark");
  try { return parseChainFixtureJson(raw); }
  catch { throw depositInboxError(undefined, "INVALID_RESPONSE"); }
}
function nativeRecord(value: unknown): Row {
  inboxCheck(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_RESPONSE", "Native envelope must be an object");
  return value as Row;
}
function assertTronIntegerTokens(raw: string): void {
  // This is the exact lexical number profile of the existing native transport.
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g;
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('"')) continue;
    inboxCheck(token.length <= 17 && /^-?(?:0|[1-9][0-9]*)$/.test(token) && token !== "-0",
      "INVALID_EVIDENCE", "TRON numbers must use exact native integer literals");
    const number = BigInt(token);
    inboxCheck(number <= limit && number >= -limit, "INVALID_EVIDENCE", "TRON integer exceeds the native exact range");
  }
}
const bscHash = z.string().regex(/^0x[0-9a-f]{64}$/);
const tronHash = z.string().regex(/^[0-9a-f]{64}$/);
const bscHeight = z.string().max(18).regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/);
function closedArguments(protocol: NodeReadTranscript["protocol"], operation: string, value: unknown): unknown {
  let schema: z.ZodType | undefined;
  if (protocol === "bsc-json-rpc") {
    if (operation === "eth_chainId") schema = z.tuple([]);
    if (operation === "eth_getTransactionReceipt") schema = z.tuple([bscHash]);
    if (operation === "eth_getBlockByNumber") schema = z.tuple([z.union([z.literal("finalized"), bscHeight]), z.literal(false)]);
  } else {
    if (operation === "/wallet/getblockbynum" || operation === "/walletsolidity/getblockbynum")
      schema = z.object({ num: integer, visible: z.literal(false) }).strict();
    if (operation === "/wallet/gettransactioninfobyid" || operation === "/walletsolidity/gettransactioninfobyid")
      schema = z.object({ value: tronHash, visible: z.literal(false) }).strict();
    if (operation === "/walletsolidity/getnowblock") schema = z.object({ visible: z.literal(false) }).strict();
  }
  inboxCheck(schema, "REPLAY_MISMATCH", "Transcript operation is outside the closed native read contract");
  const result = schema.safeParse(value);
  inboxCheck(result.success, "REPLAY_MISMATCH", "Transcript arguments are outside the closed native read contract");
  return result.data;
}
interface DecodedRead { transcript: NodeReadTranscript; arguments: unknown; result: unknown }
function decodeReads(observation: DevelopmentChainObservation): DecodedRead[] {
  rawBudget(observation.reads);
  let sessionId: string | undefined;
  return observation.reads.map((read, index) => {
    inboxCheck(read.responseSha256 === observationDigest(read.responseBody), "REPLAY_MISMATCH", "Raw response digest differs");
    const request = nativeRecord(nativeJson(read.requestBody));
    let args: unknown, result: unknown;
    if (read.protocol === "bsc-json-rpc") {
      const id = typeof request.id === "string" ? /^aw-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([1-9][0-9]*)$/.exec(request.id) : null;
      inboxCheck(Object.keys(request).sort().join(",") === "id,jsonrpc,method,params" && request.jsonrpc === "2.0"
        && request.method === read.operation && id && id[2] === String(index + 1) && (sessionId === undefined || sessionId === id[1]),
      "REPLAY_MISMATCH", "Original JSON-RPC request identity or order differs");
      sessionId = id[1];
      args = closedArguments(read.protocol, read.operation, request.params);
      inboxCheck(JSON.stringify({ jsonrpc: "2.0", id: request.id, method: read.operation, params: args }) === read.requestBody,
        "REPLAY_MISMATCH", "Original JSON-RPC request serialization differs");
      const response = nativeRecord(nativeJson(read.responseBody));
      inboxCheck(Object.keys(response).sort().join(",") === "id,jsonrpc,result" && response.jsonrpc === "2.0" && response.id === request.id,
        "INVALID_RESPONSE", "Original JSON-RPC response identity differs or reports failure");
      result = response.result;
    } else {
      args = closedArguments(read.protocol, read.operation, request);
      inboxCheck(JSON.stringify(args) === read.requestBody, "REPLAY_MISMATCH", "Original TRON request serialization differs");
      assertTronIntegerTokens(read.requestBody); assertTronIntegerTokens(read.responseBody);
      result = nativeRecord(nativeJson(read.responseBody));
      inboxCheck(!["Error", "error", "code"].some(key => Object.prototype.hasOwnProperty.call(result, key)),
        "INVALID_RESPONSE", "Original TRON response reports a provider failure");
    }
    // The unchanged observer's digest depends on this original field insertion order.
    const transcript = Object.freeze({ sourceId: read.sourceId, protocol: read.protocol, operation: read.operation,
      requestBody: read.requestBody, responseBody: read.responseBody, responseSha256: read.responseSha256, completedAtMs: read.completedAtMs });
    return { transcript, arguments: args, result };
  });
}

function replayTransport(bundle: TimedDevelopmentObservationV1, decoded: readonly DecodedRead[]): DevelopmentNodeTransport {
  let opened = false, closed = false, failed = false, busy = false, readIndex = 0, clockIndex = 0;
  const active = () => {
    inboxRuntime("simulation-only");
    inboxCheck(opened && !closed && !failed && !busy, "REPLAY_MISMATCH", "Replay session is closed, concurrent or reentrant");
  };
  return Object.freeze({ openSession(execution: string, finality: string) {
    inboxRuntime("simulation-only");
    inboxCheck(!opened && execution === bundle.observation.executionSourceId && finality === bundle.observation.finalitySourceId
      && execution !== finality, "REPLAY_MISMATCH", "Replay source selection differs");
    opened = true;
    const read = async (protocol: NodeReadTranscript["protocol"], source: string, operation: string, args: unknown) => {
      try {
        active(); busy = true;
        const current = decoded[readIndex];
        inboxCheck(current && current.transcript.protocol === protocol && current.transcript.sourceId === source
          && current.transcript.operation === operation && sameData(closedArguments(protocol, operation, args), current.arguments),
        "REPLAY_MISMATCH", "Replay read source, operation, order or arguments differs");
        const sample = bundle.timing.semanticClocks[clockIndex];
        inboxCheck(!sample || sample.afterRead > readIndex, "REPLAY_MISMATCH", "Replay omitted a recorded semantic clock call");
        readIndex += 1;
        return current.result;
      } catch (error) { failed = true; throw depositInboxError(error, "REPLAY_MISMATCH"); }
      finally { busy = false; }
    };
    return Object.freeze({ startedAtMs: bundle.observation.startedAtMs,
      bsc: (source: string, operation: string, args: unknown) => read("bsc-json-rpc", source, operation, args),
      tron: (source: string, operation: string, args: unknown) => read("tron-http", source, operation, args),
      now() {
        try {
          active(); busy = true;
          const sample = bundle.timing.semanticClocks[clockIndex];
          inboxCheck(sample && sample.afterRead === readIndex, "REPLAY_MISMATCH", "Replay semantic clock call differs");
          clockIndex += 1; return sample.atMs;
        } catch (error) { failed = true; throw depositInboxError(error, "REPLAY_MISMATCH"); }
        finally { busy = false; }
      },
      finish() {
        try {
          active(); busy = true;
          inboxCheck(readIndex === decoded.length && clockIndex === bundle.timing.semanticClocks.length,
            "REPLAY_MISMATCH", "Replay did not consume every original read and semantic clock");
          closed = true; return Object.freeze(decoded.map(read => read.transcript));
        } catch (error) { failed = true; throw depositInboxError(error, "REPLAY_MISMATCH"); }
        finally { busy = false; }
      },
    });
  } });
}

type BlockBody = Omit<NativeBlockSemantics, "blockSemanticsSha256" | "sourceIds">;
function blockSemantics(family: "bsc" | "tron", value: unknown, args: unknown): BlockBody {
  const block = value as Row;
  if (family === "bsc") return { number: BigInt(block.number as string).toString(), hash: (block.hash as string).toLowerCase(),
    parentHash: (block.parentHash as string).toLowerCase(), timestampMs: Number(BigInt(block.timestamp as string)) * 1000,
    transactions: (block.transactions as string[]).map(hash => hash.toLowerCase()) };
  const header = block.block_header as Row, raw = header.raw_data as Row;
  const genesis = (args as Row).num === 0 && (block.blockID as string).startsWith("0000000000000000");
  const number = genesis && !Object.hasOwn(raw, "number") ? 0 : raw.number as number;
  const timestampMs = genesis && !Object.hasOwn(raw, "timestamp") ? 0 : raw.timestamp as number;
  const parentHash = genesis && (!Object.hasOwn(raw, "parentHash") || raw.parentHash === "") ? "0".repeat(64) : (raw.parentHash as string).toLowerCase();
  const normalizedRaw: Row = { ...raw, number, timestamp: timestampMs, parentHash };
  for (const key of ["txTrieRoot", "witness_address"]) if (typeof normalizedRaw[key] === "string") normalizedRaw[key] = normalizedRaw[key].toLowerCase();
  const normalizedHeader: Row = { ...header, raw_data: normalizedRaw };
  if (typeof normalizedHeader.witness_signature === "string") normalizedHeader.witness_signature = normalizedHeader.witness_signature.toLowerCase();
  return { number: String(number), hash: (block.blockID as string).toLowerCase(), parentHash, timestampMs,
    transactions: ((block.transactions ?? []) as Row[]).map(transaction => (transaction.txID as string).toLowerCase()), header: normalizedHeader };
}
function normalizedReceipt(family: "bsc" | "tron", value: unknown): Row {
  const receipt = value as Row;
  if (family === "tron") return { id: (receipt.id as string).toLowerCase(), number: receipt.blockNumber,
    result: (receipt.receipt as Row).result, logs: (receipt.log as Row[]).map(log => ({ address: (log.address as string).toLowerCase(),
      topics: (log.topics as string[]).map(topic => topic.toLowerCase()), data: (log.data as string).toLowerCase() })) };
  const normalize = (item: unknown): unknown => {
    if (typeof item === "string" && item.startsWith("0x")) return item.toLowerCase();
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, normalize(child)]));
    return item;
  };
  return normalize(receipt) as Row;
}
function extractSemantics(observation: DevelopmentChainObservation, decoded: readonly DecodedRead[]): ReplayedDevelopmentObservationSemantics {
  const { transfer } = observation, family = transfer.family;
  const blocks = new Map<string, { body: BlockBody; sourceIds: Set<string> }>();
  let head: BlockBody | undefined, receipt: Row | undefined;
  for (const read of decoded) {
    const operation = read.transcript.operation;
    if (operation === "eth_getBlockByNumber" || operation.endsWith("/getblockbynum") || operation.endsWith("/getnowblock")) {
      const body = blockSemantics(family, read.result, read.arguments), previous = blocks.get(body.number);
      inboxCheck(!previous || sameData(previous.body, body), "SOURCE_CONFLICT", "Replayed block semantics changed at one height");
      if (previous) previous.sourceIds.add(read.transcript.sourceId);
      else blocks.set(body.number, { body, sourceIds: new Set([read.transcript.sourceId]) });
      if ((family === "bsc" && (read.arguments as unknown[])[0] === "finalized") || operation === "/walletsolidity/getnowblock") head = body;
    }
    if (receipt === undefined && (operation === "eth_getTransactionReceipt" || operation.endsWith("/gettransactioninfobyid")))
      receipt = normalizedReceipt(family, read.result);
  }
  inboxCheck(head && receipt, "REPLAY_MISMATCH", "Replay has no validated head or complete receipt");
  const normalizedBlocks = [...blocks.values()].sort((a, b) => BigInt(a.body.number) < BigInt(b.body.number) ? -1 : 1)
    .map(({ body, sourceIds }) => ({ ...body, blockSemanticsSha256: digestInboxValue("block-semantics", { chainKey: transfer.chainKey, ...body }),
      sourceIds: [...sourceIds].sort() }));
  const containingBlock = normalizedBlocks.find(block => block.number === transfer.blockNumber && block.hash === transfer.blockHash);
  inboxCheck(containingBlock, "REPLAY_MISMATCH", "Replay has no validated containing block");
  const receiptSemanticsSha256 = digestInboxValue("receipt-semantics", { chainKey: transfer.chainKey, receipt });
  return captureInboxData<ReplayedDevelopmentObservationSemantics>({ kind: "replayed-development-observation-semantics", mode: "simulation-only",
    creditAuthority: false, family, chainKey: transfer.chainKey, transfer,
    pinnedCheckpoint: { number: transfer.checkpointNumber, hash: transfer.checkpointHash, timestampMs: observation.checkpointTimestampMs },
    lastValidatedHead: { number: head.number, hash: head.hash, timestampMs: head.timestampMs }, containingBlock,
    receiptSemantics: receipt, receiptSemanticsSha256,
    transactionAnchor: { chainKey: transfer.chainKey, transactionId: transfer.transactionId, blockNumber: transfer.blockNumber,
      blockHash: transfer.blockHash, transactionIndex: transfer.transactionIndex, receiptSemanticsSha256 }, blocks: normalizedBlocks });
}

/** Pure archival replay. Checksums and timing establish internal consistency only; nothing grants credit authority. */
export async function replayTimedDevelopmentObservation(value: unknown): Promise<ReplayedDevelopmentObservation> {
  try {
    inboxRuntime("simulation-only");
    const captured = captureInboxData(value, { maxNodes: 20_000, maxDepth: 16 });
    const result = timedSchema.safeParse(captured);
    inboxCheck(result.success, "INVALID_INPUT", "Timed observation is outside the closed versioned format");
    const parsed = result.data, family = familyOf(parsed.context);
    const context = captureObservationContext(parsed.context, family), policy = captureObservationPolicy(parsed.policy);
    inboxCheck(sameData(context, parsed.context) && sameData(policy, parsed.policy), "REPLAY_MISMATCH", "Timed context or policy is not canonical and complete");
    const bundle = captureInboxData<TimedDevelopmentObservationV1>({ ...parsed, context, policy });
    inboxCheck(digestInboxValue("timed-observation", timedBody(bundle)) === bundle.timedObservationSha256,
      "REPLAY_MISMATCH", "Timed observation digest differs");
    inboxCheck(bundle.observation.transfer.family === family && bundle.observation.executionSourceId !== bundle.observation.finalitySourceId,
      "REPLAY_MISMATCH", "Timed observation chain or selected source identity differs");
    validateTiming(bundle.observation, bundle.timing);
    const decoded = decodeReads(bundle.observation), transport = replayTransport(bundle, decoded);
    const observe = family === "bsc" ? observeBscNodeTransfer : observeTronNodeTransfer;
    const observation = await observe({ mode: "simulation-only", transport, context, policy,
      executionSourceId: bundle.observation.executionSourceId, finalitySourceId: bundle.observation.finalitySourceId });
    inboxCheck(sameData(observation, bundle.observation), "REPLAY_MISMATCH", "Recomputed observation or original transcript digest differs");
    const semantics = extractSemantics(observation, decoded);
    inboxRuntime("simulation-only");
    // Each child is already fully immutable. Avoid copying the raw transcript a
    // second time merely because the API exposes both the bundle and its result.
    return Object.freeze({ timedObservation: bundle, observation, semantics });
  } catch (error) { throw depositInboxError(error, "REPLAY_MISMATCH"); }
}
