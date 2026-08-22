import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const NOTIFICATION_DESTINATION_ORIGIN = "https://www.alphatraders.co.il";

/**
 * Returns an explicit, internal destination that must stay ahead of generic
 * trade inference. In particular, an admin notification can reference a
 * trade for context without authorizing the admin to enter that Trade Room.
 */
export function getExplicitNonTradeRoomNotificationDestination(
  notification: Pick<AlphaExchangeNotification, "actionHref" | "relatedHref">,
) {
  const href = notification.actionHref?.trim() || notification.relatedHref?.trim();
  if (!href?.startsWith("/")) return null;

  try {
    const parsed = new URL(href, NOTIFICATION_DESTINATION_ORIGIN);
    if (parsed.origin !== NOTIFICATION_DESTINATION_ORIGIN) return null;
    const normalizedPathname = parsed.pathname.replace(/^\/(?:en|ar)(?=\/)/i, "");
    if (/^\/trade-room(?:\/|$)/i.test(normalizedPathname)) return null;
    return href;
  } catch {
    return null;
  }
}
