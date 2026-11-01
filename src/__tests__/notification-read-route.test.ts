// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
const auth = vi.hoisted(() => ({ requireApiUser: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: auth.requireApiUser }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { GET } from "@/app/api/alpha-exchange/notifications/route";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
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
describe("notification read route", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    auth.requireApiUser.mockResolvedValue({ user: user(USER_ID), unauthorized: null });
  });
  afterEach(() => { vi.restoreAllMocks(); invalidateAlphaExchangeStoreCache(); });

  it.each(["", "?limit=", "?limit=%20%20", "?limit=invalid", "?limit=Infinity"])(
    "returns the default notification page when the limit is absent or invalid: %s",
    async (query) => {
      const response = await GET(new NextRequest("https://example.test/api/alpha-exchange/notifications" + query));
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.notifications.map((item: { id: string }) => item.id)).toEqual(["notification-one", "notification-two"]);
      expect(payload).toMatchObject({ total: 2, unreadCount: 2 });
    },
  );

  it("honors an explicit page and resolves its recipient from the session", async () => {
    const response = await GET(new NextRequest("https://example.test/api/alpha-exchange/notifications?limit=1&offset=1&includeActivity=0&userId=notification-other-user"));
    expect(await response.json()).toMatchObject({ notifications: [{ id: "notification-two", userId: USER_ID }], total: 2, unreadCount: 2, activity: [] });
  });

  it("prevents the authenticated notification response from being cached", async () => {
    const response = await GET(new NextRequest("https://example.test/api/alpha-exchange/notifications?limit=2"));
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("denies unauthenticated notification reads", async () => {
    auth.requireApiUser.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new NextRequest("https://example.test/api/alpha-exchange/notifications"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
