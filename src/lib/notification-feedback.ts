import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

// Exact historical titles keep unread trade-category feedback under the same
// optional policy as newly produced review-category notices. Never infer this
// from a broad "review" match: dispute review decisions remain transactional.
export const OPTIONAL_FEEDBACK_TITLES = [
  "review available",
  "feedback required",
  "buyer left a review",
  "seller replied to your review",
  "seller left you feedback",
] as const;

const titles: ReadonlySet<string> = new Set(OPTIONAL_FEEDBACK_TITLES);
export function isOptionalFeedbackNotification(notification: Pick<AlphaExchangeNotification, "category" | "title">) {
  return notification.category === "review" || titles.has(notification.title.trim().toLowerCase());
}
