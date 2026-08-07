import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  getMarketplacePulse,
  invalidateAlphaExchangeStoreCache,
  touchUserPresence,
} from "@/lib/alpha-exchange-store";

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

function user(id: string, overrides: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role: "buyer",
    roles: ["buyer"],
    sellerStatus: "buyer",
    availabilityStatus: "available",
    onlineStatus: "offline",
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    createdAt: now,
    updatedAt: now,
    emailVerified: true,
    ...overrides,
  };
}

function listing(id: string, sellerId: string, overrides: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id,
    sellerId,
    sellerDisplayName: sellerId,
    photos: [],
    originalAmount: "1000",
    availableAmount: "1000",
    price: "3.60",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    minimumTrade: "100",
    maximumTrade: "1000",
    sellerDescription: "",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user("seller-online", { role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", onlineStatus: "online", lastActiveAt: iso(-60 * 1000) }),
      user("seller-stale", { role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", onlineStatus: "online", lastActiveAt: iso(-30 * 60 * 1000) }),
      user("buyer-online", { lastActiveAt: iso(-2 * 60 * 1000) }),
      user("buyer-offline", { lastActiveAt: iso(-3 * 60 * 60 * 1000) }),
      user("admin-online", { role: "admin", roles: ["admin"], lastActiveAt: iso(-1 * 60 * 1000) }),
    ] as AlphaExchangeDb["users"],
    sellerApplications: [],
    marketplaceListings: [
      listing("listing-1", "seller-online", { network: "TRC20", availableAmount: "1000", createdAt: iso(-30 * 60 * 1000) }),
      listing("listing-2", "seller-online", { network: "TRC20", availableAmount: "500" }),
      listing("listing-3", "seller-stale", { network: "ERC20", availableAmount: "250" }),
    ] as AlphaExchangeDb["marketplaceListings"],
    purchaseRequests: [
      { id: "pr-active", sellerId: "seller-online", buyerId: "buyer-online", listingId: "listing-1", buyerName: "Someone", buyerWhatsapp: "x", buyerNotes: "", usdtAmount: "300", fiatAmount: "1080", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", timeline: [], status: "payment_sent", createdAt: iso(-20 * 60 * 1000), updatedAt: iso(-10 * 60 * 1000) },
      { id: "pr-done", sellerId: "seller-online", buyerId: "buyer-offline", listingId: "listing-2", buyerName: "Buyer Name", buyerWhatsapp: "x", buyerNotes: "", usdtAmount: "500", fiatAmount: "1800", currency: "ILS", network: "ERC20", paymentMethod: "Bank Transfer", timeline: [], status: "completed", completedAt: iso(-15 * 60 * 1000), createdAt: iso(-60 * 60 * 1000), updatedAt: iso(-15 * 60 * 1000) },
    ] as AlphaExchangeDb["purchaseRequests"],
    commissionRecords: [],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [],
    activityLog: [],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [],
    trustScoreHistory: [],
    tradeEvidenceFiles: [],
    privateBetaInvites: [],
    privateBetaInviteUses: [],
    betaFeedback: [],
    betaAnnouncements: [],
    adminAnnouncementRuns: [],
    sellerReviews: [],
    __runtimeVersion: 0,
  };
}

describe("getMarketplacePulse", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("counts only genuinely-online sellers (fresh presence)", async () => {
    const pulse = await getMarketplacePulse();
    // seller-online is fresh; seller-stale (30 min) is not within the 5-min window.
    expect(pulse.sellersOnline).toBe(1);
  });

  it("counts buyers online from real fresh presence, excluding admins", async () => {
    const pulse = await getMarketplacePulse();
    // buyer-online fresh (2 min); buyer-offline stale; admin excluded from buyer count.
    expect(pulse.buyersOnline).toBe(1);
  });

  it("counts active trades and completed trades from real statuses", async () => {
    const pulse = await getMarketplacePulse();
    expect(pulse.activeTrades).toBe(1);
    expect(pulse.completedTrades).toBe(1);
  });

  it("aggregates active listings, USDT available and trending network", async () => {
    const pulse = await getMarketplacePulse();
    expect(pulse.activeListings).toBe(3);
    expect(pulse.totalUsdtAvailable).toBe(1750);
    expect(pulse.trendingNetwork).toBe("TRC20");
    expect(pulse.popularPaymentMethod).toBeTruthy();
  });

  it("exposes a privacy-safe last completed trade (network + time only, no amounts/names)", async () => {
    const pulse = await getMarketplacePulse();
    expect(pulse.lastCompletedTrade).not.toBeNull();
    expect(pulse.lastCompletedTrade?.network).toBe("ERC20");
    const serialized = JSON.stringify(pulse);
    expect(serialized).not.toContain("Buyer Name");
    expect(serialized).not.toContain("1800");
  });

  it("builds an anonymized recent activity feed with no buyer identifiers", async () => {
    const pulse = await getMarketplacePulse();
    expect(pulse.recentActivity.length).toBeGreaterThan(0);
    for (const entry of pulse.recentActivity) {
      expect(["new_listing", "listing_renewed", "trade_completed", "seller_online"]).toContain(entry.type);
    }
    const serialized = JSON.stringify(pulse.recentActivity);
    expect(serialized).not.toContain("buyer-online");
    expect(serialized).not.toContain("Buyer Name");
  });

  it("touchUserPresence refreshes a stale user so they count as online", async () => {
    invalidateAlphaExchangeStoreCache();
    await touchUserPresence("buyer-offline");
    const pulse = await getMarketplacePulse();
    expect(pulse.buyersOnline).toBe(2);
  });
});
