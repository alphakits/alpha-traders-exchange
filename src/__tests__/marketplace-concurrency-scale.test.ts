import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, SellerStatus, UserRole } from "@/types/alpha-exchange";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";
import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";

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
  getTradeRoomData,
  invalidateAlphaExchangeStoreCache,
  postTradeRoomMessage,
  reviewMarketplaceListingByOwner,
  recalculateCardlessTradeAmount,
  submitBuyerTradeReview,
  submitSellerBuyerReview,
  submitSellerReviewResponse,
  updateTradeTerms,
  updatePurchaseRequestStatus,
  uploadTradeEvidence,
} from "@/lib/alpha-exchange-store";

const OWNER_ID = "scale-owner";
const SELLER_IDS = Array.from({ length: 15 }, (_, index) => `scale-seller-${index + 1}`);
const BUYER_IDS = Array.from({ length: 75 }, (_, index) => `scale-buyer-${index + 1}`);
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
  const sellerSequence = Number(id.match(/\d+$/)?.[0] ?? "1");
  const accountNumber = String(1_000_000_000 + sellerSequence);
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "hash",
    whatsappNumber: `+97250${id.replace(/\D/g, "").padStart(7, "0")}`,
    role,
    roles,
    sellerStatus,
    sellerApprovalVerification: role === "approved_seller"
      ? createTestSellerApprovalVerification(now, OWNER_ID)
      : undefined,
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
    sellerBankAccounts: role === "approved_seller" ? [{
      id: `seller-bank-${id}-hapoalim`,
      sellerId: id,
      accountHolderName: `Scale Seller ${sellerSequence}`,
      bankName: "Bank Hapoalim",
      branchNumber: "123",
      accountNumber,
      accountLast4: accountNumber.slice(-4),
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }] : undefined,
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

