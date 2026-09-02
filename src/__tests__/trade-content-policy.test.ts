import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequest, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

vi.mock("@/lib/realtime", () => ({
  publishRealtimeEvent: vi.fn(),
}));

import {
  activateBuyerOnboardingWithoutPhone,
  closePurchaseRequestManually,
  downloadTradeEvidenceContent,
  getMyPurchaseRequests,
  getPremiumSellerProfile,
  getTradeRoomData,
  invalidateAlphaExchangeStoreCache,
  openTradeDispute,
  reportSeller,
  submitBuyerTradeReview,
  submitSellerReviewResponse,
  upsertUserProfileForAuth,
  uploadTradeEvidence,
} from "@/lib/alpha-exchange-store";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";

const BUYER_ID = "buyer-content-policy";
const SELLER_ID = "seller-content-policy";
const OWNER_ID = "owner-content-policy";
const REQUEST_ID = "trade-content-policy";
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";

function user(id: string, role: UserRole): AlphaExchangeUser {
  const now = new Date().toISOString();
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "test-hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "owner" ? ["owner", "admin"] : [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Bank Transfer"],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: false, email: false, sms: false },
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

function request(status: PurchaseRequest["status"] = "accepted"): PurchaseRequest {
  const now = new Date().toISOString();
  return {
    id: REQUEST_ID,
    tradeId: "TR-CONTENT-POLICY",
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    listingId: "listing-content-policy",
    buyerName: "Buyer",
    usdtAmount: "100",
    fiatAmount: "300",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    status,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user(BUYER_ID, "buyer"),
      user(SELLER_ID, "approved_seller"),
      user(OWNER_ID, "owner"),
    ],
    sellerApplications: [],
    marketplaceListings: [{
      id: "listing-content-policy",
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller",
      availableAmount: "1000",
      price: "3",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "10",
      maximumTrade: "1000",
      responseTime: "5 min",
      status: "in_trade",
      activeTradeRequestId: REQUEST_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }] as AlphaExchangeDb["marketplaceListings"],
    purchaseRequests: [request()],
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
  } as AlphaExchangeDb & { __runtimeVersion: number };
}

function snapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
}

function reloadStoreFromSnapshot() {
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
}

