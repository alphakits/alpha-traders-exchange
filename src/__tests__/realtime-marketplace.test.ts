import { describe, expect, it } from "vitest";
import type { AlphaExchangeNotification, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { applyRealtimeMarketplaceEvent, applyRealtimeNotificationEvent, applyRealtimeTradeEvent, publishRealtimeEvent, subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";

describe("realtime marketplace updates", () => {
  it("adds, updates, and removes listings from the live feed", () => {
    const initial: MarketplaceListing[] = [
      {
        id: "listing-1",
        sellerId: "seller-1",
        sellerDisplayName: "Alice",
        photos: [],
        originalAmount: "1000",
        availableAmount: "500",
        price: "38",
        currency: "ILS",
        network: "TRC20",
        paymentMethod: "Bank transfer",
        paymentMethods: ["Bank transfer"],
        minimumTrade: "100",
        maximumTrade: "500",
        sellerDescription: "",
        responseTime: "5 min",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const created = applyRealtimeMarketplaceEvent(initial, {
      type: "listing.created",
      payload: {
        listing: {
          id: "listing-2",
          sellerId: "seller-2",
          sellerDisplayName: "Bob",
          photos: [],
          originalAmount: "2000",
          availableAmount: "1000",
          price: "39",
          currency: "ILS",
          network: "ERC20",
          paymentMethod: "Bank transfer",
          paymentMethods: ["Bank transfer"],
          minimumTrade: "100",
          maximumTrade: "1000",
          sellerDescription: "",
          responseTime: "10 min",
          status: "active",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      },
    });

    expect(created).toHaveLength(2);
    expect(created.find((item) => item.id === "listing-2")?.availableAmount).toBe("1000");

    const updated = applyRealtimeMarketplaceEvent(created, {
      type: "listing.quantity_changed",
      payload: { listingId: "listing-1", availableAmount: "250" },
    });

    expect(updated.find((item) => item.id === "listing-1")?.availableAmount).toBe("250");

    const removed = applyRealtimeMarketplaceEvent(updated, {
      type: "listing.removed",
      payload: { listingId: "listing-2" },
    });

    expect(removed.find((item) => item.id === "listing-2")).toBeUndefined();
  });

  it("publishes and delivers subscribed events to listeners", () => {
    const events: RealtimeEvent[] = [];
    const unsubscribe = subscribeRealtimeEvents((event) => {
      events.push(event);
    });

    publishRealtimeEvent({
      type: "listing.created",
      payload: {
        listing: {
          id: "listing-3",
          sellerId: "seller-3",
          sellerDisplayName: "Carol",
          photos: [],
          originalAmount: "300",
          availableAmount: "300",
          price: "40",
          currency: "ILS",
          network: "BEP20",
          paymentMethod: "Bank transfer",
          paymentMethods: ["Bank transfer"],
          minimumTrade: "50",
          maximumTrade: "300",
          sellerDescription: "",
          responseTime: "8 min",
          status: "active",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("listing.created");
    unsubscribe();
  });

  it("removes a purged smoke-test trade from live client state", () => {
    const requests = [{ id: "request-smoke" }, { id: "request-real" }] as PurchaseRequest[];

    const remaining = applyRealtimeTradeEvent(requests, {
      type: "trade.status_changed",
      payload: { requestId: "request-smoke", status: "cancelled", removed: true },
    });

    expect(remaining.map((request) => request.id)).toEqual(["request-real"]);
  });

  it("applies notification updates and deletions without waiting for a page reload", () => {
    const initial = [
      { id: "notification-one", userId: "buyer-1", state: "unread", isRead: false },
      { id: "notification-two", userId: "buyer-1", state: "read", isRead: true },
    ] as AlphaExchangeNotification[];
    const updatedNotification = { ...initial[0], state: "read", isRead: true } as AlphaExchangeNotification;

    const updated = applyRealtimeNotificationEvent(initial, {
      type: "notification.updated",
      payload: { notification: updatedNotification },
    });
    const remaining = applyRealtimeNotificationEvent(updated, {
      type: "notification.deleted",
      payload: { notificationId: "notification-two", userId: "buyer-1" },
    });

    expect(updated[0]).toMatchObject({ id: "notification-one", state: "read", isRead: true });
    expect(remaining.map((notification) => notification.id)).toEqual(["notification-one"]);
  });
});
