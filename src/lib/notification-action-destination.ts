import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const NOTIFICATION_DESTINATION_ORIGIN = "https://www.alphatraders.co.il";

function safeInternalNotificationHref(href: string | null | undefined) {
  const normalizedHref = href?.trim();
  if (!normalizedHref?.startsWith("/") || normalizedHref.startsWith("//")) return null;

  try {
    const parsed = new URL(normalizedHref, NOTIFICATION_DESTINATION_ORIGIN);
    if (parsed.origin !== NOTIFICATION_DESTINATION_ORIGIN) return null;
    return normalizedHref;
  } catch {
    return null;
  }
}

/**
 * Returns the first safe internal action target. A malformed legacy actionHref
 * must not hide a valid relatedHref, and an external value must never reach the
 * application router.
 */
export function getSafeInternalNotificationDestination(
  notification: Pick<AlphaExchangeNotification, "actionHref" | "relatedHref">,
) {
  return safeInternalNotificationHref(notification.actionHref)
    ?? safeInternalNotificationHref(notification.relatedHref);
}

/**
 * Returns an explicit, internal destination that must stay ahead of generic
 * trade inference. In particular, an admin notification can reference a
 * trade for context without authorizing the admin to enter that Trade Room.
 */
export function getExplicitNonTradeRoomNotificationDestination(
  notification: Pick<AlphaExchangeNotification, "actionHref" | "relatedHref">,
) {
  for (const candidate of [notification.actionHref, notification.relatedHref]) {
    const href = safeInternalNotificationHref(candidate);
    if (!href) continue;
    const parsed = new URL(href, NOTIFICATION_DESTINATION_ORIGIN);
    const normalizedPathname = parsed.pathname.replace(/^\/(?:en|ar)(?=\/)/i, "");
    if (/^\/trade-room(?:\/|$)/i.test(normalizedPathname)) continue;
    return href;
  }
  return null;
}
