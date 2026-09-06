import type {
  MobileLocale,
  MobileNotification,
  MobileNotificationDestination,
} from "@alpha-traders/contracts";
import { isNotificationActionRequired } from "@/lib/notification-action-required";
import { localizeNotificationCopy } from "@/lib/notification-localization";
import type { AlphaExchangeNotification, NotificationTradeSnapshot } from "@/types/alpha-exchange";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function safeResourceId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return RESOURCE_ID_PATTERN.test(normalized) ? normalized : null;
}

function notificationDestination(notification: AlphaExchangeNotification): MobileNotificationDestination | null {
  const requestId = safeResourceId(
    notification.relatedRequestId ?? notification.tradeSnapshot?.requestId,
  );
  if (requestId && (
    notification.category === "trade"
    || notification.category === "review"
    || notification.category === "dispute"
  )) {
    return { screen: "trade", requestId };
  }
  if (notification.category === "listing") return { screen: "marketplace" };
  if (notification.category === "account" || notification.category === "application") {
    return { screen: "profile" };
  }
  return null;
}

function currentTradeActionRequired(
  snapshot: NotificationTradeSnapshot | undefined,
  recipientUserId: string,
) {
  if (!snapshot) return false;
  const isBuyer = snapshot.buyerId === recipientUserId;
  const isSeller = snapshot.sellerId === recipientUserId;
  if (snapshot.currentStage === "pending") return isSeller;
  if (snapshot.currentStage === "accepted") return isBuyer;
  if (snapshot.currentStage === "payment_sent") return isSeller;
  if (snapshot.currentStage === "funds_received") return isSeller;
  if (snapshot.currentStage === "usdt_release_pending") return isSeller;
  if (snapshot.currentStage === "usdt_sent") return isBuyer;
  if (snapshot.currentStage === "review_open" || snapshot.currentStage === "completed") return isBuyer;
  return false;
}

/**
 * Converts the richer web notification model into a strict native allowlist.
 * Internal user IDs, raw hrefs, counterpart IDs, bank data, and trade amounts
 * are deliberately omitted from the native response.
 */
export function toMobileNotification(
  notification: AlphaExchangeNotification,
  locale: MobileLocale,
): MobileNotification {
  const copy = localizeNotificationCopy(notification, locale);
  const destination = notificationDestination(notification);
  return {
    id: notification.id,
    category: notification.category,
    title: copy.title,
    message: copy.message,
    isRead: notification.state ? notification.state !== "unread" : notification.isRead,
    priority: notification.priority ?? "normal",
    actionRequired: Boolean(destination) && (
      currentTradeActionRequired(notification.tradeSnapshot, notification.userId)
      || isNotificationActionRequired(notification)
    ),
    destination,
    relatedDisplayNumber: notification.relatedRequestDisplayNumber
      ?? notification.relatedTradeDisplayNumber
      ?? notification.relatedListingDisplayNumber,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt ?? notification.createdAt,
  };
}
