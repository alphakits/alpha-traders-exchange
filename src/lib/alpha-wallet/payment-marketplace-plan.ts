import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import { assetFor, parseUnits } from "./amounts";
import { walletDigest } from "./commands";
import type { InitialMarketplaceAcceptance, InitialMarketplaceActivation } from "./initial-marketplace-coordination-store";
import { balance } from "./ledger";
import {
  normalizeDevelopmentPaymentDisputeReason,
  planDevelopmentPaymentClaim, planDevelopmentPaymentDispute,
} from "./payment-marketplace-canonical";
import { assertSimulationRuntime } from "./runtime";
import { v3InitialTermsSchema } from "./v3-commands";
import {
  disputeFreezePlannerDigest, paymentClaimPlannerDigest, v5Command, v5DisputeFreezeKey, v5PaymentClaimKey,
  type V5InitialDisputeFreezeInput, type V5InitialPaymentClaimInput,
} from "./v5-commands";
import type { V5WalletSnapshot } from "./v5-durable";
import { assertV5Invariants, isV5State } from "./v5-engine";

type Marketplace = Parameters<typeof planDevelopmentPaymentClaim>[0];
type EvidenceInput = Parameters<typeof planDevelopmentPaymentClaim>[1]["evidence"];
type CanonicalEvidence = ReturnType<typeof planDevelopmentPaymentClaim>["evidence"][number];
export type PaymentMarketplaceCanonicalPayloads = {
  request: PurchaseRequest; listing: MarketplaceListing; trade: Record<string, unknown>; evidence: CanonicalEvidence[];
};
export type PaymentMarketplaceCanonicalDigests = {
  requestDigest: string; listingDigest: string; tradeDigest: string; marketplaceDigest: string;
};
type SharedOptions = {
  mode: "simulation-only"; actorUserId: string; requestId: string; operationId: string;
  marketplace: Marketplace; canonical: PaymentMarketplaceCanonicalPayloads; basis: unknown;
  digests: PaymentMarketplaceCanonicalDigests;
  activation: InitialMarketplaceActivation; acceptance: InitialMarketplaceAcceptance; wallet: V5WalletSnapshot;
};

export class PaymentMarketplacePlanningError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INTEGRITY" | "ACTOR" | "LOCKED" | "UNSUPPORTED", message: string) {
    super(message); this.name = "PaymentMarketplacePlanningError";
  }
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new PaymentMarketplacePlanningError("INTEGRITY", message);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const identity = z.strictObject({ mode: z.literal("simulation-only"), actorUserId: id, requestId: id, operationId: id,
  decisionAtMs: z.number().int().positive().max(8_640_000_000_000_000) });

