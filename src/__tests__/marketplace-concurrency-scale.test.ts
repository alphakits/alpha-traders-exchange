import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, SellerStatus, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  createMarketplaceListing,
  createPurchaseRequest,
  getFirstActiveTradeForUser,
  invalidateAlphaExchangeStoreCache,
  reviewMarketplaceListingByOwner,
  updatePurchaseRequestStatus,
} from "@/lib/alpha-exchange-store";

const OWNER_ID = "scale-owner";
const SELLER_IDS = Array.from({ length: 10 }, (_, index) => `scale-seller-${index + 1}`);
const BUYER_IDS = Array.from({ length: 10 }, (_, index) => `scale-buyer-${index + 1}`);
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
    whatsappNumber: `+97250${id.replace(/\D/g, "").padStart(7, "0")}`,
    role,
    roles,
    sellerStatus,
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Bank Transfer"],
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
      ...SELLER_IDS.map((id) => createUser(id, "approved_seller")),
      ...BUYER_IDS.map((id) => createUser(id, "buyer")),
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

async function createApprovedListing(sellerId: string, index: number) {
  const listing = await createMarketplaceListing({
    sellerId,
    sellerDisplayName: `Scale Seller ${index + 1}`,
    availableAmount: "500",
    price: (3.20 + index / 100).toFixed(2),
    currency: "ILS",
    network: "TRC20",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim",
    minimumTrade: "50",
    maximumTrade: "500",
    responseTime: "5 min",
    acceptedCommissionPolicy: true,
    actorUserId: sellerId,
  });
  await reviewMarketplaceListingByOwner({
    listingId: listing.id,
    ownerUserId: OWNER_ID,
    decision: "approve",
  });
  return listing;
}

function submitPurchase(listingId: string, buyerId: string, index: number) {
  return createPurchaseRequest({
    buyerId,
    listingId,
    usdtAmount: "100",
    buyerName: `Scale Buyer ${index + 1}`,
    buyerReceivingWalletAddress: WALLET,
    paymentMethod: "Bank Transfer",
    bankName: "Bank Hapoalim",
    actorUserId: buyerId,
  });
}

describe("marketplace concurrency at ten-seller scale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("preserves ten concurrent seller-buyer trade openings and every linked notification", async () => {
    const listings: MarketplaceListing[] = [];
    for (const [index, sellerId] of SELLER_IDS.entries()) {
      listings.push(await createApprovedListing(sellerId, index));
    }

    const submissions = await Promise.all(
      listings.map((listing, index) => submitPurchase(listing.id, BUYER_IDS[index]!, index)),
    );
    const acceptances = await Promise.all(
      submissions.map((submission, index) => updatePurchaseRequestStatus({
        requestId: submission.request.id,
        actorUserId: SELLER_IDS[index]!,
        actorRole: "approved_seller",
        nextStatus: "accepted",
      })),
    );

    expect(acceptances).toHaveLength(10);
    expect(acceptances.every((result) => result.request.status === "accepted")).toBe(true);

    invalidateAlphaExchangeStoreCache();
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const requestIds = new Set(submissions.map((submission) => submission.request.id));
    const committedRequests = snapshot.purchaseRequests.filter((request) => requestIds.has(request.id));
    const committedListings = snapshot.marketplaceListings.filter((listing) => listings.some((created) => created.id === listing.id));

    expect(committedRequests).toHaveLength(10);
    expect(new Set(committedRequests.map((request) => request.id)).size).toBe(10);
    expect(new Set(committedRequests.map((request) => request.tradeId)).size).toBe(10);
    expect(committedRequests.every((request) => request.status === "accepted")).toBe(true);
    expect(committedListings).toHaveLength(10);
    expect(committedListings.every((listing) => listing.status === "matched")).toBe(true);
    for (const listing of committedListings) {
      const request = committedRequests.find((candidate) => candidate.listingId === listing.id);
      expect(listing.activeTradeRequestId).toBe(request?.id);
    }
    expect(snapshot.auditLogs.filter((entry) =>
      entry.action === "listing_matched"
      && Boolean(entry.purchaseRequestId)
      && requestIds.has(entry.purchaseRequestId!),
    )).toHaveLength(10);

    for (const [index, submission] of submissions.entries()) {
      const requestId = submission.request.id;
      expect(snapshot.notifications.filter((notification) =>
        notification.userId === SELLER_IDS[index]
        && notification.relatedRequestId === requestId
        && notification.title === "New trade request",
      )).toHaveLength(1);
      expect(snapshot.notifications.filter((notification) =>
        notification.userId === BUYER_IDS[index]
        && notification.relatedRequestId === requestId
        && notification.title === "Trade request accepted",
      )).toHaveLength(1);

      const [sellerTrade, buyerTrade] = await Promise.all([
        getFirstActiveTradeForUser(SELLER_IDS[index]!, "approved_seller"),
        getFirstActiveTradeForUser(BUYER_IDS[index]!, "buyer"),
      ]);
      expect(sellerTrade?.id).toBe(requestId);
      expect(buyerTrade?.id).toBe(requestId);
    }
  }, 30_000);

  it("commits one winner when ten buyers race to have their request accepted", async () => {
    const listing = await createApprovedListing(SELLER_IDS[0]!, 0);
    const submissions = await Promise.all(
      BUYER_IDS.map((buyerId, index) => submitPurchase(listing.id, buyerId, index)),
    );

    await Promise.allSettled(
      submissions.map((submission) => updatePurchaseRequestStatus({
        requestId: submission.request.id,
        actorUserId: SELLER_IDS[0]!,
        actorRole: "approved_seller",
        nextStatus: "accepted",
      })),
    );

    invalidateAlphaExchangeStoreCache();
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const requests = snapshot.purchaseRequests.filter((request) => request.listingId === listing.id);
    const accepted = requests.filter((request) => request.status === "accepted");
    const declined = requests.filter((request) => request.status === "declined");
    const committedListing = snapshot.marketplaceListings.find((candidate) => candidate.id === listing.id);

    expect(requests).toHaveLength(10);
    expect(accepted).toHaveLength(1);
    expect(declined).toHaveLength(9);
    expect(committedListing).toMatchObject({
      status: "matched",
      activeTradeRequestId: accepted[0]?.id,
    });
    expect(snapshot.notifications.filter((notification) =>
      notification.relatedRequestId === accepted[0]?.id
      && notification.userId === accepted[0]?.buyerId
      && notification.title === "Trade request accepted",
    )).toHaveLength(1);
    for (const declinedRequest of declined) {
      expect(snapshot.notifications.some((notification) =>
        notification.relatedRequestId === declinedRequest.id
        && notification.userId === declinedRequest.buyerId
        && notification.title === "Listing unavailable",
      )).toBe(true);
    }
  }, 30_000);
});
