import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, CommissionRecord, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { prepareHistoricalTradeReconciliation, type HistoricalTradeReconciliationInput } from "@/lib/historical-trade-reconciliation";
import { getAccountProfileData, getListingReliabilityForAdmin, getMarketplaceListingsForAdmin, getMyMarketplaceListings, getOwnerBusinessDashboardForAdmin, invalidateAlphaExchangeStoreCache, prepareHistoricalTradeSnapshotForOwner,
  reconcileHistoricalTradeByOwner, sanitizePurchaseRequestForActor } from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import * as realtime from "@/lib/realtime";
import * as marketplaceEmail from "@/lib/marketplace-email-delivery";

const CREATED = "2026-02-01T09:00:00.000Z";
const CLOSED = "2026-02-02T09:00:00.000Z";
const RECORDED = "2026-02-02T10:00:00.000Z";
const RESIDUAL = "9568.765433";
const input: HistoricalTradeReconciliationInput = {
  operationId: "historical-fixture-once", actorUserId: "owner", listingId: "listing", requestId: "target",
  preservedCompletedRequestIds: ["anchor"], totalSoldUsdt: "10000", reason: "Owner confirms the entire listing was sold externally and its fees were settled.",
  offlineCompletionConfirmed: true, commissionSettledConfirmed: true,
};

function user(id: string, role: "owner" | "approved_seller" | "buyer"): AlphaExchangeUser {
  return { id, fullName: id, email: `${id}@example.test`, passwordHash: "preserved-hash", whatsappNumber: "",
    role, roles: [role], sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    sellerApprovalVerification: role === "approved_seller" ? createTestSellerApprovalVerification(CREATED, "owner") : undefined,
    createdAt: CREATED, updatedAt: CREATED, emailVerified: true, availabilityStatus: "available", onlineStatus: "offline",
    preferredNetworks: [], preferredPaymentMethods: [], languages: ["English"], bio: "", profilePhotoUrl: "",
    lifetimeCompletedVolumeUsdt: 0, sellerPrestigeRank: "bronze", sellerPromotionHistory: [], sellerAchievements: [] } as AlphaExchangeUser;
}

function trade(id: string, amount: string, status: PurchaseRequest["status"]): PurchaseRequest {
  return { id, sellerId: "seller", buyerId: id === "target" ? "buyer" : "earlier-buyer", buyerName: "Private Fixture Name",
    listingId: "listing", usdtAmount: amount, fiatAmount: "42420.00", pricePerUsdt: "4.20", listingPriceAtRequest: "4.20",
    currency: "ILS", network: "TRC20", paymentMethod: "Face-to-Face (Meet in Person)", status,
    feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2",
    createdAt: CREATED, updatedAt: CLOSED, timeline: [], messages: [] };
}

function seed(): AlphaExchangeDb & { __runtimeVersion: number } {
  const seller = user("seller", "approved_seller");
  seller.lifetimeCompletedVolumeUsdt = 5431.234567;
  const anchor = { ...trade("anchor", "431.234567", "review_open"), fiatAmount: "1829.30", completedAt: CLOSED,
    reviewUnlockedAt: CLOSED, messages: [{ id: "anchor-message", message: "Preserve this history.", createdAt: CREATED }] } as PurchaseRequest;
  const previous = { ...trade("previous", "5000", "cancelled"), listingId: "old-listing", completedAt: CREATED };
  const priorBuyerTrade = { ...trade("buyer-history", "1000", "completed"), sellerId: "another-seller", buyerId: "buyer", listingId: "other-listing" };
  const listing = { id: "listing", sellerId: "seller", sellerDisplayName: "Seller", originalAmount: "10000", availableAmount: RESIDUAL,
    price: "4.20", currency: "ILS", network: "TRC20", paymentMethod: "Face-to-Face (Meet in Person)",
    paymentMethods: ["Face-to-Face (Meet in Person)"], photos: [], sellerDescription: "", responseTime: "", minimumTrade: "50", maximumTrade: RESIDUAL,
    status: "closed", approvalStatus: "approved", createdAt: CREATED, updatedAt: CLOSED, closedAt: CLOSED } as MarketplaceListing;
  const anchorCommission: CommissionRecord = { id: "anchor-commission", displayNumber: 7, source: "trade", sellerId: "seller",
    buyerId: "earlier-buyer", purchaseRequestId: "anchor", listingId: "listing", rate: 0.01, grossAmount: 1829.30,
    commissionAmount: 8.624692, paymentStatus: "paid", paymentVerificationStatus: "verified", paymentProvider: "crypto_wallet",
    paymentSignature: "a".repeat(64), paymentNetwork: "TRC20", paidAt: CLOSED, createdAt: CREATED, updatedAt: CLOSED };
  return { users: [user("owner", "owner"), seller, user("buyer", "buyer")], sellerApplications: [],
    marketplaceListings: [listing], purchaseRequests: [anchor, previous, priorBuyerTrade, trade("target", "10000", "declined"), trade("other-declined", "200", "declined")],
    commissionRecords: [anchorCommission, { id: "unrelated-commission", displayNumber: 41, sellerId: "another-seller",
      rate: 0.01, grossAmount: 10, commissionAmount: 0.1, paymentStatus: "pending", createdAt: CREATED, updatedAt: CREATED }],
    auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [],
    trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [],
    betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], smsDeliveries: [], __runtimeVersion: 0 };
}

