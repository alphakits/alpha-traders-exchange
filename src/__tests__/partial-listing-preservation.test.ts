import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  createMarketplaceListing,
  createPurchaseRequest,
  getCommissionRecordsForAdmin,
  getMyMarketplaceListings,
  invalidateAlphaExchangeStoreCache,
  updateCommissionPaymentStatus,
  updatePurchaseRequestStatus,
  uploadTradeEvidence,
} from "@/lib/alpha-exchange-store";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";

const SELLER_ID = "seller-1";
const BUYER_ONE_ID = "buyer-1";
const BUYER_TWO_ID = "buyer-2";
const BUYER_THREE_ID = "buyer-3";
const OWNER_ID = "owner-1";

function createUser(id: string, email: string, role: "owner" | "buyer" | "approved_seller") {
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
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: now,
    onboardingSelection: role === "buyer" ? "buyer" : undefined,
    onboardingCompletedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerRankOverride: null,
    sellerPromotionHistory: [],
    sellerAchievements: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      createUser(OWNER_ID, "jozenmark834@yahoo.com", "owner"),
      createUser(SELLER_ID, "seller@example.com", "approved_seller"),
      createUser(BUYER_ONE_ID, "buyer-one@example.com", "buyer"),
      createUser(BUYER_TWO_ID, "buyer-two@example.com", "buyer"),
      createUser(BUYER_THREE_ID, "buyer-three@example.com", "buyer"),
    ] as AlphaExchangeDb["users"],
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
    sellerReviews: [],
    __runtimeVersion: 0,
  };
}

async function completeTrade(input: {
  listingId: string;
  buyerId: string;
  buyerName: string;
  amount: string;
  runDeferredTrustWrite?: boolean;
}) {
  const request = await createPurchaseRequest({
    buyerId: input.buyerId,
    listingId: input.listingId,
    usdtAmount: input.amount,
    buyerName: input.buyerName,
    buyerWhatsapp: "+972500000001",
    buyerNotes: `Buying ${input.amount} USDT`,
    bankName: "Bank Hapoalim",
    actorUserId: input.buyerId,
  });

  await updatePurchaseRequestStatus({
    requestId: request.request.id,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "accepted",
  });

  await uploadTradeEvidence({
    purchaseRequestId: request.request.id,
    actorUserId: input.buyerId,
    actorRole: "buyer",
    side: "buyer",
    fileName: "buyer-proof.png",
    mimeType: "image/png",
    sizeBytes: 68,
    contentBase64: PNG_BASE64,
  });

  await updatePurchaseRequestStatus({
    requestId: request.request.id,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "funds_received",
  });

  await updatePurchaseRequestStatus({
    requestId: request.request.id,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "usdt_release_pending",
  });

  await uploadTradeEvidence({
    purchaseRequestId: request.request.id,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    side: "seller",
    fileName: "seller-proof.png",
    mimeType: "image/png",
    sizeBytes: 68,
    contentBase64: PNG_BASE64,
  });

  await updatePurchaseRequestStatus({
    requestId: request.request.id,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "usdt_sent",
  });

  const completion = await updatePurchaseRequestStatus({
    requestId: request.request.id,
    actorUserId: input.buyerId,
    actorRole: "buyer",
    nextStatus: "completed",
  });
  if (input.runDeferredTrustWrite && completion.deferredTrustWrite) {
    await completion.deferredTrustWrite();
  }

  return request.request.id;
}

async function markCommissionPaid(purchaseRequestId: string) {
  const commissions = await getCommissionRecordsForAdmin();
  const commission = commissions.find((record) => record.purchaseRequestId === purchaseRequestId);
  expect(commission).toBeDefined();
  await updateCommissionPaymentStatus({
    commissionId: commission!.id,
    actorUserId: OWNER_ID,
    paymentStatus: "paid",
    reason: "Settled during partial listing lifecycle regression test.",
  });
}

describe("partial listing preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("keeps a partially sold listing active with the remaining quantity", async () => {
    const listing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "1000",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });

    await completeTrade({
      listingId: listing.id,
      buyerId: BUYER_ONE_ID,
      buyerName: "Buyer One",
      amount: "250",
      runDeferredTrustWrite: true,
    });

    invalidateAlphaExchangeStoreCache();
    const listings = await getMyMarketplaceListings(SELLER_ID);
    expect(listings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: listing.id,
          status: "active",
          availableAmount: "750",
        }),
      ]),
    );
  });

  it("preserves the same listing across multiple partial sales and completes only at sell-out", async () => {
    const listing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "1000",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });

    const firstRequestId = await completeTrade({
      listingId: listing.id,
      buyerId: BUYER_ONE_ID,
      buyerName: "Buyer One",
      amount: "250",
    });

    invalidateAlphaExchangeStoreCache();
    let listings = await getMyMarketplaceListings(SELLER_ID);
    expect(listings.find((entry) => entry.id === listing.id)).toMatchObject({
      status: "active",
      availableAmount: "750",
    });

    await markCommissionPaid(firstRequestId);

    const secondRequestId = await completeTrade({
      listingId: listing.id,
      buyerId: BUYER_TWO_ID,
      buyerName: "Buyer Two",
      amount: "300",
    });

    invalidateAlphaExchangeStoreCache();
    listings = await getMyMarketplaceListings(SELLER_ID);
    expect(listings.find((entry) => entry.id === listing.id)).toMatchObject({
      status: "active",
      availableAmount: "450",
    });

    await expect(
      createPurchaseRequest({
        buyerId: BUYER_THREE_ID,
        listingId: listing.id,
        usdtAmount: "451",
        buyerName: "Buyer Three",
        buyerWhatsapp: "+972500000003",
        buyerNotes: "Attempting over-purchase",
        bankName: "Bank Hapoalim",
        actorUserId: BUYER_THREE_ID,
      }),
    ).rejects.toThrow("Requested amount exceeds the remaining listing quantity.");

    await markCommissionPaid(secondRequestId);

    await completeTrade({
      listingId: listing.id,
      buyerId: BUYER_THREE_ID,
      buyerName: "Buyer Three",
      amount: "450",
    });

    invalidateAlphaExchangeStoreCache();
    listings = await getMyMarketplaceListings(SELLER_ID);
    expect(listings.find((entry) => entry.id === listing.id)).toMatchObject({
      status: "completed",
      availableAmount: "0",
    });
  });
});
