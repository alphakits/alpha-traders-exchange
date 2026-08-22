import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const TRADE_ROOM_CONVERSATION_REASONS = new Set([
  "trade_room_message",
  "trade_room_poke",
]);

export function isTradeRoomConversationNotification(notification: Pick<AlphaExchangeNotification, "reason">) {
  return TRADE_ROOM_CONVERSATION_REASONS.has(String(notification.reason ?? "").trim());
}

function extractRequestIdFromTradeRoomHref(href: string | null | undefined) {
  if (!href) return null;
  try {
    const parsed = new URL(href, "https://www.alphatraders.co.il");
    const match = parsed.pathname.match(/\/trade-room\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    const fromQuery = parsed.searchParams.get("requestId")?.trim();
    return fromQuery || null;
  } catch {
    const match = href.match(/\/trade-room\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    const queryMatch = href.match(/[?&]requestId=([^&#]+)/i);
    return queryMatch?.[1] ? decodeURIComponent(queryMatch[1]) : null;
  }
}

/**
 * Conversation alerts intentionally bypass the lifecycle-action resolver. A
 * message/Poke must open the exact chat section of its own Trade Room, rather
 * than routing a recipient to a generic or currently-required trade action.
 */
export function getTradeRoomConversationDestination(notification: AlphaExchangeNotification) {
  if (!isTradeRoomConversationNotification(notification)) return null;
  const requestId = notification.relatedRequestId?.trim()
    || extractRequestIdFromTradeRoomHref(notification.actionHref)
    || extractRequestIdFromTradeRoomHref(notification.relatedHref);
  if (!requestId) return null;
  return `/trade-room/${encodeURIComponent(requestId)}?action=open-trade#chat`;
}
