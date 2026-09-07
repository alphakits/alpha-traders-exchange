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
});
