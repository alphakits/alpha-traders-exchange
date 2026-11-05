import "server-only";

import { z } from "zod";
import { hasRevealedBankDetails } from "@/lib/trade-cancellation";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import { assetFor, parseUnits } from "./amounts";
import { walletDigest } from "./commands";
import type { InitialMarketplaceAcceptance, InitialMarketplaceActivation } from "./initial-marketplace-coordination-store";
import { balance } from "./ledger";
import {
  planDevelopmentPrepaymentCancellation, PrepaymentCancellationPlanningError,
  type DevelopmentPrepaymentCancellationDecision, type DevelopmentPrepaymentCancellationMarketplace,
  type DevelopmentPrepaymentCancellationResult,
} from "./prepayment-cancellation";
import { assertSimulationRuntime } from "./runtime";
import { v3InitialTermsSchema } from "./v3-commands";
import {
  cancellationPlannerDigest, v4CancellationKey, v4Command,
  type V4CommandOf, type V4InitialCancellationInput,
} from "./v4-commands";
import type { V4WalletSnapshot } from "./v4-durable";
import { assertV4Invariants, isV4State } from "./v4-engine";

export type CancellationMarketplaceCanonicalPayloads = {
  request: PurchaseRequest; listing: MarketplaceListing; trade: Record<string, unknown>;
};
export type CancellationMarketplaceCanonicalDigests = {
  requestDigest: string; listingDigest: string; tradeDigest: string; marketplaceDigest: string;
};
export type DevelopmentMarketplaceCancellationPlan = Readonly<{
  command: V4CommandOf<"cancelInitialTrade">;
  canonicalDecision: DevelopmentPrepaymentCancellationDecision;
  canonicalResult: DevelopmentPrepaymentCancellationResult;
}>;

const identity = z.strictObject({ mode: z.literal("simulation-only"),
  actorUserId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  cancelledAtMs: z.number().int().positive().max(8_640_000_000_000_000) });
