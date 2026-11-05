import { z } from "zod";
import { COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import { walletDigest, type ResultOf, type WalletCommand } from "./commands";
import type { DevelopmentInitialAcceptancePlan } from "./initial-acceptance";
import { parseVersionedCommand, v2CheckpointSchema, v2TermsSchema, type V2Command, type V2ResultOf, type VersionedCommand } from "./v2-commands";
import type { V3Continuation, V3InitialAcceptanceReceipt } from "./v3-engine";

/** A closed third envelope. No old command acquires seller acceptance authority. */
export const WALLET_V3_ENGINE_VERSION = "alpha-wallet-simulation-v3" as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
const decimal = z.string().min(1).max(100).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > 0);
const asset = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const actor = z.strictObject({ kind: z.enum(["seller", "buyer", "operator", "verifier", "dispatcher"]), id });

export const v3InitialTermsSchema = v2TermsSchema.extend({
  platformTradeId: id,
  paymentMethod: z.enum(["Bank Transfer", "Face-to-Face (Meet in Person)"]),
  priceMode: z.literal("listing_price"),
  listingPriceAtRequest: decimal,
});
export type V3InitialTerms = z.infer<typeof v3InitialTermsSchema>;

export const v3SellerActionSchema = z.strictObject({
  kind: z.literal("initial_seller_acceptance"), requestedByUserId: id, requestId: id,
  faceToFaceSafetyAcknowledged: z.boolean(),
});
export const v3BuyerRequestEvidenceSchema = z.strictObject({
  kind: z.literal("retained_canonical_request"), requestId: id, tradeId: id, buyerId: id, createdAt: timestamp,
  requestDigest: hex, submissionTimelineEntryId: id, submissionTimelineDigest: hex, termsDigest: hex,
  feePolicyVersion: z.literal(MARKETPLACE_FEE_POLICY), commissionCalculationVersion: z.literal(COMMISSION_CALCULATION_VERSION),
  buyerSafetyAcknowledged: z.literal(true),
});
export const v3InitialPreconditionsSchema = z.strictObject({
  requestUpdatedAt: timestamp, requestDigest: hex, listingDigest: hex, marketplaceDigest: hex,
  usersDigest: hex, sellerInventoryDigest: hex, buyerHistoryDigest: hex, commissionsDigest: hex,
  legacyReviewsDigest: hex, enforcementDigest: hex, evidenceDigest: hex, disputesDigest: hex,
  walletRevision: safe, walletEventHash: hex, walletStateDigest: hex, walletListingDigest: hex,
  sellerActiveTradeCount: z.number().int().min(0).max(2), walletSellerActiveTradeCount: z.literal(0),
});
export const v3InitialReservationSchema = z.strictObject({
  action: z.literal("reserve"), assetId: asset, walletListingId: id, walletTradeId: id,
  principalRaw: raw, transferAmountRaw: raw, fromAccount: z.string().min(1).max(100), toAccount: z.string().min(1).max(100),
  expectedListingAvailableRaw: raw, expectedTradeReservedRaw: z.literal("0"), availableForRequestRaw: raw,
});
export const v3InitialInputSchema = z.strictObject({
  acceptanceKey: hex, terms: v3InitialTermsSchema, termsDigest: hex,
  sellerAction: v3SellerActionSchema, buyerRequestEvidence: v3BuyerRequestEvidenceSchema,
  pricing: z.strictObject({ source: z.literal("retained_request"), walletListingPrice: decimal, requiresFrozenPriceTransition: z.boolean() }),
  preconditions: v3InitialPreconditionsSchema, reservation: v3InitialReservationSchema, plannerInputDigest: hex,
});
export type V3InitialAcceptanceInput = z.infer<typeof v3InitialInputSchema>;

const common = { version: z.literal(3), engineVersion: z.literal(WALLET_V3_ENGINE_VERSION), actor, requestId: id };
export const v3CommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("continueFromV2"), input: z.strictObject({ checkpoint: v2CheckpointSchema }) }),
  z.strictObject({ ...common, type: z.literal("acceptInitialSellerRequest"), input: v3InitialInputSchema }),
  z.strictObject({ ...common, type: z.literal("pause"), input: z.null() }),
]);
export type V3Command = z.infer<typeof v3CommandSchema>;
export type V3CommandType = V3Command["type"];
export type V3CommandOf<T extends V3CommandType> = Extract<V3Command, { type: T }>;
export type V3ResultOf<T extends V3CommandType> = T extends "continueFromV2" ? V3Continuation
  : T extends "acceptInitialSellerRequest" ? V3InitialAcceptanceReceipt : { halted: true };
