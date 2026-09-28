import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
import { localizeNotificationCopy } from "@/lib/notification-localization";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  broadcastNotificationByAdmin,
  invalidateAlphaExchangeStoreCache,
} from "@/lib/alpha-exchange-store";

const OWNER_ID = "broadcast-owner";
const ARABIC_USER_ID = "broadcast-user-ar";
const ENGLISH_USER_ID = "broadcast-user-en";

function user(id: string, preferredLocale: "ar" | "en", role: AlphaExchangeUser["role"] = "buyer") {
  const now = "2026-08-27T08:00:00.000Z";
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    preferredLocale,
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: [],
    bio: "",
    onlineStatus: "online",
    availabilityStatus: "available",
    role,
    roles: role === "owner" ? ["owner", "admin"] : [role],
    sellerStatus: "buyer",
    notificationPreferences: { inApp: true, email: false, sms: false },
    createdAt: now,
    updatedAt: now,
  } as unknown as AlphaExchangeUser;
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user(OWNER_ID, "en", "owner"),
      user(ARABIC_USER_ID, "ar"),
      user(ENGLISH_USER_ID, "en"),
    ],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
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

describe("admin emergency broadcast localization", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("requires paired English and Arabic editions", async () => {
    await expect(broadcastNotificationByAdmin({
      actorUserId: OWNER_ID,
      type: "warning",
      reason: "Operational notice",
      titleEn: "Scheduled maintenance",
      bodyEn: "Trading will pause briefly.",
      titleAr: "",
      bodyAr: "سيتوقف التداول لفترة قصيرة.",
    })).rejects.toThrow("English and Arabic broadcast titles and messages are required.");

    expect((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).notifications).toHaveLength(0);
  });

  it("stores both editions and follows the current interface locale", async () => {
    await broadcastNotificationByAdmin({
      actorUserId: OWNER_ID,
      type: "warning",
      reason: "Operational notice",
      titleEn: "Scheduled maintenance",
      bodyEn: "Trading will pause briefly.",
      titleAr: "صيانة مجدولة",
      bodyAr: "سيتوقف التداول لفترة قصيرة.",
    });

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const arabicNotification = snapshot.notifications.find((item) => item.userId === ARABIC_USER_ID);
    const englishNotification = snapshot.notifications.find((item) => item.userId === ENGLISH_USER_ID);

    expect(arabicNotification).toMatchObject({
      title: "صيانة مجدولة",
      message: "سيتوقف التداول لفترة قصيرة.",
      titleEn: "Scheduled maintenance",
      messageEn: "Trading will pause briefly.",
      titleAr: "صيانة مجدولة",
      messageAr: "سيتوقف التداول لفترة قصيرة.",
      priority: "high",
    });
    expect(englishNotification).toMatchObject({
      title: "Scheduled maintenance",
      message: "Trading will pause briefly.",
    });

    expect(localizeNotificationCopy(arabicNotification!, "en")).toEqual({
      title: "Scheduled maintenance",
      message: "Trading will pause briefly.",
    });
    expect(localizeNotificationCopy(englishNotification!, "ar")).toEqual({
      title: "صيانة مجدولة",
      message: "سيتوقف التداول لفترة قصيرة.",
    });
  });
});
