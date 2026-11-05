import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { hasIrreversibleRequestProgress, hasRevealedBankDetails } from "@/lib/trade-cancellation";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import type { AlphaExchangeNotification, AuditLogEntry, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import type { DevelopmentInitialAcceptanceMarketplace } from "./initial-acceptance";
import { parseUnits } from "./amounts";
import { assertSimulationRuntime } from "./runtime";

/** Mechanical canonical effects only. This module grants no session, wallet or delivery authority. */
export type DevelopmentPrepaymentCancellationMarketplace = DevelopmentInitialAcceptanceMarketplace & {
  notifications: readonly AlphaExchangeNotification[];
};

export type DevelopmentPrepaymentCancellationDecision = Readonly<{
  requestId: string;
  tradeId: string;
  actorUserId: string;
  /** Explicit trusted clock; no ambient clock is read by this planner. */
  cancelledAtMs: number;
}>;

export type DevelopmentPrepaymentCancellationResult = {
  request: PurchaseRequest;
  listing: MarketplaceListing;
  trade: {
    id: string; purchaseRequestId: string; listingId: string; sellerId: string; buyerId: string;
    status: "cancelled"; createdAt: string; updatedAt: string; timeline: PurchaseRequest["timeline"];
  };
  notifications: AlphaExchangeNotification[];
  notificationUpdates: AlphaExchangeNotification[];
  auditLogs: AuditLogEntry[];
};

export class PrepaymentCancellationPlanningError extends Error {
  constructor(readonly code: "INVALID" | "UNSUPPORTED" | "ACTOR" | "STALE" | "LOCKED" | "INTEGRITY", message: string) {
    super(message); this.name = "PrepaymentCancellationPlanningError";
  }
}

function check(value: unknown, code: PrepaymentCancellationPlanningError["code"], message: string): asserts value {
  if (!value) throw new PrepaymentCancellationPlanningError(code, `Prepayment cancellation ${message}.`);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const time = z.string().refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > 0
  && new Date(value).toISOString() === value);
const role = z.enum(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);
const row = z.record(z.string(), z.unknown());
const decisionShape = z.strictObject({ requestId: id, tradeId: id, actorUserId: id,
  cancelledAtMs: z.number().int().positive().max(8_640_000_000_000_000) });
const marketplaceShape = z.strictObject({ users: z.array(row), marketplaceListings: z.array(row), purchaseRequests: z.array(row),
  commissionRecords: z.array(row), sellerReviews: z.array(row), marketplaceEnforcementRecords: z.array(row),
  tradeEvidenceFiles: z.array(row), disputes: z.array(row), notifications: z.array(row) });
const requestShape = z.object({ id, tradeId: id.optional(), listingId: id, sellerId: id, buyerId: id, status: z.string(),
  usdtAmount: z.string(), fiatAmount: z.string(), currency: z.string(), network: z.string(), paymentMethod: z.string(),
  createdAt: time, updatedAt: time, tradeCreatedAt: time.optional(),
  timeline: z.array(z.object({ id, type: z.string(), actorUserId: id.optional(), actorRole: role,
    message: z.string(), createdAt: time }).passthrough()),
  messages: z.array(z.object({ id, createdAt: time, credentialKind: z.literal("cardless_code").optional() }).passthrough()).optional(),
  sensitivePaymentKind: z.enum(["bank_details", "cardless_code"]).optional(), sensitivePaymentSharedAt: time.optional(),
  cardlessCodeAwaitingBuyerConfirmation: z.boolean().optional(),
  paymentSentAt: time.optional(), fundsReceivedAt: time.optional(), usdtReleaseStartedAt: time.optional(),
  usdtSentAt: time.optional(), completedAt: time.optional(),
  termsProposal: z.object({ id, kind: z.enum(["counter_offer", "amount_correction"]),
    status: z.enum(["pending", "accepted", "declined", "withdrawn"]), pricePerUsdt: z.string(),
    usdtAmount: z.string(), fiatAmount: z.string(), createdAt: time, resolvedAt: time.optional() }).passthrough().optional(),
}).passthrough();
const listingShape = z.object({ id, sellerId: id, status: z.string(), originalAmount: z.string(), availableAmount: z.string(),
  price: z.string(), currency: z.string(), network: z.string(), minimumTrade: z.string(), maximumTrade: z.string(),
  activeTradeRequestId: id.optional(), lockedAt: time.optional(), expiresAt: time.optional(), createdAt: time, updatedAt: time,
}).passthrough();
const accountShape = z.object({ id, role, disabled: z.boolean().optional(), createdAt: time, updatedAt: time }).passthrough();
const notificationShape = z.object({ id, userId: id, category: z.string(), title: z.string(), message: z.string(),
  isRead: z.boolean(), createdAt: time, updatedAt: time.optional(), archivedAt: time.optional(),
  relatedRequestId: id.optional(), relatedTradeId: id.optional(), relatedListingId: id.optional(),
  state: z.enum(["unread", "read", "archived"]).optional(), reason: z.string().optional(),
}).passthrough();
// This new financial-groundwork scope is deliberately stricter than the
// unchanged ordinary cancellation predicate: a retained payment/settlement or
// evidence event contradicts unpaid state even if its current marker is absent.
// Bank disclosure and resolved disputes retain their separate existing rules.
const contradictoryPrepaymentHistory = new Set<PurchaseRequest["timeline"][number]["type"]>([
  "payment_sent", "seller_confirmed_funds", "buyer_confirmed_funds", "usdt_release_started", "usdt_sent",
  "trade_completed", "buyer_confirmed_receipt", "buyer_evidence_uploaded", "seller_evidence_uploaded",
]);
function validateRows(items: readonly { id: string }[], shape: z.ZodType, label: string) {
  const seen = new Set<string>();
  for (const item of items) {
    check(shape.safeParse(item).success, "INVALID", `has a malformed ${label}`);
    check(!seen.has(item.id), "INTEGRITY", `has a duplicate ${label} identity`); seen.add(item.id);
  }
}
function unique<T extends { id: string }>(items: readonly T[], key: string, label: string): T {
  const matches = items.filter(item => item.id === key);
  check(matches.length === 1, "INTEGRITY", `requires one exact ${label}`); return matches[0]!;
}

/**
 * Separate groundwork for a single accepted initial-style Bank/F2F request.
 * The caller must supply a complete fenced canonical read; a plain object is
 * neither authentication nor evidence that missing rows do not exist. Expired
 * listings, pending requests, competing reservations, owner overrides, financial
 * returns, idempotent receipts and external publication need other contracts.
 * Existing production cancellation and initial coordinator rules are unchanged.
 */
export function planDevelopmentPrepaymentCancellation(
  marketplaceInput: DevelopmentPrepaymentCancellationMarketplace,
  decisionInput: DevelopmentPrepaymentCancellationDecision,
): DevelopmentPrepaymentCancellationResult {
  assertSimulationRuntime("simulation-only");
  let marketplace: DevelopmentPrepaymentCancellationMarketplace, decision: DevelopmentPrepaymentCancellationDecision;
  try { marketplace = structuredClone(marketplaceInput); decision = structuredClone(decisionInput); }
  catch { throw new PrepaymentCancellationPlanningError("INVALID", "Prepayment cancellation requires cloneable retained data."); }
  check(decisionShape.safeParse(decision).success, "INVALID", "requires its narrow retained participant decision");
  check(marketplaceShape.safeParse(marketplace).success, "INVALID", "requires explicit complete canonical collections");
  check(Object.values(marketplace).reduce((sum, rows) => sum + rows.length, 0) <= 10000, "UNSUPPORTED", "exceeds its bounded read scope");
  validateRows(marketplace.users, accountShape, "account");
  validateRows(marketplace.marketplaceListings, listingShape, "listing");
  validateRows(marketplace.purchaseRequests, requestShape, "request");
  validateRows(marketplace.notifications, notificationShape, "notification");
  validateRows(marketplace.tradeEvidenceFiles, z.object({ id, purchaseRequestId: id, side: z.enum(["buyer", "seller"]) }).passthrough(), "evidence");
  validateRows(marketplace.disputes, z.object({ id, purchaseRequestId: id, tradeId: id.optional(), status: z.enum(["open", "resolved"]) }).passthrough(), "dispute");
  for (const collection of [marketplace.commissionRecords, marketplace.marketplaceEnforcementRecords, marketplace.sellerReviews]) {
    validateRows(collection, z.object({ id }).passthrough(), "retained dependency");
  }
  const before = unique(marketplace.purchaseRequests, decision.requestId, "request");
  const beforeListing = unique(marketplace.marketplaceListings, before.listingId, "listing");
  const seller = unique(marketplace.users, before.sellerId, "seller account");
  const buyer = unique(marketplace.users, before.buyerId, "buyer account");
  check(seller.id !== buyer.id && beforeListing.sellerId === seller.id && before.tradeId === decision.tradeId,
    "INTEGRITY", "requires unchanged request, trade and party identities");
  const tradeIds = marketplace.purchaseRequests.flatMap(request => request.tradeId === undefined ? [] : [request.tradeId]);
  check(new Set(tradeIds).size === tradeIds.length, "INTEGRITY", "has duplicate canonical trade identities");
  check(decision.actorUserId === buyer.id || decision.actorUserId === seller.id, "ACTOR", "requires the retained buyer or seller; owner override is excluded");
  const actor = decision.actorUserId === seller.id ? seller : buyer;
  check(actor.disabled !== true, "ACTOR", "requires an enabled retained actor account");
  check(decision.cancelledAtMs > Date.parse(before.updatedAt) && decision.cancelledAtMs > Date.parse(beforeListing.updatedAt)
    && Date.parse(before.createdAt) <= Date.parse(before.tradeCreatedAt ?? "")
    && Date.parse(before.tradeCreatedAt ?? "") <= Date.parse(before.updatedAt)
    && Date.parse(beforeListing.createdAt) <= Date.parse(beforeListing.updatedAt), "STALE", "requires a strictly later explicit clock and retained acceptance chronology");
  const at = new Date(decision.cancelledAtMs).toISOString();
  check(before.status === "accepted", "UNSUPPORTED", "requires an accepted unpaid request");
  check(!hasIrreversibleRequestProgress(before)
    && !marketplace.tradeEvidenceFiles.some(file => file.purchaseRequestId === before.id), "LOCKED", "refuses irreversible payment or evidence progress");
  check(before.timeline.every(event => !contradictoryPrepaymentHistory.has(event.type)), "INTEGRITY",
    "refuses retained payment, settlement or evidence timeline progress that contradicts unpaid state");
  check(marketplace.disputes.every(dispute => {
    const tradeId = (dispute as { tradeId?: string }).tradeId;
    return !(tradeId === before.tradeId && dispute.purchaseRequestId !== before.id)
      && !(dispute.purchaseRequestId === before.id && tradeId !== undefined && tradeId !== before.tradeId);
  }), "INTEGRITY", "refuses inconsistent request and trade dispute linkage");
  check(!marketplace.disputes.some(dispute => dispute.purchaseRequestId === before.id && dispute.status === "open"), "LOCKED", "refuses an open dispute");
  check(actor.id !== buyer.id || !hasRevealedBankDetails(before), "LOCKED", "refuses buyer cancellation after bank details were revealed");
  const unsupported: (keyof PurchaseRequest)[] = ["usdtDemandId", "usdtDemandOfferId", "priceOfferAcceptedAt", "timedOutAt", "timeoutReason",
    "buyerConfirmationArchivedAt", "lockedAt", "reviewUnlockedAt", "buyerReview", "sellerBuyerReview", "sellerResponse", "closedAt",
    "closedByUserId", "closeReason", "closeExplanation", "completionReceipt", "historicalCompletion", "buyerVolumeCredit", "trustReconciliation",
    "usdtReleaseDeadlineAt", "sellerWiseAccountId", "buyerWiseAccountId", "sellerWiseAccountSnapshot", "buyerWiseAccountSnapshot"];
  check(unsupported.every(field => before[field] === undefined) && before.currency === "ILS"
    && (before.network === "TRC20" || before.network === "BEP20") && before.priceMode === "listing_price"
    && before.feePolicyVersion === "buyer_seller_1pct_v1" && before.commissionCalculationVersion === "usdt_6dp_v2"
    && (before.amountAdjustmentCount === undefined || before.amountAdjustmentCount === 0)
    && (!before.counterPrices || before.counterPrices.length === 0)
    && ["Bank Transfer", "Face-to-Face", "Face-to-Face (Meet in Person)"].includes(before.paymentMethod)
    && before.bankTransferProvider !== "wise" && before.sensitivePaymentKind !== "cardless_code"
    && before.cardlessCodeAwaitingBuyerConfirmation !== true
    && !before.messages?.some(message => message.credentialKind === "cardless_code"), "UNSUPPORTED", "is outside the accepted initial Bank/F2F scope");
  check(beforeListing.status === "matched" && beforeListing.activeTradeRequestId === before.id && !!beforeListing.lockedAt
    && beforeListing.currency === before.currency && beforeListing.network === before.network
    && beforeListing.bankTransferProvider !== "wise" && !beforeListing.wiseAccountId
    && !beforeListing.closedAt && !beforeListing.expiredAt && !beforeListing.cancelledAt && !beforeListing.completedAt,
  "UNSUPPORTED", "requires the exact ordinary representative listing lock");
  check(!beforeListing.expiresAt || Date.parse(beforeListing.expiresAt) > decision.cancelledAtMs, "UNSUPPORTED", "requires an unexpired listing; expiry needs a separate inventory policy");
  check(marketplace.purchaseRequests.filter(request => request.listingId === before.listingId).every(request => request.sellerId === seller.id)
    && !marketplace.purchaseRequests.some(request => request.id !== before.id && request.listingId === before.listingId
      && isDemandReservedTrade(request)), "UNSUPPORTED", "refuses competing or inconsistent listing reservations");
  check(!marketplace.commissionRecords.some(commission => commission.purchaseRequestId === before.id || commission.tradeId === before.tradeId),
    "LOCKED", "refuses a retained target commission");
  check(new Set(before.timeline.map(event => event.id)).size === before.timeline.length
    && before.timeline.every(event => Date.parse(event.createdAt) >= Date.parse(before.createdAt)
      && Date.parse(event.createdAt) <= Date.parse(before.updatedAt)), "INTEGRITY", "requires consistent retained timeline chronology");
  const terms = describeDevelopmentTradeTerms({ mode: "simulation-only", request: before,
    assetId: before.network === "TRC20" ? "tron-sim-usdt" : "bsc-sim-binance-peg-usdt", walletListingId: beforeListing.id });
  check(terms.terms.listingPriceAtRequest === terms.terms.pricePerUsdt
    && parseUnits(beforeListing.availableAmount, 6) >= parseUnits(before.usdtAmount, 6), "INTEGRITY", "requires unchanged retained listing-price terms and covered principal");
  const suffix = createHash("sha256").update(JSON.stringify(["prepayment_participant_cancellation", before.id, before.tradeId])).digest("hex");
  const side = actor.id === seller.id ? "Seller" : "Buyer";
  const timeline = [...structuredClone(before.timeline), { id: `prepayment-cancellation-event-${suffix}`, type: "request_cancelled" as const,
    actorUserId: actor.id, actorRole: actor.role, message: `${side} cancelled request`, createdAt: at }];
  check(!before.timeline.some(event => event.id === timeline[timeline.length - 1].id), "INTEGRITY", "already has its cancellation event identity");
  const request: PurchaseRequest = { ...structuredClone(before), status: "cancelled", updatedAt: at, timeline,
    actionReminderState: undefined, inactivityWarningSentAt: undefined,
    ...(before.termsProposal?.status === "pending" ? { termsProposal: { ...structuredClone(before.termsProposal), status: "withdrawn", resolvedAt: at } } : {}),
    trustReconciliation: { requestedAt: at, requestedByUserId: actor.id } };
  const listing: MarketplaceListing = { ...structuredClone(beforeListing), status: "active", updatedAt: at,
    activeTradeRequestId: undefined, lockedAt: undefined };
  const trade: DevelopmentPrepaymentCancellationResult["trade"] = { id: decision.tradeId, purchaseRequestId: before.id,
    listingId: before.listingId, sellerId: seller.id, buyerId: buyer.id, status: "cancelled", createdAt: before.tradeCreatedAt!, updatedAt: at,
    timeline: structuredClone(timeline) };
  const notifications: AlphaExchangeNotification[] = [buyer, seller].map(recipient => ({
    id: `prepayment-cancellation-notification-${recipient.id === buyer.id ? "buyer" : "seller"}-${suffix}`,
    userId: recipient.id, category: "trade", title: "Trade cancelled", message: `The ${side.toLowerCase()} cancelled this trade request.`,
    isRead: false, state: "unread", relatedRequestId: before.id, relatedTradeId: before.tradeId, relatedListingId: before.listingId,
    relatedHref: `/trade-room/${encodeURIComponent(before.id)}`, createdAt: at,
  }));
  check(!marketplace.notifications.some(existing => notifications.some(notification => notification.id === existing.id)),
    "INTEGRITY", "already has a cancellation notification identity");
  const notificationUpdates: AlphaExchangeNotification[] = marketplace.notifications.filter(notification =>
    notification.reason === "automatic_trade_action_reminder" && notification.relatedRequestId === before.id
      && notification.userId === buyer.id && notification.state !== "archived").map(notification => ({
    ...structuredClone(notification), state: "archived", isRead: true, archivedAt: at, updatedAt: at,
  }));
  const auditLogs: AuditLogEntry[] = [{ id: `prepayment-cancellation-audit-${suffix}`, action: "listing_reopened",
    actorUserId: actor.id, targetUserId: seller.id, listingId: before.listingId, purchaseRequestId: before.id,
    details: `Listing ${before.listingId} reopened after trade cancellation.`,
    oldValue: { status: before.status, activeTradeRequestId: beforeListing.activeTradeRequestId }, newValue: { status: "active" },
    reason: `${side} cancelled the trade.`, createdAt: at }];
  return freeze({ request, listing, trade, notifications, notificationUpdates, auditLogs });
}