export type V3VersionedCommand = VersionedCommand | V3Command;
export type V3VersionedResultOf<C extends V3VersionedCommand> = C extends WalletCommand ? ResultOf<C["type"]>
  : C extends V2Command ? V2ResultOf<C["type"]> : C extends V3Command ? V3ResultOf<C["type"]> : never;

export function parseV3Command(value: unknown): V3Command {
  const parsed = v3CommandSchema.parse(value);
  return v3CommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
}
export function parseV3VersionedCommand(value: unknown): V3VersionedCommand {
  return value && typeof value === "object" && (value as { version?: unknown }).version === 3
    ? parseV3Command(value) : parseVersionedCommand(value);
}
/** Engine changes do not create another transport idempotency namespace. */
export function v3CommandKey(command: V3VersionedCommand) {
  return JSON.stringify([command.actor.kind, command.actor.id, command.type, command.requestId]);
}
export function v3Command<T extends V3CommandType>(type: T, actor: V3Command["actor"], requestId: string, input: V3CommandOf<T>["input"]): V3CommandOf<T> {
  return parseV3Command({ version: 3, engineVersion: WALLET_V3_ENGINE_VERSION, type, actor, requestId, input }) as V3CommandOf<T>;
}

/**
 * Copies strictly bounded recorded facts; it creates no authentication proof.
 * A future coordinator must obtain the seller and complete canonical reads in
 * its own fenced transaction. An arbitrary caller can still invent source
 * digests, so this helper is never an endpoint or an authorization boundary.
 */
export function initialInputFromPlan(plan: DevelopmentInitialAcceptancePlan): V3InitialAcceptanceInput {
  if (plan.kind !== "alpha-wallet-development-initial-acceptance-plan-v1" || plan.mode !== "simulation-only"
    || plan.executionAuthority !== false || plan.requiredExecutionContract !== "seller-initial-acceptance-v3"
    || plan.terms.executionAuthority !== false || plan.terms.digest !== walletDigest(plan.terms.terms)
    || plan.actorUserId !== plan.terms.terms.sellerId || plan.actorUserId !== plan.canonicalAcceptance.actorUserId
    || plan.actorUserId !== plan.sellerAction.requestedByUserId || plan.requestId !== plan.terms.terms.platformRequestId
    || plan.requestId !== plan.canonicalAcceptance.requestId || plan.canonicalAcceptance.tradeId !== plan.terms.terms.platformTradeId
    || plan.plannedAtMs !== plan.canonicalAcceptance.acceptedAtMs
    || plan.sellerAction.faceToFaceSafetyAcknowledged !== (plan.canonicalAcceptance.safetyAcknowledged === true)) {
    throw new Error("A seller-native v3 initial acceptance plan is required");
  }
  const input = v3InitialInputSchema.parse({ acceptanceKey: plan.acceptanceKey, terms: plan.terms.terms, termsDigest: plan.terms.digest,
    sellerAction: plan.sellerAction, buyerRequestEvidence: plan.buyerRequestEvidence, pricing: plan.pricing,
    preconditions: plan.preconditions, reservation: plan.reservation, plannerInputDigest: plan.inputDigest });
  if (input.acceptanceKey !== walletDigest(["alpha-wallet-initial-seller-acceptance-v1", input.terms.platformRequestId, input.terms.sellerId])
    || input.plannerInputDigest !== initialPlannerDigest(input, plan.actorUserId)) {
    throw new Error("Initial acceptance planner digest mismatch");
  }
  return input;
}

export function initialPlannerDigest(input: V3InitialAcceptanceInput, actorUserId: string) {
  return walletDigest({ acceptanceKey: input.acceptanceKey, actorUserId,
    mapping: { assetId: input.reservation.assetId, walletListingId: input.reservation.walletListingId, walletTradeId: input.reservation.walletTradeId },
    termsDigest: input.termsDigest, sellerAction: input.sellerAction, preconditions: input.preconditions });
}
