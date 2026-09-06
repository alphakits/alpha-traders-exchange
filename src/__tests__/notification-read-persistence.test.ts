import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  deleteNotification,
  getNotificationsForUser,
  invalidateAlphaExchangeStoreCache,
  markAllNotificationsRead,
  markNotificationReadState,
} from "@/lib/alpha-exchange-store";

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

describe("notification read persistence", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("keeps individual and mark-all read state after a fresh session cache", async () => {
    await markNotificationReadState({
      userId: USER_ID,
      notificationId: "notification-one",
      isRead: true,
    });
    invalidateAlphaExchangeStoreCache();

    const afterOne = await getNotificationsForUser({ userId: USER_ID, includeActivity: false });
    expect(afterOne.unreadCount).toBe(1);
    expect(afterOne.notifications.find((item) => item.id === "notification-one")).toMatchObject({
      isRead: true,
      state: "read",
    });

    await markAllNotificationsRead(USER_ID);
    invalidateAlphaExchangeStoreCache();

    const afterAll = await getNotificationsForUser({ userId: USER_ID, includeActivity: false });
    const otherUser = await getNotificationsForUser({ userId: OTHER_USER_ID, includeActivity: false });
    expect(afterAll.unreadCount).toBe(0);
    expect(afterAll.notifications.every((item) => item.isRead && item.state === "read")).toBe(true);
    expect(otherUser.unreadCount).toBe(1);
    expect(otherUser.notifications[0]).toMatchObject({ id: "notification-other", state: "unread", isRead: false });
  });

  it("preserves a concurrent read while durably deleting a different notification", async () => {
    await Promise.all([
      deleteNotification({ userId: USER_ID, notificationId: "notification-one" }),
      markNotificationReadState({ userId: USER_ID, notificationId: "notification-two", isRead: true }),
    ]);
    invalidateAlphaExchangeStoreCache();

    const currentUser = await getNotificationsForUser({ userId: USER_ID, includeActivity: false });
    const otherUser = await getNotificationsForUser({ userId: OTHER_USER_ID, includeActivity: false });
    expect(currentUser.notifications.map((item) => item.id)).toEqual(["notification-two"]);
    expect(currentUser.notifications[0]).toMatchObject({ state: "read", isRead: true });
    expect(otherUser.notifications).toEqual([expect.objectContaining({ id: "notification-other", state: "unread" })]);
  });
});
