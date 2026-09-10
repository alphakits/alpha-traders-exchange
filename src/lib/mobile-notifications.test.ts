import { describe, expect, it } from "vitest";
import { toMobileNotification } from "@/lib/mobile-notifications";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

function notification(overrides: Partial<AlphaExchangeNotification>): AlphaExchangeNotification {
  return {
    id: "notification-1",
    userId: "user-1",
    category: "system",
    title: "Update",
    message: "Open the relevant workspace.",
    isRead: false,
    createdAt: "2026-09-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("toMobileNotification destinations", () => {
  it("keeps an explicit admin destination ahead of trade inference", () => {
    const result = toMobileNotification(notification({
      category: "trade",
      relatedRequestId: "request-123",
      actionHref: "/admin/alpha-exchange?section=purchase-requests&requestId=request-123",
    }), "en");

    expect(result.destination).toEqual({ screen: "admin" });
  });

  it("routes seller and application actions to native workspaces", () => {
    expect(toMobileNotification(notification({
      category: "listing",
      actionHref: "/en/dashboard/seller#my-listings-section",
    }), "en").destination).toEqual({ screen: "seller" });

    expect(toMobileNotification(notification({
      category: "application",
    }), "en").destination).toEqual({ screen: "seller_application" });

    expect(toMobileNotification(notification({
      category: "account",
      actionHref: "/dashboard/seller/compliance-payment",
    }), "en").destination).toEqual({ screen: "seller" });
  });

  it("rejects external hrefs and preserves safe trade destinations", () => {
    expect(toMobileNotification(notification({
      category: "trade",
      relatedRequestId: "request-456",
      actionHref: "https://evil.example/admin",
    }), "en").destination).toEqual({ screen: "trade", requestId: "request-456" });
  });

  it("falls back to a safe related href when the action href is unsafe", () => {
    expect(toMobileNotification(notification({
      category: "application",
      actionHref: "https://evil.example/admin",
      relatedHref: "/ar/admin/alpha-exchange?section=seller-applications",
    }), "ar").destination).toEqual({ screen: "admin" });
  });

  it("does not let a malformed related request ID hide a valid snapshot ID", () => {
    expect(toMobileNotification(notification({
      category: "trade",
      relatedRequestId: "../../admin",
      tradeSnapshot: {
        requestId: "request-from-snapshot",
        currentStage: "accepted",
        buyerId: "user-1",
        sellerId: "seller-1",
        counterpartyName: "Seller One",
        usdtAmount: "100",
        fiatAmount: "350",
        currency: "ILS",
        requiredAction: "Upload payment proof",
      },
    }), "en").destination).toEqual({ screen: "trade", requestId: "request-from-snapshot" });
  });

  it("recovers a safe trade ID from a localized legacy action href", () => {
    expect(toMobileNotification(notification({
      category: "trade",
      actionHref: "/ar/trade-room/request-789?action=pay#timeline",
    }), "ar").destination).toEqual({ screen: "trade", requestId: "request-789" });
  });

  it("projects automatic hourly reminders as localized native actions", () => {
    const result = toMobileNotification(notification({
      category: "trade",
      title: "Action Required on Your Trade",
      titleEn: "Action Required on Your Trade",
      titleAr: "إجراء مطلوب في صفقتك",
      message: "Trade TR-42 is waiting for your action.",
      messageEn: "Trade TR-42 is waiting for your action.",
      messageAr: "الصفقة TR-42 بانتظار اتخاذ إجراء منك.",
      relatedRequestId: "request-hourly",
      actionHref: "/trade-room/request-hourly",
      actionLabel: "Open Trade Room",
      reason: "automatic_trade_action_reminder",
      priority: "critical",
    }), "ar");

    expect(result).toMatchObject({
      title: "إجراء مطلوب في صفقتك",
      message: "الصفقة TR-42 بانتظار اتخاذ إجراء منك.",
      actionRequired: true,
      destination: { screen: "trade", requestId: "request-hourly" },
    });
  });
});
