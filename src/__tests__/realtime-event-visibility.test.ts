import { describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@/lib/realtime";
import type { AlphaExchangeNotification, AlphaExchangeUser } from "@/types/alpha-exchange";

vi.mock("@/lib/alpha-exchange-store", () => ({
  sanitizeNotificationForClient: vi.fn((notification) => {
    const sanitized = { ...notification };
    delete sanitized.whatsappEvent;
    delete sanitized.whatsappEventAt;
    delete sanitized.whatsappEventKey;
    delete sanitized.whatsappChannelOnly;
    return sanitized;
  }),
  sanitizePurchaseRequestForActor: vi.fn((request) => request),
}));

import { realtimeEventForUser } from "@/lib/realtime-event-visibility";
import { sanitizePurchaseRequestForActor } from "@/lib/alpha-exchange-store";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

function viewer(id: string, role: "admin" | "approved_seller" = "approved_seller") {
  return {
    id,
    role,
    roles: [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
  } as Pick<AlphaExchangeUser, "id" | "role" | "roles" | "sellerStatus">;
}

function notification(overrides: Partial<AlphaExchangeNotification> = {}): AlphaExchangeNotification {
  return {
    id: "notification-1",
    userId: "seller-1",
    category: "trade",
    title: "Private notification",
    message: "Private message",
    isRead: false,
    createdAt: "2026-09-12T00:00:00.000Z",
    whatsappEvent: "trade_room_message",
    whatsappEventAt: "2026-09-12T00:00:00.000Z",
    whatsappEventKey: "wae-00000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}

describe("seller workspace realtime visibility", () => {
  it("never broadcasts a draft listing or its bank identifier to other sellers", () => {
    const listing = { id: "draft-private", sellerId: "seller-1", status: "draft", bankAccountId: "private-bank", sellerDisplayName: "Private Seller" } as MarketplaceListing;
    const event: RealtimeEvent = { type: "listing.created", payload: { listing } };
    expect(realtimeEventForUser(event, viewer("seller-2"))).toBeNull();
    expect(realtimeEventForUser(event, viewer("seller-1"))).toEqual(event);
    expect(realtimeEventForUser(event, viewer("admin-1", "admin"))).toEqual(event);
  });

  it.each([
    { type: "listing.quantity_changed", payload: { listingId: "draft-private", availableAmount: "9876" } },
    { type: "listing.status_changed", payload: { listingId: "draft-private", status: "draft" } },
    { type: "seller.status_changed", payload: { sellerId: "seller-1", onlineStatus: "online" } },
  ] as RealtimeEvent[])("scopes private live updates to their recipient: $type", (update) => {
    const event = { ...update, recipientUserId: "seller-1" };
    expect(realtimeEventForUser(event, viewer("seller-2"))).toBeNull();
    expect(realtimeEventForUser(event, viewer("seller-1"))).toEqual(event);
    expect(realtimeEventForUser(event, viewer("admin-1", "admin"))).toEqual(event);
  });

  it("does not reintroduce an unsanitized timeline beside the sanitized trade payload", () => {
    const request = { id: "trade-1", buyerId: "buyer-1", sellerId: "seller-1", status: "accepted", timeline: [{ message: "Private phone +972501234567" }] } as PurchaseRequest;
    const sanitized = { ...request, timeline: [{ message: "[private contact removed]" }] } as PurchaseRequest;
    vi.mocked(sanitizePurchaseRequestForActor).mockReturnValueOnce(sanitized);
    const event: RealtimeEvent = { type: "trade.status_changed", payload: { request, requestId: request.id, status: request.status, timeline: request.timeline } };
    const visible = realtimeEventForUser(event, viewer("seller-1"));
    expect(JSON.stringify(visible)).not.toContain("+972501234567");
    expect(visible?.payload).toMatchObject({ timeline: sanitized.timeline, request: sanitized });
    expect(realtimeEventForUser(event, viewer("seller-2"))).toBeNull();
  });
  it("never broadcasts a notification to a different user, including an admin", () => {
    const event = { type: "notification.created", payload: { notification: notification() } } as const;
    expect(realtimeEventForUser(event, viewer("seller-2"))).toBeNull();
    expect(realtimeEventForUser(event, viewer("admin-1", "admin"))).toBeNull();
  });

  it("strips internal WhatsApp delivery metadata from the recipient's event", () => {
    const event = { type: "notification.updated", payload: { notification: notification() } } as const;
    const visible = realtimeEventForUser(event, viewer("seller-1"));
    expect(visible).not.toBeNull();
    expect(visible && "notification" in visible.payload ? visible.payload.notification : null).not.toMatchObject({
      whatsappEvent: expect.anything(),
      whatsappEventAt: expect.anything(),
      whatsappEventKey: expect.anything(),
    });
  });

  it("suppresses channel-only notification rows even for their recipient", () => {
    const event = {
      type: "notification.created",
      payload: { notification: notification({ whatsappChannelOnly: true }) },
    } as const;
    expect(realtimeEventForUser(event, viewer("seller-1"))).toBeNull();
  });

  it("scopes notification deletion events to their recipient", () => {
    const event = {
      type: "notification.deleted",
      payload: { notificationId: "notification-1", userId: "seller-1" },
    } as const;
    expect(realtimeEventForUser(event, viewer("seller-1"))).toEqual(event);
    expect(realtimeEventForUser(event, viewer("seller-2"))).toBeNull();
  });

  it("does not leak Trade Room message identifiers to non-admin workspace streams", () => {
    const event: RealtimeEvent = {
      type: "trade.message_updated",
      payload: { requestId: "request-private", messageIds: ["message-private"] },
    };
    expect(realtimeEventForUser(event, viewer("seller-1"))).toBeNull();
    expect(realtimeEventForUser(event, viewer("admin-1", "admin"))).toEqual(event);
  });
});
