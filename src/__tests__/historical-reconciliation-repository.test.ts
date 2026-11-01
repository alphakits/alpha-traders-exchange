import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const CREATED_AT = "2026-10-01T00:00:00.000Z";
const RECORDED_AT = "2026-10-02T00:00:00.000Z";
const LATER_AT = "2026-10-02T00:05:00.000Z";

function snapshots() {
  const attestation = {
    source: "owner_attestation" as const, operationId: "historical-operation", inputFingerprint: "a".repeat(64),
    recordedAt: RECORDED_AT, recordedByUserId: "owner", reason: "Owner attested a prior off-platform sale and fee payment",
  };
  const message = {
    id: "existing-message", purchaseRequestId: "historical-request", kind: "user", senderUserId: "buyer",
    senderRole: "buyer", message: "Existing trade conversation", createdAt: CREATED_AT, readByUserIds: ["seller"],
  };
  const originalRequest = {
    id: "historical-request", listingId: "historical-listing", sellerId: "seller", buyerId: "buyer", buyerName: "Buyer",
    status: "declined", usdtAmount: "20000", fiatAmount: "64640.00", pricePerUsdt: "3.20", currency: "ILS", network: "TRC20",
    paymentMethod: "Cardless ATM Withdrawal", feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2",
    buyerSafetyAcknowledged: false, sellerSafetyAcknowledged: false,
    timeline: [{ id: "declined-event", type: "request_declined", actorUserId: "owner", actorRole: "owner", message: "Listing closed", createdAt: CREATED_AT }],
    messages: [message], createdAt: CREATED_AT, updatedAt: CREATED_AT,
  };
  const originalListing = {
    id: "historical-listing", sellerId: "seller", sellerDisplayName: "Seller", photos: [], originalAmount: "20000",
    availableAmount: "15000", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Cardless ATM Withdrawal",
    paymentMethods: ["Cardless ATM Withdrawal"], minimumTrade: "50", maximumTrade: "20000", sellerDescription: "Original description",
    responseTime: "", status: "closed", closedAt: CREATED_AT, createdAt: CREATED_AT, updatedAt: CREATED_AT,
  };
  const seller = {
    id: "seller", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", fullName: "Seller",
    email: "seller@example.test", passwordHash: "original-password", disabled: false,
    lifetimeCompletedVolumeUsdt: 10000, sellerPrestigeRank: "bronze", sellerPromotionHistory: [], sellerAchievements: [],
    createdAt: CREATED_AT, updatedAt: CREATED_AT,
  };
  const oldTrust = { sellerId: "seller", updatedAt: CREATED_AT, snapshot: { sellerId: "seller", level: "bronze", totalUsdtVolume: 10000, completedTrades: 2 } };
  const canonical = {
    users: [{ ...seller, lifetimeCompletedVolumeUsdt: 25000, sellerPrestigeRank: "silver", updatedAt: RECORDED_AT,
      sellerPromotionHistory: [{ id: "historical-promotion", previousRank: "bronze", rank: "silver", promotedAt: RECORDED_AT,
        lifetimeCompletedVolumeUsdt: 25000, source: "automatic" }],
      sellerAchievements: [{ id: "historical-first-trade", key: "first_trade", title: "First Trade", description: "Completed a qualifying trade",
        earnedAt: RECORDED_AT, source: "automatic" }] }],
    marketplaceListings: [{ ...originalListing, availableAmount: "0", updatedAt: RECORDED_AT,
      historicalCompletionReconciliation: { ...attestation, requestId: originalRequest.id } }],
    purchaseRequests: [{ ...originalRequest, status: "completed", usdtAmount: "15000", fiatAmount: "48480.00", reviewUnlockedAt: RECORDED_AT, updatedAt: RECORDED_AT,
      historicalCompletion: { ...attestation, originalTerms: { status: "declined", usdtAmount: "20000", fiatAmount: "64640.00", pricePerUsdt: "3.20" },
        reconciledUsdtAmount: "15000", reconstructedFiatAmount: "48480.00", fiatAmountBasis: "saved_quote_reconstruction",
        listingTotalUsdt: "20000", preservedCompletedRequestIds: ["preserved-completion"], offlineCompletionConfirmed: true,
        stateHash: "b".repeat(64), planHash: "c".repeat(64) },
      timeline: [...originalRequest.timeline, { id: "historical-event", type: "trade_completed", actorUserId: "owner", actorRole: "owner", message: "Owner recorded prior completion", createdAt: RECORDED_AT }] }],
    commissionRecords: [{ id: "historical-commission", source: "trade", purchaseRequestId: originalRequest.id, listingId: originalListing.id,
      sellerId: "seller", buyerId: "buyer", rate: 0.01, grossAmount: 48480, grossCurrency: "ILS",
      feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2",
      sellerFeeAmount: 150, buyerFeeCollectedAmount: 150, commissionAmount: 300,
      paymentStatus: "paid", ownerSettlementAttestation: attestation, paymentVerificationNotes: "Owner attested payment; no provider verification performed",
      createdAt: RECORDED_AT, updatedAt: RECORDED_AT }],
    trustSnapshots: [{ ...oldTrust, updatedAt: RECORDED_AT, snapshot: { sellerId: "seller", level: "silver", totalUsdtVolume: 25000, completedTrades: 3 } }],
    trustScoreHistory: [{ id: "historical-trust", sellerId: "seller", oldScore: 50, newScore: 60, reason: "Historical completion", triggeredBy: "owner", createdAt: RECORDED_AT }],
    auditLogs: [{ id: "historical-audit", action: "admin_override", actorUserId: "owner", purchaseRequestId: originalRequest.id, createdAt: RECORDED_AT }],
    sellerApplications: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
    __runtimeVersion: 2,
  } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
  const incoming = {
    ...structuredClone(canonical),
    users: [{ ...seller, passwordHash: "new-security-change", disabled: true, updatedAt: LATER_AT }],
    marketplaceListings: [{ ...originalListing, status: "active", activeTradeRequestId: originalRequest.id, updatedAt: LATER_AT }],
    purchaseRequests: [{ ...originalRequest, updatedAt: LATER_AT, messages: [
      { ...message, readByUserIds: ["buyer"], seenAt: LATER_AT },
      { ...message, id: "later-message", message: "A separately saved message", createdAt: LATER_AT, readByUserIds: ["buyer"] },
    ] }],
    commissionRecords: [], auditLogs: [], trustSnapshots: [{ ...oldTrust, updatedAt: LATER_AT }], trustScoreHistory: [], __runtimeVersion: 1,
  } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
  return { canonical, incoming };
}