/** The caller supplies a complete locked read, never a selected amount or payment destination. */
function facts(options: SharedOptions, decisionAtMs: number, status: "accepted" | "payment_sent") {
  assertSimulationRuntime(options.mode);
  let input: SharedOptions;
  try { input = structuredClone(options); }
  catch { throw new PaymentMarketplacePlanningError("INVALID_INPUT", "Payment planning requires cloneable retained evidence"); }
  if (!identity.safeParse({ mode: input.mode, actorUserId: input.actorUserId, requestId: input.requestId,
    operationId: input.operationId, decisionAtMs }).success) {
    throw new PaymentMarketplacePlanningError("INVALID_INPUT", "Invalid payment planning identity or clock");
  }
  const { actorUserId, requestId, activation, acceptance, canonical, digests, wallet } = input;
  check(canonical && digests && input.basis !== undefined, "Payment planning requires its complete canonical read");
  check(digests.requestDigest === walletDigest(canonical.request) && digests.listingDigest === walletDigest(canonical.listing)
    && digests.tradeDigest === walletDigest(canonical.trade) && digests.marketplaceDigest === walletDigest(input.basis),
  "Payment canonical digests disagree with their exact retained basis");
  const requests = input.marketplace.purchaseRequests.filter(row => row.id === requestId);
  const listings = input.marketplace.marketplaceListings.filter(row => row.id === canonical.request.listingId);
  check(requests.length === 1 && listings.length === 1 && walletDigest(requests[0]) === digests.requestDigest
    && walletDigest(listings[0]) === digests.listingDigest, "Payment canonical payloads differ from the complete decision read");
  const request = canonical.request, listing = canonical.listing, physical = canonical.trade;
  check(request.id === requestId && request.tradeId && request.status === status && physical.id === request.tradeId
    && physical.purchaseRequestId === request.id && physical.listingId === request.listingId
    && physical.sellerId === request.sellerId && physical.buyerId === request.buyerId && physical.status === status
    && physical.createdAt === request.tradeCreatedAt && physical.updatedAt === request.updatedAt
    && walletDigest(physical.timeline) === walletDigest(request.timeline), "Payment requires the exact retained physical trade");
  if (actorUserId !== request.buyerId) throw new PaymentMarketplacePlanningError("ACTOR", "Only the retained buyer may claim or dispute payment");
  check(activation && acceptance && activation.requestId === requestId && activation.platformTradeId === request.tradeId
    && activation.platformListingId === request.listingId && activation.buyerId === request.buyerId
    && activation.sellerId === request.sellerId, "Original owner mapping and payment parties disagree");
  check(isV5State(wallet.state), "Payment requires an explicitly continued V5 wallet");
  assertV5Invariants(wallet.state);
  const state = wallet.state;
  if (state.haltReason !== null) throw new PaymentMarketplacePlanningError("LOCKED", "A paused wallet cannot claim or dispute payment");
  check(state.initialBindings.size === 1 && state.initialAcceptanceReceipts.size === 1
    && state.initialCancellationReceipts.size === 0, "Payment requires one original uncancelled initial mapping");
  const binding = state.initialBindings.get(requestId), accepted = acceptance.receipt;
  check(binding && accepted && accepted.platformRequestId === requestId && accepted.platformTradeId === request.tradeId
    && accepted.actorUserId === request.sellerId && acceptance.actorUserId === request.sellerId
    && accepted.buyerId === request.buyerId && binding.acceptanceKey === accepted.acceptanceKey
    && binding.walletTradeId === activation.walletTradeId && binding.walletListingId === activation.walletListingId
    && binding.assetId === activation.assetId && acceptance.walletRevision === accepted.commandRevision
    && acceptance.walletCommandKey === accepted.commandKey
    && walletDigest(state.initialAcceptanceReceipts.get(accepted.acceptanceKey)) === walletDigest(accepted),
  "Original coordinated and financial acceptance must agree before payment");
  const terms = v3InitialTermsSchema.parse(describeDevelopmentTradeTerms({ mode: "simulation-only", request,
    assetId: activation.assetId, walletListingId: activation.walletListingId }).terms);
  check(walletDigest(terms) === binding.termsDigest && walletDigest(terms) === walletDigest(binding.terms)
    && walletDigest(terms) === walletDigest(accepted.input.terms), "Payment cannot alter the accepted terms");
  const trade = state.trades.get(activation.walletTradeId), funded = state.listings.get(activation.walletListingId);
  check(trade && funded && trade.status === (status === "accepted" ? "reserved" : "payment_reported")
    && !trade.disputed && !trade.evidence && !trade.authorization && !trade.payoutId
    && funded.approved && funded.funded && !funded.closed
    && walletDigest(funded) === accepted.input.preconditions.walletListingDigest,
  "Payment requires the original unverified reservation and funded listing");
  if (status === "accepted") check(walletDigest(trade) === binding.walletTradeDigest,
    "The initial reservation changed before its buyer payment claim");
  check(decisionAtMs >= wallet.lastCommandAtMs && wallet.revision >= state.paymentContinuation.commandRevision,
    "Payment decision precedes its wallet checkpoint");
  const available = balance(state, activation.assetId, `listing:${activation.walletListingId}`);
  const held = balance(state, activation.assetId, `trade:${activation.walletTradeId}`);
  const scale = BigInt(10) ** BigInt(assetFor(activation.assetId).decimals - 6);
  check(held.toString() === terms.principalRaw && available + held === parseUnits(listing.availableAmount, 6) * scale,
    "Payment must preserve the original listing and trade allocations");
  const shared: Pick<V5InitialPaymentClaimInput, "terms" | "termsDigest" | "originalAcceptance" | "preconditions" | "principalHold"> = {
    terms, termsDigest: binding.termsDigest,
    originalAcceptance: { acceptanceKey: accepted.acceptanceKey, commandRevision: accepted.commandRevision,
      commandKey: accepted.commandKey, receiptDigest: walletDigest(accepted), bindingDigest: walletDigest(binding) },
    preconditions: { ...digests, requestUpdatedAt: request.updatedAt, canonicalStatus: status,
      canonicalTermsUnchanged: true, canonicalOpenDispute: false, walletRevision: wallet.revision,
      walletEventHash: wallet.eventHash, walletStateDigest: walletDigest(state), walletTradeDigest: walletDigest(trade),
      walletListingDigest: walletDigest(funded) },
    principalHold: { action: "retain_reserved", assetId: terms.assetId, walletListingId: activation.walletListingId,
      walletTradeId: activation.walletTradeId, principalRaw: terms.principalRaw, transferAmountRaw: "0",
      expectedListingAvailableRaw: available.toString(), expectedTradeReservedRaw: held.toString() },
  };
  return { input, state, request: request as PurchaseRequest & { tradeId: string }, accepted, shared };
}

