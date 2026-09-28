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
