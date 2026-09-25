import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  updateTradeTerms,
  sanitizePurchaseRequestForActor,
  forceCancelTradeByAdmin,
  forceCompleteTradeByAdmin,
  forceCloseTradeByOwner,
  unlockTradeReviewByAdmin,
  getTradeRoomData,
  getSellerCommissionStatus,
  getMarketplaceListings,
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
    bankName: paymentMethod === "Cardless ATM Withdrawal" ? "Bank Hapoalim, Bank Leumi" : undefined,
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
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("lets the face-to-face seller confirm full cash directly, reveal the wallet, and complete exactly once", async () => {
    const { requestId } = seedTrade({ status: "accepted" });
    const original = currentSnapshot().purchaseRequests[0];
    original.feePolicyVersion = "buyer_seller_1pct_v1";
    original.fiatAmount = "808.00";
    original.buyerReceivingWalletAddress = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
    const seller = { requestId, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    expect(sanitizePurchaseRequestForActor(original, SELLER_ID, "approved_seller").buyerReceivingWalletAddress).toBeUndefined();
    await Promise.all([
      updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" }),
      updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" }),
    ]);
    const received = currentSnapshot().purchaseRequests[0];
    expect(received).toMatchObject({ status: "funds_received", fiatAmount: "808.00", usdtAmount: "250" });
    expect(received.paymentSentAt).toBeTruthy();
    expect(received.timeline.filter(event => event.type === "seller_confirmed_funds")).toHaveLength(1);
    expect(sanitizePurchaseRequestForActor(received, SELLER_ID, "approved_seller").buyerReceivingWalletAddress).toBe(original.buyerReceivingWalletAddress);
    await expect(updatePurchaseRequestStatus({ ...seller, nextStatus: "cancelled" })).rejects.toThrow();
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "completed", completionMode: "seller", usdtSentConfirmed: true });
    expect(currentSnapshot().purchaseRequests[0].status).toBe("review_open");
    expect(currentSnapshot().commissionRecords).toHaveLength(1);
    expect(currentSnapshot().commissionRecords[0].commissionAmount).toBe(5);
  });

  it.each(["Bank Transfer", "Cardless ATM Withdrawal"])("does not skip the buyer payment stage for %s", async paymentMethod => {
    const { requestId } = seedTrade({ paymentMethod, status: "accepted" });
    await expect(updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "funds_received" })).rejects.toMatchObject({ code: "invalid-status-transition" });
    expect(currentSnapshot().purchaseRequests[0].status).toBe("accepted");
  });

  it("keeps three shared-listing trades safe and visible while unpaid fees block every new acceptance", async () => {
    const { listingId } = seedTrade({ status: "pending", amount: "100" });
    const db = currentSnapshot();
    const template = db.purchaseRequests[0];
    template.feePolicyVersion = "buyer_seller_1pct_v1";
    for (let index = 1; index < 4; index++) {
      const buyerId = `capacity-buyer-${index}`;
      db.users.push(createUser(buyerId, "buyer"));
      db.purchaseRequests.push({ ...structuredClone(template), id: `capacity-${index}`, tradeId: `capacity-trade-${index}`, buyerId });
    }
    const ids = db.purchaseRequests.map(request => request.id);
    await Promise.all(ids.slice(0, 3).map(requestId => updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "accepted" })));
    await expect(updatePurchaseRequestStatus({ requestId: ids[3], actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "accepted" })).rejects.toMatchObject({ code: "SELLER_TRADE_LIMIT" });
    let cards = await getMarketplaceListings("active", currentSnapshot());
    expect(cards.find(card => card.id === listingId)).toMatchObject({ sellerActiveTradeCount: 3, availableAmount: "700", newRequestBlockReason: "trade_limit" });
    for (const requestId of ids.slice(0, 3)) {
      const request = currentSnapshot().purchaseRequests.find(item => item.id === requestId)!;
      await updatePurchaseRequestStatus({ requestId, actorUserId: request.buyerId, actorRole: "buyer", nextStatus: "payment_sent" });
      await updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "funds_received" });
      await updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "completed", completionMode: "seller", usdtSentConfirmed: true });
      await expect(updatePurchaseRequestStatus({ requestId: ids[3], actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "accepted" })).rejects.toMatchObject({ code: "commission-due" });
      cards = await getMarketplaceListings("active", currentSnapshot());
      expect(cards.find(card => card.id === listingId)?.newRequestBlockReason).toBe("commission_due");
    }
    expect(currentSnapshot().marketplaceListings.find(item => item.id === listingId)).toMatchObject({ availableAmount: "700", status: "active", activeTradeRequestId: undefined });
    expect(currentSnapshot().commissionRecords).toHaveLength(3);
    expect(currentSnapshot().commissionRecords.every(record => record.commissionAmount === 2)).toBe(true);
  });

  it.each([FACE_TO_FACE, "Bank Transfer"])("requires buyer approval for an inclusive ILS correction in %s", async paymentMethod => {
    seedTrade({ paymentMethod, status: "funds_received" });
    const original = currentSnapshot().purchaseRequests[0];
    original.feePolicyVersion = "buyer_seller_1pct_v1";
    const proposed = await updateTradeTerms({ requestId: original.id, actorUserId: SELLER_ID, action: "propose_ils_amount", value: "404", expectedUpdatedAt: original.updatedAt });
    expect(proposed.usdtAmount).toBe("250");
    expect(proposed.termsProposal).toMatchObject({ usdtAmount: "125", fiatAmount: "404.00", status: "pending" });
    const accepted = await updateTradeTerms({ requestId: original.id, actorUserId: BUYER_ID, action: "accept_amount", proposalId: proposed.termsProposal!.id });
    expect(accepted).toMatchObject({ usdtAmount: "125", fiatAmount: "404.00", feePolicyVersion: "buyer_seller_1pct_v1" });
  });

  it("refuses a correction that consumes another active trade's reserved inventory", async () => {
    const { listingId } = seedTrade({ status: "funds_received", amount: "200" });
    const original = currentSnapshot().purchaseRequests[0];
    currentSnapshot().purchaseRequests.push({ ...structuredClone(original), id: "reserved-other", buyerId: OUTSIDER_ID, listingId, usdtAmount: "700" });
    await expect(updateTradeTerms({ requestId: original.id, actorUserId: SELLER_ID, action: "propose_ils_amount", value: "1280", expectedUpdatedAt: original.updatedAt })).rejects.toMatchObject({ code: "trade-terms-invalid" });
  });

  it.each([FACE_TO_FACE, "Bank Transfer", "Cardless ATM Withdrawal"])("settles an acknowledged two-sided fee exactly once for %s", async (paymentMethod) => {
    const { requestId } = seedTrade({ paymentMethod, status: "usdt_sent" });
    const request = currentSnapshot().purchaseRequests.find(item => item.id === requestId)!;
    request.feePolicyVersion = "buyer_seller_1pct_v1";
    request.fiatAmount = "808.00";
    invalidateAlphaExchangeStoreCache();
    const command = { requestId, actorUserId: SELLER_ID, actorRole: "approved_seller" as const, nextStatus: "completed" as const, completionMode: "seller" as const, usdtSentConfirmed: true };
    await Promise.all([updatePurchaseRequestStatus(command), updatePurchaseRequestStatus(command)]);
    expect(currentSnapshot().commissionRecords.filter(record => record.purchaseRequestId === requestId)).toEqual([
      expect.objectContaining({ feePolicyVersion: "buyer_seller_1pct_v1", sellerFeeAmount: 2.5, buyerFeeCollectedAmount: 2.5, commissionAmount: 5, paymentStatus: "pending" }),
    ]);
    // Failure to collect the buyer share must not reduce the seller's debt.
    const commission = currentSnapshot().commissionRecords[0];
    commission.buyerFeeCollectedAmount = 0;
    commission.commissionAmount = 2.5;
    invalidateAlphaExchangeStoreCache();
    expect(await getSellerCommissionStatus(SELLER_ID)).toMatchObject({ amountDue: 5, status: "pending" });
  });

  it.each([
    [FACE_TO_FACE, "funds_received"],
    [FACE_TO_FACE, "usdt_release_pending"],
    ["Bank Transfer", "usdt_sent"],
    ["Cardless ATM Withdrawal", "usdt_sent"],
  ] as const)("settles %s from %s on the seller's confirmation exactly once", async (paymentMethod, status) => {
    const { requestId, listingId } = seedTrade({ paymentMethod, status });
    const command = { requestId, actorUserId: SELLER_ID, actorRole: "approved_seller" as const,
      nextStatus: "completed" as const, completionMode: "seller" as const, usdtSentConfirmed: true };
    const results = await Promise.all([updatePurchaseRequestStatus(command), updatePurchaseRequestStatus(command)]);
    expect(results.filter(result => result.statusChanged)).toHaveLength(1);
    expect(results.every(result => result.request.status === "review_open")).toBe(true);
    const snapshot = currentSnapshot();
    const saved = snapshot.purchaseRequests.find(request => request.id === requestId)!;
    expect(saved.completedAt).toBeTruthy();
    expect(saved.reviewUnlockedAt).toBeTruthy();
    expect(saved.timeline.filter(event => event.type === "trade_completed")).toEqual([
      expect.objectContaining({ actorUserId: SELLER_ID, message: "Seller confirmed trade completed" }),
    ]);
    if (status !== "usdt_sent") {
      expect(saved.usdtSentAt).toBeTruthy();
      expect(saved.timeline.filter(event => event.type === "usdt_sent")).toHaveLength(1);
    }
    expect(snapshot.commissionRecords.filter(record => record.purchaseRequestId === requestId)).toEqual([
      expect.objectContaining({ sellerId: SELLER_ID, sellerFeeAmount: 2.5, buyerFeeCollectedAmount: 0, commissionAmount: 2.5, paymentStatus: "pending" }),
    ]);
    expect(snapshot.marketplaceListings.find(listing => listing.id === listingId)).toMatchObject({ availableAmount: "750", activeTradeRequestId: undefined });
    expect(snapshot.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: BUYER_ID, title: "Review available" }),
      expect.objectContaining({ userId: SELLER_ID, message: "You completed the trade. Check your commission due." }),
    ]));
    await submitBuyerTradeReview({ requestId, buyerUserId: BUYER_ID, rating: 5, comment: "Received the full trade amount." });
    expect(currentSnapshot().purchaseRequests.find(request => request.id === requestId)?.buyerReview?.rating).toBe(5);
  });

  it("requires explicit USDT delivery confirmation for the face-to-face shortcut", async () => {
    seedTrade({ status: "funds_received" });
    await expect(updatePurchaseRequestStatus({ requestId: "face-request-1", actorUserId: SELLER_ID,
      actorRole: "approved_seller", nextStatus: "completed", completionMode: "seller" }))
      .rejects.toMatchObject({ code: "seller-usdt-confirmation-required" });
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
  });

  it.each([
    [FACE_TO_FACE, "payment_sent"], [FACE_TO_FACE, "accepted"],
    ["Bank Transfer", "funds_received"], ["Bank Transfer", "usdt_release_pending"],
    ["Cardless ATM Withdrawal", "funds_received"],
  ] as const)("rejects premature seller completion for %s at %s", async (paymentMethod, status) => {
    seedTrade({ paymentMethod, status });
    await expect(updatePurchaseRequestStatus({ requestId: "face-request-1", actorUserId: SELLER_ID,
      actorRole: "approved_seller", nextStatus: "completed", completionMode: "seller", usdtSentConfirmed: true }))
      .rejects.toMatchObject({ code: "seller-completion-status-not-eligible" });
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
  });

  it("rejects the seller completion command from the buyer and pauses for open disputes", async () => {
    seedTrade({ paymentMethod: "Bank Transfer", status: "usdt_sent" });
    const command = { requestId: "face-request-1", nextStatus: "completed" as const, completionMode: "seller" as const, usdtSentConfirmed: true };
    await expect(updatePurchaseRequestStatus({ ...command, actorUserId: BUYER_ID, actorRole: "buyer" }))
      .rejects.toMatchObject({ code: "seller-completion-required" });
    currentSnapshot().disputes.push({ id: "dispute-1", purchaseRequestId: "face-request-1", status: "open" } as never);
    await expect(updatePurchaseRequestStatus({ ...command, actorUserId: SELLER_ID, actorRole: "approved_seller" }))
      .rejects.toMatchObject({ code: "trade-disputed" });
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
  });

  async function propose(action: "counter_offer" | "propose_amount", value: string) {
    const request = currentSnapshot().purchaseRequests[0];
    return updateTradeTerms({ requestId: request.id, actorUserId: SELLER_ID, action, value, expectedUpdatedAt: request.updatedAt, safetyAcknowledged: true });
  }

  describe.each(["Bank Transfer", "Cardless ATM Withdrawal", FACE_TO_FACE])("%s seller cancellation", (paymentMethod) => {
    it.each(["pending", "accepted"] as const)("cancels %s exactly once, releases the listing and names the seller", async (status) => {
      const { requestId, listingId } = seedTrade({ paymentMethod, status });
      await expect(updatePurchaseRequestStatus({ requestId, actorUserId: OUTSIDER_ID, actorRole: "buyer", nextStatus: "cancelled" })).rejects.toMatchObject({ code: "actor-not-allowed" });
      const input = { requestId, actorUserId: SELLER_ID, actorRole: "approved_seller" as const, nextStatus: "cancelled" as const };
      const results = await Promise.all([updatePurchaseRequestStatus(input), updatePurchaseRequestStatus(input)]);
      expect(results.filter((result) => result.statusChanged)).toHaveLength(1);
      const snapshot = currentSnapshot();
      const request = snapshot.purchaseRequests.find((item) => item.id === requestId)!;
      expect(request).toMatchObject({ status: "cancelled", usdtAmount: "250", fiatAmount: "800" });
      expect(request.timeline.filter((entry) => entry.type === "request_cancelled")).toEqual([
        expect.objectContaining({ actorUserId: SELLER_ID, message: "Seller cancelled request" }),
      ]);
      expect(snapshot.marketplaceListings.find((item) => item.id === listingId)).toMatchObject({ status: "active", activeTradeRequestId: undefined, availableAmount: "1000" });
      const notices = snapshot.notifications.filter((item) => item.title === "Trade cancelled");
      expect(notices).toHaveLength(2);
      expect(notices.map((item) => item.userId).sort()).toEqual([BUYER_ID, SELLER_ID].sort());
      expect(notices.every((item) => item.message === "The seller cancelled this trade request.")).toBe(true);
      expect(snapshot.commissionRecords).toHaveLength(0);
    });

    it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed", "review_open"] as const)("rejects seller cancellation at %s without unlocking the listing", async (status) => {
      const { requestId, listingId } = seedTrade({ paymentMethod, status });
      const listingBefore = structuredClone(currentSnapshot().marketplaceListings.find((item) => item.id === listingId));
      await expect(updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "cancelled" })).rejects.toMatchObject({ code: "invalid-status-transition" });
      expect(currentSnapshot().purchaseRequests[0].status).toBe(status);
      expect(currentSnapshot().marketplaceListings.find((item) => item.id === listingId)).toEqual(listingBefore);
    });

    it("applies a corrected amount only after buyer approval", async () => {
      seedTrade({ paymentMethod });
      // A cardless correction must retain the bank's cash amount at the agreed price.
      currentSnapshot().purchaseRequests[0].usdtAmount = "200";
      const proposed = await propose("propose_amount", "250");
      expect(proposed.usdtAmount).toBe("200");
      expect(proposed.termsProposal).toMatchObject({ status: "pending", usdtAmount: "250", fiatAmount: paymentMethod === "Cardless ATM Withdrawal" ? "800" : "800.00" });
      await expect(updateTradeTerms({ requestId: proposed.id, actorUserId: SELLER_ID, action: "accept_amount", proposalId: proposed.termsProposal!.id })).rejects.toThrow(/intended participant/);
      const accepted = await updateTradeTerms({ requestId: proposed.id, actorUserId: BUYER_ID, action: "accept_amount", proposalId: proposed.termsProposal!.id });
      expect(accepted).toMatchObject({ usdtAmount: "250", pricePerUsdt: "3.20", termsProposal: { status: "accepted" } });
      expect(Number(accepted.fiatAmount)).toBe(800);
    });

    it.each(["cancel-first", "payment-first"])("commits only one outcome when cancellation races with payment (%s)", async (order) => {
      const { requestId, listingId } = seedTrade({ paymentMethod });
      const cancel = () => updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "cancelled" });
      const pay = () => paymentMethod === "Bank Transfer"
        ? uploadTradeEvidence({ purchaseRequestId: requestId, actorUserId: BUYER_ID, actorRole: "buyer", side: "buyer", fileName: "payment.png", mimeType: "image/png", sizeBytes: 68, contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=" })
        : updatePurchaseRequestStatus({ requestId, actorUserId: BUYER_ID, actorRole: "buyer", nextStatus: "payment_sent", cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth", cardlessVerificationValue: "25/08/1995", clientOperationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
      const results = await Promise.allSettled(order === "cancel-first" ? [cancel(), pay()] : [pay(), cancel()]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const snapshot = currentSnapshot();
      const request = snapshot.purchaseRequests.find((item) => item.id === requestId)!;
      expect(["cancelled", "payment_sent"]).toContain(request.status);
      const cancelled = request.status === "cancelled";
      expect(snapshot.marketplaceListings.find((item) => item.id === listingId)).toMatchObject({ status: cancelled ? "active" : "in_trade", activeTradeRequestId: cancelled ? undefined : requestId });
      expect(request.timeline.filter((entry) => entry.type === "request_cancelled")).toHaveLength(cancelled ? 1 : 0);
      expect(Boolean(request.paymentSentAt)).toBe(!cancelled);
      if (cancelled) {
        expect(snapshot.tradeEvidenceFiles.filter((item) => item.purchaseRequestId === requestId)).toHaveLength(0);
        expect(request.messages?.some((message) => message.credentialKind === "cardless_code")).not.toBe(true);
      }
    });
  });

  it.each(["buyer", "seller"] as const)("blocks seller cancellation when %s evidence exists separately from the accepted request", async (side) => {
    const { requestId } = seedTrade({ paymentMethod: "Bank Transfer" });
    currentSnapshot().tradeEvidenceFiles.push({ id: "stored-proof", purchaseRequestId: requestId, side,
      uploadedByUserId: side === "buyer" ? BUYER_ID : SELLER_ID, uploadedAt: new Date().toISOString(),
      fileName: "payment.png", mimeType: "image/png", sizeBytes: 68, storagePath: "evidence/stored-proof.png", status: "uploaded" });
    await expect(updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "cancelled" })).rejects.toMatchObject({ code: "payment-progress-exists" });
    expect(currentSnapshot().purchaseRequests[0].status).toBe("accepted");
  });

  it("allows seller cancellation after only bank details are revealed", async () => {
    const { requestId } = seedTrade({ paymentMethod: "Bank Transfer" });
    Object.assign(currentSnapshot().purchaseRequests[0], { sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: new Date().toISOString() });
    await expect(updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "cancelled" })).resolves.toMatchObject({ request: { status: "cancelled" } });
  });

  it.each(["marker", "message"])("blocks seller cancellation when a stale accepted trade already disclosed a code (%s)", async (source) => {
    const { requestId } = seedTrade({ paymentMethod: "Cardless ATM Withdrawal" });
    Object.assign(currentSnapshot().purchaseRequests[0], source === "marker"
      ? { sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: new Date().toISOString() }
      : { messages: [{ id: "legacy-code", credentialKind: "cardless_code" }] });
    await expect(updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "cancelled" })).rejects.toMatchObject({ code: "payment-progress-exists" });
    expect(currentSnapshot().purchaseRequests[0].status).toBe("accepted");
  });

  it("withdraws a pending amount proposal when the seller cancels before payment", async () => {
    const { requestId } = seedTrade({});
    await propose("propose_amount", "200");
    const result = await updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "cancelled" });
    expect(result.request.termsProposal?.status).toBe("withdrawn");
  });

  it("blocks seller cancellation during an open dispute", async () => {
    const { requestId } = seedTrade({});
    currentSnapshot().disputes.push({ id: "open-dispute", purchaseRequestId: requestId, status: "open" } as never);
    await expect(updatePurchaseRequestStatus({ requestId, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "cancelled" })).rejects.toMatchObject({ code: "trade-disputed" });
  });

  it("accepts a seller counter-offer directly into the same trade, once", async () => {
    seedTrade({ status: "pending" });
    currentSnapshot().purchaseRequests[0].priceMode = "buyer_offer";
    currentSnapshot().purchaseRequests[0].pricePerUsdt = "3.00";
    const offer = await propose("counter_offer", "3.10");
    expect(offer.pricePerUsdt).toBe("3.00");
    expect(offer.termsProposal?.fiatAmount).toBe("775.00");
    await expect(updatePurchaseRequestStatus({ requestId: offer.id, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "accepted" })).rejects.toThrow(/proposed terms/);
    const accept = { requestId: offer.id, actorUserId: BUYER_ID, actorRole: "buyer" as const, nextStatus: "accepted" as const, acceptCounterOfferId: offer.termsProposal!.id };
    const result = await updatePurchaseRequestStatus(accept);
    expect(result.request.status).toBe("accepted");
    expect(result.request.pricePerUsdt).toBe("3.10");
    expect(result.request.fiatAmount).toBe("775.00");
    expect(result.request.termsProposal?.status).toBe("accepted");
    expect((await updatePurchaseRequestStatus(accept)).statusChanged).toBe(false);
    expect(currentSnapshot().marketplaceListings[0].activeTradeRequestId).toBe(offer.id);
  });

  it("requires buyer approval for amount corrections and resumes the trade", async () => {
    seedTrade({ status: "funds_received" });
    const proposed = await propose("propose_amount", "275.25");
    expect(proposed.usdtAmount).toBe("250");
    await expect(updatePurchaseRequestStatus({ requestId: proposed.id, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "usdt_sent" })).rejects.toThrow(/proposed terms/);
    await expect(updateTradeTerms({ requestId: proposed.id, actorUserId: SELLER_ID, action: "accept_amount", proposalId: proposed.termsProposal!.id })).rejects.toThrow(/intended participant/);
    const input = { requestId: proposed.id, actorUserId: BUYER_ID, action: "accept_amount" as const, proposalId: proposed.termsProposal!.id };
    const accepted = await updateTradeTerms(input);
    expect(accepted.usdtAmount).toBe("275.25");
    expect(accepted.fiatAmount).toBe("880.80");
    expect((await updateTradeTerms(input)).usdtAmount).toBe("275.25");
    const sent = await updatePurchaseRequestStatus({ requestId: proposed.id, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "usdt_sent" });
    expect(sent.request.status).toBe("usdt_sent");
  });

  it("declines an amount proposal without changing the original amounts", async () => {
    seedTrade({});
    const proposed = await propose("propose_amount", "200");
    const result = await updateTradeTerms({ requestId: proposed.id, actorUserId: BUYER_ID, action: "decline_terms", proposalId: proposed.termsProposal!.id });
    expect(result.usdtAmount).toBe("250");
    expect(result.termsProposal?.status).toBe("declined");
  });

  it("rejects stale proposal acceptance after withdrawal and replacement", async () => {
    seedTrade({ status: "pending" }); currentSnapshot().purchaseRequests[0].priceMode = "buyer_offer";
    const first = await propose("counter_offer", "3.10");
    const firstId = first.termsProposal!.id;
    await updateTradeTerms({ requestId: first.id, actorUserId: SELLER_ID, action: "withdraw_terms", proposalId: firstId });
    await propose("counter_offer", "3.15");
    await expect(updatePurchaseRequestStatus({ requestId: first.id, actorUserId: BUYER_ID, actorRole: "buyer", nextStatus: "accepted", acceptCounterOfferId: firstId })).rejects.toThrow(/no longer current/);
    expect(currentSnapshot().purchaseRequests[0].status).toBe("pending");
  });

  it.each(["usdt_sent", "completed", "review_open"] as const)("blocks amount changes at %s", async (status) => {
    seedTrade({ status });
    await expect(propose("propose_amount", "300")).rejects.toThrow(/stage/);
  });

  it("blocks outsiders, stale screens, over-allocation, and cardless cash mismatches", async () => {
    seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "funds_received" });
    const request = currentSnapshot().purchaseRequests[0];
    await expect(updateTradeTerms({ requestId: request.id, actorUserId: OUTSIDER_ID, action: "propose_amount", value: "250", expectedUpdatedAt: request.updatedAt })).rejects.toThrow(/not found/);
    await expect(updateTradeTerms({ requestId: request.id, actorUserId: SELLER_ID, action: "propose_amount", value: "250", expectedUpdatedAt: "stale" })).rejects.toThrow(/changed/);
    await expect(propose("propose_amount", "300")).rejects.toThrow(/withdrawal/);
  });

  it("enforces the available balance and counter-offer price bounds", async () => {
    seedTrade({});
    await expect(propose("propose_amount", "1001")).rejects.toThrow(/limits/);
    currentSnapshot().purchaseRequests[0].status = "pending";
    currentSnapshot().purchaseRequests[0].priceMode = "buyer_offer";
    invalidateAlphaExchangeStoreCache();
    await expect(propose("counter_offer", "3.21")).rejects.toThrow(/price range/);
  });

  function readyRequest(overrides: Partial<Parameters<typeof createPurchaseRequest>[0]> = {}) {
    const { listingId } = seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "pending" });
    currentSnapshot().purchaseRequests = [];
    return createPurchaseRequest({ buyerId: BUYER_ID, actorUserId: BUYER_ID, listingId, buyerName: "Ready Buyer", usdtAmount: "125", buyerReceivingWalletAddress: "0x7088a120cde7351dbf3e7831a9da3f74058c89a0", receivingNetwork: "BEP20", paymentMethod: "Cardless ATM Withdrawal", bankName: "Bank Hapoalim", cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth", cardlessVerificationValue: "25/08/1995", cardlessIlsAmount: "400", ...overrides });
  }

  it("freezes the disclosed buyer fee in a new ATM request and preserves the exact cash through recalculation", async () => {
    const { request } = await readyRequest({ feePolicyVersion: "buyer_seller_1pct_v1", usdtAmount: "154.70297", cardlessIlsAmount: "500" });
    expect(request).toMatchObject({ feePolicyVersion: "buyer_seller_1pct_v1", fiatAmount: "500.00", usdtAmount: "154.70297" });
    const seller = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
    const adjusted = await recalculateCardlessTradeAmount(seller);
    expect(adjusted).toMatchObject({ feePolicyVersion: "buyer_seller_1pct_v1", fiatAmount: "500.00", usdtAmount: "154.70297" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_sent" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "completed", completionMode: "cash_trade" });
    expect(currentSnapshot().commissionRecords).toEqual([expect.objectContaining({ feePolicyVersion: "buyer_seller_1pct_v1", sellerFeeAmount: 1.55, buyerFeeCollectedAmount: 1.55, commissionAmount: 3.1, paymentStatus: "pending" })]);
  });

  it("rejects an ATM request that omits the disclosed buyer fee from its cash amount", async () => {
    await expect(readyRequest({ feePolicyVersion: "buyer_seller_1pct_v1" })).rejects.toThrow(/exact ILS withdrawal amount/);
    expect(currentSnapshot().purchaseRequests).toHaveLength(0);
  });

  it.each(["seller", "buyer"] as const)("lets the %s cancel a prepared cardless request while the code is still hidden", async (actor) => {
    const { request } = await readyRequest();
    expect(request.messages?.some((message) => message.credentialKind === "cardless_code")).toBe(true);
    const nextStatus = actor === "seller" ? "declined" : "cancelled";
    await expect(updatePurchaseRequestStatus({ requestId: request.id, actorUserId: actor === "seller" ? SELLER_ID : BUYER_ID,
      actorRole: actor === "seller" ? "approved_seller" : "buyer", nextStatus })).resolves.toMatchObject({ request: { status: nextStatus } });
  });

  it.each([undefined, "", "Unknown Bank", "Bank transfer", "Bank Hapoalim, Bank Leumi"])("requires one supported withdrawal bank (%s)", async (bankName) => {
    await expect(readyRequest({ bankName })).rejects.toThrow(/Choose the bank/);
    expect(currentSnapshot().purchaseRequests).toHaveLength(0);
  });

  it.each(["Bank Leumi", "Bank Hapoalim", "Mercantile", "Discount", "Mizrahi-Tefahot", "First International", "Yahav", "Massad", "Jerusalem", "ONE ZERO", "Esh"])("accepts the buyer's issuing bank independently of seller banks (%s)", async (bankName) => {
    const { request } = await readyRequest({ bankName });
    expect(currentSnapshot().purchaseRequests[0].bankName).toBe(bankName);
    const projected = sanitizePurchaseRequestForActor(request, SELLER_ID, "approved_seller");
    expect(projected.bankName).toBe(bankName);
    expect(JSON.stringify(projected)).not.toContain("482913");
  });

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
    await expect(updatePurchaseRequestStatus({ ...seller, nextStatus: "cancelled" })).rejects.toMatchObject({ code: "invalid-status-transition" });
    await expect(updatePurchaseRequestStatus({ requestId: request.id, actorUserId: BUYER_ID, actorRole: "buyer", nextStatus: "cancelled" })).rejects.toThrow();
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
    room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(room.request.buyerReceivingWalletAddress).toBe(request.buyerReceivingWalletAddress);
    expect(JSON.stringify(room.messages)).not.toContain("482913");
    expect(JSON.stringify(currentSnapshot())).not.toContain("cardless:v1:");
  });

  it("keeps already-submitted ATM details readable when the encryption key changes", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-material-used-only-for-tests");
    const { request } = await readyRequest();
    vi.stubEnv("ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET", "dedicated-material-used-only-for-tests");
    const seller = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
    const room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(JSON.stringify(room.messages)).toContain("482913");
    expect(room.request.buyerReceivingWalletAddress).toBeUndefined();
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
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
    expect(currentSnapshot().commissionRecords[0]).toMatchObject({ sellerFeeAmount: 1.25, buyerFeeCollectedAmount: 0, commissionAmount: 1.25 });
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
    vi.stubEnv("ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET", "rotated-dedicated-key-for-test-only-material");
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

  it.each([FACE_TO_FACE, "Bank Transfer", "Cardless ATM Withdrawal"])("preserves settlement and history when the owner closes completed %s trades", async paymentMethod => {
    const { requestId, listingId } = seedTrade({ paymentMethod, status: "funds_received" });
    await forceCompleteTradeByAdmin({ requestId, actorUserId: OWNER_ID, reason: "Delivery verified" });
    const before = currentSnapshot();
    const commission = structuredClone(before.commissionRecords);
    const listing = structuredClone(before.marketplaceListings.find(item => item.id === listingId));
    const completed = structuredClone(before.purchaseRequests.find(item => item.id === requestId)!);
    const closed = await forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Owner has reviewed all records" });
    expect(closed).toMatchObject({ status: completed.status, completedAt: completed.completedAt, closedByUserId: OWNER_ID, closeReason: "Owner has reviewed all records" });
    expect(closed.messages).toEqual(completed.messages);
    expect(currentSnapshot().commissionRecords).toEqual(commission);
    expect(currentSnapshot().marketplaceListings.find(item => item.id === listingId)).toEqual(listing);
    expect(currentSnapshot().auditLogs).toContainEqual(expect.objectContaining({ action: "admin_override", reason: "Owner has reviewed all records" }));
    await forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Retry" });
    expect(currentSnapshot().auditLogs.filter(item => item.details?.includes("Owner closed the completed trade"))).toHaveLength(1);
    await forceCompleteTradeByAdmin({ requestId, actorUserId: OWNER_ID, reason: "Completion retry" });
    expect(currentSnapshot().commissionRecords).toEqual(commission);
    expect(currentSnapshot().marketplaceListings.find(item => item.id === listingId)).toEqual(listing);
  });

  it.each(["pending", "accepted"] as const)("owner force-close cancels %s requests before payment and retains the reason", async status => {
    const { requestId } = seedTrade({ status });
    await forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Participants requested cancellation" });
    const closed = currentSnapshot().purchaseRequests.find(item => item.id === requestId)!;
    expect(closed).toMatchObject({ status: "cancelled", closedByUserId: OWNER_ID, closeReason: "Participants requested cancellation" });
    expect(closed.closedAt).toBeTruthy();
    await forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Retry" });
    expect(currentSnapshot().auditLogs.filter(item => item.details?.includes("Admin force-cancelled"))).toHaveLength(1);
  });

  it("blocks owner cancellation after payment and active-trade review unlock", async () => {
    const { requestId } = seedTrade({ status: "payment_sent" });
    await expect(forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Review" })).rejects.toThrow("cannot be force-closed");
    await expect(unlockTradeReviewByAdmin({ requestId, actorUserId: OWNER_ID, reason: "Review" })).rejects.toThrow("Only completed trades");
  });

  it("persists review unlock and its audit entry while retaining completed status", async () => {
    const { requestId } = seedTrade({ status: "completed" });
    await unlockTradeReviewByAdmin({ requestId, actorUserId: OWNER_ID, reason: "Reopen review window" });
    const request = currentSnapshot().purchaseRequests.find(item => item.id === requestId)!;
    expect(request.status).toBe("completed");
    expect(request.reviewUnlockedAt).toBeTruthy();
    expect(request.timeline).toContainEqual(expect.objectContaining({ type: "review_unlocked", actorUserId: OWNER_ID }));
    expect(currentSnapshot().auditLogs).toContainEqual(expect.objectContaining({ action: "admin_override", reason: "Reopen review window" }));
  });

  it.each([BUYER_ID, SELLER_ID, OUTSIDER_ID, "missing-owner"])("rejects forged owner actions by %s", async actorUserId => {
    const { requestId } = seedTrade({ status: "accepted" });
    for (const action of [forceCompleteTradeByAdmin, forceCancelTradeByAdmin, forceCloseTradeByOwner, unlockTradeReviewByAdmin]) {
      await expect(action({ requestId, actorUserId, reason: "Attempted override" })).rejects.toThrow("access required");
    }
    expect(currentSnapshot().purchaseRequests.find(item => item.id === requestId)?.status).toBe("accepted");
  });

  it("rejects disabled owners, blank reasons and admin use of owner-only closure", async () => {
    const { requestId } = seedTrade({ status: "completed" });
    const owner = currentSnapshot().users.find(item => item.id === OWNER_ID)!;
    owner.disabled = true;
    await expect(forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Close" })).rejects.toThrow("Owner access required");
    owner.disabled = false;
    await expect(forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "  " })).rejects.toThrow("Reason is required");
    owner.role = "admin"; owner.roles = ["admin"];
    await expect(forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Close" })).rejects.toThrow("Owner access required");
  });

  it("preserves both owner closure and review changes when they run concurrently", async () => {
    const { requestId } = seedTrade({ status: "completed" });
    await Promise.all([
      forceCloseTradeByOwner({ requestId, actorUserId: OWNER_ID, reason: "Owner closed" }),
      unlockTradeReviewByAdmin({ requestId, actorUserId: OWNER_ID, reason: "Owner unlocked" }),
    ]);
    const request = currentSnapshot().purchaseRequests.find(item => item.id === requestId)!;
    expect(request.closedAt).toBeTruthy();
    expect(request.reviewUnlockedAt).toBeTruthy();
    expect(request.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "trade_closed_manually" }), expect.objectContaining({ type: "review_unlocked" }),
    ]));
    expect(currentSnapshot().auditLogs.filter(item => item.purchaseRequestId === requestId)).toHaveLength(2);
  });

  it("blocks force cancellation of a trade with an unresolved dispute", async () => {
    const { requestId } = seedTrade({ status: "accepted" });
    currentSnapshot().disputes.push({ id: "owner-action-dispute", purchaseRequestId: requestId, status: "open" } as never);
    await expect(forceCancelTradeByAdmin({ requestId, actorUserId: OWNER_ID, reason: "Close" })).rejects.toThrow("Resolve the open dispute");
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
