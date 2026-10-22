// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { getNotificationsForUser, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { publicAccountId } from "@/lib/public-account-identity";
const USER_ID = "notification-reader";
const OTHER_USER_ID = "notification-other-user";
function user(id: string): AlphaExchangeUser {
  const now = "2026-09-05T10:00:00.000Z";
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
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
    isFoundingMember: false,
    isFoundingSeller: false,
    emailVerified: true,
    emailVerifiedAt: now,
    onboardingSelection: "buyer",
    onboardingCompletedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  const createdAt = "2026-09-05T10:00:00.000Z";
  return {
    users: [user(USER_ID), user(OTHER_USER_ID)],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [
      {
        id: "notification-one",
        userId: USER_ID,
        category: "account",
        title: "First update",
        message: "First persistent update.",
        isRead: false,
        state: "unread",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "notification-two",
        userId: USER_ID,
        category: "system",
        title: "Second update",
        message: "Second persistent update.",
        isRead: false,
        state: "unread",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "notification-other",
        userId: OTHER_USER_ID,
        category: "account",
        title: "Other user update",
        message: "This must not be changed.",
        isRead: false,
        state: "unread",
        createdAt,
        updatedAt: createdAt,
      },
    ],
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
function install(seed: ReturnType<typeof seedDb>) {
  globalThis.__alphaExchangeMemorySnapshot = seed as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
}
beforeEach(() => install(seedDb()));
afterEach(() => { vi.restoreAllMocks(); invalidateAlphaExchangeStoreCache(); });

describe("notification batch privacy", () => {
  it("retains pagination, unread totals, ordering and identity masking for a large notification history", async () => {
    const seed = seedDb();
    const identities = Array.from({ length: 500 }, (_, index) => ({
      ...user("history-member-" + index), fullName: "Historical Member " + index + " Surname",
    }));
    seed.users.push(...identities);
    seed.notifications = Array.from({ length: 600 }, (_, index) => ({
      ...seed.notifications[0], id: "history-notification-" + index,
      message: identities[index % identities.length].fullName + " received ILS 350.25 for 100 USDT.",
      isRead: index % 2 === 1, state: index % 2 === 1 ? "read" as const : "unread" as const,
    }));
    install(seed);
    const durations: number[] = [];
    let result!: Awaited<ReturnType<typeof getNotificationsForUser>>;
    for (let run = 0; run < (process.env.ALPHA_NOTIFICATION_PROFILE === "1" ? 5 : 1); run += 1) {
      const startedAt = performance.now();
      result = await getNotificationsForUser({ userId: USER_ID, limit: 200, includeActivity: false });
      durations.push(performance.now() - startedAt);
    }
    expect(result).toMatchObject({ total: 600, unreadCount: 300, activity: [] });
    expect(result.notifications).toHaveLength(200);
    for (const notification of result.notifications) {
      const index = Number(notification.id.replace("history-notification-", ""));
      expect(index % 2).toBe(0);
      expect(notification.message).toBe(publicAccountId(identities[index % identities.length]) + " received ILS 350.25 for 100 USDT.");
    }
    if (process.env.ALPHA_NOTIFICATION_PROFILE === "1") {
      console.log(JSON.stringify({ profile: "notification-batch", identities: 502, notifications: 600, durationsMs: durations, responseSha256: createHash("sha256").update(JSON.stringify(result)).digest("hex") }));
    }
  });

  it("keeps historical buyer and seller aliases specific to each trade and listing", async () => {
    const seed = seedDb();
    const createdAt = "2026-09-05T10:00:00.000Z";
    seed.users[0].fullName = "Canonical Buyer";
    seed.users[1].fullName = "Canonical Seller";
    seed.marketplaceListings = ["First", "Second"].map((label, index) => ({
      id: "listing-" + index, sellerId: OTHER_USER_ID, sellerDisplayName: label + " Legacy Seller",
      originalAmount: "100", availableAmount: "100", price: "3.20", currency: "ILS", network: "TRC20",
      paymentMethod: "Bank Transfer", minimumTrade: "10", maximumTrade: "100", status: "active", createdAt, updatedAt: createdAt,
    } as MarketplaceListing));
    seed.purchaseRequests = ["First", "Second"].map((label, index) => ({
      id: "request-" + index, listingId: "listing-" + index, buyerId: USER_ID, sellerId: OTHER_USER_ID,
      buyerName: label + " Legacy Buyer", status: "accepted", paymentMethod: "Bank Transfer",
      usdtAmount: "100", fiatAmount: "320", currency: "ILS", network: "TRC20", timeline: [], createdAt, updatedAt: createdAt,
    } as PurchaseRequest));
    seed.notifications = ["First", "Second", "First", "Second"].map((label, index) => ({
      ...seed.notifications[0], id: "alias-notification-" + index, relatedRequestId: "request-" + (index % 2),
      message: label + " Legacy Buyer met " + label + " Legacy Seller for ILS 320.",
    }));
    install(seed);
    const result = await getNotificationsForUser({ userId: USER_ID });
    expect(result.notifications).toHaveLength(4);
    for (const notification of result.notifications) {
      expect(notification.message).toBe(publicAccountId(seed.users[0]) + " met " + publicAccountId(seed.users[1]) + " for ILS 320.");
    }
  });

  it("uses current identities on the next response after an account name changes", async () => {
    const first = seedDb();
    first.users[1].fullName = "Original Private Member";
    first.notifications[0].message = first.users[1].fullName;
    install(first);
    expect((await getNotificationsForUser({ userId: USER_ID })).notifications[0].message).toBe(publicAccountId(first.users[1]));
    const second = seedDb();
    second.users[1].fullName = "Renamed Private Member";
    second.notifications[0].message = second.users[1].fullName;
    install(second);
    expect((await getNotificationsForUser({ userId: USER_ID })).notifications[0].message).toBe(publicAccountId(second.users[1]));
  });
});