beforeEach(() => {
  vi.stubEnv("ALPHA_EXCHANGE_TEST_PERSIST_FALLBACK", "0");
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
});
afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
});

describe("historical completion persistence", () => {
  it.each(["memory", "postgres"] as const)("retains the canonical settlement through a later stale declined writer (%s)", async mode => {
    const { canonical, incoming } = snapshots();
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes("json_agg(payload order by sort_index asc)")) return { rows: [{ version: "2",
        users: canonical.users, listings: canonical.marketplaceListings, purchase_requests: canonical.purchaseRequests,
        commissions: canonical.commissionRecords, trust_snapshots: canonical.trustSnapshots, trust_score_history: canonical.trustScoreHistory,
        audit_logs: canonical.auditLogs }] };
      if (sql.includes("select version::text as version from alpha_exchange.runtime_meta")) return { rows: [{ version: "2" }] };
      return { rows: [] };
    }), release: vi.fn() };
    const pool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(client), on: vi.fn() } as unknown as Pool;
    globalThis.__alphaExchangeMemorySnapshot = structuredClone(canonical) as never;
    const repository = new AlphaExchangeRepository(mode === "memory" ? null : pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    await repository.saveSnapshot(incoming, {
      selectedTables: ["users", "listings", "purchase_requests", "commissions", "trust_snapshots", "trust_score_history", "audit_logs"] });
    expect(incoming.purchaseRequests[0]).toMatchObject({ status: "completed", usdtAmount: "15000", fiatAmount: "48480.00",
      historicalCompletion: canonical.purchaseRequests[0].historicalCompletion, timeline: canonical.purchaseRequests[0].timeline,
      buyerSafetyAcknowledged: false, sellerSafetyAcknowledged: false });
    expect(incoming.purchaseRequests[0].usdtSentAt).toBeUndefined();
    expect(incoming.purchaseRequests[0].completedAt).toBeUndefined();
    expect(incoming.purchaseRequests[0].messages).toHaveLength(2);
    expect(incoming.purchaseRequests[0].messages?.find(message => message.id === "existing-message")).toMatchObject({
      readByUserIds: expect.arrayContaining(["buyer", "seller"]), seenAt: LATER_AT });
    expect(incoming.purchaseRequests[0].messages?.find(message => message.id === "later-message")?.message).toBe("A separately saved message");
    expect(incoming.marketplaceListings[0]).toMatchObject({ status: "closed", originalAmount: "20000", availableAmount: "0", closedAt: CREATED_AT,
      historicalCompletionReconciliation: canonical.marketplaceListings[0].historicalCompletionReconciliation });
    expect(incoming.marketplaceListings[0].activeTradeRequestId).toBeUndefined();
    expect(incoming.users[0]).toMatchObject({ lifetimeCompletedVolumeUsdt: 25000, sellerPrestigeRank: "silver",
      sellerPromotionHistory: canonical.users[0].sellerPromotionHistory, sellerAchievements: canonical.users[0].sellerAchievements,
      passwordHash: "new-security-change", disabled: true });
    expect(incoming.commissionRecords).toEqual(canonical.commissionRecords);
    expect(incoming.trustSnapshots).toEqual(canonical.trustSnapshots);
    expect(incoming.trustScoreHistory).toEqual(canonical.trustScoreHistory);
    expect(incoming.auditLogs).toEqual(canonical.auditLogs);
    if (mode === "postgres") {
      expect(client.query.mock.calls.filter(([sql]) => sql.includes("json_agg(payload order by sort_index asc)"))).toHaveLength(1);
      expect(client.query).toHaveBeenCalledWith("commit");
      expect(pool.query).not.toHaveBeenCalled();
    }
  });

  it("retains a later review when its writer already observed the historical completion", async () => {
    const { canonical } = snapshots();
    const incoming = structuredClone(canonical);
    incoming.__runtimeVersion = 1;
    incoming.purchaseRequests[0].status = "review_open";
    incoming.purchaseRequests[0].buyerReview = { reviewerUserId: "buyer", rating: 4, comment: "Recorded by the buyer", createdAt: LATER_AT };
    incoming.purchaseRequests[0].paymentSentAt = LATER_AT;
    incoming.purchaseRequests[0].fundsReceivedAt = LATER_AT;
    incoming.purchaseRequests[0].reviewUnlockedAt = LATER_AT;
    incoming.purchaseRequests[0].updatedAt = LATER_AT;
    globalThis.__alphaExchangeMemorySnapshot = canonical as never;
    await new AlphaExchangeRepository(null).saveSnapshot(incoming);
    expect(incoming.purchaseRequests[0]).toMatchObject({ status: "review_open", usdtAmount: "15000",
      historicalCompletion: canonical.purchaseRequests[0].historicalCompletion,
      buyerReview: { reviewerUserId: "buyer", rating: 4, comment: "Recorded by the buyer" } });
    expect(incoming.purchaseRequests[0].paymentSentAt).toBeUndefined();
    expect(incoming.purchaseRequests[0].fundsReceivedAt).toBeUndefined();
    expect(incoming.purchaseRequests[0].reviewUnlockedAt).toBe(RECORDED_AT);
  });

  it.each(["pending", "paid"] as const)("does not turn an owner-attested paid fee into a stale %s provider claim", async paymentStatus => {
    const { canonical, incoming } = snapshots();
    incoming.commissionRecords = [{ ...canonical.commissionRecords[0], ownerSettlementAttestation: undefined, paymentStatus,
      commissionAmount: 1, paymentVerificationStatus: "verified", paymentProvider: "crypto_wallet", paymentSignature: "invented-receipt",
      paymentLastCheckedAt: LATER_AT, paidAt: LATER_AT, updatedAt: LATER_AT,
      paymentConfirmationEmailPending: { id: "unexpected-email", requestedAt: LATER_AT, amountDueUsdt: 1, remainingCommissions: [] } }];
    globalThis.__alphaExchangeMemorySnapshot = canonical as never;
    await new AlphaExchangeRepository(null).saveSnapshot(incoming, { selectedTables: ["commissions"] });
    expect(incoming.commissionRecords).toEqual(canonical.commissionRecords);
    expect(incoming.commissionRecords[0].paymentVerificationStatus).toBeUndefined();
    expect(incoming.commissionRecords[0].paymentSignature).toBeUndefined();
    expect(incoming.commissionRecords[0].paymentConfirmationEmailPending).toBeUndefined();
  });

  it("discards a stale second commission for the attested sale while retaining another sale's fee", async () => {
    const { canonical, incoming } = snapshots();
    const duplicate = { ...canonical.commissionRecords[0], id: "stale-second-commission", ownerSettlementAttestation: undefined,
      paymentStatus: "pending" as const, commissionAmount: 10, createdAt: LATER_AT, updatedAt: LATER_AT };
    const unrelated = { ...duplicate, id: "unrelated-commission", purchaseRequestId: "another-request", listingId: "another-listing" };
    incoming.commissionRecords = [duplicate, unrelated];
    globalThis.__alphaExchangeMemorySnapshot = canonical as never;
    await new AlphaExchangeRepository(null).saveSnapshot(incoming, { selectedTables: ["commissions"] });
    expect(incoming.commissionRecords).toHaveLength(2);
    expect(incoming.commissionRecords).toEqual(expect.arrayContaining([canonical.commissionRecords[0], unrelated]));
    expect(incoming.commissionRecords.filter(record => record.purchaseRequestId === "historical-request")).toEqual(canonical.commissionRecords);
  });
});
