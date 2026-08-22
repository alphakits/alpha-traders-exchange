import { describe, expect, it } from "vitest";
import { getTradeRoomConversationDestination } from "@/lib/trade-room-notification-destination";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

function notification(input: Partial<AlphaExchangeNotification>): AlphaExchangeNotification {
  return {
    id: "notification-1",
    userId: "recipient-1",
    category: "trade",
    title: "Trade update",
    message: "Open the Trade Room.",
    isRead: false,
    state: "unread",
    createdAt: "2026-08-22T10:00:00.000Z",
    ...input,
  };
}

describe("Trade Room conversation notification destinations", () => {
  it.each([
    "trade_room_message",
    "trade_room_poke",
  ])("keeps the exact chat destination for %s notifications", (reason) => {
    expect(getTradeRoomConversationDestination(notification({
      reason,
      relatedRequestId: "purchase-123",
      actionHref: "/trade-room/purchase-123#chat",
    }))).toBe("/trade-room/purchase-123?action=open-trade#chat");
  });

  it("derives the canonical request id from an internal Trade Room href when needed", () => {
    expect(getTradeRoomConversationDestination(notification({
      reason: "trade_room_message",
      actionHref: "https://www.alphatraders.co.il/en/trade-room/purchase%2F123#chat",
    }))).toBe("/trade-room/purchase%2F123?action=open-trade#chat");
  });

  it("does not override lifecycle notification routing", () => {
    expect(getTradeRoomConversationDestination(notification({
      reason: "trade_accepted",
      relatedRequestId: "purchase-123",
      actionHref: "/trade-room/purchase-123#chat",
    }))).toBeNull();
  });
});
