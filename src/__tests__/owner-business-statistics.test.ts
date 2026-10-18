import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));

import { getOwnerBusinessDashboardForAdmin, getTrustEngineOverviewForAdmin } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb, AlphaExchangeUser, CommissionRecord, PurchaseRequest, SellerReputationSnapshot } from "@/types/alpha-exchange";

const NOW = "2026-10-18T02:00:00.000Z";
const seller = (id: string): AlphaExchangeUser => ({ id, fullName: id, email: `${id}@example.test`,
  passwordHash: "synthetic", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller",
  whatsappNumber: "", preferredNetworks: ["TRC20"], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline",
  emailVerified: true, availabilityStatus: "available", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: NOW });

function fixture(): AlphaExchangeDb {
  return { users: [seller("seller-one"), seller("seller-two")], marketplaceListings: [], sellerApplications: [],
    purchaseRequests: [{ id: "request-one", sellerId: "seller-one", buyerId: "buyer", listingId: "removed-listing",
      buyerName: "Synthetic Buyer", fiatAmount: "378.75", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
      status: "completed", usdtAmount: "125", pricePerUsdt: "3", createdAt: "2026-10-17T01:00:00.000Z",
      tradeCreatedAt: "2026-10-17T01:04:00.000Z", completedAt: "2026-10-17T01:10:00.000Z", updatedAt: NOW,
      timeline: [], buyerReview: { rating: 3, reviewerUserId: "buyer", comment: "Synthetic review", createdAt: NOW } } as PurchaseRequest],
    trustSnapshots: [{ sellerId: "seller-one", snapshot: { sellerId: "seller-one", trustScore: 99,
      totalUsdtVolume: 999999, completedTrades: 200, rating: 4.9, responseTimeMinutes: 5 } as SellerReputationSnapshot,
      updatedAt: NOW }], commissionRecords: [], trustScoreHistory: [], tradeEvidenceFiles: [],
    auditLogs: [], activityLog: [], notifications: [], authSessions: [], passwordResetTokens: [],
    disputes: [], sellerReports: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [],
    betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], smsDeliveries: [],
    marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], tradeMessages: [] } as unknown as AlphaExchangeDb;
}

describe("owner business statistics from canonical records", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it("agrees with the current trust engine and actual completed-trade facts despite stale stored snapshots", async () => {
    const db = fixture();
    const business = await getOwnerBusinessDashboardForAdmin(db);
    const trust = await getTrustEngineOverviewForAdmin(db);
    const row = business.sellerLeaderboard.find(item => item.sellerId === "seller-one")!;
    expect(row).toMatchObject({ trustScore: trust.highestTrustSellers.find(item => item.sellerId === "seller-one")!.trustScore,
      completedTrades: 1, tradeVolumeUsdt: 125, averageRating: 3, responseTimeMinutes: 4 });
    expect(Number(business.marketplaceHealth.averageTrustScore.toFixed(1))).toBe(trust.marketplaceHealth.averageTrustScore);
    expect(business.thisWeek.averageResponseTimeMinutes).toBe(4);
  });

  it("includes current sellers without stored snapshots and excludes orphaned cached sellers", async () => {
    const db = fixture();
    db.trustSnapshots.push({ ...db.trustSnapshots[0], sellerId: "removed-seller",
      snapshot: { ...db.trustSnapshots[0].snapshot, sellerId: "removed-seller" } });
    const before = structuredClone(db.trustSnapshots);
    const result = await getOwnerBusinessDashboardForAdmin(db);
    expect(result.sellerLeaderboard.map(item => item.sellerId).sort()).toEqual(["seller-one", "seller-two"]);
    expect(db.trustSnapshots).toEqual(before);
  });

  it("does not count carried shortfalls as newly generated commission", async () => {
    const db = fixture();
    db.commissionRecords = [{ id: "original", sellerId: "seller-one", commissionAmount: 40, paymentStatus: "paid", createdAt: NOW },
      { id: "carry", sellerId: "seller-one", source: "tolerance_carry_forward", commissionAmount: 1, paymentStatus: "unpaid", createdAt: NOW },
      { id: "next", sellerId: "seller-one", commissionAmount: 20, paymentStatus: "unpaid", createdAt: NOW }] as CommissionRecord[];
    const result = await getOwnerBusinessDashboardForAdmin(db);
    expect(result.today.estimatedCommission).toBe(60);
    expect(result.thisWeek.revenue).toBe(60);
    expect(result.financialOverview).toMatchObject({ estimatedCommissionToday: 60, estimatedCommissionThisWeek: 60, estimatedCommissionThisMonth: 60 });
  });
});
