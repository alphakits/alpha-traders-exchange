import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  MARKETPLACE_SMOKE_TEST_MARKER,
  buildMarketplaceSmokeTestPurgePlan,
  purgeMarketplaceSmokeTestSnapshot,
} from "@/lib/marketplace-smoke-test";
import {
  invalidateAlphaExchangeStoreCache,
  purgeMarketplaceSmokeTestByAdmin,
} from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

const CREATED_AT = "2026-09-04T14:45:00.000Z";
const UPDATED_AT = "2026-09-04T14:50:00.000Z";

function listing(id: string, smoke = false): MarketplaceListing {
  return {
    id,
    sellerId: smoke ? "seller-smoke" : "seller-real",
    sellerDisplayName: smoke ? "Smoke Seller" : "Real Seller",
    photos: [],
    displayNumber: smoke ? 74 : 73,
    originalAmount: smoke ? "10" : "700",
    availableAmount: smoke ? "10" : "700",
    price: smoke ? "3.01" : "3.21",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    minimumTrade: "1",
    maximumTrade: smoke ? "10" : "700",
    sellerDescription: smoke ? MARKETPLACE_SMOKE_TEST_MARKER : "Real listing",
    responseTime: "5 min",
    status: smoke ? "matched" : "active",
    approvalStatus: "approved",
    activeTradeRequestId: smoke ? "request-smoke" : undefined,
    lockedAt: smoke ? UPDATED_AT : undefined,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

function request(id: string, smoke = false): PurchaseRequest {
  return {
    id,
    tradeId: smoke ? "trade-smoke" : "trade-real",
    displayNumber: smoke ? 88 : 87,
    buyerId: smoke ? "buyer-smoke" : "buyer-real",
    listingId: smoke ? "listing-smoke" : "listing-real",
    sellerId: smoke ? "seller-smoke" : "seller-real",
    buyerName: smoke ? "Smoke Buyer" : "Real Buyer",
    usdtAmount: smoke ? "1" : "100",
    fiatAmount: smoke ? "3.00" : "321.00",
    pricePerUsdt: smoke ? "3.00" : "3.21",
    listingPriceAtRequest: smoke ? "3.01" : "3.21",
    priceMode: smoke ? "buyer_offer" : "listing_price",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    messages: smoke ? [{
      id: "message-smoke",
      purchaseRequestId: id,
      kind: "user",
      senderUserId: "buyer-smoke",
      senderRole: "buyer",
      message: "SMOKE TEST TR-000088 — buyer chat OK",
      createdAt: UPDATED_AT,
      readByUserIds: [],
    }] : [],
    status: smoke ? "accepted" : "pending",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

function seedDb(): AlphaExchangeDb {
  const smokeListing = listing("listing-smoke", true);
  const realListing = listing("listing-real");
  const smokeRequest = request("request-smoke", true);
  const realRequest = request("request-real");
  return {
    users: [],
    sellerApplications: [],
    marketplaceListings: [smokeListing, realListing],
    purchaseRequests: [smokeRequest, realRequest],
    commissionRecords: [],
    auditLogs: [
      { id: "audit-smoke", action: "listing_matched", actorUserId: "seller-smoke", listingId: smokeListing.id, purchaseRequestId: smokeRequest.id, createdAt: UPDATED_AT },
      { id: "audit-smoke-trust", action: "trust_score_updated", actorUserId: "seller-smoke", targetUserId: "seller-smoke", details: "Trust score 56.7 -> 57.3 (Trade lifecycle updated)", createdAt: UPDATED_AT },
      { id: "audit-real", action: "listing_matched", actorUserId: "seller-real", listingId: realListing.id, purchaseRequestId: realRequest.id, createdAt: UPDATED_AT },
    ],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [
      { id: "notification-smoke", userId: "buyer-smoke", category: "trade", title: "Price offer accepted", message: "Smoke", isRead: false, relatedListingId: smokeListing.id, relatedTradeId: smokeRequest.tradeId, createdAt: UPDATED_AT },
      { id: "notification-real", userId: "buyer-real", category: "trade", title: "Real", message: "Real", isRead: false, relatedListingId: realListing.id, relatedTradeId: realRequest.tradeId, createdAt: UPDATED_AT },
    ],
    activityLog: [
      { id: "activity-smoke", userId: "seller-smoke", category: "listing", title: "Listing approved", details: `Listing ${smokeListing.id} approved`, createdAt: UPDATED_AT },
      { id: "activity-real", userId: "seller-real", category: "listing", title: "Listing approved", details: `Listing ${realListing.id} approved`, createdAt: UPDATED_AT },
    ],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [],
    trustScoreHistory: [
      { id: "trust-smoke", sellerId: "seller-smoke", oldScore: 56.7, newScore: 57.3, reason: "Trade lifecycle updated", triggeredBy: "seller-smoke", createdAt: UPDATED_AT },
      { id: "trust-real", sellerId: "seller-real", oldScore: 30, newScore: 31, reason: "Trade lifecycle updated", triggeredBy: "seller-real", createdAt: UPDATED_AT },
    ],
    tradeEvidenceFiles: [],
    tradeMessages: smokeRequest.messages,
    privateBetaInvites: [],
    privateBetaInviteUses: [],
    betaFeedback: [],
    betaAnnouncements: [],
    adminAnnouncementRuns: [],
    sellerReviews: [],
    smsDeliveries: [{
      id: "sms-smoke",
      eventKey: `trade:${smokeRequest.id}:accepted:buyer:${smokeRequest.buyerId}`,
      eventType: "trade_accepted",
      recipientUserId: smokeRequest.buyerId,
      recipientPhone: "+972500000000",
      body: "Smoke",
      status: "queued",
      retryCount: 0,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    }],
    marketplaceEnforcementRecords: [],
    marketplaceEnforcementAuditLog: [],
  };
}

describe("marketplace smoke-test purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("removes the exact synthetic listing, trade, messages, notifications, logs, and trust history while preserving real records", () => {
    const result = purgeMarketplaceSmokeTestSnapshot(seedDb(), "listing-smoke");

    expect(result.requestIds).toEqual(["request-smoke"]);
    expect(result.tradeIds).toEqual(["trade-smoke"]);
    expect(result.snapshot.marketplaceListings.map((item) => item.id)).toEqual(["listing-real"]);
    expect(result.snapshot.purchaseRequests.map((item) => item.id)).toEqual(["request-real"]);
    expect(result.snapshot.tradeMessages).toEqual([]);
    expect(result.snapshot.notifications.map((item) => item.id)).toEqual(["notification-real"]);
    expect(result.snapshot.auditLogs.map((item) => item.id)).toEqual(["audit-real"]);
    expect(result.snapshot.activityLog.map((item) => item.id)).toEqual(["activity-real"]);
    expect(result.snapshot.trustScoreHistory.map((item) => item.id)).toEqual(["trust-real"]);
    expect(result.snapshot.smsDeliveries).toEqual([]);
  });

  it("refuses to purge an ordinary listing", () => {
    expect(() => buildMarketplaceSmokeTestPurgePlan(seedDb(), "listing-real"))
      .toThrow("Only a clearly marked smoke-test listing");
  });

  it("refuses to purge after payment evidence or non-test user content exists", () => {
    const withEvidence = seedDb();
    withEvidence.purchaseRequests[0].paymentSentAt = UPDATED_AT;
    expect(() => buildMarketplaceSmokeTestPurgePlan(withEvidence, "listing-smoke"))
      .toThrow("payment, evidence, release, or completion data exists");

    const withRealMessage = seedDb();
    withRealMessage.purchaseRequests[0].messages![0].message = "This is not a smoke-test message";
    expect(() => buildMarketplaceSmokeTestPurgePlan(withRealMessage, "listing-smoke"))
      .toThrow("non-test user content");
  });

  it("commits the guarded purge through the repository without stale records reappearing", async () => {
    globalThis.__alphaExchangeMemorySnapshot = { ...seedDb(), __runtimeVersion: 0 } as never;

    await purgeMarketplaceSmokeTestByAdmin({ listingId: "listing-smoke", actorUserId: "owner" });

    const persisted = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(persisted.marketplaceListings.map((item) => item.id)).toEqual(["listing-real"]);
    expect(persisted.purchaseRequests.map((item) => item.id)).toEqual(["request-real"]);
    expect(persisted.notifications.map((item) => item.id)).toEqual(["notification-real"]);
    expect(persisted.auditLogs.map((item) => item.id)).toEqual(["audit-real"]);
  });
});
