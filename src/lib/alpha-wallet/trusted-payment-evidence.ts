import "server-only";

import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { z } from "zod";
import { walletDigest } from "./commands";
import { captureInboxData, captureInboxOptions } from "./deposit-inbox-data";
import { balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import { v5PaymentClaimKey } from "./v5-commands";
import { verifyV5History } from "./v5-durable";
import { isV5State } from "./v5-engine";

/** Fixture-source consistency only. No caller, checksum or prepared record can authorize a payment or payout. */
export const TRUSTED_PAYMENT_EVIDENCE_FORMAT = "development-prepared-trusted-payment-evidence" as const;
export type TrustedPaymentEvidenceErrorCode = "INVALID_INPUT" | "RUNTIME_REFUSED" | "ADMISSION_REFUSED"
  | "INVALID_HISTORY" | "BINDING_MISMATCH" | "INVALID_OBSERVATION" | "STALE_CHECKPOINT" | "SOURCE_FAILURE" | "TIMEOUT";
export class TrustedPaymentEvidenceError extends Error {
  readonly executionAuthority = false;
  readonly releaseAuthority = false;
  constructor(readonly code: TrustedPaymentEvidenceErrorCode, message: string) {
    super(message); this.name = "TrustedPaymentEvidenceError";
  }
}
function check(value: unknown, code: TrustedPaymentEvidenceErrorCode, message: string): asserts value {
  if (!value) throw new TrustedPaymentEvidenceError(code, message);
}
function runtime(mode: unknown): void {
  try { assertSimulationRuntime(typeof mode === "string" ? mode : undefined); }
  catch { throw new TrustedPaymentEvidenceError("RUNTIME_REFUSED", "Fiat evidence requires an explicit local simulation-only runtime"); }
}
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.number().int().min(1).max(8_640_000_000_000_000).refine(value => !Object.is(value, -0));
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const minor = z.string().min(1).max(78).regex(/^(?:0|[1-9][0-9]*)$/);
const method = z.enum(["Bank Transfer", "Face-to-Face (Meet in Person)"]);
const recipientSchema = z.strictObject({ recipientAccountId: id, sellerId: id, paymentInstructionsDigest: hex });
const sourceSchema = z.strictObject({
  sourceId: id, authorityId: id,
  kind: z.enum(["synthetic-bank-feed", "synthetic-independent-cash-custodian"]),
  enabled: z.boolean(), validFromMs: instant, validUntilMs: instant,
  maxObservationAgeMs: z.number().int().min(1).max(300_000),
  recipients: z.array(recipientSchema).min(1).max(32),
});
export const trustedPaymentManifestSchema = z.strictObject({
  kind: z.literal("development-trusted-payment-admission"), formatVersion: z.literal(1), mode: z.literal("simulation-only"),
  assurance: z.literal("synthetic-source-consistency-only"), sources: z.array(sourceSchema).min(1).max(16),
});
export type TrustedPaymentManifestV1 = z.infer<typeof trustedPaymentManifestSchema>;
export type TrustedPaymentAdmission = Readonly<{ manifest: TrustedPaymentManifestV1; manifestSha256: string }>;

const paymentBindingSchema = z.strictObject({
  platformRequestId: id, platformTradeId: id, sellerId: id, buyerId: id,
  acceptanceKey: hex, claimKey: hex, termsDigest: hex, paymentInstructionsDigest: hex, recipientAccountId: id,
  paymentMethod: method, amountMinor: minor, currency: z.literal("ILS"),
});
export const trustedPaymentObservationSchema = z.strictObject({
  kind: z.enum(["synthetic-bank-credit", "synthetic-independent-cash-receipt"]),
  sourceId: id, authorityId: id, transactionId: id, revision,
  status: z.enum(["pending", "settled", "reversed", "revoked", "rejected"]),
  occurredAtMs: instant, settledAtMs: instant.nullable(), observedAtMs: instant,
  payment: paymentBindingSchema,
});
export type TrustedPaymentObservationV1 = z.infer<typeof trustedPaymentObservationSchema>;
export type TrustedPaymentObservationStatus = TrustedPaymentObservationV1["status"];
const checkpointSchema = z.strictObject({ revision, eventHash: hex, stateHash: hex, lastCommandAtMs: instant });
const walletContextSchema = z.strictObject({
  platformRequestId: id, platformTradeId: id, platformListingId: id, walletTradeId: id, walletListingId: id,
  sellerId: id, buyerId: id, assetId: z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]),
  principalRaw: minor, amountMinor: minor, currency: z.literal("ILS"), paymentMethod: method,
  paymentInstructionsDigest: hex, destinationSha256: hex, termsDigest: hex,
  acceptanceKey: hex, acceptanceReceiptSha256: hex, claimKey: hex, claimReceiptSha256: hex,
  acceptedAtMs: instant, claimedAtMs: instant, checkpoint: checkpointSchema,
  walletTradeSha256: hex, recordedOperatorIds: z.array(id).max(256), paused: z.boolean(), disputed: z.boolean(),
});
export type TrustedPaymentWalletContextV1 = z.infer<typeof walletContextSchema>;
const eligibilitySchema = z.strictObject({
  sourceReportsSettled: z.boolean(), fresh: z.boolean(), sourceActive: z.boolean(), walletUnpaused: z.boolean(),
  undisputed: z.boolean(), eligibleForLaterVerification: z.boolean(),
});
export type TrustedPaymentEligibilityV1 = z.infer<typeof eligibilitySchema>;
const historyRow = z.strictObject({
  revision: z.union([revision, z.string().regex(/^[1-9][0-9]{0,15}$/)]), command_key: z.string().min(1).max(512),
  command_type: z.string().min(1).max(80), occurred_at_ms: z.union([instant, z.string().regex(/^[1-9][0-9]{0,15}$/)]),
  command_json: z.unknown(), input_hash: hex, result_json: z.unknown(), result_hash: hex, state_hash: hex,
  previous_event_hash: hex, event_hash: hex,
});
const historySchema = z.array(historyRow).min(1).max(256);
export type TrustedPaymentWalletHistory = z.infer<typeof historySchema>;
export const preparedTrustedPaymentEvidenceSchema = z.strictObject({
  kind: z.literal(TRUSTED_PAYMENT_EVIDENCE_FORMAT), formatVersion: z.literal(1), mode: z.literal("simulation-only"),
  executionAuthority: z.literal(false), releaseAuthority: z.literal(false), assurance: z.literal("synthetic-source-consistency-only"),
  manifestSha256: hex, sourceId: id, transactionId: id, nativePaymentKey: hex, paymentFactsSha256: hex, observationSha256: hex,
  walletContext: walletContextSchema, observation: trustedPaymentObservationSchema, eligibility: eligibilitySchema,
  walletHistory: historySchema, preparedAtMs: instant, preparationSha256: hex,
});
export type PreparedTrustedPaymentEvidenceV1 = z.infer<typeof preparedTrustedPaymentEvidenceSchema>;
export type TrustedPaymentEvidenceRequest = Readonly<{ requestId: string; sourceId: string; transactionId: string }>;
export type TrustedPaymentSourceQuery = Readonly<{ sourceId: string; authorityId: string; transactionId: string }>;
export interface DevelopmentTrustedPaymentReaderOptions {
  mode: "simulation-only";
  manifest: unknown;
  /** A trusted fixture adapter reads retained commands. A body-supplied checkpoint is never a substitute. */
  readWalletHistory: () => unknown | Promise<unknown>;
  /** No expected amount/recipient is supplied to the source: it must return its own retained observation. */
  readEvidence: (query: TrustedPaymentSourceQuery) => unknown | Promise<unknown>;
  clock: () => number;
}
export interface DevelopmentTrustedPaymentReader {
  readonly mode: "simulation-only";
  readonly executionAuthority: false;
  readonly releaseAuthority: false;
  readonly manifestSha256: string;
  prepare(request: TrustedPaymentEvidenceRequest): Promise<PreparedTrustedPaymentEvidenceV1>;
}
const DATA_LIMITS = { maxBytes: 4 * 1_048_576, maxNodes: 40_000, maxDepth: 48, maxStringBytes: 32_768 };
function capture<T>(value: unknown): T {
  try { return captureInboxData<T>(value, DATA_LIMITS); }
  catch { throw new TrustedPaymentEvidenceError("INVALID_INPUT", "Fiat evidence requires bounded inert data without executable fields"); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown, code: TrustedPaymentEvidenceErrorCode = "INVALID_INPUT"): T {
  const result = schema.safeParse(capture(value));
  check(result.success, code, "Fiat evidence does not match its closed development contract");
  return capture<T>(result.data);
}
function options(value: unknown, allowed: readonly string[]) {
  try { return captureInboxOptions(value, allowed); }
  catch { throw new TrustedPaymentEvidenceError("INVALID_INPUT", "Fiat evidence options must be explicit inert fields"); }
}
/** Domain-separated consistency digest. This function never authenticates a source. */
export function trustedPaymentDigest(domain: string, value: unknown): string {
  check(typeof domain === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(domain), "INVALID_INPUT", "Invalid fiat evidence digest domain");
  return walletDigest(["alpha-wallet-trusted-payment-evidence-v1", domain, capture(value)]);
}
export function captureTrustedPaymentManifest(value: unknown): TrustedPaymentAdmission {
  runtime("simulation-only");
  const manifest = parse(trustedPaymentManifestSchema, value), sourceIds = new Set<string>(), authorities = new Set<string>();
  for (const source of manifest.sources) {
    check(!sourceIds.has(source.sourceId) && !authorities.has(source.authorityId), "ADMISSION_REFUSED", "Fiat source aliases are not independent admissions");
    sourceIds.add(source.sourceId); authorities.add(source.authorityId);
    check(source.validUntilMs > source.validFromMs, "ADMISSION_REFUSED", "Fiat source validity interval is empty");
    const accounts = new Set<string>(), instructions = new Set<string>();
    for (const recipient of source.recipients) {
      const binding = JSON.stringify([recipient.sellerId, recipient.paymentInstructionsDigest]);
      check(!accounts.has(recipient.recipientAccountId) && !instructions.has(binding)
        && recipient.sellerId !== source.authorityId, "ADMISSION_REFUSED", "Fiat recipient mappings must be unique and independent of the source authority");
      accounts.add(recipient.recipientAccountId); instructions.add(binding);
    }
  }
  return capture({ manifest, manifestSha256: trustedPaymentDigest("admission", manifest) });
}

function contextFromHistory(history: TrustedPaymentWalletHistory, requestId: string): TrustedPaymentWalletContextV1 {
  let snapshot: ReturnType<typeof verifyV5History>;
  try { snapshot = verifyV5History(history); }
  catch { throw new TrustedPaymentEvidenceError("INVALID_HISTORY", "Fiat evidence requires the exact replayable wallet command history"); }
  check(isV5State(snapshot.state), "INVALID_HISTORY", "Fiat evidence requires the explicit V5 buyer-claim profile");
  const state = snapshot.state, binding = state.initialBindings.get(requestId);
  check(binding, "BINDING_MISMATCH", "Fiat evidence requires an existing initial reservation");
  const accepted = state.initialAcceptanceReceipts.get(binding.acceptanceKey);
  const claim = state.initialPaymentClaimReceipts.get(v5PaymentClaimKey(requestId, binding.acceptanceKey));
  const trade = state.trades.get(binding.walletTradeId);
  check(accepted && claim && trade && trade.status === "payment_reported" && !trade.evidence && !trade.authorization && !trade.payoutId
    && balance(state, binding.assetId, `trade:${trade.id}`).toString() === binding.terms.principalRaw,
  "BINDING_MISMATCH", "Fiat evidence requires the retained unverified claim and its full original reservation");
  const terms = binding.terms;
  // Read only after the complete inert history passes its original strict command parsers.
  // This is a bounded exact exclusion set, not discovery/authentication of every real account or provider.
  const recordedOperatorIds = [...new Set(history.map(row => (row.command_json as { actor: { kind: string; id: string } }).actor)
    .filter(actor => actor.kind === "operator").map(actor => actor.id))].sort();
  return parse(walletContextSchema, {
    platformRequestId: terms.platformRequestId, platformTradeId: terms.platformTradeId, platformListingId: terms.platformListingId,
    walletTradeId: binding.walletTradeId, walletListingId: binding.walletListingId, sellerId: terms.sellerId, buyerId: terms.buyerId,
    assetId: terms.assetId, principalRaw: terms.principalRaw, amountMinor: terms.fiatTotalMinor, currency: terms.currency,
    paymentMethod: terms.paymentMethod, paymentInstructionsDigest: terms.paymentInstructionsDigest,
    destinationSha256: trustedPaymentDigest("crypto-destination", terms.destination), termsDigest: binding.termsDigest,
    acceptanceKey: accepted.acceptanceKey, acceptanceReceiptSha256: walletDigest(accepted),
    claimKey: claim.claimKey, claimReceiptSha256: walletDigest(claim), acceptedAtMs: accepted.acceptedAtMs, claimedAtMs: claim.claimedAtMs,
    checkpoint: { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(state), lastCommandAtMs: snapshot.lastCommandAtMs },
    walletTradeSha256: walletDigest(trade), recordedOperatorIds, paused: state.haltReason !== null, disputed: trade.disputed,
  }, "INVALID_HISTORY");
}
function sourceFor(admission: TrustedPaymentAdmission, sourceId: string) {
  const source = admission.manifest.sources.find(item => item.sourceId === sourceId);
  check(source, "ADMISSION_REFUSED", "Fiat evidence source is not admitted");
  return source;
}
function evaluate(admission: TrustedPaymentAdmission, sourceId: string, transactionId: string,
  context: TrustedPaymentWalletContextV1, observation: TrustedPaymentObservationV1, preparedAtMs: number): TrustedPaymentEligibilityV1 {
  const source = sourceFor(admission, sourceId), bank = context.paymentMethod === "Bank Transfer";
  check(source.authorityId !== context.sellerId && source.authorityId !== context.buyerId
    && !context.recordedOperatorIds.includes(source.authorityId)
    && source.kind === (bank ? "synthetic-bank-feed" : "synthetic-independent-cash-custodian"),
  "ADMISSION_REFUSED", "Fiat verification requires an independent admitted source for the exact payment method");
  const recipient = source.recipients.find(item => item.sellerId === context.sellerId
    && item.paymentInstructionsDigest === context.paymentInstructionsDigest);
  check(recipient, "ADMISSION_REFUSED", "Frozen fiat instructions have no explicit admitted recipient account");
  check(observation.sourceId === sourceId && observation.transactionId === transactionId && observation.authorityId === source.authorityId
    && observation.kind === (bank ? "synthetic-bank-credit" : "synthetic-independent-cash-receipt"),
  "INVALID_OBSERVATION", "Fiat observation source or native transaction identity changed");
  const expected = { platformRequestId: context.platformRequestId, platformTradeId: context.platformTradeId,
    sellerId: context.sellerId, buyerId: context.buyerId, acceptanceKey: context.acceptanceKey, claimKey: context.claimKey,
    termsDigest: context.termsDigest, paymentInstructionsDigest: context.paymentInstructionsDigest,
    recipientAccountId: recipient.recipientAccountId, paymentMethod: context.paymentMethod, amountMinor: context.amountMinor, currency: context.currency };
  check(walletDigest(observation.payment) === walletDigest(expected), "BINDING_MISMATCH", "Fiat observation does not bind the exact original claim, amount, parties and admitted recipient");
  check(preparedAtMs >= context.checkpoint.lastCommandAtMs && observation.occurredAtMs >= context.acceptedAtMs
    && observation.occurredAtMs <= observation.observedAtMs && observation.observedAtMs <= preparedAtMs,
  "INVALID_OBSERVATION", "Fiat observation chronology does not follow the original acceptance and current read");
  const settledAt = observation.settledAtMs;
  check(settledAt === null || (settledAt >= observation.occurredAtMs && settledAt <= observation.observedAtMs),
    "INVALID_OBSERVATION", "Fiat settlement time is outside the observed transaction");
  check(observation.status === "settled" || observation.status === "reversed" ? settledAt !== null
    : observation.status === "pending" || observation.status === "rejected" ? settledAt === null : true,
  "INVALID_OBSERVATION", "Fiat status and settlement time disagree");
  const flags = {
    sourceReportsSettled: observation.status === "settled",
    fresh: preparedAtMs - observation.observedAtMs < source.maxObservationAgeMs,
    sourceActive: source.enabled && source.validFromMs <= preparedAtMs && preparedAtMs < source.validUntilMs,
    walletUnpaused: !context.paused, undisputed: !context.disputed,
  };
  return capture({ ...flags, eligibleForLaterVerification: Object.values(flags).every(Boolean) });
}

function build(admission: TrustedPaymentAdmission, sourceId: string, transactionId: string,
  walletHistory: TrustedPaymentWalletHistory, context: TrustedPaymentWalletContextV1,
  observation: TrustedPaymentObservationV1, preparedAtMs: number): PreparedTrustedPaymentEvidenceV1 {
  const eligibility = evaluate(admission, sourceId, transactionId, context, observation, preparedAtMs);
  const body = {
    kind: TRUSTED_PAYMENT_EVIDENCE_FORMAT, formatVersion: 1 as const, mode: "simulation-only" as const,
    executionAuthority: false as const, releaseAuthority: false as const, assurance: "synthetic-source-consistency-only" as const,
    manifestSha256: admission.manifestSha256, sourceId, transactionId,
    nativePaymentKey: trustedPaymentDigest("native-payment", [admission.manifestSha256, sourceId, transactionId]),
    paymentFactsSha256: trustedPaymentDigest("payment-facts", { sourceId, authorityId: observation.authorityId, transactionId,
      kind: observation.kind, occurredAtMs: observation.occurredAtMs, payment: observation.payment }),
    observationSha256: trustedPaymentDigest("observation", observation), walletContext: context, observation, eligibility,
    walletHistory, preparedAtMs,
  };
  return capture({ ...body, preparationSha256: trustedPaymentDigest("preparation", body) });
}

/**
 * Replays an archived preparation for historical consistency, including negative observations.
 * A self-consistent archive is not source authentication or proof of current authority/freshness.
 */
export function verifyPreparedTrustedPaymentEvidence(supplied: {
  mode: "simulation-only"; manifest: unknown; prepared: unknown;
}): PreparedTrustedPaymentEvidenceV1 {
  runtime("simulation-only");
  const input = options(supplied, ["mode", "manifest", "prepared"]); runtime(input.mode);
  const admission = captureTrustedPaymentManifest(input.manifest), prepared = parse(preparedTrustedPaymentEvidenceSchema, input.prepared);
  check(prepared.manifestSha256 === admission.manifestSha256, "ADMISSION_REFUSED", "Fiat preparation belongs to another admission");
  const context = contextFromHistory(prepared.walletHistory, prepared.walletContext.platformRequestId);
  const expected = build(admission, prepared.sourceId, prepared.transactionId, prepared.walletHistory, context, prepared.observation, prepared.preparedAtMs);
  check(walletDigest(prepared) === walletDigest(expected), "BINDING_MISMATCH", "Fiat preparation differs from its original replayable evidence");
  runtime(input.mode); return expected;
}

/** Private fixture adapter. It performs no network call, database write, signing, account login or ledger command. */
export function createDevelopmentTrustedPaymentReader(supplied: DevelopmentTrustedPaymentReaderOptions): DevelopmentTrustedPaymentReader {
  runtime("simulation-only");
  const input = options(supplied, ["mode", "manifest", "readWalletHistory", "readEvidence", "clock"]); runtime(input.mode);
  const admission = captureTrustedPaymentManifest(input.manifest);
  for (const name of ["readWalletHistory", "readEvidence", "clock"]) {
    check(typeof input[name] === "function" && !types.isProxy(input[name]), "INVALID_INPUT", "Fiat fixture adapters must be explicit trusted functions");
  }
  const readHistory = input.readWalletHistory as DevelopmentTrustedPaymentReaderOptions["readWalletHistory"];
  const readEvidence = input.readEvidence as DevelopmentTrustedPaymentReaderOptions["readEvidence"];
  const clock = input.clock as DevelopmentTrustedPaymentReaderOptions["clock"];
  const now = () => {
    let value: unknown;
    try { value = clock(); } catch { throw new TrustedPaymentEvidenceError("SOURCE_FAILURE", "Fiat fixture clock failed"); }
    return parse(instant, value);
  };
  return Object.freeze({ mode: "simulation-only" as const, executionAuthority: false as const, releaseAuthority: false as const,
    manifestSha256: admission.manifestSha256,
    async prepare(value: TrustedPaymentEvidenceRequest) {
      runtime(input.mode);
      const request = parse(z.strictObject({ requestId: id, sourceId: id, transactionId: id }), value);
      const source = sourceFor(admission, request.sourceId), startedAt = now(), monotonicStart = performance.now();
      const read = async (callback: () => unknown | Promise<unknown>): Promise<unknown> => {
        runtime(input.mode);
        const remaining = 30_000 - (performance.now() - monotonicStart);
        check(remaining > 0, "TIMEOUT", "Fiat evidence preparation exceeded its bounded read deadline");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Untrusted callback rejection text is never returned or persisted.
          // Inert provider records must not acquire promise/thenable execution.
          let returned: unknown;
          try { returned = callback(); }
          catch { throw new TrustedPaymentEvidenceError("SOURCE_FAILURE", "Fiat fixture evidence adapter failed"); }
          let pending: Promise<unknown>;
          if (returned !== null && typeof returned === "object" && !types.isProxy(returned) && types.isPromise(returned)) {
            check(Object.getPrototypeOf(returned) === Promise.prototype && Reflect.ownKeys(returned).length === 0,
              "INVALID_INPUT", "Fiat fixture adapters must return ordinary promises or inert data");
            pending = Promise.prototype.then.call(returned, capture, () => {
              throw new TrustedPaymentEvidenceError("SOURCE_FAILURE", "Fiat fixture evidence adapter failed");
            }) as Promise<unknown>;
          } else pending = Promise.resolve(capture(returned));
          return await Promise.race([
            pending,
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TrustedPaymentEvidenceError("TIMEOUT", "Fiat evidence preparation exceeded its bounded read deadline")), remaining); }),
          ]);
        } finally { if (timer !== undefined) clearTimeout(timer); runtime(input.mode); }
      };
      const history = parse(historySchema, await read(readHistory), "INVALID_HISTORY");
      const context = contextFromHistory(history, request.requestId);
      // Check scope before invoking the source. An unadmitted recipient never causes a lookup.
      check(source.authorityId !== context.sellerId && source.authorityId !== context.buyerId
        && !context.recordedOperatorIds.includes(source.authorityId)
        && source.kind === (context.paymentMethod === "Bank Transfer" ? "synthetic-bank-feed" : "synthetic-independent-cash-custodian")
        && source.recipients.some(item => item.sellerId === context.sellerId && item.paymentInstructionsDigest === context.paymentInstructionsDigest),
      "ADMISSION_REFUSED", "Fiat source does not independently admit the original payment recipient and method");
      const query = capture<TrustedPaymentSourceQuery>({ sourceId: source.sourceId, authorityId: source.authorityId, transactionId: request.transactionId });
      const observation = parse(trustedPaymentObservationSchema, await read(() => readEvidence(query)), "INVALID_OBSERVATION");
      const after = parse(historySchema, await read(readHistory), "INVALID_HISTORY");
      check(walletDigest(history) === walletDigest(after), "STALE_CHECKPOINT", "Wallet history changed while preparing fiat evidence");
      const preparedAt = now();
      check(preparedAt >= startedAt && preparedAt - startedAt < 30_000 && performance.now() - monotonicStart < 30_000,
        "TIMEOUT", "Fiat evidence preparation clock is stale or moved backwards");
      runtime(input.mode);
      return build(admission, request.sourceId, request.transactionId, history, context, observation, preparedAt);
    },
  });
}
