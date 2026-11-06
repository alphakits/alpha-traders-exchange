import { z } from "zod";
import { walletDigest, type ResultOf, type WalletCommand } from "./commands";
import { v2CheckpointSchema, type V2Command, type V2ResultOf } from "./v2-commands";
import { v3InitialTermsSchema, type V3Command, type V3ResultOf } from "./v3-commands";
import { parseV4VersionedCommand, v4OriginalAcceptanceSchema, type V4Command, type V4ResultOf, type V4VersionedCommand } from "./v4-commands";
import type { V5Continuation, V5InitialDisputeFreezeReceipt, V5InitialPaymentClaimReceipt } from "./v5-engine";

/** Closed claim-only continuation. A claim is not verified payment or release authority. */
export const WALLET_V5_ENGINE_VERSION = "alpha-wallet-simulation-v5" as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
const timestamp = z.string().datetime({ offset: true, precision: 3 })
  .refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > 0);
const asset = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const actor = z.strictObject({ kind: z.enum(["seller", "buyer", "operator", "verifier", "dispatcher"]), id });

/** Safe reference to an atomically stored buyer upload, never independently verified PaymentEvidence. */
export const v5BankProofSchema = z.strictObject({
  evidenceId: id, contentSha256: hex, mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  sizeBytes: z.number().int().min(1).max(8 * 1024 * 1024),
});
export type V5BankProof = z.infer<typeof v5BankProofSchema>;
export const v5LifecyclePreconditionsSchema = z.strictObject({
  requestUpdatedAt: timestamp, requestDigest: hex, listingDigest: hex, tradeDigest: hex, marketplaceDigest: hex,
  canonicalStatus: z.enum(["accepted", "payment_sent"]), canonicalTermsUnchanged: z.literal(true), canonicalOpenDispute: z.literal(false),
  walletRevision: safe, walletEventHash: hex, walletStateDigest: hex, walletTradeDigest: hex, walletListingDigest: hex,
});
export const v5PrincipalHoldSchema = z.strictObject({
  action: z.literal("retain_reserved"), assetId: asset, walletListingId: id, walletTradeId: id,
  principalRaw: raw, transferAmountRaw: z.literal("0"), expectedTradeReservedRaw: raw, expectedListingAvailableRaw: raw,
});
const lifecycle = {
  terms: v3InitialTermsSchema, termsDigest: hex, originalAcceptance: v4OriginalAcceptanceSchema,
  preconditions: v5LifecyclePreconditionsSchema, principalHold: v5PrincipalHoldSchema, plannerInputDigest: hex,
};
export const v5PaymentClaimInputSchema = z.strictObject({
  ...lifecycle, claimKey: hex, claimedAtMs: safe,
  claim: z.strictObject({ kind: z.literal("buyer_payment_claim"), buyerId: id, amountMinor: raw, currency: z.literal("ILS"),
    proof: v5BankProofSchema.nullable() }),
});
export const v5DisputeFreezeInputSchema = z.strictObject({
  ...lifecycle, disputeKey: hex, disputedAtMs: safe, reasonDigest: hex,
  priorClaim: z.strictObject({ claimKey: hex, commandRevision: safe, receiptDigest: hex }),
});
export type V5InitialPaymentClaimInput = z.infer<typeof v5PaymentClaimInputSchema>;
export type V5InitialDisputeFreezeInput = z.infer<typeof v5DisputeFreezeInputSchema>;

const common = { version: z.literal(5), engineVersion: z.literal(WALLET_V5_ENGINE_VERSION), actor, requestId: id };
export const v5CommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("continueFromV4"), input: z.strictObject({ checkpoint: v2CheckpointSchema }) }),
  z.strictObject({ ...common, type: z.literal("claimInitialPayment"), input: v5PaymentClaimInputSchema }),
  z.strictObject({ ...common, type: z.literal("freezeInitialDispute"), input: v5DisputeFreezeInputSchema }),
  z.strictObject({ ...common, type: z.literal("pause"), input: z.null() }),
]);
export type V5Command = z.infer<typeof v5CommandSchema>;
export type V5CommandType = V5Command["type"];
export type V5CommandOf<T extends V5CommandType> = Extract<V5Command, { type: T }>;
export type V5ResultOf<T extends V5CommandType> = T extends "continueFromV4" ? V5Continuation
  : T extends "claimInitialPayment" ? V5InitialPaymentClaimReceipt
    : T extends "freezeInitialDispute" ? V5InitialDisputeFreezeReceipt : { halted: true };
export type V5VersionedCommand = V4VersionedCommand | V5Command;
export type V5VersionedResultOf<C extends V5VersionedCommand> = C extends WalletCommand ? ResultOf<C["type"]>
  : C extends V2Command ? V2ResultOf<C["type"]> : C extends V3Command ? V3ResultOf<C["type"]>
    : C extends V4Command ? V4ResultOf<C["type"]> : C extends V5Command ? V5ResultOf<C["type"]> : never;

export function parseV5Command(value: unknown): V5Command {
  const parsed = v5CommandSchema.parse(value);
  return v5CommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
}
export function parseV5VersionedCommand(value: unknown): V5VersionedCommand {
  return value && typeof value === "object" && (value as { version?: unknown }).version === 5
    ? parseV5Command(value) : parseV4VersionedCommand(value);
}
/** Transport identity remains global across every engine version. */
export function v5CommandKey(command: V5VersionedCommand) {
  return JSON.stringify([command.actor.kind, command.actor.id, command.type, command.requestId]);
}
export function v5Command<T extends V5CommandType>(type: T, actor: V5Command["actor"], requestId: string, input: V5CommandOf<T>["input"]): V5CommandOf<T> {
  return parseV5Command({ version: 5, engineVersion: WALLET_V5_ENGINE_VERSION, type, actor, requestId, input }) as V5CommandOf<T>;
}
export function v5PaymentClaimKey(platformRequestId: string, acceptanceKey: string) {
  return walletDigest(["alpha-wallet-initial-payment-claim-v1", platformRequestId, acceptanceKey]);
}
export function v5DisputeFreezeKey(platformRequestId: string, acceptanceKey: string) {
  return walletDigest(["alpha-wallet-initial-dispute-freeze-v1", platformRequestId, acceptanceKey]);
}
export function paymentClaimPlannerDigest(input: V5InitialPaymentClaimInput, actorUserId: string) {
  const { plannerInputDigest: _ignored, ...facts } = input; void _ignored;
  return walletDigest({ actorUserId, input: facts });
}
export function disputeFreezePlannerDigest(input: V5InitialDisputeFreezeInput, actorUserId: string) {
  const { plannerInputDigest: _ignored, ...facts } = input; void _ignored;
  return walletDigest({ actorUserId, input: facts });
}
