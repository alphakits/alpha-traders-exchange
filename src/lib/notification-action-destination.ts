import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
import { APP_DESTINATION_ORIGIN, parseInternalAppUrl } from "@/lib/internal-app-url";
import { isNewListingBroadcastNotification, listingNotificationViewDestination } from "@/lib/listing-notification";

type NotificationDestination = Pick<AlphaExchangeNotification, "actionHref" | "relatedHref">
  & Partial<Pick<AlphaExchangeNotification, "category" | "reason" | "title" | "relatedListingId">>;

function newListingDestination(notification: NotificationDestination) {
  return isNewListingBroadcastNotification(notification)
    ? listingNotificationViewDestination(notification)
    : null;
}

const NOTIFICATION_DESTINATION_ORIGIN = APP_DESTINATION_ORIGIN;

function safeInternalNotificationHref(href: string | null | undefined) {
  const normalizedHref = href?.trim();
  if (!normalizedHref?.startsWith("/") || normalizedHref.startsWith("//")) return null;

  const parsed = parseInternalAppUrl(normalizedHref);
  return parsed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
}

/**
 * Returns the first safe internal action target. A malformed legacy actionHref
 * must not hide a valid relatedHref, and an external value must never reach the
 * application router.
 */
export function getSafeInternalNotificationDestination(
  notification: NotificationDestination,
) {
  return newListingDestination(notification) ?? safeInternalNotificationHref(notification.actionHref)
    ?? safeInternalNotificationHref(notification.relatedHref);
}

/**
 * Returns an explicit, internal destination that must stay ahead of generic
 * trade inference. In particular, an admin notification can reference a
 * trade for context without authorizing the admin to enter that Trade Room.
 */
export function getExplicitNonTradeRoomNotificationDestination(
  notification: NotificationDestination,
) {
  const listingDestination = newListingDestination(notification);
  if (listingDestination) return listingDestination;
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
