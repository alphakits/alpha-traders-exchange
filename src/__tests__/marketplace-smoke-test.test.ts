import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));

import {
  MARKETPLACE_SMOKE_TEST_MARKER,
  buildMarketplaceSmokeTestPurgePlan,
  purgeMarketplaceSmokeTestSnapshot,
} from "@/lib/marketplace-smoke-test";
import {
  invalidateAlphaExchangeStoreCache,
  purgeMarketplaceSmokeTestByAdmin,
} from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { publishRealtimeEvent } from "@/lib/realtime";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

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
    users: [{ id: "owner", fullName: "Synthetic Owner", email: "owner@example.test", passwordHash: "test-hash",
      role: "owner", roles: ["owner", "admin"], sellerStatus: "buyer", emailVerified: true,
      availabilityStatus: "available", createdAt: CREATED_AT, updatedAt: UPDATED_AT } as AlphaExchangeUser],
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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("preserves unrelated records containing the shared smoke marker or a longer identifier", () => {
    const db = seedDb();
    db.notifications.push({ ...db.notifications[1], id: "notification-other-smoke", message: MARKETPLACE_SMOKE_TEST_MARKER });
    db.activityLog.push({ ...db.activityLog[1], id: "activity-longer-id", details: "Listing listing-smoke-other approved" });
    const result = purgeMarketplaceSmokeTestSnapshot(db, "listing-smoke").snapshot;
    expect(result.notifications.some(item => item.id === "notification-other-smoke")).toBe(true);
    expect(result.activityLog.some(item => item.id === "activity-longer-id")).toBe(true);
  });

  it("preserves unattributed trust history and alerts even for the same seller and timestamp", () => {
    const db = seedDb();
    db.notifications.push({ id: "same-seller-trust", userId: "seller-smoke", category: "trust", title: "Trust score increased",
      message: "An independent account update", isRead: false, createdAt: UPDATED_AT });
    const result = purgeMarketplaceSmokeTestSnapshot(db, "listing-smoke").snapshot;
    expect(result.trustScoreHistory).toEqual(db.trustScoreHistory);
    expect(result.auditLogs.some(item => item.id === "audit-smoke-trust")).toBe(true);
    expect(result.notifications.some(item => item.id === "same-seller-trust")).toBe(true);
  });

  it("rejects a missing administrative actor without deleting or publishing anything", async () => {
    globalThis.__alphaExchangeMemorySnapshot = { ...seedDb(), __runtimeVersion: 0 } as never;
    await expect(purgeMarketplaceSmokeTestByAdmin({ listingId: "listing-smoke", actorUserId: "missing" })).rejects.toThrow(/admin access/i);
    expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).marketplaceListings).toHaveLength(2);
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it.each(["disabled", "demoted"])("rejects an administrator %s while the purge waits to commit", async change => {
    globalThis.__alphaExchangeMemorySnapshot = { ...seedDb(), __runtimeVersion: 0 } as never;
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
      const newer = await repository.loadSnapshot();
      if (change === "disabled") newer.users[0].disabled = true;
      else { newer.users[0].role = "buyer"; newer.users[0].roles = ["buyer"]; }
      await persist(newer, { selectedTables: ["users"] });
      await persist(incoming, options);
    });
    await expect(purgeMarketplaceSmokeTestByAdmin({ listingId: "listing-smoke", actorUserId: "owner" })).rejects.toThrow(/admin access/i);
    expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).marketplaceListings).toHaveLength(2);
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("retains all records if the atomic trust-and-cleanup write fails", async () => {
    globalThis.__alphaExchangeMemorySnapshot = { ...seedDb(), __runtimeVersion: 0 } as never;
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementation(async (incoming, options) => {
      if (options?.selectedTables?.includes("trust_snapshots")) throw new Error("Synthetic trust persistence failure");
      await persist(incoming, options);
    });
    await expect(purgeMarketplaceSmokeTestByAdmin({ listingId: "listing-smoke", actorUserId: "owner" })).rejects.toThrow("Synthetic trust persistence failure");
    const persisted = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(persisted.marketplaceListings).toHaveLength(2);
    expect(persisted.purchaseRequests).toHaveLength(2);
    expect(persisted.auditLogs.some(item => item.reason === "Guarded smoke-test cleanup")).toBe(false);
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("refuses cleanup if payment starts while its write is waiting", async () => {
    globalThis.__alphaExchangeMemorySnapshot = { ...seedDb(), __runtimeVersion: 0 } as never;
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
      const newer = await repository.loadSnapshot();
      newer.purchaseRequests[0].paymentSentAt = UPDATED_AT;
      await persist(newer, { selectedTables: ["purchase_requests"] });
      await persist(incoming, options);
    });
    await expect(purgeMarketplaceSmokeTestByAdmin({ listingId: "listing-smoke", actorUserId: "owner" })).rejects.toThrow(/payment, evidence/);
    const persisted = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(persisted.marketplaceListings).toHaveLength(2);
    expect(persisted.purchaseRequests[0].paymentSentAt).toBe(UPDATED_AT);
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("removes exact synthetic records while preserving real records and unattributed trust history", () => {
    const result = purgeMarketplaceSmokeTestSnapshot(seedDb(), "listing-smoke");

    expect(result.requestIds).toEqual(["request-smoke"]);
    expect(result.tradeIds).toEqual(["trade-smoke"]);
    expect(result.snapshot.marketplaceListings.map((item) => item.id)).toEqual(["listing-real"]);
    expect(result.snapshot.purchaseRequests.map((item) => item.id)).toEqual(["request-real"]);
    expect(result.snapshot.tradeMessages).toEqual([]);
    expect(result.snapshot.notifications.map((item) => item.id)).toEqual(["notification-real"]);
    expect(result.snapshot.auditLogs.map((item) => item.id)).toEqual(["audit-smoke-trust", "audit-real"]);
    expect(result.snapshot.activityLog.map((item) => item.id)).toEqual(["activity-real"]);
    expect(result.snapshot.trustScoreHistory.map((item) => item.id)).toEqual(["trust-smoke", "trust-real"]);
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
    expect(persisted.auditLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "audit-smoke-trust" }), expect.objectContaining({ id: "audit-real" }),
      expect.objectContaining({ action: "listing_removed", actorUserId: "owner", reason: "Guarded smoke-test cleanup" }),
    ]));
    expect(persisted.auditLogs).toHaveLength(3);
  });
});
