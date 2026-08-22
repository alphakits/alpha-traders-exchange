import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

const { sendMarketplaceEmailMock } = vi.hoisted(() => ({
  sendMarketplaceEmailMock: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

vi.mock("@/lib/marketplace-email-delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/marketplace-email-delivery")>("@/lib/marketplace-email-delivery");
  return {
    ...actual,
    sendMarketplaceEmail: sendMarketplaceEmailMock,
  };
});

import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { prepareTradeRoomConversationEmail } from "@/lib/marketplace-email-events";

const BUYER_ID = "buyer-1";
const SELLER_ID = "seller-1";

function createUser(id: string): AlphaExchangeUser {
  const now = "2026-08-22T10:00:00.000Z";
  return {
    id,
    fullName: id === BUYER_ID ? "Buyer One" : "Seller One",
    email: `${id}@example.test`,
    passwordHash: "not-used-in-email-test",
    whatsappNumber: "+972500000000",
    role: id === BUYER_ID ? "buyer" : "approved_seller",
    roles: id === BUYER_ID ? ["buyer"] : ["approved_seller"],
    sellerStatus: id === BUYER_ID ? "buyer" : "approved_seller",
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: true, sms: false },
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

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [createUser(BUYER_ID), createUser(SELLER_ID)],
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

describe("Trade Room email events", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    sendMarketplaceEmailMock.mockReset();
    sendMarketplaceEmailMock.mockResolvedValue({ ok: true });
  });

  it("sends a generic Buyer-to-Seller message email with an exact canonical Trade Room link", async () => {
    const deliver = await prepareTradeRoomConversationEmail({
      event: "trade_room_message",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: SELLER_ID,
      senderUserId: BUYER_ID,
      senderRole: "buyer",
      idempotencyKey: "trade-room-message:message-1:seller-1",
    });

    await deliver();

    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "trade_room_message",
      to: "seller-1@example.test",
      title: "New Trade Room message",
      message: "You have a new message in your active Alpha Exchange trade.",
      actionLabel: "Open Trade Room",
      actionUrl: expect.stringMatching(/\/en\/trade-room\/purchase-1#chat$/),
      idempotencyKey: "trade-room-message:message-1:seller-1",
    }));
    const payload = (sendMarketplaceEmailMock.mock.calls as unknown[][])[0]?.[0] as { message?: string; actionUrl?: string };
    expect(payload.message).not.toContain("bank");
    expect(payload.actionUrl).not.toContain("seller-1@example.test");
  });

  it("sends the reverse Seller-to-Buyer Poke email without exposing participant data", async () => {
    const deliver = await prepareTradeRoomConversationEmail({
      event: "trade_room_poke",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: BUYER_ID,
      senderUserId: SELLER_ID,
      senderRole: "seller",
      idempotencyKey: "trade-room-poke:poke-1:buyer-1",
    });

    await deliver();

    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "trade_room_poke",
      to: "buyer-1@example.test",
      title: "Trade Room reminder",
      message: "Your Seller is waiting for you in an active trade.",
      actionUrl: expect.stringMatching(/\/en\/trade-room\/purchase-1#chat$/),
    }));
  });

  it("sends the reverse Seller-to-Buyer message email with the same privacy-safe exact-room CTA", async () => {
    const deliver = await prepareTradeRoomConversationEmail({
      event: "trade_room_message",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: BUYER_ID,
      senderUserId: SELLER_ID,
      senderRole: "seller",
      idempotencyKey: "trade-room-message:message-2:buyer-1",
    });

    await deliver();

    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "trade_room_message",
      to: "buyer-1@example.test",
      title: "New Trade Room message",
      message: "You have a new message in your active Alpha Exchange trade.",
      actionUrl: expect.stringMatching(/\/en\/trade-room\/purchase-1#chat$/),
    }));
  });

  it("sends the Buyer-to-Seller Poke email with the exact Trade Room CTA", async () => {
    const deliver = await prepareTradeRoomConversationEmail({
      event: "trade_room_poke",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: SELLER_ID,
      senderUserId: BUYER_ID,
      senderRole: "buyer",
      idempotencyKey: "trade-room-poke:poke-2:seller-1",
    });

    await deliver();

    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "trade_room_poke",
      to: "seller-1@example.test",
      title: "Trade Room reminder",
      message: "Your Buyer is waiting for you in an active trade.",
      actionUrl: expect.stringMatching(/\/en\/trade-room\/purchase-1#chat$/),
    }));
  });

  it("does not schedule a self-notification email", async () => {
    const deliver = await prepareTradeRoomConversationEmail({
      event: "trade_room_message",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: BUYER_ID,
      senderUserId: BUYER_ID,
      senderRole: "buyer",
      idempotencyKey: "not-used",
    });

    await deliver();
    expect(sendMarketplaceEmailMock).not.toHaveBeenCalled();
  });

  it("contains provider failure without throwing after the Trade Room interaction committed", async () => {
    sendMarketplaceEmailMock.mockResolvedValueOnce({ ok: false, reason: "resend_network_failed" } as never);
    const deliver = await prepareTradeRoomConversationEmail({
      event: "trade_room_message",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: SELLER_ID,
      senderUserId: BUYER_ID,
      senderRole: "buyer",
      idempotencyKey: "trade-room-message:message-2:seller-1",
    });

    await expect(deliver()).resolves.toBeUndefined();
    expect(sendMarketplaceEmailMock).toHaveBeenCalledTimes(1);
  });
});
