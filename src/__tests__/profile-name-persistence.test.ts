import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { getAccountProfileData, invalidateAlphaExchangeStoreCache, updateAccountProfileData, updateUserSellerSettings, upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { PROFILE_AVATARS } from "@/lib/profile-presets";
import { ProfileNameCooldownError, PROFILE_NAME_CHANGE_INTERVAL_MS } from "@/lib/profile-name-policy";
const SELLER_ID = "profile-test-user";
const OWNER_ID = "profile-test-owner";
function user(id: string, role: "owner" | "buyer"): AlphaExchangeUser {
  const now = new Date().toISOString();
  return {
    id,
    fullName: role === "owner" ? "Owner" : "Manual Commission Seller",
    email: `${id}@example.test`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "owner" ? ["owner", "admin"] : ["buyer"],
    sellerStatus: "buyer",
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
  } as AlphaExchangeUser;
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [user(SELLER_ID, "buyer"), user(OWNER_ID, "owner")],
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

describe("saved profile names", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    invalidateAlphaExchangeStoreCache();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  });
  it("survives stale provider metadata, cold reads and repeated auth synchronization", async () => {
    await updateAccountProfileData({ userId: SELLER_ID, fullName: "New Profile Name" });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    for (let i = 0; i < 2; i++) {
      invalidateAlphaExchangeStoreCache();
      const user = await upsertUserProfileForAuth({ fullName: "Old Provider Name", email: `${SELLER_ID}@example.test`, whatsappNumber: "", emailVerified: true });
      expect(user.fullName).toBe("New Profile Name");
    }
    invalidateAlphaExchangeStoreCache();
    expect((await getAccountProfileData(SELLER_ID)).profile).toMatchObject({ fullName: "New Profile Name", nextNameChangeAt: "2026-09-28T12:00:00.000Z" });
  });
  it("blocks name changes across both settings paths until exactly seven days, without blocking other edits", async () => {
    const start = Date.now();
    await updateAccountProfileData({ userId: SELLER_ID, fullName: "First Name" });
    await updateAccountProfileData({ userId: SELLER_ID, fullName: " First Name ", bio: "Updated bio" });
    vi.setSystemTime(start + PROFILE_NAME_CHANGE_INTERVAL_MS - 1);
    await expect(updateAccountProfileData({ userId: SELLER_ID, fullName: "Second Name" })).rejects.toBeInstanceOf(ProfileNameCooldownError);
    await expect(updateUserSellerSettings({ userId: SELLER_ID, fullName: "Third Name" })).rejects.toBeInstanceOf(ProfileNameCooldownError);
    await updateAccountProfileData({ userId: SELLER_ID, country: "Romania" });
    expect((await getAccountProfileData(SELLER_ID)).profile).toMatchObject({ fullName: "First Name", bio: "Updated bio", country: "Romania" });
    vi.setSystemTime(start + PROFILE_NAME_CHANGE_INTERVAL_MS);
    await updateAccountProfileData({ userId: SELLER_ID, fullName: "Second Name" });
    expect((await getAccountProfileData(SELLER_ID)).profile.fullName).toBe("Second Name");
  });
  it("commits only one of two simultaneous different names", async () => {
    const results = await Promise.allSettled([
      updateAccountProfileData({ userId: SELLER_ID, fullName: "Concurrent First" }),
      updateAccountProfileData({ userId: SELLER_ID, fullName: "Concurrent Second" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    invalidateAlphaExchangeStoreCache();
    expect(["Concurrent First", "Concurrent Second"]).toContain((await getAccountProfileData(SELLER_ID)).profile.fullName);
  });
  it("rejects locked banner tiers at persistence and keeps the previous cover", async () => {
    await updateAccountProfileData({ userId: SELLER_ID, coverBannerUrl: "/images/profile-presets/banners/network.svg" });
    await expect(updateAccountProfileData({ userId: SELLER_ID, coverBannerUrl: "/images/profile-presets/banners/gold.svg" })).rejects.toThrow("PROFILE_BANNER_LOCKED");
    invalidateAlphaExchangeStoreCache();
    expect((await getAccountProfileData(SELLER_ID)).profile.coverBannerUrl).toBe("/images/profile-presets/banners/network.svg");
  });
  it("keeps buyer statistics and in-platform messaging enabled", async () => {
    await updateAccountProfileData({ userId: SELLER_ID, showTradeStats: false, allowDirectMessages: false });
    invalidateAlphaExchangeStoreCache();
    expect((await getAccountProfileData(SELLER_ID)).profile).toMatchObject({ showTradeStats: true, allowDirectMessages: true });
  });
  it("persists a random preset avatar once when a new user signs up", async () => {
    const input = { fullName: "New Buyer", email: "new-buyer@example.test", whatsappNumber: "", emailVerified: true };
    const created = await upsertUserProfileForAuth(input);
    expect(PROFILE_AVATARS.map((avatar) => avatar.url)).toContain(created.profilePhotoUrl);
    invalidateAlphaExchangeStoreCache();
    expect((await upsertUserProfileForAuth(input)).profilePhotoUrl).toBe(created.profilePhotoUrl);
  });

});
