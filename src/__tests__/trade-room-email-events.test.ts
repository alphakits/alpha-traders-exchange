import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";

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
import { prepareTradeEventEmails, prepareTradeRoomConversationEmail } from "@/lib/marketplace-email-events";

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
    preferredLocale: id === BUYER_ID ? "ar" : "en",
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

function createRequest(status: PurchaseRequest["status"] = "pending"): PurchaseRequest {
  const now = "2026-08-22T10:00:00.000Z";
  return {
    id: "purchase-1",
    tradeId: "TR-100",
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    listingId: "listing-1",
    buyerName: "Buyer One",
    usdtAmount: "125",
    fiatAmount: "400",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    status,
    createdAt: now,
    updatedAt: now,
  };
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

  it("sends Arabic-first and English lifecycle copy to the seller for a new buy request", async () => {
    const deliver = await prepareTradeEventEmails({
      event: "new_buy_request",
      request: createRequest(),
    });

    await deliver();

    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "new_buy_request",
      to: "seller-1@example.test",
      recipientLocale: "en",
      title: { ar: "طلب شراء جديد", en: "New Buy Request" },
      message: {
        ar: "طلب Buyer One شراء 125 USDT. راجع الطلب في غرفة الصفقة.",
        en: "Buyer One requested 125 USDT. Review the request in your Trade Room.",
      },
      actionPath: "/trade-room/purchase-1",
    }));
  });

  it("sends bilingual accepted-trade instructions to the buyer", async () => {
    const deliver = await prepareTradeEventEmails({
      event: "trade_accepted",
      request: createRequest("accepted"),
    });

    await deliver();

    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "trade_accepted",
      to: "buyer-1@example.test",
      recipientLocale: "ar",
      title: { ar: "تم قبول الصفقة", en: "Trade Accepted" },
      message: {
        ar: "وافق البائع على طلبك. ارفع إيصال الدفع للمتابعة.",
        en: "The seller accepted your request. Upload your payment receipt to continue.",
      },
      actionPath: "/trade-room/purchase-1",
      idempotencyKey: "trade-lifecycle:purchase-1:trade_accepted:buyer-1",
    }));
  });

  it("emails the Buyer for both seller-side middle transitions", async () => {
    const fundsReceived = await prepareTradeEventEmails({
      event: "seller_funds_received",
      request: createRequest("funds_received"),
    });
    const releaseStarted = await prepareTradeEventEmails({
      event: "seller_usdt_release_started",
      request: createRequest("usdt_release_pending"),
    });

    await fundsReceived();
    await releaseStarted();

    expect(sendMarketplaceEmailMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: "seller_funds_received",
      to: "buyer-1@example.test",
      title: { ar: "أكد البائع استلام الأموال", en: "Seller Confirmed Funds Received" },
      idempotencyKey: "trade-lifecycle:purchase-1:seller_funds_received:buyer-1",
    }));
    expect(sendMarketplaceEmailMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: "seller_usdt_release_started",
      to: "buyer-1@example.test",
      title: { ar: "بدأ البائع إرسال USDT", en: "Seller Started USDT Release" },
      idempotencyKey: "trade-lifecycle:purchase-1:seller_usdt_release_started:buyer-1",
    }));
  });

  it("sends exact bilingual price-offer terms for submission, acceptance, and decline", async () => {
    const priceOffer = {
      ...createRequest(),
      priceMode: "buyer_offer" as const,
      listingPriceAtRequest: "3.30",
      pricePerUsdt: "2.95",
      priceOfferDiscount: "0.35",
      fiatAmount: "368.75",
    };

    for (const event of ["new_buy_request", "trade_accepted", "trade_rejected"] as const) {
      const deliver = await prepareTradeEventEmails({ event, request: priceOffer });
      await deliver();
    }

    expect(sendMarketplaceEmailMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: "seller-1@example.test",
      title: { ar: "عرض سعر جديد", en: "New Price Offer" },
      message: expect.objectContaining({ en: expect.stringContaining("₪2.95 per USDT") }),
    }));
    expect(sendMarketplaceEmailMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: "buyer-1@example.test",
      title: { ar: "تم قبول عرض السعر", en: "Price Offer Accepted" },
      message: expect.objectContaining({ ar: expect.stringContaining("₪2.95") }),
    }));
    expect(sendMarketplaceEmailMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      to: "buyer-1@example.test",
      title: { ar: "تم رفض عرض السعر", en: "Price Offer Declined" },
      message: expect.objectContaining({ en: expect.stringContaining("No payment is required") }),
    }));
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
      recipientLocale: "en",
      title: { ar: "رسالة جديدة في غرفة الصفقة", en: "New Trade Room message" },
      message: {
        ar: "لديك رسالة جديدة في صفقة نشطة على Alpha Exchange.",
        en: "You have a new message in your active Alpha Exchange trade.",
      },
      actionLabel: { ar: "فتح غرفة الصفقة", en: "Open Trade Room" },
      actionPath: "/trade-room/purchase-1#chat",
      idempotencyKey: "trade-room-message:message-1:seller-1",
    }));
    const payload = (sendMarketplaceEmailMock.mock.calls as unknown[][])[0]?.[0] as {
      message?: { ar: string; en: string };
      actionPath?: string;
    };
    expect(payload.message?.en).not.toContain("bank");
    expect(payload.message?.ar).not.toContain("bank");
    expect(payload.actionPath).not.toContain("seller-1@example.test");
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
      recipientLocale: "ar",
      title: { ar: "تذكير من غرفة الصفقة", en: "Trade Room reminder" },
      message: {
        ar: "البائع ينتظرك في صفقة نشطة.",
        en: "Your Seller is waiting for you in an active trade.",
      },
      actionPath: "/trade-room/purchase-1#chat",
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
      recipientLocale: "ar",
      title: { ar: "رسالة جديدة في غرفة الصفقة", en: "New Trade Room message" },
      message: {
        ar: "لديك رسالة جديدة في صفقة نشطة على Alpha Exchange.",
        en: "You have a new message in your active Alpha Exchange trade.",
      },
      actionPath: "/trade-room/purchase-1#chat",
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
      recipientLocale: "en",
      title: { ar: "تذكير من غرفة الصفقة", en: "Trade Room reminder" },
      message: {
        ar: "المشتري ينتظرك في صفقة نشطة.",
        en: "Your Buyer is waiting for you in an active trade.",
      },
      actionPath: "/trade-room/purchase-1#chat",
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
