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
  invalidateAlphaExchangeStoreCache,
  reviewMarketplaceListingByOwner,
  updateMarketplaceListingForSeller,
} from "@/lib/alpha-exchange-store";

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
});