describe("Trade content policy", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    reloadStoreFromSnapshot();
  });

  it("rejects direct contact content at close, dispute, report, review, and reply write boundaries", async () => {
    snapshot().purchaseRequests[0]!.status = "pending";
    await expect(closePurchaseRequestManually({
      requestId: REQUEST_ID,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      reason: "Call 050-123-4567",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(closePurchaseRequestManually({
      requestId: REQUEST_ID,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      reason: "No longer available",
      explanation: "Email buyer@example.test",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    snapshot().purchaseRequests[0]!.status = "accepted";
    await expect(openTradeDispute({
      purchaseRequestId: REQUEST_ID,
      openedByUserId: BUYER_ID,
      reason: "Email buyer@example.test",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(reportSeller({
      reporterUserId: BUYER_ID,
      sellerId: SELLER_ID,
      reason: "WhatsApp https://wa.me/972501234567",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);

    const reviewRequest = snapshot().purchaseRequests[0]!;
    reviewRequest.status = "review_open";
    reviewRequest.completedAt = new Date().toISOString();
    reloadStoreFromSnapshot();
    await expect(submitBuyerTradeReview({
      requestId: REQUEST_ID,
      buyerUserId: BUYER_ID,
      rating: 5,
      comment: "Telegram: @buyer_private",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);

    snapshot().purchaseRequests[0]!.buyerReview = {
      reviewerUserId: BUYER_ID,
      rating: 5,
      comment: "Good trade",
      createdAt: new Date().toISOString(),
      hidden: false,
    };
    reloadStoreFromSnapshot();
    await expect(submitSellerReviewResponse({
      requestId: REQUEST_ID,
      sellerUserId: SELLER_ID,
      message: "mailto:seller@example.test",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);

    expect(snapshot().disputes).toEqual([]);
    expect(snapshot().sellerReports).toEqual([]);
    expect(snapshot().purchaseRequests[0]?.closedAt).toBeUndefined();
    expect(snapshot().purchaseRequests[0]?.sellerResponse).toBeUndefined();
  });

  it("rejects contact-bearing display text during a new server-auth profile upsert", async () => {
    await expect(upsertUserProfileForAuth({
      fullName: "Email buyer@example.test",
      email: "new-auth-profile@example.test",
      whatsappNumber: "",
      emailVerified: true,
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(activateBuyerOnboardingWithoutPhone({
      userId: BUYER_ID,
      firstName: "Buyer",
      lastName: "User",
      displayName: "Telegram: @buyer_private",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    expect(snapshot().users.some((entry) => entry.email === "new-auth-profile@example.test")).toBe(false);
  });

  it("uses a generated evidence filename in workspace, Trade Room, and download projections", async () => {
    const uploaded = await uploadTradeEvidence({
      purchaseRequestId: REQUEST_ID,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      side: "buyer",
      fileName: "buyer-050-123-4567@example.test.png",
      mimeType: "image/png",
      sizeBytes: 68,
      contentBase64: TINY_PNG_BASE64,
    });

    expect(uploaded.request.buyerEvidence?.fileName).toBe("buyer-payment-evidence.png");
    const workspace = await getMyPurchaseRequests(SELLER_ID, "approved_seller");
    const room = await getTradeRoomData({
      purchaseRequestId: REQUEST_ID,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      markMessagesRead: false,
    });
    const downloaded = await downloadTradeEvidenceContent({
      evidenceId: uploaded.request.buyerEvidence!.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
    });

    for (const value of [JSON.stringify(workspace), JSON.stringify(room), downloaded.evidence.fileName]) {
      expect(value).not.toContain("050-123-4567");
      expect(value).not.toContain("example.test");
    }
    expect(room.request.buyerEvidence?.fileName).toBe("buyer-payment-evidence.png");
    expect(downloaded.evidence.fileName).toBe("buyer-payment-evidence.png");
  });

  it("commits simultaneous identical buyer review submissions exactly once", async () => {
    const completed = snapshot().purchaseRequests[0]!;
    snapshot().users.find((entry) => entry.id === SELLER_ID)!.notificationPreferences = { inApp: true, email: false, sms: false };
    completed.status = "review_open";
    completed.completedAt = new Date().toISOString();
    reloadStoreFromSnapshot();

    const submit = () => submitBuyerTradeReview({
      requestId: REQUEST_ID,
      buyerUserId: BUYER_ID,
      rating: 5,
      comment: "Fast and professional trade",
    });
    const [first, replay] = await Promise.all([submit(), submit()]);

    expect(replay.review.id).toBe(first.review.id);
    const saved = snapshot();
    expect(saved.purchaseRequests[0]?.buyerReview).toMatchObject({
      rating: 5,
      comment: "Fast and professional trade",
    });
    expect(saved.auditLogs.filter((entry) => entry.action === "trade_review_submitted")).toHaveLength(1);
    expect(saved.notifications.filter((entry) => entry.title === "Buyer left a review")).toHaveLength(1);
    expect(saved.activityLog.filter((entry) => entry.title === "Review submitted")).toHaveLength(1);
  });

  it("commits simultaneous identical seller review responses exactly once", async () => {
    const completed = snapshot().purchaseRequests[0]!;
    snapshot().users.find((entry) => entry.id === BUYER_ID)!.notificationPreferences = { inApp: true, email: false, sms: false };
    completed.status = "review_open";
    completed.completedAt = new Date().toISOString();
    completed.buyerReview = {
      reviewerUserId: BUYER_ID,
      rating: 5,
      comment: "Fast and professional trade",
      createdAt: new Date().toISOString(),
      hidden: false,
    };
    reloadStoreFromSnapshot();

    const submit = () => submitSellerReviewResponse({
      requestId: REQUEST_ID,
      sellerUserId: SELLER_ID,
      message: "Thank you for the smooth trade",
    });
    const [first, replay] = await Promise.all([submit(), submit()]);

    expect(replay.sellerReply).toBe(first.sellerReply);
    const saved = snapshot();
    expect(saved.purchaseRequests[0]?.sellerResponse?.message).toBe("Thank you for the smooth trade");
    expect(saved.auditLogs.filter((entry) => entry.action === "trade_review_responded")).toHaveLength(1);
    expect(saved.notifications.filter((entry) => entry.title === "Seller replied to your review")).toHaveLength(1);
    expect(saved.activityLog.filter((entry) => entry.title === "Review response sent")).toHaveLength(1);
  });

  it("redacts legacy close and review content in counterparty workspace, Trade Room, and public seller profile", async () => {
    const legacy = snapshot().purchaseRequests[0]!;
    legacy.status = "review_open";
    legacy.completedAt = new Date().toISOString();
    legacy.closeReason = "Call 050-123-4567";
    legacy.closeExplanation = "Email buyer@example.test";
    legacy.buyerReview = {
      reviewerUserId: BUYER_ID,
      rating: 5,
      comment: "Telegram: @buyer_private",
      createdAt: new Date().toISOString(),
      hidden: false,
    };
    legacy.sellerResponse = {
      responderUserId: SELLER_ID,
      message: "WhatsApp https://wa.me/972501234567",
      createdAt: new Date().toISOString(),
    };
    reloadStoreFromSnapshot();

    const workspace = await getMyPurchaseRequests(SELLER_ID, "approved_seller");
    const room = await getTradeRoomData({
      purchaseRequestId: REQUEST_ID,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      markMessagesRead: false,
    });
    const profile = await getPremiumSellerProfile({
      sellerId: SELLER_ID,
      viewerUserId: BUYER_ID,
      viewerRole: "buyer",
    });
    const serialized = JSON.stringify({ workspace, room, profile });

    expect(serialized).not.toContain("050-123-4567");
    expect(serialized).not.toContain("buyer@example.test");
    expect(serialized).not.toContain("@buyer_private");
    expect(serialized).not.toContain("wa.me");
    expect(serialized).not.toContain("t.me");
  });

  it("projects a legacy cancelled trade on idempotent close retry", async () => {
    const legacy = snapshot().purchaseRequests[0]!;
    legacy.status = "cancelled";
    legacy.closedAt = new Date().toISOString();
    legacy.buyerWhatsapp = "+972 50-123-4567";
    legacy.buyerNotes = "Email buyer@example.test";
    legacy.closeReason = "Call 555-123-4567";
    legacy.closeExplanation = "Telegram: @buyer_private";
    reloadStoreFromSnapshot();

    const repeatedClose = await closePurchaseRequestManually({
      requestId: REQUEST_ID,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      reason: "Already closed",
    });

    const serialized = JSON.stringify(repeatedClose);
    expect(repeatedClose).not.toHaveProperty("buyerWhatsapp");
    expect(repeatedClose).not.toHaveProperty("buyerNotes");
    expect(serialized).not.toContain("050-123-4567");
    expect(serialized).not.toContain("buyer@example.test");
    expect(serialized).not.toContain("555-123-4567");
    expect(serialized).not.toContain("@buyer_private");
  });
});