/** This pure plan records a claim, never independent fiat verification or release authority. */
export function planDevelopmentMarketplacePaymentClaim(options: SharedOptions & { claimedAtMs: number; evidence?: EvidenceInput }) {
  const { input, shared, request, accepted } = facts(options, options.claimedAtMs, "accepted");
  const canonicalDecision = { requestId: request.id, tradeId: request.tradeId, actorUserId: input.actorUserId,
    claimedAtMs: options.claimedAtMs, ...(options.evidence === undefined ? {} : { evidence: structuredClone(options.evidence) }) };
  const canonicalResult = planDevelopmentPaymentClaim(input.marketplace, canonicalDecision);
  check(canonicalResult.evidence.length === (shared.terms.paymentMethod === "Bank Transfer" ? 1 : 0),
    "Canonical payment evidence does not match the original payment method");
  const evidence = canonicalResult.evidence[0];
  const claim: V5InitialPaymentClaimInput = { ...shared,
    claimKey: v5PaymentClaimKey(request.id, accepted.acceptanceKey), claimedAtMs: options.claimedAtMs,
    claim: { kind: "buyer_payment_claim", buyerId: request.buyerId, amountMinor: shared.terms.fiatTotalMinor,
      currency: shared.terms.currency, proof: evidence ? { evidenceId: evidence.metadata.id,
        contentSha256: evidence.contentDigest, mimeType: evidence.metadata.mimeType as "image/jpeg" | "image/png" | "application/pdf",
        sizeBytes: evidence.metadata.sizeBytes } : null }, plannerInputDigest: "0".repeat(64) };
  claim.plannerInputDigest = paymentClaimPlannerDigest(claim, input.actorUserId);
  return freeze({ command: v5Command("claimInitialPayment", { kind: "buyer", id: input.actorUserId }, input.operationId, claim),
    canonicalDecision, canonicalResult,
    canonicalInput: evidence ? { evidence: { metadata: evidence.metadata, contentDigest: evidence.contentDigest } } : {} });
}

/** A dispute holds the exact existing claim; it introduces no resolution power. */
export function planDevelopmentMarketplacePaymentDispute(options: SharedOptions & { disputedAtMs: number; reason: string }) {
  const { input, state, shared, request, accepted } = facts(options, options.disputedAtMs, "payment_sent");
  const claim = state.initialPaymentClaimReceipts.get(v5PaymentClaimKey(request.id, accepted.acceptanceKey));
  check(claim && claim.actorUserId === request.buyerId && claim.platformRequestId === request.id,
    "A dispute requires the exact original buyer payment claim");
  const claimedAt = new Date(claim.claimedAtMs).toISOString();
  check(request.paymentSentAt === claimedAt, "Canonical payment time differs from its original financial claim");
  const proof = claim.input.claim.proof, retained = input.canonical.evidence;
  if (proof) {
    check(retained.length === 1 && retained[0].metadata.id === proof.evidenceId
      && retained[0].contentDigest === proof.contentSha256 && retained[0].metadata.mimeType === proof.mimeType
      && retained[0].metadata.sizeBytes === proof.sizeBytes
      && retained[0].metadata.uploadedAt === claimedAt
      && createHash("sha256").update(Buffer.from(retained[0].contentBase64, "base64")).digest("hex") === proof.contentSha256,
    "Dispute evidence differs from the exact content of its buyer claim");
  } else check(retained.length === 0, "A Face-to-Face claim cannot acquire uploaded payment evidence");
  const reason = normalizeDevelopmentPaymentDisputeReason(options.reason);
  const canonicalDecision = { requestId: request.id, tradeId: request.tradeId, actorUserId: input.actorUserId,
    openedAtMs: options.disputedAtMs, reason };
  const canonicalResult = planDevelopmentPaymentDispute(input.marketplace, canonicalDecision, input.canonical.evidence);
  const dispute: V5InitialDisputeFreezeInput = { ...shared,
    disputeKey: v5DisputeFreezeKey(request.id, accepted.acceptanceKey), disputedAtMs: options.disputedAtMs,
    reasonDigest: createHash("sha256").update(reason, "utf8").digest("hex"),
    priorClaim: { claimKey: claim.claimKey, commandRevision: claim.commandRevision, receiptDigest: walletDigest(claim) },
    plannerInputDigest: "0".repeat(64) };
  dispute.plannerInputDigest = disputeFreezePlannerDigest(dispute, input.actorUserId);
  return freeze({ command: v5Command("freezeInitialDispute", { kind: "buyer", id: input.actorUserId }, input.operationId, dispute),
    canonicalDecision, canonicalResult, canonicalInput: { reason } });
}
