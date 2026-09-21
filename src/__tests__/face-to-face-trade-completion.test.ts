import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequestStatus, UserRole } from "@/types/alpha-exchange";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  adminOverrideMarketplaceListing,
  closePurchaseRequestManually,
  createPurchaseRequest,
  recalculateCardlessTradeAmount,
  sanitizePurchaseRequestForActor,
  forceCancelTradeByAdmin,
  forceCompleteTradeByAdmin,
  getTradeRoomData,
  invalidateAlphaExchangeStoreCache,
  submitBuyerTradeReview,
  submitSellerBuyerReview,
  updatePurchaseRequestStatus,
  uploadTradeEvidence,
} from "@/lib/alpha-exchange-store";
import { isBuyerEvidenceRequiredForPaymentMethod, isCashTradeCompletionAvailable, isCashTradeUsdtSentConfirmationAvailable, isFaceToFaceCompletionAvailable } from "@/lib/marketplace-payment-methods";

const SELLER_ID = "face-seller-1";
const NEXT_SELLER_ID = "face-seller-2";
const BUYER_ID = "face-buyer-1";
const OUTSIDER_ID = "face-outsider-1";
const OWNER_ID = "face-owner-1";
const FACE_TO_FACE = "Face-to-Face (Meet in Person)";

function createUser(id: string, role: "owner" | "buyer" | "approved_seller"): AlphaExchangeUser {
  const now = new Date().toISOString();
  const roles: UserRole[] = role === "owner" ? ["owner", "admin"] : [role];
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles,
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    sellerApprovalVerification: role === "approved_seller"
      ? createTestSellerApprovalVerification(now, OWNER_ID)
      : undefined,
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: [FACE_TO_FACE],
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
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
  } as AlphaExchangeUser;
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      createUser(SELLER_ID, "approved_seller"),
      createUser(BUYER_ID, "buyer"),
      createUser(OUTSIDER_ID, "buyer"),
      createUser(OWNER_ID, "owner"),
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
  } as AlphaExchangeDb & { __runtimeVersion: number };
}

function currentSnapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
}