function current() { return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(RECORDED);
  globalThis.__alphaExchangeMemorySnapshot = seed() as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers(); invalidateAlphaExchangeStoreCache();
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
});

describe("owner-attested historical reconciliation", () => {
  it("prepares the exact residual and saved-policy fees while preserving earlier settlement and unknown facts", () => {
    const source = seed();
    const before = JSON.stringify(source);
    const plan = prepareHistoricalTradeSnapshotForOwner(source, input, RECORDED);
    expect(JSON.stringify(source)).toBe(before);
    expect(plan.summary).toMatchObject({ correctedUsdtAmount: RESIDUAL, reconstructedFiatAmount: "40590.70",
      sellerFeeAmount: 95.687654, buyerFeeCollectedAmount: 95.687654, commissionAmount: 191.375308,
      commissionDisplayNumber: 42, paymentStatus: "paid", settlementSource: "owner_attestation" });
    expect(plan.snapshot.purchaseRequests[0]).toEqual(source.purchaseRequests[0]);
    expect(plan.snapshot.commissionRecords[0]).toEqual(source.commissionRecords[0]);
    expect(plan.snapshot.marketplaceListings[0]).toMatchObject({ status: "closed", availableAmount: "0", originalAmount: "10000", closedAt: CLOSED });
    const target = plan.snapshot.purchaseRequests.find(request => request.id === "target")!;
    expect(target).toMatchObject({ status: "completed", usdtAmount: RESIDUAL, fiatAmount: "40590.70", reviewUnlockedAt: RECORDED,
      historicalCompletion: { source: "owner_attestation", offlineCompletionConfirmed: true, recordedAt: RECORDED,
        originalTerms: { status: "declined", usdtAmount: "10000", fiatAmount: "42420.00", pricePerUsdt: "4.20" },
        fiatAmountBasis: "saved_quote_reconstruction" } });
    for (const field of ["tradeCreatedAt", "paymentSentAt", "fundsReceivedAt", "usdtSentAt", "completedAt", "buyerReview", "sellerBuyerReview"] as const) expect(target[field]).toBeUndefined();
    const commission = plan.patch.commission!;
    for (const field of ["paymentVerificationStatus", "paymentProvider", "paymentNetwork", "paymentSignature", "paymentSubmittedAt",
      "paymentLastCheckedAt", "paidAt", "paymentExpectedAmount", "paymentExpectedAmountAssignedAt", "paymentConfirmationEmailPending"] as const) expect(commission[field]).toBeUndefined();
    expect(plan.derived).toEqual({ seller: { id: "seller", completedTrades: 3, lifetimeCompletedVolumeUsdt: 15000, rank: "silver" },
      buyer: { id: "buyer", completedTrades: 2, lifetimeCompletedVolumeUsdt: 10568.765433, rank: "bronze" } });
    const seller = plan.snapshot.users.find(account => account.id === "seller")!;
    expect(seller.sellerPromotionHistory).toHaveLength(1);
    expect(seller.sellerPromotionHistory![0]).toMatchObject({ previousRank: "bronze", rank: "silver", source: "automatic", promotedAt: RECORDED });
    expect(seller.sellerAchievements?.map(achievement => achievement.key)).toEqual(["first_trade"]);
    expect(seller.sellerAchievements?.[0].earnedAt).toBe(RECORDED);
    expect(plan.snapshot.trustSnapshots[0].snapshot).toMatchObject({ completedTrades: 3, totalUsdtVolume: 15000, responseTimeMinutes: 0, rating: 0 });
    for (const collection of ["notifications", "activityLog", "smsDeliveries", "tradeEvidenceFiles", "sellerReviews"] as const) expect(plan.snapshot[collection]).toEqual(source[collection]);
  });

  it("is deterministic at the supplied recording time and replays without new fees, audit or promotion", () => {
    const first = prepareHistoricalTradeSnapshotForOwner(seed(), input, RECORDED);
    vi.setSystemTime("2027-09-01T00:00:00.000Z");
    expect(prepareHistoricalTradeSnapshotForOwner(seed(), input, RECORDED).patchHash).toBe(first.patchHash);
    const replay = prepareHistoricalTradeSnapshotForOwner(first.snapshot, input, "2027-09-01T01:00:00.000Z");
    expect(replay.changed).toBe(false);
    expect(replay.snapshot).toEqual(first.snapshot);
    expect(replay.patchHash).toBe(first.patchHash);
    expect(() => prepareHistoricalTradeReconciliation(first.snapshot, { ...input, reason: "Different facts" }, RECORDED)).toThrow(/different historical reconciliation/);
  });

  it("keeps unknown historical occurrence time out of dated completion metrics while preserving lifetime credit", async () => {
    const source = seed();
    const before = await getOwnerBusinessDashboardForAdmin(source);
    const plan = prepareHistoricalTradeSnapshotForOwner(source, input, RECORDED);
    const after = await getOwnerBusinessDashboardForAdmin(plan.snapshot);
    expect(after.today.completedTrades).toBe(before.today.completedTrades);
    expect(after.today.tradeVolumeUsdt).toBe(before.today.tradeVolumeUsdt);
    expect(after.thisWeek.tradeVolumeUsdt).toBe(before.thisWeek.tradeVolumeUsdt);
    expect(after.thisWeek.averageTradeCompletionTimeMinutes).toBe(before.thisWeek.averageTradeCompletionTimeMinutes);
    expect(after.today.estimatedCommission).toBe(before.today.estimatedCommission);
    expect(after.thisWeek.revenue).toBe(before.thisWeek.revenue);
    expect(after.financialOverview.estimatedCommissionThisMonth).toBe(before.financialOverview.estimatedCommissionThisMonth);
    expect(after.sellerLeaderboard.find(row => row.sellerId === "seller")).toMatchObject({ completedTrades: 3, tradeVolumeUsdt: 15000 });
    expect((await getListingReliabilityForAdmin(plan.snapshot)).find(row => row.sellerId === "seller")).toMatchObject({ completedTrades: 3 });
    expect(after.financialOverview.largestTradeId).toBe("target");
    expect(after.liveActivity.some(event => event.id === "trade-target")).toBe(false);
  });

  it.each(["review_open", "locked"] as const)("retains intact history after a later %s review transition", async status => {
    const first = prepareHistoricalTradeSnapshotForOwner(seed(), input, RECORDED);
    const request = first.snapshot.purchaseRequests.find(item => item.id === "target")!;
    request.status = status;
    request.buyerReview = { reviewerUserId: "buyer", rating: 4, comment: "A genuine later review", createdAt: "2026-02-03T09:00:00.000Z" };
    const replay = prepareHistoricalTradeSnapshotForOwner(first.snapshot, input, "2026-02-03T10:00:00.000Z");
    expect(replay.changed).toBe(false);
    expect(replay.snapshot).toEqual(first.snapshot);
    globalThis.__alphaExchangeMemorySnapshot = replay.snapshot as never;
    invalidateAlphaExchangeStoreCache();
    expect((await getAccountProfileData("seller")).stats.completedTrades).toBe(3);
    expect((await getAccountProfileData("buyer")).stats.completedTrades).toBe(2);
  });

  it.each(["stock", "anchor", "linkage", "pending", "dispute", "commission", "number", "policy"])("rejects conflicting %s facts without changing the source", kind => {
    const source = seed();
    if (kind === "stock") source.marketplaceListings[0].availableAmount = "9000";
    if (kind === "anchor") source.purchaseRequests[0].usdtAmount = "400";
    if (kind === "linkage") source.purchaseRequests.find(request => request.id === "target")!.sellerId = "other";
    if (kind === "pending") source.purchaseRequests.find(request => request.id === "other-declined")!.status = "accepted";
    if (kind === "dispute") source.disputes.push({ id: "dispute", purchaseRequestId: "target" } as never);
    if (kind === "commission") source.commissionRecords.push({ ...source.commissionRecords[0], id: "existing-target-fee", purchaseRequestId: "target" });
    if (kind === "number") source.commissionRecords[0].displayNumber = undefined;
    if (kind === "policy") source.purchaseRequests.find(request => request.id === "target")!.feePolicyVersion = undefined;
    const before = JSON.stringify(source);
    expect(() => prepareHistoricalTradeReconciliation(source, input, RECORDED)).toThrow(/Historical reconciliation/);
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each(["non-owner", "disabled", "negative", "precision", "wrong-total", "no-attestation"])("rejects %s authorization or attestation", kind => {
    const source = seed();
    const changed = { ...input };
    if (kind === "non-owner") changed.actorUserId = "buyer";
    if (kind === "disabled") source.users[0].disabled = true;
    if (kind === "negative") changed.totalSoldUsdt = "-1";
    if (kind === "precision") changed.totalSoldUsdt = "10000.0000001";
    if (kind === "wrong-total") changed.totalSoldUsdt = "10001";
    if (kind === "no-attestation") changed.commissionSettledConfirmed = false as never;
    expect(() => prepareHistoricalTradeReconciliation(source, changed, RECORDED)).toThrow(/Historical reconciliation/);
  });

  it("does not treat an altered commission as an idempotent retry", () => {
    const first = prepareHistoricalTradeReconciliation(seed(), input, RECORDED);
    first.snapshot.commissionRecords.find(record => record.id === first.summary.commissionId)!.commissionAmount += 1;
    expect(() => prepareHistoricalTradeReconciliation(first.snapshot, input, RECORDED)).toThrow(/financial plan has changed/);
  });

  it.each(["price", "policy", "currency", "seller", "actor", "recorded-time"])("rejects changed %s in an apparent replay", kind => {
    const first = prepareHistoricalTradeReconciliation(seed(), input, RECORDED);
    const target = first.snapshot.purchaseRequests.find(request => request.id === "target")!;
    const commission = first.snapshot.commissionRecords.find(record => record.id === first.summary.commissionId)!;
    if (kind === "price") target.pricePerUsdt = "4.21";
    if (kind === "policy") commission.commissionCalculationVersion = undefined;
    if (kind === "currency") { target.currency = "USD"; commission.grossCurrency = "USD"; }
    if (kind === "seller") commission.sellerId = "another-seller";
    if (kind === "actor") target.historicalCompletion!.recordedByUserId = "buyer";
    if (kind === "recorded-time") commission.ownerSettlementAttestation!.recordedAt = CLOSED;
    expect(() => prepareHistoricalTradeReconciliation(first.snapshot, input, RECORDED)).toThrow(/Historical reconciliation/);
  });

  it.each([["perfect_month", 20], ["fast_responder", 100]] as const)("does not let an unknown external time unlock %s", (achievement, completedCount) => {
    const source = seed();
    source.purchaseRequests = source.purchaseRequests.filter(request => ["anchor", "target", "buyer-history"].includes(request.id));
    const acceptedAt = "2026-02-01T09:01:00.000Z";
    Object.assign(source.purchaseRequests[0], { tradeCreatedAt: acceptedAt, usdtSentAt: CLOSED });
    for (let index = 0; index < completedCount - 2; index++) {
      const request = { ...trade(`timed-${index}`, "10", "completed"), listingId: "earlier-listing",
        tradeCreatedAt: acceptedAt, usdtSentAt: CLOSED, completedAt: CLOSED };
      source.purchaseRequests.push(request);
      source.commissionRecords.push({ ...source.commissionRecords[0], id: `timed-fee-${index}`, displayNumber: 42 + index, purchaseRequestId: request.id });
    }
    const plan = prepareHistoricalTradeSnapshotForOwner(source, input, RECORDED);
    const keys = plan.snapshot.users.find(account => account.id === "seller")!.sellerAchievements!.map(item => item.key);
    expect(keys).toContain("first_trade");
    expect(keys).not.toContain(achievement);
  });

  it("keeps owner provenance private in participant projections", async () => {
    const plan = prepareHistoricalTradeSnapshotForOwner(seed(), input, RECORDED);
    const target = plan.patch.request!;
    expect(sanitizePurchaseRequestForActor(target, "buyer", "buyer").historicalCompletion).toBeUndefined();
    expect(sanitizePurchaseRequestForActor(target, "seller", "approved_seller").historicalCompletion).toBeUndefined();
    expect(sanitizePurchaseRequestForActor(target, "owner", "owner").historicalCompletion).toEqual(target.historicalCompletion);
    expect(sanitizePurchaseRequestForActor(target, "buyer", "buyer").historicalCompletionSummary).toEqual({
      source: "owner_attestation", recordedAt: RECORDED, fiatAmountBasis: "saved_quote_reconstruction" });
    expect(sanitizePurchaseRequestForActor({ ...target, historicalCompletion: undefined }, "buyer", "buyer").historicalCompletionSummary).toBeUndefined();
    const sellerListings = await getMyMarketplaceListings("seller", "all", plan.snapshot);
    expect(sellerListings[0].historicalCompletionReconciliation).toBeUndefined();
    const ownerListings = await getMarketplaceListingsForAdmin(plan.snapshot, "owner");
    expect(ownerListings[0].historicalCompletionReconciliation).toEqual(plan.snapshot.marketplaceListings[0].historicalCompletionReconciliation);
  });

  it("defaults to read-only and applies only the reviewed plan without delivery", async () => {
    const publish = vi.spyOn(realtime, "publishRealtimeEvent");
    const email = vi.spyOn(marketplaceEmail, "sendMarketplaceEmail");
    const before = JSON.stringify(current());
    const preview = await reconcileHistoricalTradeByOwner({ ...input, recordedAt: RECORDED });
    expect(preview.applied).toBe(false);
    expect(JSON.stringify(current())).toBe(before);
    await expect(reconcileHistoricalTradeByOwner({ ...input, apply: true })).rejects.toThrow(/reviewed time/);
    const applied = await reconcileHistoricalTradeByOwner({ ...input, apply: true, recordedAt: preview.recordedAt,
      expectedStateHash: preview.stateHash, expectedPlanHash: preview.planHash, expectedPatchHash: preview.patchHash });
    expect(applied.applied).toBe(true);
    expect(current().purchaseRequests[0]).toEqual(seed().purchaseRequests[0]);
    expect(current().commissionRecords[0]).toEqual(seed().commissionRecords[0]);
    expect(publish).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
    expect((await getAccountProfileData("seller")).stats).toMatchObject({ completedTrades: 3, sellerLevel: "silver", lifetimeCompletedVolumeUsdt: 15000 });
    expect((await getAccountProfileData("buyer")).stats).toMatchObject({ completedTrades: 2, buyerLevel: "bronze", lifetimeCompletedVolumeUsdt: 10568.77 });
  });

  it("rejects a stale financial plan and preserves a concurrent unrelated account change", async () => {
    const preview = await reconcileHistoricalTradeByOwner({ ...input, recordedAt: RECORDED });
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    let raced = false;
    vi.spyOn(repository, "saveSnapshot").mockImplementation(async (incoming, options) => {
      if (!raced) {
        raced = true;
        const canonical = await repository.loadSnapshot();
        canonical.users.find(account => account.id === "buyer")!.passwordHash = "newer-password";
        await persist(canonical, { selectedTables: ["users"] });
      }
      return persist(incoming, options);
    });
    await reconcileHistoricalTradeByOwner({ ...input, apply: true, recordedAt: RECORDED,
      expectedStateHash: preview.stateHash, expectedPlanHash: preview.planHash, expectedPatchHash: preview.patchHash });
    expect(current().users.find(account => account.id === "buyer")!.passwordHash).toBe("newer-password");
    const changed = seed();
    changed.marketplaceListings[0].availableAmount = "9500";
    globalThis.__alphaExchangeMemorySnapshot = changed as never;
    invalidateAlphaExchangeStoreCache();
    await expect(reconcileHistoricalTradeByOwner({ ...input, apply: true, recordedAt: RECORDED,
      expectedStateHash: preview.stateHash, expectedPlanHash: preview.planHash, expectedPatchHash: preview.patchHash })).rejects.toThrow(/residual/);
    expect(current().purchaseRequests.find(request => request.id === "target")!.status).toBe("declined");
  });

  it("rechecks owner authority during a canonical rebase", async () => {
    const preview = await reconcileHistoricalTradeByOwner({ ...input, recordedAt: RECORDED });
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    let raced = false;
    vi.spyOn(repository, "saveSnapshot").mockImplementation(async (incoming, options) => {
      if (!raced) {
        raced = true;
        const canonical = await repository.loadSnapshot();
        canonical.users.find(account => account.id === "owner")!.disabled = true;
        await persist(canonical, { selectedTables: ["users"] });
      }
      return persist(incoming, options);
    });
    await expect(reconcileHistoricalTradeByOwner({ ...input, apply: true, recordedAt: RECORDED,
      expectedStateHash: preview.stateHash, expectedPlanHash: preview.planHash, expectedPatchHash: preview.patchHash })).rejects.toThrow(/enabled owner/);
    expect(current().purchaseRequests.find(request => request.id === "target")!.status).toBe("declined");
    expect(current().commissionRecords).toHaveLength(2);
  });
});
