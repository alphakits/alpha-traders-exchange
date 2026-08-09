import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, SellerStatus, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  createMarketplaceListing,
  createPurchaseRequest,
  getAccountProfileData,
  getCommissionRecordsForAdmin,
  getNotificationsForUser,
  getFirstActiveTradeForUser,
  getMyMarketplaceListings,
  getMyPurchaseRequests,
  invalidateAlphaExchangeStoreCache,
  reviewMarketplaceListingByOwner,
  TradeBlockedError,
  updateCommissionPaymentStatus,
  updateMarketplaceListingForSeller,
  updatePurchaseRequestStatus,
  uploadTradeEvidence,
} from "@/lib/alpha-exchange-store";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";

const SELLER_ID = "seller-1";
const SELLER_TWO_ID = "seller-2";
const BUYER_ONE_ID = "buyer-1";
const BUYER_TWO_ID = "buyer-2";
const BUYER_THREE_ID = "buyer-3";
const OWNER_ID = "owner-1";

function createUser(id: string, email: string, role: "owner" | "buyer" | "approved_seller"): AlphaExchangeUser {
  const now = new Date().toISOString();
  const roles: UserRole[] = role === "owner" ? ["owner", "admin"] : [role];
  const sellerStatus: SellerStatus = role === "approved_seller" ? "approved_seller" : "buyer";
  return {
    id,
    fullName: id,
    email,
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
    sellerRankOverride: undefined,
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
    adminAnnouncementRuns: [],
    sellerReviews: [],
    __runtimeVersion: 0,
  };
}

