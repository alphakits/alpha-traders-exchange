import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, SellerStatus, UserRole } from "@/types/alpha-exchange";

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
  addSellerBankAccount,
  createMarketplaceListing,
  createPurchaseRequest,
  getCommissionRecordsForAdmin,
  getMarketplaceListings,
  getSellerReviews,
  getTradeRoomBankDetails,
  getTradeRoomData,
  invalidateAlphaExchangeStoreCache,
  openTradeDispute,
  postTradeRoomMessage,
  reportSeller,
  reviewMarketplaceListingByOwner,
  setUserBlockStatus,
  submitBuyerTradeReview,
  submitSellerReviewResponse,
  TradeBlockedError,
  updatePurchaseRequestStatus,
  uploadTradeEvidence,
} from "@/lib/alpha-exchange-store";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";

const OWNER_ID = "app-review-owner";
const SELLER_ID = "app-review-seller";
const BUYER_ID = "app-review-buyer";
const OUTSIDER_ID = "app-review-outsider";
const REVIEW_WALLET = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";
const FIXTURE_NOTICE = "APP REVIEW FIXTURE — FICTIONAL DATA ONLY";

function createUser(id: string, role: "owner" | "buyer" | "approved_seller"): AlphaExchangeUser {
  const now = new Date().toISOString();
  const roles: UserRole[] = role === "owner" ? ["owner", "admin"] : [role];
  const sellerStatus: SellerStatus = role === "approved_seller" ? "approved_seller" : "buyer";

  return {
    id,
    fullName: role === "approved_seller" ? "App Review Seller" : role === "buyer" ? "App Review Buyer" : "App Review Owner",
    email: `${id}@example.test`,
    passwordHash: "non-production-test-hash",
    whatsappNumber: "",
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
    bio: FIXTURE_NOTICE,
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
      createUser(BUYER_ID, "buyer"),
      createUser(OUTSIDER_ID, "buyer"),
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

function snapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
}

async function createApprovedReviewListing(paymentMethods = ["Bank Transfer"]) {
  const bankAccount = await addSellerBankAccount({
    sellerId: SELLER_ID,
    actorUserId: SELLER_ID,
    accountHolderName: "App Review Seller",
    bankName: "Bank Hapoalim",
    branchNumber: "123",
    accountNumber: "0000000001",
    isDefault: true,
  });
  const listing = await createMarketplaceListing({
    sellerId: SELLER_ID,
    sellerDisplayName: "App Review Seller",
    availableAmount: "1000",
    price: "3.30",
    currency: "ILS",
    network: "TRC20",
    paymentMethods,
    bankAccountId: bankAccount.id,
    bankName: "Bank Hapoalim",
    minimumTrade: "50",
    maximumTrade: "1000",
    notes: FIXTURE_NOTICE,
    sellerDescription: "Fictional approved seller used only for the App Review rehearsal.",
    responseTime: "5 min",
    acceptedCommissionPolicy: true,
    actorUserId: SELLER_ID,
  });
  await reviewMarketplaceListingByOwner({
    listingId: listing.id,
    ownerUserId: OWNER_ID,
    decision: "approve",
  });
  return { bankAccount, listing };
}

function purchaseInput(listingId: string) {
  return {
    buyerId: BUYER_ID,
    listingId,
    usdtAmount: "100",
    buyerName: "App Review Buyer",
    buyerReceivingWalletAddress: REVIEW_WALLET,
    paymentMethod: "Bank Transfer",
    bankName: "Bank Hapoalim",
    actorUserId: BUYER_ID,
  };
}

describe("full Exchange App Review rehearsal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, reason: null });
  });

  it("completes the fictional buyer and approved-seller journey without production services", async () => {
    const { bankAccount, listing } = await createApprovedReviewListing();
    const marketplace = await getMarketplaceListings(undefined, undefined, BUYER_ID);
    expect(marketplace.map((entry) => entry.id)).toContain(listing.id);

    const created = await createPurchaseRequest({
      ...purchaseInput(listing.id),
      priceMode: "buyer_offer",
      offeredPrice: "3.05",
    });
    expect(created.request).toMatchObject({
      status: "pending",
      priceMode: "buyer_offer",
      listingPriceAtRequest: "3.30",
      pricePerUsdt: "3.05",
      fiatAmount: "305.00",
    });
    await expect(getTradeRoomBankDetails({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
    })).rejects.toThrow("only after the seller accepts");

    const accepted = await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });
    expect(accepted.request).toMatchObject({ status: "accepted", pricePerUsdt: "3.05", fiatAmount: "305.00" });

    const bankDetails = await getTradeRoomBankDetails({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
    });
    expect(bankDetails).toMatchObject({
      bankAccountId: bankAccount.id,
      accountHolderName: "App Review Seller",
      bankName: "Bank Hapoalim",
      branchNumber: "123",
      accountNumber: "0000000001",
    });

    const buyerMessageText = "The fictional payment is ready for verification inside this Trade Room.";
    const sellerMessageText = "I will verify the fictional transfer before releasing USDT.";
    const buyerMessage = await postTradeRoomMessage({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      clientMessageId: "11111111-1111-4111-8111-111111111111",
      message: buyerMessageText,
    });
    await postTradeRoomMessage({
      purchaseRequestId: created.request.id,
      actorUserId: SELLER_ID,
      clientMessageId: "22222222-2222-4222-8222-222222222222",
      message: sellerMessageText,
    });
    const sellerRoom = await getTradeRoomData({
      purchaseRequestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      markMessagesRead: true,
      strongConsistency: true,
    });
    expect(sellerRoom.messages.find((message) => message.id === buyerMessage.message.id)?.readByUserIds)
      .toEqual(expect.arrayContaining([BUYER_ID, SELLER_ID]));

    const buyerEvidence = await uploadTradeEvidence({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      side: "buyer",
      fileName: "fictional-buyer-proof.png",
      mimeType: "image/png",
      sizeBytes: 68,
      contentBase64: PNG_BASE64,
    });
    expect(buyerEvidence.request.status).toBe("payment_sent");
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
    const sellerEvidence = await uploadTradeEvidence({
      purchaseRequestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      side: "seller",
      fileName: "fictional-seller-proof.png",
      mimeType: "image/png",
      sizeBytes: 68,
      contentBase64: PNG_BASE64,
    });
    expect(sellerEvidence.request.status).toBe("usdt_sent");

    const completion = await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      nextStatus: "completed",
    });
    expect(completion.request.status).toBe("review_open");
    if (completion.deferredTrustWrite) await completion.deferredTrustWrite();

    await submitBuyerTradeReview({
      requestId: created.request.id,
      buyerUserId: BUYER_ID,
      rating: 5,
      comment: "The protected Trade Room journey was clear and complete.",
    });
    await submitSellerReviewResponse({
      requestId: created.request.id,
      sellerUserId: SELLER_ID,
      message: "Thank you for completing the protected review journey.",
    });

    const reviews = await getSellerReviews({ sellerId: SELLER_ID, actorUserId: BUYER_ID, actorRole: "buyer" });
    expect(reviews).toEqual([
      expect.objectContaining({
        tradeId: created.request.tradeId,
        rating: 5,
        verifiedTrade: true,
        sellerReply: "Thank you for completing the protected review journey.",
      }),
    ]);

    const saved = snapshot();
    const savedListing = saved.marketplaceListings.find((entry) => entry.id === listing.id);
    const savedRequest = saved.purchaseRequests.find((entry) => entry.id === created.request.id);
    expect(savedListing).toMatchObject({ availableAmount: "900", status: "active", activeTradeRequestId: undefined });
    expect((await getCommissionRecordsForAdmin()).find((entry) => entry.purchaseRequestId === created.request.id))
      .toMatchObject({ paymentStatus: "pending", commissionAmount: 1 });
    expect(savedRequest?.timeline.map((entry) => entry.type)).toEqual(expect.arrayContaining([
      "price_offer_submitted",
      "price_offer_accepted",
      "bank_details_revealed",
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
    ]));
    const notificationCopy = saved.notifications.map((entry) => entry.message).join("\n");
    expect(notificationCopy).not.toContain(buyerMessageText);
    expect(notificationCopy).not.toContain(sellerMessageText);
    expect(notificationCopy).not.toContain("0000000001");
  });

  it("completes a cardless ATM withdrawal from request through review without exposing bank details", async () => {
    const { bankAccount, listing } = await createApprovedReviewListing([
      "Bank Transfer",
      "Face-to-Face (Meet in Person)",
      "Cardless ATM Withdrawal",
    ]);
    const created = await createPurchaseRequest({
      ...purchaseInput(listing.id),
      paymentMethod: "Cardless ATM Withdrawal",
    });
    expect(created.request).toMatchObject({
      status: "pending",
      paymentMethod: "Cardless ATM Withdrawal",
      sellerBankAccountId: bankAccount.id,
    });

    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });
    await expect(getTradeRoomBankDetails({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
    })).rejects.toThrow("Bank details are available only after the seller accepts the trade.");

    const buyerEvidence = await uploadTradeEvidence({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      side: "buyer",
      fileName: "fictional-cardless-withdrawal.png",
      mimeType: "image/png",
      sizeBytes: 68,
      contentBase64: PNG_BASE64,
    });
    expect(buyerEvidence.request.status).toBe("payment_sent");
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
    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "usdt_sent",
    });
    const completion = await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      nextStatus: "completed",
    });
    expect(completion.request.status).toBe("review_open");
    if (completion.deferredTrustWrite) await completion.deferredTrustWrite();

    await submitBuyerTradeReview({
      requestId: created.request.id,
      buyerUserId: BUYER_ID,
      rating: 5,
      comment: "The fictional cardless withdrawal completed successfully.",
    });

    const saved = snapshot();
    expect(saved.marketplaceListings.find((entry) => entry.id === listing.id)).toMatchObject({
      availableAmount: "900",
      status: "active",
      activeTradeRequestId: undefined,
    });
    expect(saved.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: SELLER_ID, title: "Withdrawal ready" }),
      expect.objectContaining({ userId: BUYER_ID, title: "Seller confirmed cash collected" }),
    ]));
    expect(saved.purchaseRequests.find((entry) => entry.id === created.request.id)?.timeline.map((entry) => entry.type))
      .toEqual(expect.arrayContaining([
        "request_submitted",
        "request_accepted",
        "buyer_evidence_uploaded",
        "payment_sent",
        "seller_confirmed_funds",
        "usdt_release_started",
        "usdt_sent",
        "trade_completed",
        "trade_locked",
        "review_unlocked",
        "commission_recorded",
      ]));
    expect((await getCommissionRecordsForAdmin()).filter((entry) => entry.purchaseRequestId === created.request.id))
      .toHaveLength(1);
  });

  it("enforces block, privacy, participant, report, and dispute protections", async () => {
    const { listing } = await createApprovedReviewListing();
    await setUserBlockStatus({ actorUserId: BUYER_ID, targetUserId: SELLER_ID, blocked: true });
    expect(await getMarketplaceListings(undefined, undefined, BUYER_ID)).toHaveLength(0);
    await expect(createPurchaseRequest(purchaseInput(listing.id))).rejects.toMatchObject({
      name: "TradeBlockedError",
      code: "USER_INTERACTION_BLOCKED",
    } satisfies Partial<TradeBlockedError>);

    await setUserBlockStatus({ actorUserId: BUYER_ID, targetUserId: SELLER_ID, blocked: false });
    const created = await createPurchaseRequest(purchaseInput(listing.id));
    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
    });

    const unsafeMessage = "Contact me on WhatsApp at +972 50 123 4567.";
    await expect(postTradeRoomMessage({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      clientMessageId: "33333333-3333-4333-8333-333333333333",
      message: unsafeMessage,
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    expect(JSON.stringify(snapshot().purchaseRequests)).not.toContain(unsafeMessage);

    await postTradeRoomMessage({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      clientMessageId: "44444444-4444-4444-8444-444444444444",
      message: "Please keep every update inside this protected Trade Room.",
    });
    await expect(getTradeRoomData({
      purchaseRequestId: created.request.id,
      actorUserId: OUTSIDER_ID,
      actorRole: "buyer",
    })).rejects.toThrow(/not allowed/i);

    const report = await reportSeller({
      reporterUserId: BUYER_ID,
      sellerId: SELLER_ID,
      purchaseRequestId: created.request.id,
      reason: "Fictional reviewer safety report for moderation verification.",
    });
    expect(report.purchaseRequestId).toBe(created.request.id);

    const buyerEvidence = await uploadTradeEvidence({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      side: "buyer",
      fileName: "fictional-dispute-proof.png",
      mimeType: "image/png",
      sizeBytes: 68,
      contentBase64: PNG_BASE64,
    });
    expect(buyerEvidence.request.status).toBe("payment_sent");
    const dispute = await openTradeDispute({
      purchaseRequestId: created.request.id,
      openedByUserId: BUYER_ID,
      reason: "Fictional payment confirmation requires moderator review.",
    });
    expect(dispute).toMatchObject({ purchaseRequestId: created.request.id, status: "open" });

    const buyerRoom = await getTradeRoomData({
      purchaseRequestId: created.request.id,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      markMessagesRead: false,
      strongConsistency: true,
    });
    expect(buyerRoom.hasOpenDispute).toBe(true);

    const saved = snapshot();
    expect(saved.sellerReports).toEqual([expect.objectContaining({ id: report.id, purchaseRequestId: created.request.id })]);
    expect(saved.notifications).toContainEqual(expect.objectContaining({ userId: OWNER_ID, title: "Dispute opened" }));
    expect(saved.purchaseRequests.find((entry) => entry.id === created.request.id)?.timeline)
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: "dispute_opened" })]));
    expect(saved.users.every((user) => user.email.endsWith("@example.test") && user.whatsappNumber === "")).toBe(true);
  });
});
