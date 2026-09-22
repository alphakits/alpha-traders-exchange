import type { AlphaExchangeTradeReminder, PurchaseRequest } from "@/types/alpha-exchange";
import { isCashTradePaymentMethod } from "@/lib/marketplace-payment-methods";

/** Only navigation state is shared with the header; never wallet or payment details. */
export type TradeHeaderActivity = Pick<PurchaseRequest,
  "id" | "tradeId" | "displayNumber" | "buyerId" | "sellerId" | "paymentMethod" | "status" | "updatedAt"
> & { buyerReviewed: boolean };

export function toTradeHeaderActivity(request: PurchaseRequest): TradeHeaderActivity {
  const { id, tradeId, displayNumber, buyerId, sellerId, paymentMethod, status, updatedAt } = request;
  return { id, tradeId, displayNumber, buyerId, sellerId, paymentMethod, status, updatedAt, buyerReviewed: Boolean(request.buyerReview) };
}

export function getTradeHeaderReminderKind(trade: TradeHeaderActivity, actorId: string): AlphaExchangeTradeReminder["kind"] | null {
  const isBuyer = trade.buyerId === actorId;
  const isSeller = trade.sellerId === actorId;
  if (!isBuyer && !isSeller) return null;
  if (["review_open", "completed", "locked"].includes(trade.status)) {
    return isBuyer && !trade.buyerReviewed ? "feedback_required" : null;
  }
  if (isBuyer && (trade.status === "accepted" || trade.status === "usdt_sent")) return "buyer_action_required";
  if (isSeller && (["pending", "payment_sent", "funds_received", "usdt_release_pending"].includes(trade.status)
    || (trade.status === "usdt_sent" && isCashTradePaymentMethod(trade.paymentMethod)))) return "seller_action_required";
  return null;
}

export function isTradeHeaderActivityResolved(trade: TradeHeaderActivity, actorId: string) {
  return trade.status === "cancelled" || trade.status === "declined"
    || (["review_open", "completed", "locked"].includes(trade.status) && getTradeHeaderReminderKind(trade, actorId) === null);
}

// In-memory, actor-scoped snapshots keep a cached Next.js layout current without
// router.refresh(), auth reads, polling, or any write to the trade itself.
const activities = new Map<string, TradeHeaderActivity>();
const listeners = new Set<() => void>();

export function publishTradeHeaderActivity(actorId: string, trade: TradeHeaderActivity) {
  if (typeof window === "undefined" || (trade.buyerId !== actorId && trade.sellerId !== actorId)) return;
  const previous = activities.get(actorId);
  if (previous && Date.parse(previous.updatedAt) > Date.parse(trade.updatedAt)) return;
  if (JSON.stringify(previous) === JSON.stringify(trade)) return;
  activities.set(actorId, trade);
  for (const listener of listeners) listener();
}

export function readTradeHeaderActivity(actorId: string) {
  return activities.get(actorId) ?? null;
}

export function subscribeTradeHeaderActivity(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
