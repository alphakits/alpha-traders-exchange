import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, SellerStatus, UserRole } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  publishRealtimeEvent: vi.fn(),
}));

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

vi.mock("@/lib/realtime", () => ({
  publishRealtimeEvent: mocks.publishRealtimeEvent,
}));

import {
  createMarketplaceListing,
  createPurchaseRequest,
  getCommissionRecordsForAdmin,
  getFirstActiveTradeForUser,
  getSellerReviews,
  invalidateAlphaExchangeStoreCache,
  postTradeRoomMessage,
  reviewMarketplaceListingByOwner,
  submitBuyerTradeReview,
  submitSellerReviewResponse,
  updatePurchaseRequestStatus,
  uploadTradeEvidence,
} from "@/lib/alpha-exchange-store";

const OWNER_ID = "scale-owner";
const SELLER_IDS = Array.from({ length: 10 }, (_, index) => `scale-seller-${index + 1}`);
const BUYER_IDS = Array.from({ length: 10 }, (_, index) => `scale-buyer-${index + 1}`);
const WALLET = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";

function clientMessageId(side: "buyer" | "seller", index: number) {
  const prefix = side === "buyer" ? "1" : "2";
  const suffix = String(index + 1).padStart(12, "0");
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${suffix}`;
}

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
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, reason: null });
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

  it("preserves ten simultaneous complete trade lifecycles, reviews, commissions, and reopened listings", async () => {
    const listings: MarketplaceListing[] = [];
    for (const [index, sellerId] of SELLER_IDS.entries()) {
      listings.push(await createApprovedListing(sellerId, index));
    }

    const submissions = await Promise.all(
      listings.map((listing, index) => submitPurchase(listing.id, BUYER_IDS[index]!, index)),
    );
    await Promise.all(
      submissions.map((submission, index) => updatePurchaseRequestStatus({
        requestId: submission.request.id,
        actorUserId: SELLER_IDS[index]!,
        actorRole: "approved_seller",
        nextStatus: "accepted",
      })),
    );

    const buyerMessages = submissions.map((submission, index) => ({
      purchaseRequestId: submission.request.id,
      actorUserId: BUYER_IDS[index]!,
      clientMessageId: clientMessageId("buyer", index),
      message: `Fictional scale buyer update ${index + 1}.`,
    }));
    const sellerMessages = submissions.map((submission, index) => ({
      purchaseRequestId: submission.request.id,
      actorUserId: SELLER_IDS[index]!,
      clientMessageId: clientMessageId("seller", index),
      message: `Fictional scale seller update ${index + 1}.`,
    }));
    await Promise.all([
      ...buyerMessages.map((message) => postTradeRoomMessage(message)),
      ...sellerMessages.map((message) => postTradeRoomMessage(message)),
    ]);

    const buyerEvidence = await Promise.all(
      submissions.map((submission, index) => uploadTradeEvidence({
        purchaseRequestId: submission.request.id,
        actorUserId: BUYER_IDS[index]!,
        actorRole: "buyer",
        side: "buyer",
        fileName: `fictional-scale-buyer-${index + 1}.png`,
        mimeType: "image/png",
        sizeBytes: 68,
        contentBase64: PNG_BASE64,
      })),
    );
    expect(buyerEvidence.every((result) => result.request.status === "payment_sent")).toBe(true);

    await Promise.all(
      submissions.map((submission, index) => updatePurchaseRequestStatus({
        requestId: submission.request.id,
        actorUserId: SELLER_IDS[index]!,
        actorRole: "approved_seller",
        nextStatus: "funds_received",
      })),
    );
    await Promise.all(
      submissions.map((submission, index) => updatePurchaseRequestStatus({
        requestId: submission.request.id,
        actorUserId: SELLER_IDS[index]!,
        actorRole: "approved_seller",
        nextStatus: "usdt_release_pending",
      })),
    );
    const sellerEvidence = await Promise.all(
      submissions.map((submission, index) => uploadTradeEvidence({
        purchaseRequestId: submission.request.id,
        actorUserId: SELLER_IDS[index]!,
        actorRole: "approved_seller",
        side: "seller",
        fileName: `fictional-scale-seller-${index + 1}.png`,
        mimeType: "image/png",
        sizeBytes: 68,
        contentBase64: PNG_BASE64,
      })),
    );
    expect(sellerEvidence.every((result) => result.request.status === "usdt_sent")).toBe(true);

    const completions = await Promise.all(
      submissions.map((submission, index) => updatePurchaseRequestStatus({
        requestId: submission.request.id,
        actorUserId: BUYER_IDS[index]!,
        actorRole: "buyer",
        nextStatus: "completed",
      })),
    );
    expect(completions.every((result) => result.request.status === "review_open")).toBe(true);
    for (const completion of completions) {
      if (completion.deferredTrustWrite) await completion.deferredTrustWrite();
    }

    await Promise.all(
      submissions.map((submission, index) => submitBuyerTradeReview({
        requestId: submission.request.id,
        buyerUserId: BUYER_IDS[index]!,
        rating: 5,
        comment: `Verified fictional scale review ${index + 1}.`,
      })),
    );
    await Promise.all(
      submissions.map((submission, index) => submitSellerReviewResponse({
        requestId: submission.request.id,
        sellerUserId: SELLER_IDS[index]!,
        message: `Verified fictional scale seller response ${index + 1}.`,
      })),
    );

    invalidateAlphaExchangeStoreCache();
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const requestIds = new Set(submissions.map((submission) => submission.request.id));
    const completedRequests = snapshot.purchaseRequests.filter((request) => requestIds.has(request.id));
    const completedListings = snapshot.marketplaceListings.filter((listing) => listings.some((created) => created.id === listing.id));
    const commissions = (await getCommissionRecordsForAdmin()).filter((record) => requestIds.has(record.purchaseRequestId));

    expect(completedRequests).toHaveLength(10);
    expect(completedRequests.every((request) => request.status === "review_open")).toBe(true);
    expect(completedListings).toHaveLength(10);
    expect(completedListings.every((listing) => (
      listing.status === "active"
      && listing.activeTradeRequestId === undefined
      && listing.availableAmount === "400"
    ))).toBe(true);
    expect(commissions).toHaveLength(10);
    expect(new Set(commissions.map((record) => record.purchaseRequestId))).toEqual(requestIds);
    expect(commissions.every((record) => record.paymentStatus === "pending" && record.commissionAmount === 1)).toBe(true);

    const requiredTimelineTypes = [
      "request_submitted",
      "request_accepted",
      "buyer_evidence_uploaded",
      "payment_sent",
      "seller_confirmed_funds",
      "usdt_release_started",
      "seller_evidence_uploaded",
      "usdt_sent",
      "trade_completed",
      "trade_locked",
      "review_unlocked",
      "commission_recorded",
    ];
    for (const request of completedRequests) {
      const index = submissions.findIndex((submission) => submission.request.id === request.id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(request.buyerId).toBe(BUYER_IDS[index]);
      expect(request.sellerId).toBe(SELLER_IDS[index]);
      expect(request.messages?.filter((message) => message.kind === "user")).toHaveLength(2);
      expect(request.timeline.map((entry) => entry.type)).toEqual(expect.arrayContaining(requiredTimelineTypes));

      const reviews = await getSellerReviews({
        sellerId: SELLER_IDS[index]!,
        actorUserId: BUYER_IDS[index]!,
        actorRole: "buyer",
      });
      expect(reviews).toEqual([
        expect.objectContaining({
          tradeId: request.tradeId,
          rating: 5,
          verifiedTrade: true,
          sellerReply: `Verified fictional scale seller response ${index + 1}.`,
        }),
      ]);
    }

    const notificationCopy = snapshot.notifications.map((notification) => notification.message).join("\n");
    for (const message of [...buyerMessages, ...sellerMessages]) {
      expect(notificationCopy).not.toContain(message.message);
    }
    expect(snapshot.users.every((user) => user.email.endsWith("@example.test"))).toBe(true);
  }, 60_000);
});