async function createApprovedListing(sellerId: string, index: number, paymentMethod = "Bank Transfer") {
  const listing = await createMarketplaceListing({
    sellerId,
    sellerDisplayName: `Scale Seller ${index + 1}`,
    availableAmount: "500",
    price: (3.20 + index / 100).toFixed(2),
    currency: "ILS",
    network: "TRC20",
    paymentMethods: [paymentMethod],
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

describe("marketplace concurrency at fifteen-seller scale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, reason: null });
  });

  it("settles fifteen mixed-method trades with seventy-five competing buyers, corrected amounts and duplicate clicks", async () => {
    const methods = ["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"];
    const listings = await Promise.all(SELLER_IDS.map((sellerId, index) => createApprovedListing(sellerId, index, methods[index % methods.length])));
    const submissions = await Promise.all(BUYER_IDS.map((buyerId, index) => {
      const listing = listings[Math.floor(index / 5)];
      const paymentMethod = methods[Math.floor(index / 5) % methods.length];
      const cardless = paymentMethod === "Cardless ATM Withdrawal";
      return createPurchaseRequest({
        buyerId, listingId: listing.id, actorUserId: buyerId, buyerName: buyerId,
        buyerReceivingWalletAddress: WALLET, paymentMethod, bankName: "Bank Hapoalim",
        usdtAmount: cardless ? calculateCardlessUsdtAmount("300", listing.price)! : "100",
        safetyAcknowledged: true,
        ...(cardless ? { cardlessWithdrawalCode: "482913", cardlessVerificationKind: "id_number", cardlessVerificationValue: "012345678", cardlessIlsAmount: "300" } : {}),
      });
    }));
    const acceptances = await Promise.allSettled(submissions.map(({ request }) => updatePurchaseRequestStatus({
      requestId: request.id, actorUserId: request.sellerId, actorRole: "approved_seller", nextStatus: "accepted", safetyAcknowledged: true,
    })));
    expect(acceptances.filter((result) => result.status === "fulfilled")).toHaveLength(15);
    const acceptedSnapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const winners = acceptedSnapshot.purchaseRequests.filter((request) => ["accepted", "payment_sent"].includes(request.status));
    expect(winners).toHaveLength(15);
    expect(new Set(winners.map((request) => request.listingId)).size).toBe(15);
    expect(acceptedSnapshot.purchaseRequests.filter((request) => request.status === "declined")).toHaveLength(60);

    await Promise.all(winners.map(async (initial, index) => {
      const buyer = { actorUserId: initial.buyerId, actorRole: "buyer" as const };
      const seller = { actorUserId: initial.sellerId, actorRole: "approved_seller" as const };
      const cardless = initial.paymentMethod === "Cardless ATM Withdrawal";
      const bank = initial.paymentMethod === "Bank Transfer";
      const beforePayment = await getTradeRoomData({ purchaseRequestId: initial.id, ...seller, markMessagesRead: false });
      expect(beforePayment.request.buyerReceivingWalletAddress).toBeUndefined();
      let request = initial;
      if (cardless) {
        request = await recalculateCardlessTradeAmount({ requestId: initial.id, actorUserId: seller.actorUserId, ilsAmount: "300" });
        expect(request.usdtAmount).toBe(calculateCardlessUsdtAmount("300", request.pricePerUsdt!));
      } else {
        const proposal = await updateTradeTerms({ requestId: initial.id, actorUserId: seller.actorUserId, action: "propose_amount", value: "150", expectedUpdatedAt: initial.updatedAt });
        expect(proposal.usdtAmount).toBe("100");
        request = await updateTradeTerms({ requestId: initial.id, actorUserId: buyer.actorUserId, action: "accept_amount", proposalId: proposal.termsProposal!.id });
        expect(request.usdtAmount).toBe("150");
      }
      const messages = [
        { purchaseRequestId: request.id, actorUserId: buyer.actorUserId, clientMessageId: clientMessageId("buyer", index), message: "Fictional buyer confirmed the terms." },
        { purchaseRequestId: request.id, actorUserId: seller.actorUserId, clientMessageId: clientMessageId("seller", index), message: "Fictional seller confirmed the terms." },
      ];
      await Promise.all([...messages, ...messages].map((message) => postTradeRoomMessage(message)));
      if (bank) {
        await uploadTradeEvidence({ purchaseRequestId: request.id, ...buyer, side: "buyer", fileName: "fictional-receipt.png", mimeType: "image/png", sizeBytes: 68, contentBase64: PNG_BASE64 });
      } else if (!cardless) {
        await updatePurchaseRequestStatus({ requestId: request.id, ...buyer, nextStatus: "payment_sent" });
      }
      await updatePurchaseRequestStatus({ requestId: request.id, ...seller, nextStatus: "funds_received" });
      const paidRoom = await getTradeRoomData({ purchaseRequestId: request.id, ...seller, markMessagesRead: false });
      expect(paidRoom.request.buyerReceivingWalletAddress).toBe(WALLET);
      expect(JSON.stringify(paidRoom)).not.toContain("482913");
      if (bank) {
        await updatePurchaseRequestStatus({ requestId: request.id, ...seller, nextStatus: "usdt_release_pending" });
        await uploadTradeEvidence({ purchaseRequestId: request.id, ...seller, side: "seller", fileName: "fictional-transfer.png", mimeType: "image/png", sizeBytes: 68, contentBase64: PNG_BASE64 });
      } else if (cardless) {
        await updatePurchaseRequestStatus({ requestId: request.id, ...seller, nextStatus: "usdt_sent" });
      }
      const complete = { requestId: request.id, ...seller, nextStatus: "completed" as const, completionMode: "seller" as const, usdtSentConfirmed: true };
      const completions = await Promise.all([updatePurchaseRequestStatus(complete), updatePurchaseRequestStatus(complete)]);
      expect(completions.filter((completion) => completion.statusChanged)).toHaveLength(1);
      for (const completion of completions) await completion.deferredTrustWrite?.();
      await Promise.all([
        submitBuyerTradeReview({ requestId: request.id, buyerUserId: buyer.actorUserId, rating: 5, comment: "Fictional buyer review." }),
        submitSellerBuyerReview({ requestId: request.id, sellerUserId: seller.actorUserId, rating: 5, comment: "Fictional seller review." }),
      ]);
    }));

    invalidateAlphaExchangeStoreCache();
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const completed = snapshot.purchaseRequests.filter((request) => request.status === "review_open");
    expect(completed).toHaveLength(15);
    expect(snapshot.commissionRecords).toHaveLength(15);
    expect(new Set(snapshot.commissionRecords.map((record) => record.paymentExpectedAmount)).size).toBe(15);
    for (const request of completed) {
      expect(request.messages?.filter((message) => message.kind === "user" && !message.credentialKind)).toHaveLength(2);
      expect(request.timeline.filter((entry) => entry.type === "trade_completed")).toHaveLength(1);
      expect(request.buyerReview?.rating).toBe(5);
      expect(request.sellerBuyerReview?.rating).toBe(5);
      const listing = snapshot.marketplaceListings.find((entry) => entry.id === request.listingId)!;
      expect(listing.status).toBe("active");
      expect(listing.activeTradeRequestId).toBeUndefined();
      expect(Number(listing.availableAmount)).toBeCloseTo(500 - Number(request.usdtAmount), 6);
      const commissions = snapshot.commissionRecords.filter((record) => record.purchaseRequestId === request.id);
      expect(commissions).toHaveLength(1);
      expect(commissions[0].commissionAmount).toBeCloseTo(Number(request.usdtAmount) * 0.01, 2);
    }
  }, 60_000);

  it("preserves fifteen concurrent seller-buyer trade openings and every linked notification", async () => {
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

    expect(acceptances).toHaveLength(SELLER_IDS.length);
    expect(acceptances.every((result) => result.request.status === "accepted")).toBe(true);

    invalidateAlphaExchangeStoreCache();
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const requestIds = new Set(submissions.map((submission) => submission.request.id));
    const committedRequests = snapshot.purchaseRequests.filter((request) => requestIds.has(request.id));
    const committedListings = snapshot.marketplaceListings.filter((listing) => listings.some((created) => created.id === listing.id));

    expect(committedRequests).toHaveLength(SELLER_IDS.length);
    expect(new Set(committedRequests.map((request) => request.id)).size).toBe(SELLER_IDS.length);
    expect(new Set(committedRequests.map((request) => request.tradeId)).size).toBe(SELLER_IDS.length);
    expect(committedRequests.every((request) => request.status === "accepted")).toBe(true);
    expect(committedListings).toHaveLength(SELLER_IDS.length);
    expect(committedListings.every((listing) => listing.status === "matched")).toBe(true);
    for (const listing of committedListings) {
      const request = committedRequests.find((candidate) => candidate.listingId === listing.id);
      expect(listing.activeTradeRequestId).toBe(request?.id);
    }
    expect(snapshot.auditLogs.filter((entry) =>
      entry.action === "listing_matched"
      && Boolean(entry.purchaseRequestId)
      && requestIds.has(entry.purchaseRequestId!),
    )).toHaveLength(SELLER_IDS.length);

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

  it("commits one winner when seventy-five buyers race to have their request accepted", async () => {
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

    expect(requests).toHaveLength(BUYER_IDS.length);
    expect(accepted).toHaveLength(1);
    expect(declined).toHaveLength(BUYER_IDS.length - 1);
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

  it("preserves fifteen simultaneous complete trade lifecycles, reviews, commissions, and reopened listings", async () => {
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
    const commissions = (await getCommissionRecordsForAdmin()).filter((record) => (
      record.purchaseRequestId ? requestIds.has(record.purchaseRequestId) : false
    ));

    expect(completedRequests).toHaveLength(SELLER_IDS.length);
    expect(completedRequests.every((request) => request.status === "review_open")).toBe(true);
    expect(completedListings).toHaveLength(SELLER_IDS.length);
    expect(completedListings.every((listing) => (
      listing.status === "active"
      && listing.activeTradeRequestId === undefined
      && listing.availableAmount === "400"
    ))).toBe(true);
    expect(commissions).toHaveLength(SELLER_IDS.length);
    expect(new Set(commissions.map((record) => record.purchaseRequestId))).toEqual(requestIds);
    expect(commissions.every((record) => record.paymentStatus === "pending" && record.commissionAmount === 1)).toBe(true);
    expect(new Set(commissions.map((record) => record.paymentExpectedAmount)).size).toBe(SELLER_IDS.length);
    expect(commissions.every((record) => (
      record.paymentExpectedAmountMode === "unique_v1"
      && typeof record.paymentExpectedAmountAssignedAt === "string"
    ))).toBe(true);

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
