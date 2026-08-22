import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AuditLogEntry } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  createMarketplaceListing,
  deleteMarketplaceListingForSeller,
  getListingReliabilityForAdmin,
  getMarketplaceListings,
  getNotificationsForUser,
  getPremiumSellerProfile,
  invalidateAlphaExchangeStoreCache,
  reviewMarketplaceListingByOwner,
  updateUserSellerSettings,
  updateMarketplaceListingForSeller,
} from "@/lib/alpha-exchange-store";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";

const OWNER_ID = "owner-1";
const SELLER_ID = "seller-1";
const SELLER_TWO_ID = "seller-2";

function createUser(id: string, email: string, role: "owner" | "approved_seller") {
  const now = new Date().toISOString();
  return {
    id,
    fullName: id,
    email,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "owner" ? ["owner", "admin"] : [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [createUser(OWNER_ID, "jozenmark834@yahoo.com", "owner"), createUser(SELLER_ID, "seller@example.com", "approved_seller"), createUser(SELLER_TWO_ID, "seller-two@example.com", "approved_seller")] as AlphaExchangeDb["users"],
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

async function createApprovedListing(amount: string, price: string, sellerId: string = SELLER_ID) {
  const listing = await createMarketplaceListing({
    sellerId,
    sellerDisplayName: sellerId,
    availableAmount: amount,
    price,
    currency: "ILS",
    network: "TRC20",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim",
    minimumTrade: "100",
    maximumTrade: amount,
    responseTime: "5 min",
    acceptedCommissionPolicy: true,
    actorUserId: sellerId,
  });
  await reviewMarketplaceListingByOwner({ listingId: listing.id, ownerUserId: OWNER_ID, decision: "approve" });
  return listing;
}

function auditLogs(): AuditLogEntry[] {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
  return snapshot.auditLogs;
}

describe("listing accountability: reason + audit + reliability", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("records reason + before/after when a listing price is edited", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    await updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      price: "3.70",
      changeReason: "Price updated",
      changeExplanation: "Adjusted to match the market rate.",
    });

    const edit = auditLogs().find((entry) => entry.action === "listing_edited" && entry.listingId === listing.id);
    expect(edit).toBeDefined();
    expect(edit?.reason).toBe("Price updated");
    expect(edit?.oldValue).toMatchObject({ price: "3.60" });
    expect(edit?.newValue).toMatchObject({ price: "3.70" });
    expect(edit?.details).toContain("Adjusted to match the market rate.");
  });

  it("records reason when a listing is removed", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    await deleteMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      changeReason: "Personal reason",
      changeExplanation: "No longer selling this week.",
    });

    const closed = auditLogs().find((entry) => entry.action === "listing_closed" && entry.listingId === listing.id);
    expect(closed).toBeDefined();
    expect(closed?.reason).toBe("Personal reason");
    expect(closed?.newValue).toMatchObject({ status: "closed" });
  });

  it("rejects direct contact content from public seller profiles, listings, and listing audit text", async () => {
    await expect(updateUserSellerSettings({
      userId: SELLER_ID,
      bio: "WhatsApp https://wa.me/972501234567",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(updateUserSellerSettings({
      userId: SELLER_ID,
      fullName: "Email seller@example.test",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);

    await expect(createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: SELLER_ID,
      availableAmount: "1000",
      price: "3.60",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "100",
      maximumTrade: "1000",
      responseTime: "5 min",
      notes: "Email seller@example.test",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Call 050-123-4567",
      availableAmount: "1000",
      price: "3.60",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "100",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);

    const listing = await createApprovedListing("1000", "3.60");
    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      sellerDescription: "Telegram: @seller_private",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      photos: ["https://wa.me/972501234567"],
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(deleteMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      changeReason: "Call 050-123-4567",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
  });

  it("surfaces deterministic reliability metrics for admins", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    await updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      price: "3.70",
      changeReason: "Price updated",
      changeExplanation: "Market moved.",
    });
    const second = await createApprovedListing("500", "3.55");
    await deleteMarketplaceListingForSeller({
      listingId: second.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      changeReason: "Network issue",
      changeExplanation: "Pausing during a network incident.",
    });

    const first = await getListingReliabilityForAdmin();
    const again = await getListingReliabilityForAdmin();
    const sellerReport = first.find((report) => report.sellerId === SELLER_ID);
    expect(sellerReport).toBeDefined();
    expect(sellerReport?.editCount).toBeGreaterThanOrEqual(1);
    expect(sellerReport?.removalCount).toBeGreaterThanOrEqual(1);
    expect(sellerReport?.reliability.reliabilityScore).toBe(
      again.find((report) => report.sellerId === SELLER_ID)?.reliability.reliabilityScore,
    );
    expect(sellerReport?.reliability.reliabilityScore).toBeGreaterThanOrEqual(0);
    expect(sellerReport?.reliability.reliabilityScore).toBeLessThanOrEqual(100);
  });

  it("orders the marketplace feed deterministically across repeated reads", async () => {
    await createApprovedListing("1000", "3.60", SELLER_ID);
    await createApprovedListing("800", "3.58", SELLER_TWO_ID);

    const firstOrder = (await getMarketplaceListings()).map((listing) => listing.id);
    invalidateAlphaExchangeStoreCache();
    const secondOrder = (await getMarketplaceListings()).map((listing) => listing.id);

    expect(firstOrder.length).toBeGreaterThanOrEqual(2);
    expect(secondOrder).toEqual(firstOrder);
  });

  it("never exposes a seller's private email or phone in marketplace listing DTOs", async () => {
    const seller = (globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).users
      .find((user) => user.id === SELLER_ID);
    if (!seller) throw new Error("seller fixture missing");
    seller.email = "seller-private@example.test";
    seller.whatsappNumber = "+972501234567";
    seller.showEmailPublic = true;
    seller.showPhonePublic = true;
    await createApprovedListing("1000", "3.60");

    const [listing] = await getMarketplaceListings("active");
    const serialized = JSON.stringify(listing);
    expect(listing.sellerProfile).not.toHaveProperty("contact");
    expect(serialized).not.toContain("seller-private@example.test");
    expect(serialized).not.toContain("+972501234567");
  });

  it("never exposes a seller's direct contact in a public seller profile, even when legacy public flags are enabled", async () => {
    const seller = (globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).users
      .find((user) => user.id === SELLER_ID);
    if (!seller) throw new Error("seller fixture missing");
    seller.email = "seller-profile-private@example.test";
    seller.whatsappNumber = "+972501111111";
    seller.verifiedPhone = "+972501111111";
    seller.showEmailPublic = true;
    seller.showPhonePublic = true;

    for (const viewer of [
      {},
      { viewerUserId: "buyer-1", viewerRole: "buyer" as const },
    ]) {
      const profile = await getPremiumSellerProfile({ sellerId: SELLER_ID, ...viewer });
      const serialized = JSON.stringify(profile);
      expect(profile).not.toBeNull();
      expect(serialized).not.toContain("seller-profile-private@example.test");
      expect(serialized).not.toContain("+972501111111");
      expect(profile?.profile).not.toHaveProperty("contact");
    }
  });

  it("redacts legacy direct-contact notification content and external contact destinations before REST or SSE snapshots", async () => {
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    snapshot.notifications.push({
      id: "legacy-contact-notification",
      userId: "buyer-1",
      category: "trade",
      title: "Contact seller-profile-private@example.test",
      message: "Telegram @seller_private or https://wa.me/972501111111",
      relatedHref: "https://t.me/seller_private",
      actionHref: "https://wa.me/972501111111",
      isRead: false,
      createdAt: new Date().toISOString(),
    } as never);

    const { notifications } = await getNotificationsForUser({ userId: "buyer-1", includeActivity: false });
    const notification = notifications.find((item) => item.id === "legacy-contact-notification");
    const serialized = JSON.stringify(notification);

    expect(serialized).not.toContain("seller-profile-private@example.test");
    expect(serialized).not.toContain("@seller_private");
    expect(serialized).not.toContain("wa.me");
    expect(serialized).not.toContain("t.me");
    expect(notification?.relatedHref).toBeUndefined();
    expect(notification?.actionHref).toBeUndefined();
  });

  it("scrubs embedded legacy contact data even when a historical listing has no seller record", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const storedListing = snapshot.marketplaceListings.find((item) => item.id === listing.id);
    if (!storedListing) throw new Error("listing fixture missing");
    storedListing.sellerProfile = {
      sellerId: SELLER_ID,
      sellerName: "Legacy seller",
      profilePhotoUrl: "",
      memberSince: new Date().toISOString(),
      languages: ["English"],
      preferredNetworks: ["TRC20"],
      bio: "",
      onlineStatus: "offline",
      availabilityStatus: "available",
      contact: { email: "legacy-private@example.test", phone: "+972509999999" },
    };
    snapshot.users = snapshot.users.filter((user) => user.id !== SELLER_ID);

    const [result] = await getMarketplaceListings("active");
    const serialized = JSON.stringify(result);
    expect(result?.sellerProfile).not.toHaveProperty("contact");
    expect(serialized).not.toContain("legacy-private@example.test");
    expect(serialized).not.toContain("+972509999999");
  });

  it("redacts legacy user-authored profile and listing text before it reaches public marketplace viewers", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const seller = snapshot.users.find((user) => user.id === SELLER_ID);
    const storedListing = snapshot.marketplaceListings.find((item) => item.id === listing.id);
    if (!seller || !storedListing) throw new Error("seller listing fixture missing");
    seller.fullName = "Seller 050-123-4567";
    seller.bio = "Email seller-private@example.test";
    seller.tradingExperience = "Telegram: @seller_private";
    seller.profilePhotoUrl = "https://wa.me/972501234567";
    storedListing.sellerDisplayName = "Seller 050-123-4567";
    storedListing.notes = "WhatsApp https://wa.me/972501234567";
    storedListing.sellerDescription = "Email seller-private@example.test";
    storedListing.photos = ["https://t.me/seller_private"];
    invalidateAlphaExchangeStoreCache();

    const [publicListing] = await getMarketplaceListings("active");
    const profile = await getPremiumSellerProfile({ sellerId: SELLER_ID, viewerUserId: "buyer-1", viewerRole: "buyer" });
    const serialized = JSON.stringify({ publicListing, profile });

    expect(serialized).not.toContain("050-123-4567");
    expect(serialized).not.toContain("seller-private@example.test");
    expect(serialized).not.toContain("@seller_private");
    expect(serialized).not.toContain("wa.me");
    expect(serialized).not.toContain("t.me");
    expect(publicListing?.photos).toEqual([]);
  });
});
