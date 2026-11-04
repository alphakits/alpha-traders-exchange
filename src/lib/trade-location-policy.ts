import { isFaceToFacePaymentMethod } from "@/lib/marketplace-payment-methods";

/** UI and server use the same fail-closed gate, including the selected trade method (not listing options). */
export function canShareTradeLocation(trade: {
  paymentMethod?: string; status: string; closedAt?: string; completedAt?: string;
}) {
  return isFaceToFacePaymentMethod(trade.paymentMethod)
    && !trade.closedAt && !trade.completedAt
    && ["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(trade.status);
}

export const TRADE_LOCATION_UNAVAILABLE = "Location sharing is available only to the buyer and seller in an accepted, unfinished Face-to-Face trade.";
