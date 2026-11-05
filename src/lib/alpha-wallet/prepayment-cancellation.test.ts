// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeNotification, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { planDevelopmentPrepaymentCancellation, PrepaymentCancellationPlanningError,
  type DevelopmentPrepaymentCancellationDecision, type DevelopmentPrepaymentCancellationMarketplace } from "./prepayment-cancellation";
import { simulatedDestination } from "./sandbox";

const AT = 1_800_000_000_000, ACCEPTED = AT + 1000, CANCELLED = AT + 2000;
const createdAt = new Date(AT).toISOString(), acceptedAt = new Date(ACCEPTED).toISOString(), cancelledAt = new Date(CANCELLED).toISOString();
type MutableMarketplace = { [K in keyof DevelopmentPrepaymentCancellationMarketplace]: Array<DevelopmentPrepaymentCancellationMarketplace[K][number]> };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function fixture(method: "Bank Transfer" | "Face-to-Face" | "Face-to-Face (Meet in Person)" = "Bank Transfer", network: "TRC20" | "BEP20" = "TRC20") {
  const users: AlphaExchangeUser[] = ["cancellation-seller", "cancellation-buyer", "cancellation-owner"].map((id, index) => ({
    id, fullName: `Synthetic ${id}`, email: `${id}@example.invalid`, passwordHash: "synthetic-not-a-login", whatsappNumber: "",
    preferredNetworks: [network], profilePhotoUrl: "", languages: ["en"], bio: "Fixture", onlineStatus: "offline", availabilityStatus: "available",
    role: index === 0 ? "approved_seller" : index === 1 ? "buyer" : "owner", sellerStatus: index === 0 ? "approved_seller" : "buyer",
    disabled: false, createdAt, updatedAt: createdAt,
  }));
  const [seller, buyer, owner] = users;
  const request: PurchaseRequest = { id: "cancellation-request", tradeId: "cancellation-trade", listingId: "cancellation-listing",
    sellerId: seller.id, buyerId: buyer.id, buyerName: "Synthetic buyer", usdtAmount: "200", fiatAmount: "646.40", pricePerUsdt: "3.20",
    listingPriceAtRequest: "3.20", priceMode: "listing_price", currency: "ILS", network, paymentMethod: method,
    buyerReceivingWalletAddress: simulatedDestination(network === "TRC20" ? "tron-sim-usdt" : "bsc-sim-binance-peg-usdt", buyer.id),
    feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2", amountAdjustmentCount: 0,
    status: "accepted", createdAt, updatedAt: acceptedAt, tradeCreatedAt: acceptedAt, messages: [],
    timeline: [{ id: "cancellation-submission", type: "request_submitted", actorUserId: buyer.id, actorRole: buyer.role, message: "Buyer submitted request", createdAt },
      { id: "cancellation-acceptance", type: "request_accepted", actorUserId: seller.id, actorRole: seller.role, message: "Seller accepted request", createdAt: acceptedAt }],
    ...(method === "Bank Transfer" ? { bankTransferProvider: "israeli_bank" as const, sellerBankAccountId: "cancellation-bank",
      sellerBankAccountSnapshot: { accountHolderName: "Synthetic seller", bankName: "Synthetic bank", branchNumber: "000", accountNumber: "00000000", accountLast4: "0000" } } : {}),
  };
  const listing: MarketplaceListing = { id: request.listingId, sellerId: seller.id, sellerDisplayName: "Synthetic seller", photos: [],
    originalAmount: "500", availableAmount: "500", price: "3.40", currency: "ILS", network, paymentMethod: method, paymentMethods: [method],
    minimumTrade: "1", maximumTrade: "500", sellerDescription: "Fixture", responseTime: "Fixture", status: "matched", approvalStatus: "approved",
    activeTradeRequestId: request.id, lockedAt: acceptedAt, createdAt, updatedAt: acceptedAt };
  const marketplace: MutableMarketplace = { users, marketplaceListings: [listing], purchaseRequests: [request], commissionRecords: [],
    sellerReviews: [], marketplaceEnforcementRecords: [], tradeEvidenceFiles: [], disputes: [], notifications: [] };
  const decision: DevelopmentPrepaymentCancellationDecision = { requestId: request.id, tradeId: request.tradeId!, actorUserId: seller.id, cancelledAtMs: CANCELLED };
  return { marketplace, decision, request, listing, seller, buyer, owner };
}
type Fixture = ReturnType<typeof fixture>;
function plan(f: Fixture, extra: Partial<DevelopmentPrepaymentCancellationDecision> = {}) {
  return planDevelopmentPrepaymentCancellation(f.marketplace, { ...f.decision, ...extra });
}
function reminder(f: Fixture, id: string, patch: Partial<AlphaExchangeNotification> = {}): AlphaExchangeNotification {
  return { id, userId: f.buyer.id, category: "trade", title: "Action required", message: "Synthetic reminder", isRead: false,
    state: "unread", relatedRequestId: f.request.id, relatedTradeId: f.request.tradeId, relatedListingId: f.listing.id,
    reason: "automatic_trade_action_reminder", createdAt: acceptedAt, ...patch };
}

