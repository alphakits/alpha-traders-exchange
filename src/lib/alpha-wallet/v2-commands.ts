import { z } from "zod";
import { COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import { MARKETPLACE_PAYMENT_METHODS } from "@/lib/marketplace-payment-methods";
import type { AcceptedAmountTermsPlan, DevelopmentTradeTerms } from "./accepted-terms";
import { parseWalletCommand, walletDigest, WALLET_ENGINE_VERSION, type WalletCommand, type WalletCommandType, type ResultOf } from "./commands";
import type { Actor } from "./types";
import type { V2AcceptanceReceipt, V2Continuation, V2TermsBinding } from "./v2-engine";

/** A separate envelope; the v1 schema and command identities remain unchanged. */
export const WALLET_V2_ENGINE_VERSION = "alpha-wallet-simulation-v2" as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
const decimal = z.string().min(1).max(100).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const asset = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const actor = z.strictObject({ kind: z.enum(["seller", "buyer", "operator", "verifier", "dispatcher"]), id });

export const v2CheckpointSchema = z.strictObject({ revision: safe, eventHash: hex, stateHash: hex, lastCommandAtMs: safe });
export type V2Checkpoint = z.infer<typeof v2CheckpointSchema>;

/** Only canonical public terms and a digest of private instructions are stored. */
export const v2TermsSchema = z.strictObject({
  platformRequestId: id, platformTradeId: id.nullable(), platformListingId: id, walletListingId: id,
  sellerId: id, buyerId: id, assetId: asset, receivingNetwork: z.enum(["TRC20", "BEP20"]),
  destination: z.string().min(1).max(250), currency: z.literal("ILS"), paymentMethod: z.enum(MARKETPLACE_PAYMENT_METHODS),
  paymentInstructionsDigest: hex, priceMode: z.enum(["listing_price", "buyer_offer"]).nullable(), listingPriceAtRequest: decimal.nullable(),
  feePolicyVersion: z.literal(MARKETPLACE_FEE_POLICY), commissionCalculationVersion: z.literal(COMMISSION_CALCULATION_VERSION),
  usdtAmount: decimal, pricePerUsdt: decimal, fiatAmount: decimal,
  principalRaw: raw, buyerFeeRaw: raw, sellerFeeRaw: raw, totalFeeRaw: raw, fiatTotalMinor: raw,
});

export const v2AcceptancePreconditionsSchema = z.strictObject({
  requestUpdatedAt: z.string().min(1).max(100).refine(value => Number.isFinite(Date.parse(value)), "Invalid request timestamp"),
  requestDigest: hex, listingDigest: hex, proposalDigest: hex, bindingRevision: safe, bindingDigest: hex,
  walletRevision: safe, walletEventHash: hex, walletStateDigest: hex, walletTradeDigest: hex,
  inventoryDigest: hex, evidenceDigest: hex, disputesDigest: hex,
});

export const v2EnrollmentInputSchema = z.strictObject({
  walletTradeId: id, terms: v2TermsSchema, termsDigest: hex, expectedWallet: v2CheckpointSchema, walletTradeDigest: hex,
});
export type V2EnrollmentInput = z.infer<typeof v2EnrollmentInputSchema>;

export const v2AcceptanceInputSchema = z.strictObject({
  platformRequestId: id, proposalId: id, walletTradeId: id, priorTermsDigest: hex,
  acceptedTerms: v2TermsSchema, submittedAdjustmentCount: z.number().int().min(1).max(2),
  invalidatePreparedCardlessCredentials: z.boolean(), plannerInputDigest: hex,
  preconditions: v2AcceptancePreconditionsSchema,
});
export type V2AcceptanceInput = z.infer<typeof v2AcceptanceInputSchema>;

type V2Envelope<T extends string, I> = { version: 2; engineVersion: typeof WALLET_V2_ENGINE_VERSION; type: T; actor: Actor; requestId: string; input: I };
type Inherited<C> = C extends WalletCommand ? Omit<C, "version" | "engineVersion"> & { version: 2; engineVersion: typeof WALLET_V2_ENGINE_VERSION } : never;
export type V2InheritedCommand = Inherited<WalletCommand>;
export type V2Command = V2InheritedCommand
  | V2Envelope<"continueFromV1", { checkpoint: V2Checkpoint }>
  | V2Envelope<"enrollReservedTrade", V2EnrollmentInput>
  | V2Envelope<"acceptAmountCorrection", V2AcceptanceInput>;
export type VersionedCommand = WalletCommand | V2Command;
export type V2CommandType = V2Command["type"];
export type V2CommandOf<T extends V2CommandType> = Extract<V2Command, { type: T }>;
export type V2ResultOf<T extends V2CommandType> = T extends WalletCommandType ? ResultOf<T>
  : T extends "continueFromV1" ? V2Continuation
    : T extends "enrollReservedTrade" ? V2TermsBinding : V2AcceptanceReceipt;

const envelopeSchema = z.strictObject({
  version: z.literal(2), engineVersion: z.literal(WALLET_V2_ENGINE_VERSION), type: z.string().min(1).max(80), actor, requestId: id,
  input: z.unknown().refine(value => value !== undefined, "Missing command input"),
});

export function parseV2Command(input: unknown): V2Command {
  const outer = envelopeSchema.parse(input);
  switch (outer.type) {
    case "continueFromV1": return { ...outer, type: outer.type, input: z.strictObject({ checkpoint: v2CheckpointSchema }).parse(outer.input) };
    case "enrollReservedTrade": return { ...outer, type: outer.type, input: v2EnrollmentInputSchema.parse(outer.input) };
    case "acceptAmountCorrection": return { ...outer, type: outer.type, input: v2AcceptanceInputSchema.parse(outer.input) };
    default: {
      // Reuse the unchanged strict input contracts, not a permissive generic
      // method dispatcher. Unknown names/extra fields still fail the v1 parser.
      const inherited = parseWalletCommand({ ...outer, version: 1, engineVersion: WALLET_ENGINE_VERSION });
      return { ...inherited, version: 2, engineVersion: WALLET_V2_ENGINE_VERSION };
    }
  }
}

export function parseVersionedCommand(input: unknown): VersionedCommand {
  return input && typeof input === "object" && (input as { version?: unknown }).version === 2
    ? parseV2Command(input) : parseWalletCommand(input);
}

/** Engine versions deliberately do not create another identity namespace. */
export function versionedCommandKey(command: VersionedCommand) {
  return JSON.stringify([command.actor.kind, command.actor.id, command.type, command.requestId]);
}
export const v2CommandKey = versionedCommandKey;

export function v2Command<T extends V2CommandType>(type: T, actor: Actor, requestId: string, input: V2CommandOf<T>["input"]): V2CommandOf<T> {
  return parseV2Command({ version: 2, engineVersion: WALLET_V2_ENGINE_VERSION, type, actor, requestId, input }) as V2CommandOf<T>;
}

/**
 * Copies a planner's recorded facts, never its authority. The eventual trusted
 * coordinator must derive this plan from complete canonical data while fenced,
 * authenticate the buyer, update the marketplace and guard every enrolled writer.
 * This helper and the simulation command are not a public acceptance endpoint.
 */
export function acceptanceInputFromPlan(plan: AcceptedAmountTermsPlan): V2AcceptanceInput {
  if (plan.kind !== "alpha-wallet-development-accepted-amount-plan-v1" || plan.mode !== "simulation-only"
    || plan.executionAuthority !== false || plan.prior.executionAuthority !== false || plan.accepted.executionAuthority !== false
    || plan.reservation.action === "no_reservation" || plan.reservation.walletTradeId === null || plan.preconditions.walletTradeDigest === null
    || plan.prior.digest !== walletDigest(plan.prior.terms) || plan.accepted.digest !== walletDigest(plan.accepted.terms)
    || plan.acceptanceKey !== walletDigest(["alpha-wallet-amount-acceptance", plan.requestId, plan.proposalId])
    || plan.nextBindingRevision !== plan.preconditions.bindingRevision + 1) {
    throw new Error("A reserved canonical development amount plan is required");
  }
  const descriptor = v2AcceptanceInputSchema.parse({
    platformRequestId: plan.requestId, proposalId: plan.proposalId, walletTradeId: plan.reservation.walletTradeId,
    priorTermsDigest: plan.prior.digest, acceptedTerms: plan.accepted.terms,
    submittedAdjustmentCount: plan.submittedAdjustmentCount, invalidatePreparedCardlessCredentials: plan.invalidatePreparedCardlessCredentials,
    plannerInputDigest: plan.inputDigest, preconditions: plan.preconditions,
  });
  if (descriptor.plannerInputDigest !== walletDigest({ actorUserId: plan.actorUserId, prior: plan.prior.digest,
    accepted: plan.accepted.digest, preconditions: descriptor.preconditions })) throw new Error("Canonical planner digest mismatch");
  return descriptor;
}

// Compile-time proof that the strict JSON schema retains the established terms contract.
const _termsContract: (terms: z.infer<typeof v2TermsSchema>) => DevelopmentTradeTerms = terms => terms;
void _termsContract;