async function approveListing(listingId: string) {
  await reviewMarketplaceListingByOwner({
    listingId,
    ownerUserId: OWNER_ID,
    decision: "approve",
  });
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
    buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
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

async function advanceTradeToUsdtSent(input: { requestId: string; buyerId: string }) {
  await updatePurchaseRequestStatus({
    requestId: input.requestId,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "accepted",
  });
  await uploadTradeEvidence({
    purchaseRequestId: input.requestId,
    actorUserId: input.buyerId,
    actorRole: "buyer",
    side: "buyer",
    fileName: "buyer-proof.png",
    mimeType: "image/png",
    sizeBytes: 68,
    contentBase64: PNG_BASE64,
  });
  await updatePurchaseRequestStatus({
    requestId: input.requestId,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "funds_received",
  });
  await updatePurchaseRequestStatus({
    requestId: input.requestId,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "usdt_release_pending",
  });
  await uploadTradeEvidence({
    purchaseRequestId: input.requestId,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    side: "seller",
    fileName: "seller-proof.png",
    mimeType: "image/png",
    sizeBytes: 68,
    contentBase64: PNG_BASE64,
  });
  await updatePurchaseRequestStatus({
    requestId: input.requestId,
    actorUserId: SELLER_ID,
    actorRole: "approved_seller",
    nextStatus: "usdt_sent",
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

  it("assigns one canonical trade ID at request creation and keeps linked records aligned", async () => {
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
    await approveListing(listing.id);

    const created = await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: listing.id,
      usdtAmount: "250",
      buyerName: "Buyer One",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Buying 250 USDT",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      bankName: "Bank Hapoalim",
      actorUserId: BUYER_ONE_ID,
    });

    const tradeId = created.request.tradeId;
    expect(tradeId).toMatch(/^trade-/);

    let snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    expect(snapshot.notifications.find((entry) => entry.relatedRequestId === created.request.id)?.relatedTradeId).toBe(tradeId);
    expect(snapshot.auditLogs.find((entry) => entry.purchaseRequestId === created.request.id && entry.action === "purchase_request_submitted")).toBeDefined();

    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });

    await uploadTradeEvidence({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ONE_ID,
      actorRole: "buyer",
      side: "buyer",
      fileName: "buyer-proof.png",
      mimeType: "image/png",
      sizeBytes: 68,
      contentBase64: PNG_BASE64,
    });

    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "funds_received",
    });

    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "usdt_release_pending",
    });

    await uploadTradeEvidence({
      purchaseRequestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      side: "seller",
      fileName: "seller-proof.png",
      mimeType: "image/png",
      sizeBytes: 68,
      contentBase64: PNG_BASE64,
    });

    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "usdt_sent",
    });

    const completion = await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: BUYER_ONE_ID,
      actorRole: "buyer",
      nextStatus: "completed",
    });
    await completion.deferredTrustWrite?.();

    snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    const request = snapshot.purchaseRequests.find((entry) => entry.id === created.request.id);
    expect(request?.tradeId).toBe(tradeId);
    expect(snapshot.notifications.filter((entry) => entry.relatedRequestId === created.request.id).every((entry) => entry.relatedTradeId === tradeId)).toBe(true);
    expect(snapshot.commissionRecords.find((entry) => entry.purchaseRequestId === created.request.id)).toMatchObject({
      tradeId,
      listingId: listing.id,
      sellerId: SELLER_ID,
      buyerId: BUYER_ONE_ID,
    });
  });

  it("persists all three seller payment methods and up to two supported banks on a listing", async () => {
    const listing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "1000",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"],
      bankName: "Bank Hapoalim, Bank Leumi",
      minimumTrade: "50",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });

    expect(listing.paymentMethods).toEqual(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"]);
    expect(listing.bankName).toBe("Bank Hapoalim, Bank Leumi");
  });

  it("uses the buyer-selected payment method throughout the trade request", async () => {
    const listing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "1000",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer", "Face-to-Face (Meet in Person)"],
      bankName: "Bank Hapoalim, Bank Leumi",
      minimumTrade: "50",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    await approveListing(listing.id);

    const created = await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: listing.id,
      usdtAmount: "250",
      buyerName: "Buyer One",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Meet in person",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      paymentMethod: "Face-to-Face (Meet in Person)",
      safetyAcknowledged: true,
      actorUserId: BUYER_ONE_ID,
    });

    expect(created.request.paymentMethod).toBe("Face-to-Face (Meet in Person)");
    expect(created.request.bankName).toBeUndefined();
    expect(created.request.buyerSafetyAcknowledged).toBe(true);
  });

  it("returns updated seller and buyer profile stats immediately after trade completion", async () => {
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
    await approveListing(listing.id);

    const beforeSeller = await getAccountProfileData(SELLER_ID);
    const beforeBuyer = await getAccountProfileData(BUYER_ONE_ID);
    expect(beforeSeller.stats.kind).toBe("seller");
    expect(beforeBuyer.stats.kind).toBe("buyer");

    await completeTrade({
      listingId: listing.id,
      buyerId: BUYER_ONE_ID,
      buyerName: "Buyer One",
      amount: "250",
    });

    const afterSeller = await getAccountProfileData(SELLER_ID);
    const afterBuyer = await getAccountProfileData(BUYER_ONE_ID);

    expect(afterSeller.stats.kind).toBe("seller");
    expect(afterBuyer.stats.kind).toBe("buyer");
    if (afterSeller.stats.kind !== "seller" || afterBuyer.stats.kind !== "buyer") {
      throw new Error("Expected seller and buyer profile stats.");
    }
    expect(afterSeller.stats.completedTrades).toBe(1);
    expect(afterSeller.stats.activeListings).toBe(1);
    expect(afterSeller.stats.lifetimeCompletedVolumeUsdt).toBe(250);
    expect(afterBuyer.stats.activeTrades).toBe(0);
    expect(afterBuyer.stats.completedTrades).toBe(1);
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
    await approveListing(listing.id);

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

  it("keeps original and available listing amounts aligned after seller quantity edits", async () => {
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

    await updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      availableAmount: "825",
      maximumTrade: "825",
    });

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    expect(snapshot.marketplaceListings.find((entry) => entry.id === listing.id)).toMatchObject({
      originalAmount: "825",
      availableAmount: "825",
    });
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
    await approveListing(listing.id);

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
        buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
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

  it("covers full trade lifecycle transitions, notifications, and commission record creation", async () => {
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
    await approveListing(listing.id);

    const created = await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: listing.id,
      usdtAmount: "300",
      buyerName: "Lifecycle Buyer",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Trade lifecycle QA",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      actorUserId: BUYER_ONE_ID,
    });

    expect(created.request.status).toBe("pending");
    let snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    expect(snapshot.notifications.some((entry) => entry.userId === SELLER_ID && entry.title === "New trade request" && entry.relatedRequestId === created.request.id)).toBe(true);

    await advanceTradeToUsdtSent({ requestId: created.request.id, buyerId: BUYER_ONE_ID });

    const completion = await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: BUYER_ONE_ID,
      actorRole: "buyer",
      nextStatus: "completed",
    });
    await completion.deferredTrustWrite?.();
    expect(Boolean(completion.request.completedAt)).toBe(true);
    expect(completion.request.status).toBe("review_open");

    snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    const notificationsForBuyer = snapshot.notifications.filter((entry) => entry.userId === BUYER_ONE_ID).map((entry) => entry.title);
    const notificationsForSeller = snapshot.notifications.filter((entry) => entry.userId === SELLER_ID).map((entry) => entry.title);
    expect(notificationsForBuyer).toEqual(
      expect.arrayContaining([
        "Trade request accepted",
        "Seller confirmed funds received",
        "USDT release pending",
        "Seller marked USDT sent",
        "Trade completed",
      ]),
    );
    expect(notificationsForSeller).toEqual(
      expect.arrayContaining([
        "New trade request",
        "Buyer marked payment sent",
        "Trade completed",
      ]),
    );

    const commission = snapshot.commissionRecords.find((entry) => entry.purchaseRequestId === created.request.id);
    expect(commission).toMatchObject({
      listingId: listing.id,
      sellerId: SELLER_ID,
      buyerId: BUYER_ONE_ID,
      paymentStatus: "pending",
      grossAmount: 960,
      commissionAmount: 3,
    });
  });

  it("archives overdue buyer confirmation after usdt_sent and blocks new purchases", async () => {
    const lockedListing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "500",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "500",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    const freshListing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "600",
      price: "3.25",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "600",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    await approveListing(lockedListing.id);
    await approveListing(freshListing.id);

    const created = await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: lockedListing.id,
      usdtAmount: "120",
      buyerName: "Buyer One",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Timeout archive test",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      actorUserId: BUYER_ONE_ID,
    });

    await advanceTradeToUsdtSent({ requestId: created.request.id, buyerId: BUYER_ONE_ID });

    const snapshotBefore = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    const target = snapshotBefore.purchaseRequests.find((entry) => entry.id === created.request.id);
    expect(target?.status).toBe("usdt_sent");
    if (target) {
      const staleSentAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      target.usdtSentAt = staleSentAt;
      target.updatedAt = staleSentAt;
      target.buyerConfirmationArchivedAt = undefined;
    }

    invalidateAlphaExchangeStoreCache();
    await getMyPurchaseRequests(BUYER_ONE_ID, "buyer");

    const snapshotAfter = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    const archived = snapshotAfter.purchaseRequests.find((entry) => entry.id === created.request.id);
    expect(Boolean(archived?.buyerConfirmationArchivedAt)).toBe(true);
    expect(snapshotAfter.notifications.some((entry) => entry.userId === BUYER_ONE_ID && entry.title === "Action Required — Confirm USDT Receipt")).toBe(true);

    await expect(
      createPurchaseRequest({
        buyerId: BUYER_ONE_ID,
        listingId: freshListing.id,
        usdtAmount: "100",
        buyerName: "Buyer One",
        buyerWhatsapp: "+972500000001",
        buyerNotes: "Should be blocked",
        buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        actorUserId: BUYER_ONE_ID,
      }),
    ).rejects.toMatchObject({
      name: "TradeBlockedError",
      code: "AWAITING_BUYER_CONFIRMATION",
    });
  });

  it("supports cancellation before usdt_sent (seller decline and buyer cancel after accept)", async () => {
    const listing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "900",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "900",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    await approveListing(listing.id);

    const sellerDeclined = await createPurchaseRequest({
      buyerId: BUYER_TWO_ID,
      listingId: listing.id,
      usdtAmount: "100",
      buyerName: "Buyer Two",
      buyerWhatsapp: "+972500000002",
      buyerNotes: "Seller decline flow",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      actorUserId: BUYER_TWO_ID,
    });
    const declineResult = await updatePurchaseRequestStatus({
      requestId: sellerDeclined.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "declined",
    });
    expect(declineResult.request.status).toBe("declined");

    const buyerCancelled = await createPurchaseRequest({
      buyerId: BUYER_THREE_ID,
      listingId: listing.id,
      usdtAmount: "120",
      buyerName: "Buyer Three",
      buyerWhatsapp: "+972500000003",
      buyerNotes: "Buyer cancel flow",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      actorUserId: BUYER_THREE_ID,
    });
    await updatePurchaseRequestStatus({
      requestId: buyerCancelled.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });
    const cancelResult = await updatePurchaseRequestStatus({
      requestId: buyerCancelled.request.id,
      actorUserId: BUYER_THREE_ID,
      actorRole: "buyer",
      nextStatus: "cancelled",
    });
    expect(cancelResult.request.status).toBe("cancelled");

    const listings = await getMyMarketplaceListings(SELLER_ID);
    expect(listings.find((entry) => entry.id === listing.id)?.status).toBe("active");
  });

  it("emits one notification per trade lifecycle event with deep links", async () => {
    const seededDb = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    seededDb.users.push(createUser(SELLER_TWO_ID, "seller-two@example.com", "approved_seller"));
    const listing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "600",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "600",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    await approveListing(listing.id);
    const listingOwnerNotifications = await getNotificationsForUser({ userId: SELLER_ID });
    const unrelatedSellerNotifications = await getNotificationsForUser({ userId: SELLER_TWO_ID });
    expect(listingOwnerNotifications.notifications.some((notification) => notification.title === "Listing submitted" && notification.relatedListingId === listing.id)).toBe(true);
    expect(unrelatedSellerNotifications.notifications.some((notification) => notification.title === "🟢 New USDT Listing Available" && notification.relatedListingId === listing.id)).toBe(false);

    const request = await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: listing.id,
      usdtAmount: "120",
      buyerName: "Buyer One",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Notification certification",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      actorUserId: BUYER_ONE_ID,
    });

    const sellerNotificationsAfterRequest = await getNotificationsForUser({ userId: SELLER_ID });
    const buyerNotificationsAfterRequest = await getNotificationsForUser({ userId: BUYER_ONE_ID });
    expect(sellerNotificationsAfterRequest.notifications.filter((n) => n.relatedRequestId === request.request.id && n.title === "New trade request")).toHaveLength(1);
    expect(buyerNotificationsAfterRequest.notifications.filter((n) => n.title === "New trade request")).toHaveLength(0);
    expect(buyerNotificationsAfterRequest.notifications.filter((n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id)).toHaveLength(1);

    await updatePurchaseRequestStatus({
      requestId: request.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });
    await uploadTradeEvidence({
      purchaseRequestId: request.request.id,
      actorUserId: BUYER_ONE_ID,
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
    await updatePurchaseRequestStatus({
      requestId: request.request.id,
      actorUserId: BUYER_ONE_ID,
      actorRole: "buyer",
      nextStatus: "completed",
    });

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion: number };
    const requestNotifications = snapshot.notifications.filter((entry) => entry.relatedRequestId === request.request.id || entry.relatedTradeId === request.request.tradeId);
    const sellerNotifications = requestNotifications.filter((entry) => entry.userId === SELLER_ID).map((entry) => entry.title);
    const buyerNotifications = requestNotifications.filter((entry) => entry.userId === BUYER_ONE_ID).map((entry) => entry.title);

    expect(requestNotifications.filter((entry) => entry.title === "New trade request")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.title === "Trade request accepted")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.title === "Buyer marked payment sent")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.title === "Seller confirmed funds received")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.title === "USDT release pending")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.title === "Seller marked USDT sent")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.userId === BUYER_ONE_ID && entry.title === "Trade completed")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.userId === SELLER_ID && entry.title === "Trade completed")).toHaveLength(1);
    expect(requestNotifications.filter((entry) => entry.userId === BUYER_ONE_ID && entry.title === "Review available")).toHaveLength(1);
    expect(sellerNotifications).toContain("Buyer marked payment sent");
    expect(buyerNotifications).toContain("Trade completed");
    expect(buyerNotifications).toContain("Review available");
    expect(requestNotifications.every((entry, index, arr) => arr.findIndex((item) => item.id === entry.id) === index)).toBe(true);
    expect(requestNotifications.every((entry) => Boolean(entry.relatedHref) || Boolean(entry.actionHref))).toBe(true);
  });

  it("prevents buyers from opening a second active trade", async () => {
    const primaryListing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "700",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "700",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    const secondaryListing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "800",
      price: "3.25",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "800",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    await approveListing(primaryListing.id);
    await approveListing(secondaryListing.id);

    const first = await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: primaryListing.id,
      usdtAmount: "150",
      buyerName: "Buyer One",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "First trade",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      actorUserId: BUYER_ONE_ID,
    });
    await updatePurchaseRequestStatus({
      requestId: first.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });

    try {
      await createPurchaseRequest({
        buyerId: BUYER_ONE_ID,
        listingId: secondaryListing.id,
        usdtAmount: "100",
        buyerName: "Buyer One",
        buyerWhatsapp: "+972500000001",
        buyerNotes: "Second active trade should fail",
        buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        actorUserId: BUYER_ONE_ID,
      });
      throw new Error("Expected ACTIVE_TRADE_EXISTS error.");
    } catch (error) {
      expect(error).toBeInstanceOf(TradeBlockedError);
      const blocked = error as TradeBlockedError;
      expect(blocked.code).toBe("ACTIVE_TRADE_EXISTS");
      expect(blocked.purchaseRequestId).toBe(first.request.id);
    }
  });

  it("redirects buyer but not seller for a pending (pre-acceptance) trade", async () => {
    const listing = await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "500",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "500",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });
    await approveListing(listing.id);

    await createPurchaseRequest({
      buyerId: BUYER_ONE_ID,
      listingId: listing.id,
      usdtAmount: "100",
      buyerName: "Buyer One",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Pending trade test",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      actorUserId: BUYER_ONE_ID,
    });

    // Buyer should be redirected into trade room (pending = buyer is waiting)
    const buyerTrade = await getFirstActiveTradeForUser(BUYER_ONE_ID, "buyer");
    expect(buyerTrade).not.toBeNull();
    expect(buyerTrade?.status).toBe("pending");

    // Seller should NOT be redirected — pending request is unaccepted, seller can still browse
    const sellerTrade = await getFirstActiveTradeForUser(SELLER_ID, "approved_seller");
    expect(sellerTrade).toBeNull();
  });
});
