import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequestStatus, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  adminOverrideMarketplaceListing,
  closePurchaseRequestManually,
  forceCancelTradeByAdmin,
  forceCompleteTradeByAdmin,
  invalidateAlphaExchangeStoreCache,
  updatePurchaseRequestStatus,
} from "@/lib/alpha-exchange-store";
import { isCashTradeCompletionAvailable, isFaceToFaceCompletionAvailable } from "@/lib/marketplace-payment-methods";

const SELLER_ID = "face-seller-1";
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

describe("Face-to-Face participant completion", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("lets the seller finish an accepted in-person trade without evidence and reuses canonical completion effects", async () => {
    const { listingId } = seedTrade({});

    const result = await completeFaceToFace("seller");

    expect(result.statusChanged).toBe(true);
    expect(result.request).toMatchObject({
      status: "review_open",
      buyerEvidence: undefined,
      sellerEvidence: undefined,
    });
    expect(result.request.completedAt).toBeTruthy();
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

  it("lets the buyer finish the same flow without evidence and records the buyer as actor", async () => {
    seedTrade({});

    const result = await completeFaceToFace("buyer");

    expect(result.request.status).toBe("review_open");
    expect(result.request.timeline).toContainEqual(expect.objectContaining({
      type: "trade_completed",
      actorUserId: BUYER_ID,
      message: "Buyer marked the Face-to-Face trade complete.",
    }));
    expect(currentSnapshot().commissionRecords.filter((record) => record.purchaseRequestId === "face-request-1")).toHaveLength(1);
  });

  it.each(["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)(
    "supports already-open Face-to-Face trades at the %s stage without resetting them",
    async (status) => {
      seedTrade({ status });

      await expect(completeFaceToFace("buyer")).resolves.toMatchObject({
        request: { status: "review_open" },
        statusChanged: true,
      });
    },
  );

  it("does not weaken the Bank Transfer evidence lifecycle", async () => {
    seedTrade({ paymentMethod: "Bank Transfer" });

    await expect(completeFaceToFace("buyer")).rejects.toMatchObject({
      code: "cash-trade-completion-payment-method-required",
    });
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
    expect(currentSnapshot().marketplaceListings[0]).toMatchObject({ availableAmount: "1000" });
  });

  it.each(["buyer", "seller"] as const)(
    "lets the %s complete Cardless ATM only after USDT is marked sent",
    async (actor) => {
      const requestId = `cardless-request-${actor}`;
      const { listingId } = seedTrade({
        requestId,
        paymentMethod: "Cardless ATM Withdrawal",
        status: "usdt_sent",
      });

      const result = await updatePurchaseRequestStatus({
        requestId,
        actorUserId: actor === "seller" ? SELLER_ID : BUYER_ID,
        actorRole: actor === "seller" ? "approved_seller" : "buyer",
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
        actorUserId: actor === "seller" ? SELLER_ID : BUYER_ID,
        message: `${actor === "seller" ? "Seller" : "Buyer"} marked the Cardless ATM trade complete.`,
      }));
    },
  );

  it("keeps Cardless ATM cancellable before proof but blocks early completion", async () => {
    const { listingId } = seedTrade({ paymentMethod: "Cardless ATM Withdrawal", status: "accepted" });

    await expect(updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
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

  it("blocks participant and admin cancellation once payment or transfer progress exists", async () => {
    const { requestId, listingId } = seedTrade({
      paymentMethod: "Cardless ATM Withdrawal",
      status: "payment_sent",
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

    expect(currentSnapshot().purchaseRequests.find((request) => request.id === requestId)?.status).toBe("payment_sent");
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

  it("requires the explicit Face-to-Face command instead of weakening ordinary completion", async () => {
    seedTrade({});

    await expect(updatePurchaseRequestStatus({
      requestId: "face-request-1",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      nextStatus: "completed",
    })).rejects.toMatchObject({
      code: "confirmation-prerequisite-missing",
      details: expect.objectContaining({ guard: "completed-requires-usdt-sent" }),
    });
  });

  it.each(["pending", "declined", "cancelled"] as const)(
    "rejects completion while a Face-to-Face trade is %s",
    async (status) => {
      seedTrade({ status });

      await expect(completeFaceToFace("buyer")).rejects.toMatchObject({
        code: "cash-trade-completion-status-not-eligible",
      });
    },
  );

  it("allows participants only, including when a privileged user is not part of the trade", async () => {
    seedTrade({});

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

  it("serializes simultaneous buyer and seller completion into one trade, one listing deduction, and one commission", async () => {
    const { listingId } = seedTrade({});

    const results = await Promise.all([
      completeFaceToFace("buyer"),
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

  it("exposes completion only for normalized Face-to-Face methods and active accepted stages", () => {
    expect(isFaceToFaceCompletionAvailable("meet in person", "accepted")).toBe(true);
    expect(isFaceToFaceCompletionAvailable(FACE_TO_FACE, "usdt_sent")).toBe(true);
    expect(isFaceToFaceCompletionAvailable(FACE_TO_FACE, "pending")).toBe(false);
    expect(isFaceToFaceCompletionAvailable("Bank Transfer", "accepted")).toBe(false);
    expect(isCashTradeCompletionAvailable("Cardless ATM Withdrawal", "accepted")).toBe(false);
    expect(isCashTradeCompletionAvailable("Cardless ATM Withdrawal", "usdt_sent")).toBe(true);
    expect(isCashTradeCompletionAvailable("Bank Transfer", "usdt_sent")).toBe(false);
  });
});
