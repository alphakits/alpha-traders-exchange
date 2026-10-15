import type { PurchaseRequest } from "@/types/alpha-exchange";
import { hasIrreversibleRequestProgress, hasRevealedBankDetails } from "./trade-cancellation";

/** Acceptance exposes payment actions. Do not wait for a receipt or payment flag. */
export function areTradeAmountsLocked(request: PurchaseRequest) {
  return request.status !== "pending" || Boolean(
    request.tradeCreatedAt
    || request.priceOfferAcceptedAt
    || request.sensitivePaymentSharedAt
    || hasIrreversibleRequestProgress(request)
    || hasRevealedBankDetails(request)
    // A stale/rolled-back status must never reopen financial terms.
    || request.timeline?.some(event => [
      "request_accepted", "price_offer_accepted", "payment_sent",
      "seller_confirmed_funds", "usdt_release_started", "usdt_sent",
      "trade_completed", "buyer_evidence_uploaded", "seller_evidence_uploaded",
    ].includes(event.type)),
  );
}
