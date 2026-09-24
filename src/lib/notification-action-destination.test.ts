import { describe, expect, it } from "vitest";
import {
  getExplicitNonTradeRoomNotificationDestination,
  getSafeInternalNotificationDestination,
} from "@/lib/notification-action-destination";

describe("explicit notification action destinations", () => {
  it.each([
    { reason: "new_listing_published", title: "New listing" },
    { title: "🟢 New USDT Listing Available" },
  ])("repairs stored listing management links for broadcasts: %j", (event) => {
    const notice = {
      ...event, category: "listing" as const, relatedListingId: "listing-public",
      actionHref: "/admin/alpha-exchange?section=marketplace-listings",
      relatedHref: "/usdt-exchange#seller-listing-listing-public",
    };
    expect(getSafeInternalNotificationDestination(notice)).toBe("/usdt-exchange#listing-listing-public");
    expect(getExplicitNonTradeRoomNotificationDestination(notice)).toBe("/usdt-exchange#listing-listing-public");
  });

  it("falls back to the marketplace when an old broadcast has no listing ID", () => {
    expect(getSafeInternalNotificationDestination({
      category: "listing", reason: "new_listing_published", actionHref: "/dashboard/seller",
    })).toBe("/usdt-exchange");
  });

  it("preserves exact internal admin targets ahead of category-based trade inference", () => {
    expect(getExplicitNonTradeRoomNotificationDestination({
      relatedHref: "/admin/alpha-exchange?section=purchase-requests&requestId=request-123",
    })).toBe("/admin/alpha-exchange?section=purchase-requests&requestId=request-123");
  });

  it("prefers an explicit action over a broader related target", () => {
    expect(getExplicitNonTradeRoomNotificationDestination({
      actionHref: "/admin/alpha-exchange?section=commissions&commissionId=commission-123",
      relatedHref: "/admin/alpha-exchange",
    })).toBe("/admin/alpha-exchange?section=commissions&commissionId=commission-123");
  });

  it("does not replace participant Trade Room destinations", () => {
    expect(getExplicitNonTradeRoomNotificationDestination({
      actionHref: "/trade-room/request-123?action=accept-trade#action-required",
    })).toBeNull();
    expect(getExplicitNonTradeRoomNotificationDestination({
      relatedHref: "/en/trade-room/request-123#chat",
    })).toBeNull();
  });

  it("fails closed for non-internal destinations", () => {
    expect(getExplicitNonTradeRoomNotificationDestination({ actionHref: "https://example.test/admin" })).toBeNull();
    expect(getExplicitNonTradeRoomNotificationDestination({ actionHref: "//example.test/admin" })).toBeNull();
    expect(getExplicitNonTradeRoomNotificationDestination({ relatedHref: "javascript:alert(1)" })).toBeNull();
  });

  it("falls back to a valid related target when a legacy action target is invalid", () => {
    expect(getExplicitNonTradeRoomNotificationDestination({
      actionHref: "https://example.test/phishing",
      relatedHref: "/admin/alpha-exchange?section=seller-applications&sellerApplication=application-123",
    })).toBe("/admin/alpha-exchange?section=seller-applications&sellerApplication=application-123");
  });

  it("allows only same-site paths through the generic destination resolver", () => {
    expect(getSafeInternalNotificationDestination({
      actionHref: "javascript:alert(1)",
      relatedHref: "/usdt-exchange?listing=listing-123#my-listings",
    })).toBe("/usdt-exchange?listing=listing-123#my-listings");
    expect(getSafeInternalNotificationDestination({
      actionHref: "//example.test/phishing",
      relatedHref: "https://example.test/phishing",
    })).toBeNull();
  });
});
