import { describe, expect, it } from "vitest";
import { isNotificationActionRequired } from "@/lib/notification-action-required";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

function notification(overrides: Partial<AlphaExchangeNotification>): AlphaExchangeNotification {
  return {
    id: "notification-1",
    userId: "owner-1",
    category: "system",
    title: "Account update",
    message: "An account update is available.",
    isRead: false,
    state: "unread",
    priority: "normal",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("notification action-required classification", () => {
  it("marks urgent owner review notifications as actionable", () => {
    expect(isNotificationActionRequired(notification({
      category: "listing",
      title: "New Listing Pending Review",
      message: "A seller submitted a listing for approval.",
      actionHref: "/admin/alpha-exchange?section=marketplace-listings&listing=listing-1",
      actionLabel: "Review Listing",
      priority: "critical",
    }))).toBe(true);

    expect(isNotificationActionRequired(notification({
      category: "application",
      title: "New Approved Seller Application",
      message: "A buyer applied to become a seller.",
      actionHref: "/admin/alpha-exchange?section=seller-applications&sellerApplication=application-1",
      actionLabel: "Review Application",
      priority: "high",
    }))).toBe(true);
  });

  it("keeps unresolved approval alerts actionable after they are read", () => {
    expect(isNotificationActionRequired(notification({
      category: "listing",
      title: "Listing Approval Required",
      priority: "critical",
      isRead: true,
      state: "read",
      actionHref: "/admin/alpha-exchange?section=marketplace-listings",
    }))).toBe(true);
  });

  it("treats urgent compliance review alerts as actions", () => {
    expect(isNotificationActionRequired(notification({
      category: "system",
      title: "Compliance payment awaiting verification",
      priority: "high",
      actionHref: "/admin/alpha-exchange?section=marketplace-enforcement",
    }))).toBe(true);
  });

  it("does not turn every high-priority trade update into an owner action", () => {
    expect(isNotificationActionRequired(notification({
      category: "trade",
      title: "Trade update",
      message: "The trade changed status.",
      relatedHref: "/trade-room/request-1",
      priority: "high",
    }))).toBe(false);
  });

  it("ignores archived owner actions", () => {
    expect(isNotificationActionRequired(notification({
      category: "dispute",
      title: "Dispute opened",
      message: "Review the trade.",
      actionHref: "/admin/alpha-exchange?section=purchase-requests&requestId=request-1",
      priority: "critical",
      state: "archived",
    }))).toBe(false);
  });
});