describe("separate pure prepayment cancellation groundwork", () => {
  it.each(["seller", "buyer"] as const)("derives exact deterministic %s cancellation without mutating retained terms", side => {
    const f = fixture(), before = structuredClone(f.marketplace), actor = f[side];
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Ambient clock is forbidden"); });
    const result = plan(f, { actorUserId: actor.id });
    expect(result).toEqual(plan(f, { actorUserId: actor.id })); expect(f.marketplace).toEqual(before);
    expect(result.request).toEqual({ ...f.request, status: "cancelled", updatedAt: cancelledAt,
      timeline: [...f.request.timeline, expect.objectContaining({ type: "request_cancelled", actorUserId: actor.id,
        actorRole: actor.role, message: `${side === "seller" ? "Seller" : "Buyer"} cancelled request`, createdAt: cancelledAt })],
      actionReminderState: undefined, inactivityWarningSentAt: undefined,
      trustReconciliation: { requestedAt: cancelledAt, requestedByUserId: actor.id } });
    expect(result.listing).toEqual({ ...f.listing, status: "active", activeTradeRequestId: undefined, lockedAt: undefined, updatedAt: cancelledAt });
    expect(result.trade).toEqual({ id: f.request.tradeId, purchaseRequestId: f.request.id, listingId: f.listing.id,
      sellerId: f.seller.id, buyerId: f.buyer.id, status: "cancelled", createdAt: acceptedAt, updatedAt: cancelledAt, timeline: result.request.timeline });
    expect(result.notifications).toHaveLength(2);
    expect(result.notifications.map(row => row.userId)).toEqual([f.buyer.id, f.seller.id]);
    expect(result.notifications.every(row => row.title === "Trade cancelled" && row.message === `The ${side} cancelled this trade request.`
      && row.relatedHref === `/trade-room/${f.request.id}` && row.createdAt === cancelledAt && !row.isRead)).toBe(true);
    expect(result.notificationUpdates).toEqual([]);
    expect(result.auditLogs).toEqual([expect.objectContaining({ action: "listing_reopened", actorUserId: actor.id,
      targetUserId: f.seller.id, listingId: f.listing.id, purchaseRequestId: f.request.id,
      oldValue: { status: "accepted", activeTradeRequestId: f.request.id }, newValue: { status: "active" },
      reason: `${side === "seller" ? "Seller" : "Buyer"} cancelled the trade.`, createdAt: cancelledAt })]);
    expect(result.request.usdtAmount).toBe("200"); expect(result.listing.availableAmount).toBe("500");
    expect(result.request.closedAt).toBeUndefined(); expect(result.request.closeReason).toBeUndefined();
    expect(result.request.messages).toEqual([]); expect(Object.isFrozen(result.request.timeline)).toBe(true);
  });

  it.each(["Face-to-Face", "Face-to-Face (Meet in Person)"] as const)("supports retained %s without inventing new payment consent", method => {
    const f = fixture(method); expect(plan(f).request.paymentMethod).toBe(method);
  });
  it("preserves exact BSC terms and differing current listing price", () => {
    const f = fixture("Bank Transfer", "BEP20"), result = plan(f);
    expect(result.request.pricePerUsdt).toBe("3.20"); expect(result.listing.price).toBe("3.40"); expect(result.request.network).toBe("BEP20");
  });
  it("withdraws pending proposals, clears reminder intent, and archives only live accepted-stage buyer reminders", () => {
    const f = fixture();
    f.request.termsProposal = { id: "cancellation-proposal", kind: "amount_correction", status: "pending", pricePerUsdt: "3.20", usdtAmount: "250", fiatAmount: "808.00", createdAt: acceptedAt };
    f.request.actionReminderState = { stage: "accepted", actionStartedAt: acceptedAt,
      buyer: { userId: f.buyer.id, lastSentAt: acceptedAt, reminderCount: 1 } };
    f.request.inactivityWarningSentAt = acceptedAt;
    f.marketplace.notifications.push(reminder(f, "buyer-live"), reminder(f, "buyer-read", { state: "read", isRead: true }),
      reminder(f, "buyer-archived", { state: "archived", isRead: true, archivedAt: acceptedAt }),
      reminder(f, "seller-reminder", { userId: f.seller.id }), reminder(f, "different-request", { relatedRequestId: "other-request" }),
      reminder(f, "different-reason", { reason: "other-reason" }));
    const result = plan(f);
    expect(result.request.termsProposal).toEqual({ ...f.request.termsProposal, status: "withdrawn", resolvedAt: cancelledAt });
    expect(result.request.actionReminderState).toBeUndefined(); expect(result.request.inactivityWarningSentAt).toBeUndefined();
    expect(result.notificationUpdates).toEqual(f.marketplace.notifications.slice(0, 2).map(row => ({ ...row, state: "archived", isRead: true,
      archivedAt: cancelledAt, updatedAt: cancelledAt })));
    expect(f.request.termsProposal.status).toBe("pending"); expect(f.marketplace.notifications[0].isRead).toBe(false);
  });
  it("preserves an already declined proposal without rewriting resolution history", () => {
    const f = fixture();
    f.request.termsProposal = { id: "declined-proposal", kind: "counter_offer", status: "declined", pricePerUsdt: "3.10", usdtAmount: "200", fiatAmount: "626.20", createdAt, resolvedAt: acceptedAt };
    expect(plan(f).request.termsProposal).toEqual(f.request.termsProposal);
  });
  it.each(["marker", "buyer timeline", "legacy missing actor"] as const)("blocks buyer bank disclosure from %s but permits seller cancellation", source => {
    const f = fixture();
    if (source === "marker") Object.assign(f.request, { sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: acceptedAt });
    else f.request.timeline.push({ id: "disclosure-event", type: "bank_details_revealed", actorUserId: source === "buyer timeline" ? f.buyer.id : undefined,
      actorRole: "buyer", message: "Revealed", createdAt: acceptedAt } as PurchaseRequest["timeline"][number]);
    expect(() => plan(f, { actorUserId: f.buyer.id })).toThrow("bank details");
    const result = plan(f); expect(result.request.sensitivePaymentSharedAt).toBe(f.request.sensitivePaymentSharedAt);
    expect(result.request.timeline.slice(0, -1)).toEqual(f.request.timeline);
  });
  it("does not mistake another actor's bank-details timeline entry for buyer disclosure", () => {
    const f = fixture(); f.request.timeline.push({ id: "seller-disclosure-event", type: "bank_details_revealed", actorUserId: f.seller.id,
      actorRole: "approved_seller", message: "Seller reviewed", createdAt: acceptedAt });
    expect(plan(f, { actorUserId: f.buyer.id }).request.status).toBe("cancelled");
  });
  it("allows an actual participant with owner metadata but refuses an unrelated owner", () => {
    const f = fixture(); expect(() => plan(f, { actorUserId: f.owner.id })).toThrow("owner override");
    f.seller.role = "owner";
    expect(plan(f).request.timeline.at(-1)?.actorRole).toBe("owner");
  });
  it("does not apply new-sale availability, seller approval, blocklist or outstanding unrelated commission rules", () => {
    const f = fixture(); Object.assign(f.seller, { sellerStatus: "suspended", role: "buyer", availabilityStatus: "vacation", isProfileHidden: true, blockedUserIds: [f.buyer.id] });
    f.marketplace.marketplaceEnforcementRecords.push({ id: "seller-enforcement", sellerId: f.seller.id, status: "active" } as never);
    f.marketplace.commissionRecords.push({ id: "other-commission", sellerId: f.seller.id, purchaseRequestId: "other-request", paymentStatus: "overdue" } as never);
    expect(plan(f).request.status).toBe("cancelled");
  });
  it.each(["paymentSentAt", "fundsReceivedAt", "usdtReleaseStartedAt", "usdtSentAt", "completedAt"] as const)("rejects retained %s even with stale accepted status", field => {
    const f = fixture(); f.request[field] = acceptedAt; expect(() => plan(f)).toThrow("irreversible");
  });
  it.each(["buyerEvidence", "sellerEvidence"] as const)("rejects embedded %s", field => {
    const f = fixture(); f.request[field] = { id: "evidence" } as never; expect(() => plan(f)).toThrow("irreversible");
  });
  it.each(["buyer", "seller"] as const)("rejects stored %s evidence", side => {
    const f = fixture(); f.marketplace.tradeEvidenceFiles.push({ id: "stored-evidence", purchaseRequestId: f.request.id, side });
    expect(() => plan(f)).toThrow("irreversible");
  });
  it.each([
    "payment_sent", "seller_confirmed_funds", "buyer_confirmed_funds", "usdt_release_started", "usdt_sent",
    "trade_completed", "buyer_confirmed_receipt", "buyer_evidence_uploaded", "seller_evidence_uploaded",
  ] as const)("refuses retained %s history even when accepted status and current fields appear unpaid", type => {
    const f = fixture();
    f.request.timeline.push({ id: `contradictory-${type}`, type, actorUserId: f.buyer.id, actorRole: f.buyer.role,
      message: "Synthetic retained lifecycle event", createdAt: acceptedAt });
    expect(f.request.status).toBe("accepted"); expect(f.marketplace.tradeEvidenceFiles).toEqual([]);
    expect(() => plan(f)).toThrow("timeline progress that contradicts unpaid state");
  });
  it("refuses an open dispute but preserves resolved dispute history", () => {
    const f = fixture(); f.marketplace.disputes.push({ id: "retained-dispute", purchaseRequestId: f.request.id, status: "open" });
    expect(() => plan(f)).toThrow("open dispute"); f.marketplace.disputes[0].status = "resolved";
    f.request.timeline.push({ id: "resolved-dispute-history", type: "dispute_resolved", actorUserId: f.owner.id, actorRole: f.owner.role,
      message: "Synthetic dispute resolved without payment", createdAt: acceptedAt });
    const result = plan(f); expect(result.request.status).toBe("cancelled");
    expect(result.request.timeline.slice(0, -1)).toEqual(f.request.timeline);
  });
  it.each(["wrong request", "wrong trade"])("refuses a dispute with %s linkage instead of hiding it from the prepayment gate", mismatch => {
    const f = fixture();
    f.marketplace.disputes.push(Object.assign({ id: "mismatched-dispute", status: "open" as const,
      purchaseRequestId: mismatch === "wrong request" ? "other-request" : f.request.id },
    { tradeId: mismatch === "wrong trade" ? "other-trade" : f.request.tradeId }));
    expect(() => plan(f)).toThrow("dispute linkage");
  });
  it.each(["pending", "payment_sent", "completed", "cancelled"] as const)("refuses %s as a new cancellation", status => {
    const f = fixture(); f.request.status = status; expect(() => plan(f)).toThrow("accepted unpaid");
  });
  it.each(["expiry boundary", "past expiry", "malformed expiry", "wrong representative", "missing representative", "missing lock", "competing reservation"])("refuses %s rather than inventing an inventory policy", condition => {
    const f = fixture();
    if (condition === "expiry boundary") f.listing.expiresAt = cancelledAt;
    if (condition === "past expiry") f.listing.expiresAt = acceptedAt;
    if (condition === "malformed expiry") f.listing.expiresAt = "not-a-date";
    if (condition === "wrong representative") f.listing.activeTradeRequestId = "other-request";
    if (condition === "missing representative") delete f.listing.activeTradeRequestId;
    if (condition === "missing lock") delete f.listing.lockedAt;
    if (condition === "competing reservation") f.marketplace.purchaseRequests.push({ ...structuredClone(f.request), id: "other-request", tradeId: "other-trade" });
    expect(() => plan(f)).toThrow();
  });
  it("retains future expiry and ordinary pending sibling requests", () => {
    const f = fixture(); f.listing.expiresAt = new Date(CANCELLED + 1).toISOString();
    f.marketplace.purchaseRequests.push({ ...structuredClone(f.request), id: "pending-sibling", tradeId: "pending-trade", status: "pending" });
    const result = plan(f); expect(result.listing.expiresAt).toBe(f.listing.expiresAt); expect(result.listing.availableAmount).toBe("500");
  });
  it.each([
    ["unrelated actor", { actorUserId: "unknown-user" }], ["new trade identity", { tradeId: "replacement-trade" }],
    ["request alias", { requestId: "cancellation-trade" }], ["old clock", { cancelledAtMs: ACCEPTED }],
    ["fractional clock", { cancelledAtMs: CANCELLED + 0.5 }], ["caller role", { role: "owner" }],
    ["caller financial amount", { usdtAmount: "500" }], ["caller reason", { reason: "override" }],
  ])("refuses %s input", (_label, extra) => { const f = fixture(); expect(() => plan(f, extra as Partial<DevelopmentPrepaymentCancellationDecision>)).toThrow(); });
  it.each(["missing collection", "duplicate request", "duplicate trade", "duplicate user", "uncloneable data"])("refuses %s", condition => {
    const f = fixture();
    if (condition === "missing collection") delete (f.marketplace as Partial<MutableMarketplace>).notifications;
    if (condition === "duplicate request") f.marketplace.purchaseRequests.push(structuredClone(f.request));
    if (condition === "duplicate trade") f.marketplace.purchaseRequests.push({ ...structuredClone(f.request), id: "trade-alias" });
    if (condition === "duplicate user") f.marketplace.users.push(structuredClone(f.seller));
    if (condition === "uncloneable data") Object.assign(f.request, { unsupportedCallback: () => true });
    expect(() => plan(f)).toThrow(PrepaymentCancellationPlanningError);
  });
  it("refuses deterministic event collisions rather than treating status as a receipt", () => {
    const f = fixture(), planned = plan(f); f.marketplace.notifications.push(planned.notifications[0]);
    expect(() => plan(f)).toThrow("notification identity");
  });
  it("refuses target commissions and old manual-close lifecycle metadata", () => {
    const f = fixture(); f.marketplace.commissionRecords.push({ id: "target-commission", sellerId: f.seller.id, tradeId: f.request.tradeId } as never);
    expect(() => plan(f)).toThrow("target commission"); f.marketplace.commissionRecords = []; f.request.closedAt = acceptedAt;
    expect(() => plan(f)).toThrow("initial Bank/F2F scope");
  });
  it.each(["production", "hosted", "signing"])("refuses a %s runtime", runtime => {
    const f = fixture();
    if (runtime === "production") vi.stubEnv("NODE_ENV", "production");
    if (runtime === "hosted") vi.stubEnv("VERCEL", "1");
    if (runtime === "signing") vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1");
    expect(() => plan(f)).toThrow();
  });
});
