import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
import { parseInternalAppUrl } from "@/lib/internal-app-url";

const TRADE_ROOM_CONVERSATION_REASONS = new Set([
  "trade_room_message",
  "trade_room_poke",
]);

export function extractRequestIdFromTradeRoomHref(href: string | null | undefined) {
  const parsed = parseInternalAppUrl(href);
  if (!parsed) return null;
  try {
    const match = parsed.pathname.match(/^\/(?:en\/|ar\/)?trade-room\/([^/]+)\/?$/i);
    if (match?.[1]) return decodeURIComponent(match[1]).trim() || null;
    const fromQuery = parsed.searchParams.get("requestId")?.trim();
    return fromQuery || null;
  } catch {
    return null;
  }
}

export function extractTradeRoomHrefFromRelatedHref(href: string | null | undefined) {
  const requestId = extractRequestIdFromTradeRoomHref(href);
  return requestId ? `/trade-room/${encodeURIComponent(requestId)}` : null;
}

function isExplicitTradeRoomChatHref(href: string | null | undefined) {
  const parsed = parseInternalAppUrl(href);
  return Boolean(parsed && /^\/(?:en\/|ar\/)?trade-room\/[^/]+\/?$/i.test(parsed.pathname) && parsed.hash === "#chat");
}

export function isTradeRoomConversationNotification(
  notification: Pick<AlphaExchangeNotification, "reason" | "actionHref" | "relatedHref">,
) {
  const reason = String(notification.reason ?? "").trim();
  if (reason) return TRADE_ROOM_CONVERSATION_REASONS.has(reason);
  // Older/stale client snapshots can lack the server's conversation reason
  // while retaining its exact internal `#chat` action. Only use that marker
  // when no explicit lifecycle reason is present; ordinary trade links stay
  // on their normal action path.
  return isExplicitTradeRoomChatHref(notification.actionHref)
    || isExplicitTradeRoomChatHref(notification.relatedHref);
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
