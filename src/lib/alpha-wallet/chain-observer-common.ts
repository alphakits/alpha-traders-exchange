import "server-only";
import { z } from "zod";
import type { FixtureChain, TransferFixtureContext, VerifiedFixtureTransfer } from "./chain-evidence";
import { NodeObservationError, observationDigest, observationRuntime,
  type DevelopmentNodeTransport, type NodeObservationErrorCode, type NodeObservationSession, type NodeReadTranscript } from "./chain-observer-rpc";
export { observationDigest, observationRuntime, NodeObservationError } from "./chain-observer-rpc";

export interface ObserverInput {
  mode: "simulation-only";
  transport: DevelopmentNodeTransport;
  context: unknown;
  executionSourceId: string;
  finalitySourceId: string;
  policy?: unknown;
}
export interface ObservationPolicy { maxAncestry: number; maxCheckpointAgeMs: number; maxFutureSkewMs: number }
export interface DevelopmentChainObservation {
  readonly kind: "development-chain-observation";
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly assurance: "configured-node-consistency-only";
  readonly transfer: VerifiedFixtureTransfer;
  readonly executionSourceId: string;
  readonly finalitySourceId: string;
  readonly checkpointTimestampMs: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly reads: readonly NodeReadTranscript[];
  readonly observationSha256: string;
}
const decimal = (max: bigint, positive = false) => z.string().min(1).max(78).refine(v => v.length <= 78 && /^(?:0|[1-9][0-9]*)$/.test(v)
  && BigInt(v) <= max && (!positive || BigInt(v) > BigInt(0)));
const bscHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(s => s.toLowerCase());
const tronHash = z.string().regex(/^[0-9a-fA-F]{64}$/).transform(s => s.toLowerCase());
const chainSchema = z.discriminatedUnion("family", [
  z.object({ family: z.literal("bsc"), chainId: z.enum(["56", "97"]), genesisHash: bscHash }).strict(),
  z.object({ family: z.literal("tron"), network: z.enum(["mainnet", "nile", "shasta"]),
    genesisHash: tronHash.refine(s => s.startsWith("0000000000000000")) }).strict(),
]);
const contextSchema = z.object({ mode: z.literal("development-fixture"), chain: chainSchema,
  token: z.string(), recipient: z.string(), transactionId: z.string(),
  amountRaw: decimal((BigInt(1) << BigInt(256)) - BigInt(1), true), eventIndex: decimal((BigInt(1) << BigInt(64)) - BigInt(1)),
}).strict();
const policySchema = z.object({ maxAncestry: z.number().int().min(0).max(64).default(64),
  maxCheckpointAgeMs: z.number().int().min(1).max(600_000).default(120_000),
  maxFutureSkewMs: z.number().int().min(0).max(30_000).default(5_000),
}).strict();
export function observationCheck(value: unknown, code: NodeObservationErrorCode, message: string): asserts value {
  if (!value) throw new NodeObservationError(code, message);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { const result = schema.safeParse(value); if (result.success) return result.data; }
  catch { /* Malformed data may not escape as an untyped coercion error. */ }
  throw new NodeObservationError("INVALID_INPUT", "Observation context or policy is invalid");
}
/** Capture top-level data without invoking caller getters before the runtime guard. */
export function captureObserverInput(value: unknown): ObserverInput {
  try {
    observationCheck(value !== null && typeof value === "object" && !Array.isArray(value),
      "INVALID_INPUT", "Observer input must be a plain data object");
    const prototype = Object.getPrototypeOf(value);
    observationCheck(prototype === Object.prototype || prototype === null, "INVALID_INPUT", "Observer input must be plain data");
    const captured: Record<string, unknown> = {};
    const allowed = new Set(["mode", "transport", "context", "executionSourceId", "finalitySourceId", "policy"]);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      observationCheck(typeof key === "string" && allowed.has(key) && descriptor.enumerable && "value" in descriptor,
        "INVALID_INPUT", "Observer input contains an unsupported or executable field");
      captured[key] = descriptor.value;
    }
    observationRuntime(captured.mode);
    const parsed = parse(z.object({ mode: z.literal("simulation-only"), transport: z.unknown(), context: z.unknown(),
      executionSourceId: z.string().min(1).max(100), finalitySourceId: z.string().min(1).max(100), policy: z.unknown().optional(),
    }).strict(), captured);
    const transport = parsed.transport as DevelopmentNodeTransport | null | undefined;
    const openSession = transport?.openSession;
    observationCheck(typeof openSession === "function", "INVALID_INPUT", "Observation requires an explicit development transport");
    return Object.freeze({ ...parsed, transport: Object.freeze({ openSession: (execution: string, finality: string) =>
      Reflect.apply(openSession, transport, [execution, finality]) as NodeObservationSession }) });
  } catch (error) {
    if (error instanceof NodeObservationError) throw error;
    throw new NodeObservationError("INVALID_INPUT", "Observer input could not be captured as plain data");
  }
}
export function captureObservationContext(value: unknown, family: FixtureChain["family"]): TransferFixtureContext {
  const context = parse(contextSchema, value);
  observationCheck(context.chain.family === family, "INVALID_INPUT", "Observation chain family conflicts");
  const address = family === "bsc" ? z.string().regex(/^0x[0-9a-fA-F]{40}$/) : z.string().regex(/^41[0-9a-fA-F]{40}$/);
  const token = parse(address, context.token).toLowerCase(), recipient = parse(address, context.recipient).toLowerCase();
  const transactionId = parse(family === "bsc" ? bscHash : tronHash, context.transactionId);
  return Object.freeze({ ...context, chain: Object.freeze({ ...context.chain }), token, recipient, transactionId });
}
export function captureObservationPolicy(value: unknown = {}): ObservationPolicy { return Object.freeze(parse(policySchema, value)); }
export function checkCheckpointFreshness(timestampMs: number, now: number, policy: ObservationPolicy): void {
  observationCheck(Number.isSafeInteger(timestampMs) && timestampMs >= 0 && Number.isSafeInteger(now) && now >= 0,
    "INVALID_EVIDENCE", "Checkpoint clock is not an exact millisecond instant");
  observationCheck(timestampMs <= now + policy.maxFutureSkewMs && now - timestampMs <= policy.maxCheckpointAgeMs,
    "STALE_CHECKPOINT", "Checkpoint is outside the permitted freshness window");
}
export function safeObservationVerification<T>(work: () => T): T {
  try { return work(); }
  catch (error) {
    if (error instanceof NodeObservationError) throw error;
    throw new NodeObservationError("INVALID_EVIDENCE", "Native transaction evidence failed the frozen transfer decoder");
  }
}
export function sealDevelopmentObservation(args: { session: NodeObservationSession; transfer: VerifiedFixtureTransfer;
  executionSourceId: string; finalitySourceId: string; checkpointTimestampMs: number; policy: ObservationPolicy }): DevelopmentChainObservation {
  observationRuntime("simulation-only");
  const completedAtMs = args.session.now();
  checkCheckpointFreshness(args.checkpointTimestampMs, completedAtMs, args.policy);
  const reads = args.session.finish();
  const body = { kind: "development-chain-observation" as const, mode: "simulation-only" as const, creditAuthority: false as const,
    assurance: "configured-node-consistency-only" as const, transfer: args.transfer,
    executionSourceId: args.executionSourceId, finalitySourceId: args.finalitySourceId,
    checkpointTimestampMs: args.checkpointTimestampMs, startedAtMs: args.session.startedAtMs, completedAtMs, reads };
  return Object.freeze({ ...body, observationSha256: observationDigest(body) });
}
