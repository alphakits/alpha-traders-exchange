import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, SellerStatus, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  createMarketplaceListing,
  createPurchaseRequest,
  invalidateAlphaExchangeStoreCache,
  reviewMarketplaceListingByOwner,
  updateMarketplaceListingForSeller,
  updatePurchaseRequestStatus,
} from "@/lib/alpha-exchange-store";

const SELLER_ID = "offer-seller";
const BUYER_ONE_ID = "offer-buyer-1";
const BUYER_TWO_ID = "offer-buyer-2";
const OWNER_ID = "offer-owner";
const WALLET = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

function createUser(id: string, role: "owner" | "buyer" | "approved_seller"): AlphaExchangeUser {
  const now = new Date().toISOString();
  const roles: UserRole[] = role === "owner" ? ["owner", "admin"] : [role];
  const sellerStatus: SellerStatus = role === "approved_seller" ? "approved_seller" : "buyer";
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles,
    sellerStatus,
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["Arabic", "English"],
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
    onboardingSelection: role === "buyer" ? "buyer" : undefined,
    onboardingCompletedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerRankOverride: undefined,
    sellerPromotionHistory: [],
    sellerAchievements: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      createUser(OWNER_ID, "owner"),
      createUser(SELLER_ID, "approved_seller"),
      createUser(BUYER_ONE_ID, "buyer"),
      createUser(BUYER_TWO_ID, "buyer"),
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

async function createLiveListing() {
  const listing = await createMarketplaceListing({
    sellerId: SELLER_ID,
    sellerDisplayName: "Offer Seller",
    availableAmount: "15000",
    price: "3.30",
    currency: "ILS",
    network: "TRC20",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim",
    minimumTrade: "100",
    maximumTrade: "15000",
    responseTime: "5 min",
    acceptedCommissionPolicy: true,
    actorUserId: SELLER_ID,
  });
  await reviewMarketplaceListingByOwner({ listingId: listing.id, ownerUserId: OWNER_ID, decision: "approve" });
  return listing;
}

async function submitOffer(listingId: string, buyerId: string, offeredPrice: string) {
  return createPurchaseRequest({
    buyerId,
    listingId,
    usdtAmount: "1000",
    buyerName: buyerId,
    buyerReceivingWalletAddress: WALLET,
    priceMode: "buyer_offer",
    offeredPrice,
    actorUserId: buyerId,
  });
}

describe("negotiated marketplace price offers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("freezes the buyer's valid price and creates the accepted trade at that exact price", async () => {
    const listing = await createLiveListing();
    const created = await submitOffer(listing.id, BUYER_ONE_ID, "2.95");

    expect(created.request).toMatchObject({
      priceMode: "buyer_offer",
      listingPriceAtRequest: "3.30",
      pricePerUsdt: "2.95",
      priceOfferDiscount: "0.35",
      fiatAmount: "2950.00",
      status: "pending",
    });
    expect(created.request.timeline[0]?.type).toBe("price_offer_submitted");

    const accepted = await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });

    expect(accepted.request).toMatchObject({
      status: "accepted",
      pricePerUsdt: "2.95",
      fiatAmount: "2950.00",
    });
    expect(accepted.request.priceOfferAcceptedAt).toBeTruthy();
    expect(accepted.request.timeline.some((event) => event.type === "price_offer_accepted")).toBe(true);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.marketplaceListings.find((item) => item.id === listing.id)).toMatchObject({
      status: "matched",
      activeTradeRequestId: created.request.id,
    });
    expect(snapshot.notifications.some((item) => item.userId === BUYER_ONE_ID && item.title === "Price offer accepted" && item.message.includes("₪2.95"))).toBe(true);
  });

  it("enforces the ₪0.35 server limit and requires a genuinely lower cent price", async () => {
    const listing = await createLiveListing();
    for (const [offeredPrice, code] of [["2.94", "PRICE_OFFER_BELOW_MINIMUM"], ["3.30", "PRICE_OFFER_NOT_LOWER"], ["3.001", "PRICE_OFFER_INVALID_FORMAT"]] as const) {
      await expect(submitOffer(listing.id, BUYER_ONE_ID, offeredPrice)).rejects.toMatchObject({ code });
    }
    expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).purchaseRequests).toHaveLength(0);
  });

  it("keeps Buy Now behavior unchanged at the listing price", async () => {
    const listing = await createLiveListing();
    const created = await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: listing.id,
      usdtAmount: "1000",
      buyerName: BUYER_ONE_ID,
      buyerReceivingWalletAddress: WALLET,
      priceMode: "listing_price",
      offeredPrice: "0.01",
      actorUserId: BUYER_ONE_ID,
    });

    expect(created.request).toMatchObject({
      priceMode: "listing_price",
      pricePerUsdt: "3.30",
      listingPriceAtRequest: "3.30",
      fiatAmount: "3300.00",
    });
    expect(created.request.priceOfferDiscount).toBeUndefined();
    expect(created.request.timeline[0]?.type).toBe("request_submitted");
  });

  it("keeps the submitted offer snapshot when the seller later edits the public listing price", async () => {
    const listing = await createLiveListing();
    const created = await submitOffer(listing.id, BUYER_ONE_ID, "2.95");

    await updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      price: "3.40",
    });
    const accepted = await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });

    expect(accepted.request).toMatchObject({
      listingPriceAtRequest: "3.30",
      pricePerUsdt: "2.95",
      priceOfferDiscount: "0.35",
      fiatAmount: "2950.00",
      status: "accepted",
    });
  });

  it("allows only one concurrent seller acceptance and declines the competing offer", async () => {
    const listing = await createLiveListing();
    const [first, second] = await Promise.all([
      submitOffer(listing.id, BUYER_ONE_ID, "3.05"),
      submitOffer(listing.id, BUYER_TWO_ID, "3.10"),
    ]);

    await Promise.allSettled([
      updatePurchaseRequestStatus({ requestId: first.request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "accepted" }),
      updatePurchaseRequestStatus({ requestId: second.request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "accepted" }),
    ]);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const offers = snapshot.purchaseRequests.filter((request) => request.listingId === listing.id);
    expect(offers.filter((request) => request.status === "accepted")).toHaveLength(1);
    expect(offers.filter((request) => request.status === "declined")).toHaveLength(1);
    expect(snapshot.marketplaceListings.find((item) => item.id === listing.id)?.activeTradeRequestId)
      .toBe(offers.find((request) => request.status === "accepted")?.id);
  });
});
