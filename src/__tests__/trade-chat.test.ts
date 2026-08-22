import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequest, PurchaseRequestStatus, UserRole } from "@/types/alpha-exchange";

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
  invalidateAlphaExchangeStoreCache,
  postTradeRoomMessage,
  postTradeRoomPoke,
} from "@/lib/alpha-exchange-store";

const BUYER_ID = "buyer-1";
const SELLER_ID = "seller-1";
const OUTSIDER_ID = "outsider-1";
const ADMIN_ID = "admin-1";

function user(id: string, role: UserRole): AlphaExchangeUser {
  const now = new Date().toISOString();
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "test-hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "admin" ? ["admin", "buyer"] : [role],
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

function trade(id: string, status: PurchaseRequestStatus = "accepted"): PurchaseRequest {
  const now = new Date().toISOString();
  return {
    id,
    tradeId: `TR-${id}`,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    listingId: "listing-1",
    buyerName: "Buyer",
    buyerWhatsapp: "+972500000000",
    buyerNotes: "",
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

function seedDb(requests = [trade("trade-1")]): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user(BUYER_ID, "buyer"),
      user(SELLER_ID, "approved_seller"),
      user(OUTSIDER_ID, "buyer"),
      user(ADMIN_ID, "admin"),
    ],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: requests,
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

describe("Trade Room participant communication", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    mocks.publishRealtimeEvent.mockReset();
    mocks.checkSharedRateLimit.mockReset();
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, reason: null });
  });

  it("persists a Buyer message with one generic, recipient-only Seller notification", async () => {
    const posted = await postTradeRoomMessage({
      purchaseRequestId: "trade-1",
      actorUserId: BUYER_ID,
      message: "Private payment details should never be copied to a bell notification.",
    });

    const saved = snapshot();
    expect(saved.purchaseRequests[0]?.messages).toHaveLength(1);
    expect(posted.notificationRecipientUserId).toBe(SELLER_ID);
    expect(saved.notifications).toHaveLength(1);
    expect(saved.notifications[0]).toMatchObject({
      userId: SELLER_ID,
      title: "New Trade Room message",
      message: "You have a new message in your active Alpha Exchange trade.",
      reason: "trade_room_message",
      actionHref: "/trade-room/trade-1#chat",
    });
    expect(saved.notifications[0]?.message).not.toContain("Private payment details");
    expect(saved.notifications.some((entry) => entry.userId === BUYER_ID)).toBe(false);
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "trade.message_created" }));
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "notification.created" }));
  });

  it("delivers the reverse Seller-to-Buyer alert even when in-app preferences are disabled", async () => {
    const posted = await postTradeRoomMessage({
      purchaseRequestId: "trade-1",
      actorUserId: SELLER_ID,
      message: "I have reviewed the update.",
    });

    expect(posted.notificationRecipientUserId).toBe(BUYER_ID);
    expect(snapshot().notifications).toEqual([
      expect.objectContaining({ userId: BUYER_ID, reason: "trade_room_message" }),
    ]);
    expect(snapshot().notifications.some((entry) => entry.userId === SELLER_ID)).toBe(false);
  });

  it("rejects an outsider and a nonparticipant admin from posting Trade Room messages", async () => {
    await expect(postTradeRoomMessage({ purchaseRequestId: "trade-1", actorUserId: OUTSIDER_ID, message: "spoof" }))
      .rejects.toThrow("not allowed");
    await expect(postTradeRoomMessage({ purchaseRequestId: "trade-1", actorUserId: ADMIN_ID, message: "spoof" }))
      .rejects.toThrow("not allowed");
    expect(snapshot().purchaseRequests[0]?.messages).toHaveLength(0);
  });

  it("sends a Buyer Poke to the Seller with durable state, a generic alert, and exact cooldown data", async () => {
    const poked = await postTradeRoomPoke({
      purchaseRequestId: "trade-1",
      actorUserId: BUYER_ID,
      requestHeaders: new Headers(),
    });

    const saved = snapshot();
    expect(mocks.checkSharedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      key: "exchange:trade-room-poke",
      identifier: `trade-1:${BUYER_ID}:${SELLER_ID}`,
      maxRequests: 1,
      windowMs: 300_000,
    }));
    expect(poked.poke).toMatchObject({ available: true, canPoke: false, counterpartRole: "seller" });
    expect(poked.poke.cooldownRemainingSeconds).toBeGreaterThanOrEqual(299);
    expect(saved.purchaseRequests[0]?.pokeState?.buyerToSellerAt).toBeTruthy();
    expect(saved.purchaseRequests[0]?.messages).toHaveLength(1);
    expect(saved.purchaseRequests[0]?.messages?.[0]).toMatchObject({ kind: "system", senderUserId: BUYER_ID });
    expect(saved.notifications).toHaveLength(1);
    expect(saved.notifications[0]).toMatchObject({
      userId: SELLER_ID,
      title: "Trade Room reminder",
      message: "Your Buyer is waiting for you in an active trade.",
      reason: "trade_room_poke",
      actionHref: "/trade-room/trade-1#chat",
    });
    expect(mocks.publishRealtimeEvent.mock.calls.map(([event]) => event.type)).toEqual([
      "trade.message_created",
      "notification.created",
    ]);
  });

  it("sends the reverse Seller Poke to the Buyer and keeps directions independent", async () => {
    const poked = await postTradeRoomPoke({
      purchaseRequestId: "trade-1",
      actorUserId: SELLER_ID,
      requestHeaders: new Headers(),
    });

    expect(poked.notificationRecipientUserId).toBe(BUYER_ID);
    expect(snapshot().purchaseRequests[0]?.pokeState?.sellerToBuyerAt).toBeTruthy();
    expect(snapshot().notifications[0]).toMatchObject({
      userId: BUYER_ID,
      message: "Your Seller is waiting for you in an active trade.",
    });
  });

  it("scopes Poke cooldowns independently by trade and sender-to-recipient direction", async () => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb([trade("trade-a"), trade("trade-b")]) as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();

    await postTradeRoomPoke({ purchaseRequestId: "trade-a", actorUserId: BUYER_ID, requestHeaders: new Headers() });
    await postTradeRoomPoke({ purchaseRequestId: "trade-a", actorUserId: SELLER_ID, requestHeaders: new Headers() });
    await postTradeRoomPoke({ purchaseRequestId: "trade-b", actorUserId: BUYER_ID, requestHeaders: new Headers() });
    await expect(postTradeRoomPoke({ purchaseRequestId: "trade-a", actorUserId: BUYER_ID, requestHeaders: new Headers() }))
      .rejects.toMatchObject({ code: "POKE_COOLDOWN_ACTIVE", status: 429 });

    const saved = snapshot();
    const tradeA = saved.purchaseRequests.find((request) => request.id === "trade-a");
    const tradeB = saved.purchaseRequests.find((request) => request.id === "trade-b");
    expect(tradeA?.pokeState).toMatchObject({ buyerToSellerAt: expect.any(String), sellerToBuyerAt: expect.any(String) });
    expect(tradeB?.pokeState).toMatchObject({ buyerToSellerAt: expect.any(String) });
    expect(tradeA?.messages).toHaveLength(2);
    expect(tradeB?.messages).toHaveLength(1);
    expect(saved.notifications).toHaveLength(3);
    const cooldownKeys = mocks.checkSharedRateLimit.mock.calls
      .map(([input]) => input as { key?: string; identifier?: string })
      .filter((input) => input.key === "exchange:trade-room-poke")
      .map((input) => input.identifier);
    expect(cooldownKeys).toEqual([
      `trade-a:${BUYER_ID}:${SELLER_ID}`,
      `trade-a:${SELLER_ID}:${BUYER_ID}`,
      `trade-b:${BUYER_ID}:${SELLER_ID}`,
    ]);
  });

  it("rejects Pokes from an outsider and a nonparticipant admin before any delivery is created", async () => {
    for (const actorUserId of [OUTSIDER_ID, ADMIN_ID]) {
      await expect(postTradeRoomPoke({ purchaseRequestId: "trade-1", actorUserId, requestHeaders: new Headers() }))
        .rejects.toMatchObject({ code: "TRADE_PARTICIPANT_REQUIRED", status: 403 });
    }
    expect(snapshot().purchaseRequests[0]?.messages).toHaveLength(0);
    expect(snapshot().notifications).toHaveLength(0);
    expect(mocks.checkSharedRateLimit).not.toHaveBeenCalled();
  });

  it("denies Pokes for every terminal or explicitly closed canonical trade state", async () => {
    const now = new Date().toISOString();
    const terminalRequests: PurchaseRequest[] = [
      "completed",
      "locked",
      "review_open",
      "declined",
      "cancelled",
    ].map((status) => trade(`terminal-${status}`, status as PurchaseRequestStatus));
    terminalRequests.push(
      { ...trade("timed-out", "accepted"), timedOutAt: now },
      { ...trade("manually-closed", "accepted"), closedAt: now },
    );

    for (const request of terminalRequests) {
      globalThis.__alphaExchangeMemorySnapshot = seedDb([request]) as never;
      globalThis.__alphaExchangeRepositoryPromise = undefined as never;
      invalidateAlphaExchangeStoreCache();
      await expect(postTradeRoomPoke({ purchaseRequestId: request.id, actorUserId: BUYER_ID, requestHeaders: new Headers() }))
        .rejects.toMatchObject({ code: "TRADE_NOT_ACTIVE", status: 409 });
      expect(snapshot().purchaseRequests[0]?.messages).toHaveLength(0);
      expect(snapshot().notifications).toHaveLength(0);
    }
  });

  it("fails closed without persistence when the shared Poke cooldown claim is unavailable", async () => {
    mocks.checkSharedRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 1,
      reason: "limiter_unavailable",
    });

    await expect(postTradeRoomPoke({ purchaseRequestId: "trade-1", actorUserId: BUYER_ID, requestHeaders: new Headers() }))
      .rejects.toMatchObject({ code: "POKE_COOLDOWN_UNAVAILABLE", status: 503 });
    expect(snapshot().purchaseRequests[0]?.messages).toHaveLength(0);
    expect(snapshot().notifications).toHaveLength(0);
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("rejects a second Poke through the persisted five-minute state before it can produce another delivery", async () => {
    await postTradeRoomPoke({ purchaseRequestId: "trade-1", actorUserId: BUYER_ID, requestHeaders: new Headers() });
    // A fresh canonical read (the equivalent of a reconnect or another server
    // instance) must still see the durable directional cooldown.
    invalidateAlphaExchangeStoreCache();
    await expect(postTradeRoomPoke({ purchaseRequestId: "trade-1", actorUserId: BUYER_ID, requestHeaders: new Headers() }))
      .rejects.toMatchObject({ code: "POKE_COOLDOWN_ACTIVE", status: 429 });
    expect(snapshot().notifications).toHaveLength(1);
    expect(snapshot().purchaseRequests[0]?.messages).toHaveLength(1);
  });

  it("allows only one concurrent Poke claim and leaves terminal trades untouched", async () => {
    let claimed = false;
    mocks.checkSharedRateLimit.mockImplementation(async () => {
      if (claimed) return { allowed: false, retryAfterSeconds: 300, reason: "limit_reached" };
      claimed = true;
      return { allowed: true, retryAfterSeconds: 0, reason: null };
    });
    const [first, second] = await Promise.allSettled([
      postTradeRoomPoke({ purchaseRequestId: "trade-1", actorUserId: BUYER_ID, requestHeaders: new Headers() }),
      postTradeRoomPoke({ purchaseRequestId: "trade-1", actorUserId: BUYER_ID, requestHeaders: new Headers() }),
    ]);
    expect([first, second].filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(snapshot().notifications).toHaveLength(1);

    globalThis.__alphaExchangeMemorySnapshot = seedDb([trade("terminal", "completed")]) as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    await expect(postTradeRoomPoke({ purchaseRequestId: "terminal", actorUserId: BUYER_ID, requestHeaders: new Headers() }))
      .rejects.toMatchObject({ code: "TRADE_NOT_ACTIVE", status: 409 });
    expect(snapshot().purchaseRequests[0]?.messages).toHaveLength(0);
  });

  it("revalidates the canonical trade under the persistence lock when a terminal update races a Poke", async () => {
    mocks.checkSharedRateLimit.mockImplementationOnce(async () => {
      const latest = snapshot() as AlphaExchangeDb & { __runtimeVersion: number };
      const now = new Date().toISOString();
      latest.purchaseRequests[0] = {
        ...latest.purchaseRequests[0]!,
        status: "completed",
        completedAt: now,
        updatedAt: now,
      };
      latest.__runtimeVersion = 1;
      return { allowed: true, retryAfterSeconds: 0, reason: null };
    });

    await expect(postTradeRoomPoke({ purchaseRequestId: "trade-1", actorUserId: BUYER_ID, requestHeaders: new Headers() }))
      .rejects.toMatchObject({ code: "TRADE_NOT_ACTIVE", status: 409 });

    expect(snapshot().purchaseRequests[0]).toMatchObject({ status: "completed", messages: [] });
    expect(snapshot().notifications).toHaveLength(0);
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });
});
