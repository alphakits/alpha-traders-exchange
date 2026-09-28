import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const OWNER_ACTION_CATEGORIES = new Set<AlphaExchangeNotification["category"]>([
  "application",
  "listing",
  "dispute",
  "report",
  "system",
]);

/**
 * Keeps mobile notification surfaces consistent about what still needs a tap.
 * Priority alone is not enough because ordinary trade updates are intentionally
 * high priority; owner review categories must also carry an explicit action.
 */
export function isNotificationActionRequired(notification: AlphaExchangeNotification) {
  if (notification.state === "archived") return false;

  const text = `${notification.title} ${notification.message} ${notification.actionLabel ?? ""}`.toLowerCase();
  if (
    text.includes("action required")
    || text.includes("feedback required")
    || text.includes("confirm usdt receipt")
  ) {
    return true;
  }

  const urgent = notification.priority === "critical" || notification.priority === "high";
  const actionable = Boolean(notification.actionHref || notification.relatedHref);
  return urgent && actionable && OWNER_ACTION_CATEGORIES.has(notification.category);
}
