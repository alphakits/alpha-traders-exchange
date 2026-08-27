import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, BetaAnnouncement } from "@/types/alpha-exchange";
import { localizeNotificationCopy } from "@/lib/notification-localization";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  createBetaAnnouncement,
  getActiveBetaAnnouncements,
  getNotificationsForUser,
  invalidateAlphaExchangeStoreCache,
  resolveBetaAnnouncementLocale,
} from "@/lib/alpha-exchange-store";

const OWNER_ID = "owner-beta-announcements";
const ARABIC_USER_ID = "founding-user-ar";
const ENGLISH_USER_ID = "founding-user-en";

function user(input: {
  id: string;
  language: string;
  preferredLocale: "ar" | "en";
  role?: AlphaExchangeUser["role"];
  isFoundingMember?: boolean;
}): AlphaExchangeUser {
  const now = "2026-08-27T08:00:00.000Z";
  const role = input.role ?? "buyer";
  return {
    id: input.id,
    fullName: input.id,
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: [input.language],
    preferredLocale: input.preferredLocale,
    bio: "",
    onlineStatus: "online",
    availabilityStatus: "available",
    role,
    roles: role === "owner" ? ["owner", "admin"] : [role],
    sellerStatus: "buyer",
    isFoundingMember: input.isFoundingMember === true,
    notificationPreferences: { inApp: true, email: false, sms: false },
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  } as unknown as AlphaExchangeUser;
}

function seedDb(betaAnnouncements: BetaAnnouncement[] = []): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user({ id: OWNER_ID, language: "English", preferredLocale: "en", role: "owner" }),
      user({ id: ARABIC_USER_ID, language: "English", preferredLocale: "ar", isFoundingMember: true }),
      user({ id: ENGLISH_USER_ID, language: "العربية", preferredLocale: "en", isFoundingMember: true }),
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
    betaAnnouncements,
    adminAnnouncementRuns: [],
    sellerReviews: [],
    __runtimeVersion: 0,
  };
}

describe("private-beta announcement localization", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("requires complete English and Arabic copy before publishing", async () => {
    await expect(createBetaAnnouncement({
      ownerUserId: OWNER_ID,
      type: "new_feature",
      titleEn: "A faster market",
      messageEn: "The refreshed market is live.",
      titleAr: "",
      messageAr: "السوق المحدّث متاح الآن.",
    })).rejects.toThrow("English and Arabic announcement titles and messages are required.");

    expect((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).betaAnnouncements).toHaveLength(0);
  });

  it("persists both locales and delivers each founding member their preferred language", async () => {
    const announcement = await createBetaAnnouncement({
      ownerUserId: OWNER_ID,
      type: "new_feature",
      titleEn: "A faster market",
      messageEn: "The refreshed market is live.",
      titleAr: "سوق أسرع",
      messageAr: "السوق المحدّث متاح الآن.",
    });

    expect(announcement).toMatchObject({
      title: "A faster market",
      message: "The refreshed market is live.",
      titleEn: "A faster market",
      messageEn: "The refreshed market is live.",
      titleAr: "سوق أسرع",
      messageAr: "السوق المحدّث متاح الآن.",
    });

    const arabicNotifications = await getNotificationsForUser({ userId: ARABIC_USER_ID });
    const englishNotifications = await getNotificationsForUser({ userId: ENGLISH_USER_ID });
    const [arabicNotification] = arabicNotifications.notifications;
    const [englishNotification] = englishNotifications.notifications;

    expect(arabicNotification).toMatchObject({
      title: "إعلان السوق: سوق أسرع",
      message: "السوق المحدّث متاح الآن.",
      titleEn: "Marketplace announcement: A faster market",
      messageEn: "The refreshed market is live.",
      titleAr: "إعلان السوق: سوق أسرع",
      messageAr: "السوق المحدّث متاح الآن.",
    });
    expect(englishNotification).toMatchObject({
      title: "Marketplace announcement: A faster market",
      message: "The refreshed market is live.",
    });
    expect(localizeNotificationCopy(arabicNotification, "en")).toEqual({
      title: "Marketplace announcement: A faster market",
      message: "The refreshed market is live.",
    });
    expect(localizeNotificationCopy(englishNotification, "ar")).toEqual({
      title: "إعلان السوق: سوق أسرع",
      message: "السوق المحدّث متاح الآن.",
    });

    const [arabicResponse] = await getActiveBetaAnnouncements("ar");
    const [englishResponse] = await getActiveBetaAnnouncements("en");
    expect(arabicResponse).toMatchObject({ title: "سوق أسرع", message: "السوق المحدّث متاح الآن.", titleEn: "A faster market", titleAr: "سوق أسرع" });
    expect(englishResponse).toMatchObject({ title: "A faster market", message: "The refreshed market is live.", titleEn: "A faster market", titleAr: "سوق أسرع" });
  });

  it("normalizes legacy single-language rows without losing their content", async () => {
    const legacy = {
      id: "announcement-legacy",
      title: "Legacy maintenance notice",
      message: "The market will reopen soon.",
      type: "maintenance",
      isActive: true,
      createdByUserId: OWNER_ID,
      createdAt: "2026-08-26T08:00:00.000Z",
      updatedAt: "2026-08-26T08:00:00.000Z",
    } as unknown as BetaAnnouncement;
    globalThis.__alphaExchangeMemorySnapshot = seedDb([legacy]) as never;
    invalidateAlphaExchangeStoreCache();

    const [localized] = await getActiveBetaAnnouncements("ar");
    expect(localized).toMatchObject({
      title: "Legacy maintenance notice",
      message: "The market will reopen soon.",
      titleEn: "Legacy maintenance notice",
      titleAr: "Legacy maintenance notice",
      messageEn: "The market will reopen soon.",
      messageAr: "The market will reopen soon.",
    });
  });

  it("recognizes supported Arabic preference values and otherwise defaults to English", () => {
    expect(resolveBetaAnnouncementLocale("ar-IL")).toBe("ar");
    expect(resolveBetaAnnouncementLocale("Arabic")).toBe("ar");
    expect(resolveBetaAnnouncementLocale("العربية")).toBe("ar");
    expect(resolveBetaAnnouncementLocale("English")).toBe("en");
    expect(resolveBetaAnnouncementLocale(undefined)).toBe("en");
  });
});