function check(value: unknown, message: string): asserts value {
  if (!value) throw new PrepaymentCancellationPlanningError("INTEGRITY", message);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Derive one command from the complete fenced canonical read and original
 * coordinated acceptance. This pure function authenticates no account and
 * persists nothing. The private coordinator supplies stored authority, exact
 * transaction ownership, migration context and same-transaction publication.
 * Private account/dependency rows are committed only as a digest; they never
 * enter the command, public receipt or exported recovery evidence.
 */
export function planDevelopmentMarketplaceCancellation(options: {
  mode: "simulation-only"; actorUserId: string; requestId: string; operationId: string; cancelledAtMs: number;
  marketplace: DevelopmentPrepaymentCancellationMarketplace;
  canonical: CancellationMarketplaceCanonicalPayloads;
  basis: unknown;
  digests: CancellationMarketplaceCanonicalDigests;
  activation: InitialMarketplaceActivation;
  acceptance: InitialMarketplaceAcceptance;
  wallet: V4WalletSnapshot;
}): DevelopmentMarketplaceCancellationPlan {
  assertSimulationRuntime(options.mode);
  let input: typeof options;
  try { input = structuredClone(options); }
  catch { throw new PrepaymentCancellationPlanningError("INVALID", "Cancellation planning requires cloneable retained evidence"); }
  const parsed = identity.safeParse({ mode: input.mode, actorUserId: input.actorUserId, requestId: input.requestId,
    operationId: input.operationId, cancelledAtMs: input.cancelledAtMs });
  if (!parsed.success) throw new PrepaymentCancellationPlanningError("INVALID", "Invalid cancellation planning identity or clock");
  const { actorUserId, requestId, operationId, cancelledAtMs, activation, acceptance, canonical, digests, wallet } = input;
  check(canonical && digests && input.basis !== undefined, "A complete canonical cancellation basis is required");
  check(digests.requestDigest === walletDigest(canonical.request)
    && digests.listingDigest === walletDigest(canonical.listing)
    && digests.tradeDigest === walletDigest(canonical.trade)
    && digests.marketplaceDigest === walletDigest(input.basis), "Canonical cancellation digests disagree with their exact retained basis");
  const requests = input.marketplace.purchaseRequests.filter(row => row.id === requestId);
  const listings = input.marketplace.marketplaceListings.filter(row => row.id === canonical.request.listingId);
  check(requests.length === 1 && listings.length === 1
    && walletDigest(requests[0]) === digests.requestDigest && walletDigest(listings[0]) === digests.listingDigest,
  "Canonical cancellation payloads differ from the complete decision read");
  const request = canonical.request, listing = canonical.listing, physicalTrade = canonical.trade;
  check(request.id === requestId && request.tradeId && request.status === "accepted"
    && physicalTrade.id === request.tradeId && physicalTrade.purchaseRequestId === request.id
    && physicalTrade.listingId === request.listingId && physicalTrade.sellerId === request.sellerId
    && physicalTrade.buyerId === request.buyerId && physicalTrade.status === "accepted"
    && physicalTrade.createdAt === request.tradeCreatedAt && physicalTrade.updatedAt === request.updatedAt
    && walletDigest(physicalTrade.timeline) === walletDigest(request.timeline),
  "Cancellation requires the exact retained accepted physical trade");
  check(activation && acceptance && activation.requestId === requestId
    && activation.platformTradeId === request.tradeId && activation.platformListingId === request.listingId
    && activation.buyerId === request.buyerId && activation.sellerId === request.sellerId,
  "The original owner mapping and canonical parties disagree");
  check(isV4State(wallet.state), "Cancellation requires the explicitly continued V4 wallet");
  assertV4Invariants(wallet.state);
  const state = wallet.state;
  check(state.haltReason === null && state.initialBindings.size === 1 && state.initialAcceptanceReceipts.size === 1
    && state.initialCancellationReceipts.size === 0, "Cancellation requires one unpaused, uncancelled initial mapping");
  const binding = state.initialBindings.get(requestId), accepted = acceptance.receipt;
  check(binding && accepted && accepted.platformRequestId === requestId
    && accepted.platformTradeId === request.tradeId && accepted.actorUserId === request.sellerId
    && acceptance.actorUserId === request.sellerId && accepted.buyerId === request.buyerId
    && binding.acceptanceKey === accepted.acceptanceKey && binding.walletTradeId === activation.walletTradeId
    && binding.walletListingId === activation.walletListingId && binding.assetId === activation.assetId
    && acceptance.walletRevision === accepted.commandRevision && acceptance.walletCommandKey === accepted.commandKey
    && walletDigest(state.initialAcceptanceReceipts.get(accepted.acceptanceKey)) === walletDigest(accepted),
  "Cancellation requires the original coordinated and financial acceptance together");
  const terms = v3InitialTermsSchema.parse(describeDevelopmentTradeTerms({ mode: "simulation-only", request,
    assetId: activation.assetId, walletListingId: activation.walletListingId }).terms);
  check(walletDigest(terms) === binding.termsDigest && walletDigest(terms) === walletDigest(binding.terms)
    && walletDigest(terms) === walletDigest(accepted.input.terms), "Cancellation cannot alter the original accepted terms");
  const reserved = state.trades.get(activation.walletTradeId), funded = state.listings.get(activation.walletListingId);
  check(reserved && funded && reserved.status === "reserved" && funded.approved && funded.funded && !funded.closed
    && walletDigest(reserved) === binding.walletTradeDigest
    && walletDigest(funded) === accepted.input.preconditions.walletListingDigest,
  "The original funded listing or reservation changed before cancellation");
  check(cancelledAtMs >= wallet.lastCommandAtMs && wallet.revision >= state.cancellationContinuation.commandRevision,
    "Cancellation clock or checkpoint precedes its wallet continuation");
  const available = balance(state, activation.assetId, `listing:${activation.walletListingId}`);
  const held = balance(state, activation.assetId, `trade:${activation.walletTradeId}`);
  const scale = BigInt(10) ** BigInt(assetFor(activation.assetId).decimals - 6);
  check(held.toString() === terms.principalRaw
    && available + held === parseUnits(listing.availableAmount, 6) * scale,
  "Canonical inventory must match the exact original listing and trade allocations");
  const canonicalDecision = { requestId, tradeId: request.tradeId, actorUserId, cancelledAtMs };
  const canonicalResult = planDevelopmentPrepaymentCancellation(input.marketplace, canonicalDecision);
  const actorKind = actorUserId === request.sellerId ? "seller" : "buyer";
  const cancellation: V4InitialCancellationInput = {
    cancellationKey: v4CancellationKey(requestId, accepted.acceptanceKey), terms, termsDigest: binding.termsDigest,
    originalAcceptance: { acceptanceKey: accepted.acceptanceKey, commandRevision: accepted.commandRevision,
      commandKey: accepted.commandKey, receiptDigest: walletDigest(accepted), bindingDigest: walletDigest(binding) },
    cancelledAtMs,
    preconditions: { ...digests, requestUpdatedAt: request.updatedAt, listingExpiresAt: listing.expiresAt ?? null,
      canonicalPrepayment: true, canonicalTermsUnchanged: true, buyerBankDetailsDisclosed: hasRevealedBankDetails(request),
      walletRevision: wallet.revision, walletEventHash: wallet.eventHash, walletStateDigest: walletDigest(state),
      walletTradeDigest: walletDigest(reserved), walletListingDigest: walletDigest(funded) },
    principalReturn: { action: "return_to_listing", assetId: terms.assetId, walletListingId: activation.walletListingId,
      walletTradeId: activation.walletTradeId, principalRaw: terms.principalRaw, transferAmountRaw: terms.principalRaw,
      fromAccount: `trade:${activation.walletTradeId}`, toAccount: `listing:${activation.walletListingId}`,
      expectedListingAvailableRaw: available.toString(), expectedTradeReservedRaw: held.toString() },
    plannerInputDigest: "0".repeat(64),
  };
  cancellation.plannerInputDigest = cancellationPlannerDigest(cancellation, actorUserId);
  return freeze({ command: v4Command("cancelInitialTrade", { kind: actorKind, id: actorUserId }, operationId, cancellation),
    canonicalDecision, canonicalResult });
}