function seedTrade(input: {
  requestId?: string;
  paymentMethod?: string;
  status?: PurchaseRequestStatus;
  amount?: string;
}) {
  const requestId = input.requestId ?? "face-request-1";
  const listingId = `listing-${requestId}`;
  const status = input.status ?? "accepted";
  const paymentMethod = input.paymentMethod ?? FACE_TO_FACE;
  const amount = input.amount ?? "250";
  const now = new Date().toISOString();
  const isActive = ["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(status);
  const snapshot = currentSnapshot();

  snapshot.marketplaceListings.push({
    id: listingId,
    sellerId: SELLER_ID,
    sellerDisplayName: "Face Seller",
    originalAmount: "1000",
    availableAmount: "1000",
    price: "3.20",
    currency: "ILS",
    network: "TRC20",
    paymentMethods: [paymentMethod],
    paymentMethod,
    minimumTrade: "50",
    maximumTrade: "1000",
    status: isActive ? (status === "accepted" ? "matched" : "in_trade") : "active",
    activeTradeRequestId: isActive ? requestId : undefined,
    lockedAt: isActive ? now : undefined,
    createdAt: now,
    updatedAt: now,
  } as never);
  snapshot.purchaseRequests.push({
    id: requestId,
    tradeId: `trade-${requestId}`,
    listingId,
    buyerId: BUYER_ID,
    buyerName: "Face Buyer",
    sellerId: SELLER_ID,
    usdtAmount: amount,
    fiatAmount: String(Number(amount) * 3.2),
    pricePerUsdt: "3.20",
    listingPriceAtRequest: "3.20",
    currency: "ILS",
    network: "TRC20",
    paymentMethod,
    status,
    sellerSafetyAcknowledged: true,
    timeline: [],
    createdAt: now,
    updatedAt: now,
  } as never);
  return { requestId, listingId };
}

function completeFaceToFace(actor: "buyer" | "seller") {
  return updatePurchaseRequestStatus({
    requestId: "face-request-1",
    actorUserId: actor === "seller" ? SELLER_ID : BUYER_ID,
    actorRole: actor === "seller" ? "approved_seller" : "buyer",
    nextStatus: "completed",
    completionMode: "face_to_face",
  });
}

describe("guided cash-trade completion", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  function readyRequest(overrides: Partial<Parameters<typeof createPurchaseRequest>[0]> = {}) {
    const { listingId } = seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "pending" });
    currentSnapshot().purchaseRequests = [];
    return createPurchaseRequest({ buyerId: BUYER_ID, actorUserId: BUYER_ID, listingId, buyerName: "Ready Buyer", usdtAmount: "125", buyerReceivingWalletAddress: "0x7088a120cde7351dbf3e7831a9da3f74058c89a0", receivingNetwork: "BEP20", paymentMethod: "Cardless ATM Withdrawal", cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth", cardlessVerificationValue: "25/08/1995", cardlessIlsAmount: "400", ...overrides });
  }

  it.each([
    { cardlessWithdrawalCode: "" }, { cardlessVerificationValue: "" }, { cardlessVerificationKind: "" },
    { cardlessIlsAmount: "" }, { cardlessIlsAmount: "540" }, { cardlessIlsAmount: "10001" }, { cardlessIlsAmount: "500" },
  ])("rejects an unprepared or mismatched cardless request before persisting (%j)", async (overrides) => {
    await expect(readyRequest(overrides)).rejects.toMatchObject({ code: "CARDLESS_DETAILS_REQUIRED" });
    expect(currentSnapshot().purchaseRequests).toHaveLength(0);
  });

  it("requires a wallet matching the buyer-selected network", async () => {
    await expect(readyRequest({ receivingNetwork: "TRC20" })).rejects.toThrow();
    expect(currentSnapshot().purchaseRequests).toHaveLength(0);
  });

  it("protects prepared details until acceptance, then reveals the wallet only after ATM cash collection", async () => {
    const { request } = await readyRequest();
    const seller = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    for (const actorUserId of [SELLER_ID, OUTSIDER_ID, OWNER_ID]) {
      const projected = sanitizePurchaseRequestForActor(request, actorUserId, "approved_seller");
      expect(JSON.stringify(projected)).not.toContain("482913");
      expect(JSON.stringify(projected)).not.toContain("1995-08-25");
      expect(projected.buyerReceivingWalletAddress).toBeUndefined();
    }
    expect(JSON.stringify(currentSnapshot())).not.toContain("482913");
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
    await expect(updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" })).resolves.toMatchObject({ statusChanged: false });
    let room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(room.request.network).toBe("BEP20");
    expect(room.request.status).toBe("payment_sent");
    expect(JSON.stringify(room.messages)).toContain("ILS amount: 400.00");
    expect(JSON.stringify(room.messages)).toContain("482913");
    expect(room.request.buyerReceivingWalletAddress).toBeUndefined();
    await expect(updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_sent" })).rejects.toThrow();
    await expect(updatePurchaseRequestStatus({ requestId: request.id, actorUserId: BUYER_ID, actorRole: "buyer", nextStatus: "cancelled" })).rejects.toThrow();
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
    room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(room.request.buyerReceivingWalletAddress).toBe(request.buyerReceivingWalletAddress);
    expect(JSON.stringify(room.messages)).not.toContain("482913");
    expect(JSON.stringify(currentSnapshot())).not.toContain("cardless:v1:");
  });

  it("repairs a legacy non-hundred cash amount at its saved listing price", async () => {
    const { request } = await readyRequest();
    const seller = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
    const persisted = currentSnapshot().purchaseRequests.find((item) => item.id === request.id)!;
    persisted.fiatAmount = "540";
    persisted.pricePerUsdt = "";
    persisted.listingPriceAtRequest = "3.2";
    invalidateAlphaExchangeStoreCache();
    await expect(recalculateCardlessTradeAmount({ ...seller, ilsAmount: "794" })).rejects.toThrow();
    const adjusted = await recalculateCardlessTradeAmount({ ...seller, ilsAmount: "500" });
    expect(adjusted).toMatchObject({ fiatAmount: "500.00", usdtAmount: "156.25", pricePerUsdt: "3.2" });
  });

  it("does not let the seller replace a prepared bank code's cash amount", async () => {
    const { request } = await readyRequest();
    const seller = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
    await expect(recalculateCardlessTradeAmount({ ...seller, ilsAmount: "500" })).rejects.toThrow("bank code amount cannot be changed");
    await expect(recalculateCardlessTradeAmount({ ...seller, ilsAmount: "400" })).resolves.toMatchObject({ usdtAmount: "125" });
  });

  it("recalculates seller USDT at the locked price and accounts once for simultaneous completion", async () => {
    const { request } = await readyRequest();
    const seller = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
    await expect(recalculateCardlessTradeAmount({ requestId: request.id, actorUserId: BUYER_ID })).rejects.toThrow();
    const persisted = currentSnapshot().purchaseRequests.find((item) => item.id === request.id)!;
    persisted.usdtAmount = "124.999";
    invalidateAlphaExchangeStoreCache();
    const adjusted = await recalculateCardlessTradeAmount(seller);
    expect(adjusted.usdtAmount).toBe("125");
    expect(adjusted.fiatAmount).toBe("400.00");
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_sent" });
    await expect(recalculateCardlessTradeAmount(seller)).rejects.toThrow();
    await Promise.all([
      updatePurchaseRequestStatus({ ...seller, nextStatus: "completed", completionMode: "cash_trade" }),
      updatePurchaseRequestStatus({ requestId: request.id, actorUserId: BUYER_ID, actorRole: "buyer", nextStatus: "completed" }),
    ]);
    expect(currentSnapshot().commissionRecords).toHaveLength(1);
    expect(currentSnapshot().commissionRecords[0].commissionAmount).toBe(1.25);
    expect(currentSnapshot().marketplaceListings[0].availableAmount).toBe("875");
  });

  it("saves independent seller and buyer reviews concurrently, with idempotent retries and participant checks", async () => {
    seedTrade({ status: "usdt_sent" });
    const sellerReview = { requestId: "face-request-1", sellerUserId: SELLER_ID, rating: 5, comment: "Prompt cash payment" };
    await expect(submitSellerBuyerReview(sellerReview)).rejects.toThrow(/completion/);
    await updatePurchaseRequestStatus({ requestId: "face-request-1", actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "completed", completionMode: "cash_trade" });
    await expect(submitSellerBuyerReview({ ...sellerReview, sellerUserId: BUYER_ID })).rejects.toThrow(/Only the seller/);
    await expect(submitSellerBuyerReview({ ...sellerReview, rating: 8 })).rejects.toThrow(/Rating/);
    await Promise.all([
      submitSellerBuyerReview(sellerReview),
      submitBuyerTradeReview({ requestId: "face-request-1", buyerUserId: BUYER_ID, rating: 5, comment: "Fast exchange" }),
    ]);
    invalidateAlphaExchangeStoreCache();
    const room = await getTradeRoomData({ purchaseRequestId: "face-request-1", actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(room.request.sellerBuyerReview).toMatchObject({ reviewerUserId: SELLER_ID, comment: "Prompt cash payment" });
    expect(room.request.buyerReview).toMatchObject({ reviewerUserId: BUYER_ID, comment: "Fast exchange" });
    await expect(submitSellerBuyerReview(sellerReview)).resolves.toMatchObject({ sellerBuyerReview: { reviewerUserId: SELLER_ID, rating: 5, comment: "Prompt cash payment", createdAt: room.request.sellerBuyerReview?.createdAt } });
    await expect(submitSellerBuyerReview({ ...sellerReview, comment: "Changed review" })).rejects.toThrow(/already submitted/);
    expect(currentSnapshot().commissionRecords).toHaveLength(1);
    await expect(closePurchaseRequestManually({ requestId: "face-request-1", actorUserId: SELLER_ID, actorRole: "approved_seller", reason: "other", explanation: "No trade happened" })).rejects.toThrow();
  });

  it("requires both withdrawal fields without advancing or exposing incomplete details", async () => {
    seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "accepted" });
    await expect(updatePurchaseRequestStatus({ requestId: "face-request-1", actorUserId: BUYER_ID, actorRole: "buyer", nextStatus: "payment_sent",
      cardlessWithdrawalCode: "482913", clientOperationId: "0123456789abcdef0123456789abcdef",
    })).rejects.toMatchObject({ code: "cardless-verification-required" });
    expect(currentSnapshot().purchaseRequests[0]?.status).toBe("accepted");
    expect(JSON.stringify(currentSnapshot())).not.toContain("482913");
  });

  it.each([
    ["id_number", "012345678", "ID number: 012345678"],
    ["date_of_birth", "29/02/1992", "Date of birth: 29/02/1992"],
  ])("protects %s together with the code and rejects a changed retry", async (kind, value, display) => {
    seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "accepted" });
    const input = { requestId: "face-request-1", actorUserId: BUYER_ID, actorRole: "buyer" as const, nextStatus: "payment_sent" as const,
      cardlessWithdrawalCode: "482913", cardlessVerificationKind: kind, cardlessVerificationValue: value,
      clientOperationId: "0123456789abcdef0123456789abcdef" };
    await updatePurchaseRequestStatus(input);
    const persisted = JSON.stringify(currentSnapshot());
    expect(persisted).not.toContain("482913");
    expect(persisted).not.toContain(value);
    expect((await updatePurchaseRequestStatus(input)).statusChanged).toBe(false);
    await expect(updatePurchaseRequestStatus({ ...input, cardlessVerificationValue: kind === "id_number" ? "112345678" : "28/02/1992" }))
      .rejects.toMatchObject({ code: "cardless-code-conflict" });
    const room = await getTradeRoomData({ purchaseRequestId: "face-request-1", actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(room.messages).toEqual(expect.arrayContaining([expect.objectContaining({ message: `Cardless withdrawal code: 482913\n${display}` })]));
    await expect(getTradeRoomData({ purchaseRequestId: "face-request-1", actorUserId: OUTSIDER_ID, actorRole: "buyer", markMessagesRead: false })).rejects.toThrow();
    await updatePurchaseRequestStatus({ requestId: "face-request-1", actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "funds_received" });
    const afterCash = await getTradeRoomData({ purchaseRequestId: "face-request-1", actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(JSON.stringify(afterCash.messages)).not.toContain("482913");
    expect(JSON.stringify(afterCash.messages)).not.toContain(value);
    expect(JSON.stringify(currentSnapshot())).not.toContain("cardless:v1:");
  });

  it("records USDT sent first, then lets only the seller complete the cash trade", async () => {
    const { listingId } = seedTrade({ status: "funds_received" });

    const sent = await updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "usdt_sent",
    });

    expect(sent.statusChanged).toBe(true);
    expect(sent.request).toMatchObject({
      status: "usdt_sent",
      buyerEvidence: undefined,
      sellerEvidence: undefined,
    });
    expect(sent.request.usdtSentAt).toBeTruthy();
    expect(sent.request.completedAt).toBeUndefined();
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
    expect(currentSnapshot().marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
      availableAmount: "1000",
      status: "in_trade",
      activeTradeRequestId: "face-request-1",
    });

    const result = await completeFaceToFace("seller");

    expect(result.statusChanged).toBe(true);
    expect(result.request).toMatchObject({
      status: "review_open",
      buyerEvidence: undefined,
      sellerEvidence: undefined,
    });
    expect(result.request.completedAt).toBeTruthy();
    expect(result.request.usdtSentAt).toBeTruthy();
    expect(result.request.lockedAt).toBeTruthy();
    expect(result.request.reviewUnlockedAt).toBeTruthy();

    const snapshot = currentSnapshot();
    expect(snapshot.marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
      availableAmount: "750",
      status: "active",
      activeTradeRequestId: undefined,
    });
    expect(snapshot.commissionRecords.filter((record) => record.purchaseRequestId === "face-request-1")).toHaveLength(1);
    expect(result.request.timeline.filter((event) => event.type === "trade_completed")).toEqual([
      expect.objectContaining({
        actorUserId: SELLER_ID,
        message: "Seller marked the Face-to-Face trade complete.",
      }),
    ]);
    expect(result.request.timeline.filter((event) => event.type === "usdt_sent")).toEqual([
      expect.objectContaining({ actorUserId: SELLER_ID, message: "Seller marked USDT sent" }),
    ]);
    expect(snapshot.auditLogs).toContainEqual(expect.objectContaining({
      action: "purchase_completed",
      actorUserId: SELLER_ID,
      details: expect.stringContaining("marked complete by Seller"),
    }));
    expect(snapshot.notifications).toContainEqual(expect.objectContaining({
      userId: BUYER_ID,
      title: "Face-to-Face trade completed",
      message: expect.stringContaining("Seller marked"),
    }));
  });

  it("blocks buyer completion even when a cash trade is ready for USDT", async () => {
    seedTrade({ status: "funds_received" });

    await expect(completeFaceToFace("buyer")).rejects.toMatchObject({
      code: "cash-trade-completion-participant-required",
      details: expect.objectContaining({ guard: "cash-trade-seller" }),
    });
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
  });

  it.each(["funds_received", "usdt_release_pending"] as const)(
    "requires explicit USDT-sent confirmation before seller completion from %s",
    async (status) => {
      seedTrade({ status });

      await expect(completeFaceToFace("seller")).rejects.toMatchObject({
        code: "cash-trade-completion-status-not-eligible",
      });
      expect(currentSnapshot().commissionRecords).toHaveLength(0);
    },
  );

  it("supports seller completion after the recorded USDT-sent stage", async () => {
    seedTrade({ status: "usdt_sent" });

    await expect(completeFaceToFace("seller")).resolves.toMatchObject({
      request: { status: "review_open" },
      statusChanged: true,
    });
  });

  it("keeps the buyer blocked during seller completion and then requires feedback", async () => {
    seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "usdt_sent" });
    const snapshot = currentSnapshot();
    const activeRequest = snapshot.purchaseRequests.find((request) => request.id === "face-request-1");
    if (activeRequest) activeRequest.buyerConfirmationArchivedAt = new Date().toISOString();
    snapshot.users.push(createUser(NEXT_SELLER_ID, "approved_seller"));
    snapshot.marketplaceListings.push({
      ...snapshot.marketplaceListings[0],
      id: "listing-next-cash-trade",
      sellerId: NEXT_SELLER_ID,
      sellerDisplayName: "Next Face Seller",
      status: "active",
      activeTradeRequestId: undefined,
      lockedAt: undefined,
    });

    const nextPurchase = () => createPurchaseRequest({
      buyerId: BUYER_ID,
      listingId: "listing-next-cash-trade",
      usdtAmount: "125",
      cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth", cardlessVerificationValue: "25/08/1995", cardlessIlsAmount: "400",
      buyerName: "Face Buyer",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      paymentMethod: "Cardless ATM Withdrawal",
      bankName: "Bank Hapoalim",
      actorUserId: BUYER_ID,
    });

    await expect(nextPurchase()).rejects.toMatchObject({ code: "ACTIVE_TRADE_EXISTS" });
    await completeFaceToFace("seller");
    await expect(nextPurchase()).rejects.toMatchObject({ code: "PENDING_BUYER_FEEDBACK" });

    await submitBuyerTradeReview({
      requestId: "face-request-1",
      buyerUserId: BUYER_ID,
      rating: 5,
      comment: "Clear and fast cash trade.",
    });
    await expect(nextPurchase()).resolves.toMatchObject({ request: { status: "pending" } });
  });

  it.each(["buyer", "approved_seller"] as const)("lets a %s buy from ten sellers consecutively immediately after each saved review", async (buyerRole) => {
    seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "pending" });
    const seed = currentSnapshot();
    const template = seed.marketplaceListings[0];
    seed.purchaseRequests = [];
    seed.marketplaceListings = [];
    const buyer = seed.users.find((item) => item.id === BUYER_ID)!;
    buyer.role = buyerRole;
    buyer.roles = [buyerRole];
    for (let i = 0; i < 11; i += 1) {
      const sellerId = `repeat-seller-${i}`;
      seed.users.push(createUser(sellerId, "approved_seller"));
      seed.marketplaceListings.push({ ...template, id: `repeat-listing-${i}`, sellerId, status: "active" });
    }
    const purchase = (i: number) => createPurchaseRequest({
      buyerId: BUYER_ID, actorUserId: BUYER_ID, listingId: `repeat-listing-${i}`,
      buyerName: "Repeat Buyer", buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      usdtAmount: "125", paymentMethod: "Cardless ATM Withdrawal", bankName: "Bank Hapoalim",
      cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth", cardlessVerificationValue: "25/08/1995", cardlessIlsAmount: "400",
    });
    for (let i = 0; i < 10; i += 1) {
      const { request: trade } = await purchase(i);
      const seller = { requestId: trade.id, actorUserId: `repeat-seller-${i}`, actorRole: "approved_seller" as const };
      await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
      const pendingProjection = sanitizePurchaseRequestForActor(trade, seller.actorUserId, seller.actorRole);
      expect(JSON.stringify(pendingProjection)).not.toContain("482913");
      const acceptedRoom = await getTradeRoomData({ purchaseRequestId: trade.id, actorUserId: seller.actorUserId, actorRole: seller.actorRole, markMessagesRead: false });
      expect(acceptedRoom.request.status).toBe("payment_sent");
      expect(acceptedRoom.request.buyerReceivingWalletAddress).toBeUndefined();
      expect(JSON.stringify(acceptedRoom.messages)).toContain("ILS amount: 400.00");
      await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
      await updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_sent" });
      const completed = await updatePurchaseRequestStatus(i % 2 === 0
        ? { ...seller, nextStatus: "completed", completionMode: "cash_trade" }
        : { requestId: trade.id, actorUserId: BUYER_ID, actorRole: buyerRole, nextStatus: "completed" });
      expect(completed.request.status).toBe("review_open");
      await expect(purchase(i + 1)).rejects.toMatchObject({ code: "PENDING_BUYER_FEEDBACK" });
      await Promise.all([
        completed.deferredTrustWrite?.(),
        submitBuyerTradeReview({ requestId: trade.id, buyerUserId: BUYER_ID, rating: 5, comment: `Completed trade ${i + 1}` }),
      ]);
    }
    // No refresh, delay, logout or owner intervention before the next purchase.
    await expect(purchase(10)).resolves.toMatchObject({ request: { status: "pending" } });
    const saved = currentSnapshot();
    expect(saved.purchaseRequests.filter((item) => item.buyerId === BUYER_ID && item.buyerReview)).toHaveLength(10);
    expect(saved.commissionRecords).toHaveLength(10);
  });

  it.each([FACE_TO_FACE, "Cardless ATM Withdrawal"])(
    "advances %s through buyer and seller confirmations without evidence",
    async (paymentMethod) => {
      seedTrade({ paymentMethod, status: "accepted" });

      const buyerConfirmed = await updatePurchaseRequestStatus({
        requestId: "face-request-1",
        actorUserId: BUYER_ID,
        actorRole: "buyer",
        nextStatus: "payment_sent",
        ...(paymentMethod === "Cardless ATM Withdrawal" ? {
          cardlessWithdrawalCode: "482913",
      cardlessVerificationKind: "id_number",
      cardlessVerificationValue: "012345678",
          clientOperationId: "0123456789abcdef0123456789abcdef",
        } : {}),
      });
      expect(buyerConfirmed.request).toMatchObject({
        status: "payment_sent",
        buyerEvidence: undefined,
      });

      const sellerConfirmed = await updatePurchaseRequestStatus({
        requestId: "face-request-1",
        actorUserId: SELLER_ID,
        actorRole: "approved_seller",
        nextStatus: "funds_received",
      });
      expect(sellerConfirmed.request).toMatchObject({
        status: "funds_received",
        sellerEvidence: undefined,
      });
      expect(sellerConfirmed.request.timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "payment_sent", actorUserId: BUYER_ID }),
        expect.objectContaining({ type: "seller_confirmed_funds", actorUserId: SELLER_ID }),
      ]));

      const sellerConfirmedUsdt = await updatePurchaseRequestStatus({
        requestId: "face-request-1",
        actorUserId: SELLER_ID,
        actorRole: "approved_seller",
        nextStatus: "usdt_sent",
      });
      expect(sellerConfirmedUsdt.request).toMatchObject({
        status: "usdt_sent",
        buyerEvidence: undefined,
        sellerEvidence: undefined,
      });
      expect(sellerConfirmedUsdt.request.completedAt).toBeUndefined();
      expect(currentSnapshot().commissionRecords).toHaveLength(0);
    },
  );

  it.each([FACE_TO_FACE, "Cardless ATM Withdrawal"])(
    "rejects photo evidence for %s at the server boundary",
    async (paymentMethod) => {
      seedTrade({ paymentMethod, status: "accepted" });

      await expect(uploadTradeEvidence({
        purchaseRequestId: "face-request-1",
        actorUserId: BUYER_ID,
        actorRole: "buyer",
        side: "buyer",
        fileName: "unneeded-proof.png",
        mimeType: "image/png",
        sizeBytes: 1,
        contentBase64: "AA==",
      })).rejects.toThrow("Photo evidence is not used");
      expect(currentSnapshot().tradeEvidenceFiles).toHaveLength(0);
    },
  );

  it("does not weaken or skip the Bank Transfer evidence lifecycle", async () => {
    seedTrade({ paymentMethod: "Bank Transfer", status: "funds_received" });
    expect(isBuyerEvidenceRequiredForPaymentMethod("Bank Transfer")).toBe(true);

    await expect(completeFaceToFace("seller")).rejects.toMatchObject({
      code: "cash-trade-completion-payment-method-required",
    });
    await expect(updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "usdt_sent",
    })).rejects.toMatchObject({ code: "invalid-status-transition" });

    await updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "usdt_release_pending",
    });
    const sent = await updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "usdt_sent",
    });
    expect(sent.request.status).toBe("usdt_sent");
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
    expect(currentSnapshot().marketplaceListings[0]).toMatchObject({ availableAmount: "1000" });
  });

  it("lets only the seller complete Cardless ATM after separately confirming USDT sent", async () => {
      const requestId = "cardless-request-seller";
      const { listingId } = seedTrade({
        requestId,
        paymentMethod: "Cardless ATM Withdrawal",
        status: "usdt_sent",
      });

      const result = await updatePurchaseRequestStatus({
        requestId,
        actorUserId: SELLER_ID,
        actorRole: "approved_seller",
        nextStatus: "completed",
        completionMode: "cash_trade",
      });

      expect(result.request.status).toBe("review_open");
      expect(currentSnapshot().commissionRecords.filter((record) => record.purchaseRequestId === requestId)).toHaveLength(1);
      expect(currentSnapshot().marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
        availableAmount: "750",
        activeTradeRequestId: undefined,
      });
      expect(result.request.timeline).toContainEqual(expect.objectContaining({
        type: "trade_completed",
        actorUserId: SELLER_ID,
        message: "Seller marked the Cardless ATM trade complete.",
      }));
  });

  it("keeps Cardless ATM cancellable before buyer confirmation but blocks early seller completion", async () => {
    const { listingId } = seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "accepted" });

    await expect(updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: SELLER_ID,
      actorRole: "approved_seller",
      nextStatus: "completed",
      completionMode: "cash_trade",
    })).rejects.toMatchObject({ code: "cash-trade-completion-status-not-eligible" });
    expect(currentSnapshot().commissionRecords).toHaveLength(0);

    const cancelled = await updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      nextStatus: "cancelled",
    });
    expect(cancelled.request.status).toBe("cancelled");
    expect(currentSnapshot().marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
      status: "active",
      activeTradeRequestId: undefined,
    });
  });

  it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)(
  "blocks participant and admin cancellation once cash-trade progress reaches %s",
  async (status) => {
    const { requestId, listingId } = seedTrade({
      paymentMethod: "Cardless ATM Withdrawal",
      status,
    });

    await expect(updatePurchaseRequestStatus({
      requestId,
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      nextStatus: "cancelled",
    })).rejects.toMatchObject({ code: "invalid-status-transition" });
    await expect(forceCancelTradeByAdmin({
      requestId,
      actorUserId: OWNER_ID,
      reason: "Attempted force cancellation after payment started.",
    })).rejects.toThrow("cannot be force-closed");
    await expect(closePurchaseRequestManually({
      requestId,
      actorUserId: OWNER_ID,
      actorRole: "owner",
      reason: "Attempted manual cancellation",
    })).rejects.toThrow("cannot be force-closed");
    await expect(adminOverrideMarketplaceListing({
      listingId,
      adminUserId: OWNER_ID,
      action: "force_close",
      reason: "Attempted listing force-close after payment started.",
    })).rejects.toThrow("cannot be force-closed");

    expect(currentSnapshot().purchaseRequests.find((request) => request.id === requestId)?.status).toBe(status);
    expect(currentSnapshot().marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
      status: "in_trade",
      activeTradeRequestId: requestId,
    });
  });

  it("lets an admin cancel an accepted trade only before payment starts and reopens the listing", async () => {
    const { requestId, listingId } = seedTrade({
      requestId: "admin-cancel-before-payment",
      paymentMethod: "Cardless ATM Withdrawal",
      status: "accepted",
    });

    const cancelled = await forceCancelTradeByAdmin({
      requestId,
      actorUserId: OWNER_ID,
      reason: "No participant action occurred after acceptance.",
    });

    expect(cancelled.status).toBe("cancelled");
    expect(currentSnapshot().marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
      status: "active",
      activeTradeRequestId: undefined,
    });
    expect(currentSnapshot().notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: BUYER_ID, title: "Trade cancelled by admin" }),
      expect.objectContaining({ userId: SELLER_ID, title: "Trade cancelled by admin" }),
    ]));
  });

  it("uses the canonical completion lifecycle when an admin confirms a completed trade", async () => {
    const { requestId, listingId } = seedTrade({
      requestId: "admin-completed-cardless",
      paymentMethod: "Cardless ATM Withdrawal",
      status: "funds_received",
      amount: "250",
    });

    const completed = await forceCompleteTradeByAdmin({
      requestId,
      actorUserId: OWNER_ID,
      reason: "Both participants confirmed the off-platform exchange was completed.",
    });

    expect(completed.status).toBe("review_open");
    expect(currentSnapshot().commissionRecords.filter((record) => record.purchaseRequestId === requestId))
      .toEqual([expect.objectContaining({ sellerId: SELLER_ID, commissionAmount: 2.5, paymentStatus: "pending" })]);
    expect(currentSnapshot().marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
      availableAmount: "750",
      status: "active",
      activeTradeRequestId: undefined,
    });
    expect(completed.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "trade_completed", actorUserId: OWNER_ID, message: "Admin force-completed this trade." }),
      expect.objectContaining({ type: "commission_recorded", actorUserId: OWNER_ID }),
    ]));
    expect(currentSnapshot().auditLogs).toContainEqual(expect.objectContaining({
      action: "purchase_completed",
      actorUserId: OWNER_ID,
      reason: "Both participants confirmed the off-platform exchange was completed.",
      details: expect.stringContaining("seller commission recorded"),
    }));
  });

  it("lets the buyer confirm cash-trade receipt after seller USDT confirmation", async () => {
    seedTrade({ status: "usdt_sent" });

    await expect(updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      nextStatus: "completed",
    })).resolves.toMatchObject({ request: { status: "review_open" } });
  });

  it.each(["pending", "declined", "cancelled"] as const)(
    "rejects completion while a Face-to-Face trade is %s",
    async (status) => {
      seedTrade({ status });

      await expect(completeFaceToFace("seller")).rejects.toMatchObject({
        code: "cash-trade-completion-status-not-eligible",
      });
    },
  );

  it("allows only the trade seller, including when a privileged user is not part of the trade", async () => {
    seedTrade({ status: "funds_received" });

    await expect(updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: OUTSIDER_ID,
      actorRole: "buyer",
      nextStatus: "completed",
      completionMode: "face_to_face",
    })).rejects.toMatchObject({ code: "actor-not-allowed" });

    await expect(updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: OWNER_ID,
      actorRole: "owner",
      nextStatus: "completed",
      completionMode: "face_to_face",
    })).rejects.toMatchObject({ code: "cash-trade-completion-participant-required" });
  });

  it("serializes a seller double-click into one trade, one listing deduction, and one commission", async () => {
    const { listingId } = seedTrade({ status: "usdt_sent" });

    const results = await Promise.all([
      completeFaceToFace("seller"),
      completeFaceToFace("seller"),
    ]);

    expect(results.filter((result) => result.statusChanged)).toHaveLength(1);
    expect(results.filter((result) => !result.statusChanged)).toHaveLength(1);
    expect(results.every((result) => result.request.status === "review_open")).toBe(true);

    const snapshot = currentSnapshot();
    const request = snapshot.purchaseRequests.find((candidate) => candidate.id === "face-request-1");
    expect(request?.timeline.filter((event) => event.type === "trade_completed")).toHaveLength(1);
    expect(snapshot.commissionRecords.filter((record) => record.purchaseRequestId === "face-request-1")).toHaveLength(1);
    expect(snapshot.marketplaceListings.find((listing) => listing.id === listingId)).toMatchObject({
      availableAmount: "750",
      activeTradeRequestId: undefined,
      status: "active",
    });
  });

  it("separates cash USDT confirmation availability from completion availability", () => {
    expect(isFaceToFaceCompletionAvailable("meet in person", "accepted")).toBe(false);
    expect(isFaceToFaceCompletionAvailable(FACE_TO_FACE, "payment_sent")).toBe(false);
    expect(isFaceToFaceCompletionAvailable(FACE_TO_FACE, "funds_received")).toBe(false);
    expect(isFaceToFaceCompletionAvailable(FACE_TO_FACE, "usdt_sent")).toBe(true);
    expect(isFaceToFaceCompletionAvailable(FACE_TO_FACE, "pending")).toBe(false);
    expect(isFaceToFaceCompletionAvailable("Bank Transfer", "accepted")).toBe(false);
    expect(isCashTradeCompletionAvailable("Cardless ATM Withdrawal", "accepted")).toBe(false);
    expect(isCashTradeCompletionAvailable("Cardless ATM Withdrawal", "funds_received")).toBe(false);
    expect(isCashTradeCompletionAvailable("Cardless ATM Withdrawal", "usdt_sent")).toBe(true);
    expect(isCashTradeCompletionAvailable("Bank Transfer", "usdt_sent")).toBe(false);
    expect(isCashTradeUsdtSentConfirmationAvailable(FACE_TO_FACE, "funds_received")).toBe(true);
    expect(isCashTradeUsdtSentConfirmationAvailable("Cardless ATM Withdrawal", "usdt_release_pending")).toBe(true);
    expect(isCashTradeUsdtSentConfirmationAvailable("Cardless ATM Withdrawal", "usdt_sent")).toBe(false);
    expect(isCashTradeUsdtSentConfirmationAvailable("Bank Transfer", "funds_received")).toBe(false);
  });
});
