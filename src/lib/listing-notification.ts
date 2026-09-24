import { listingDestination } from "@/lib/action-destinations";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

export const NEW_LISTING_NOTIFICATION_REASON = "new_listing_published";

type ListingNotification = Partial<Pick<AlphaExchangeNotification, "category" | "reason" | "title" | "relatedListingId">>;

export function isNewListingBroadcastNotification(notification: ListingNotification) {
  return notification.category === "listing" && (
    notification.reason === NEW_LISTING_NOTIFICATION_REASON
    // Existing notifications predate the explicit event reason.
    || notification.title?.includes("New USDT Listing Available") === true
  );
}

export function listingNotificationViewDestination(notification: ListingNotification) {
  const id = notification.relatedListingId?.trim();
  return id ? listingDestination({ id }) : "/usdt-exchange";
}
