import type { PurchaseRequest } from "@/types/alpha-exchange";
import { hasIrreversibleRequestProgress } from "./trade-cancellation";

/** Amount proposals remain available until payment, cash confirmation or code disclosure. */
export function areTradeAmountsLocked(request: PurchaseRequest) {
  return hasIrreversibleRequestProgress(request) || Boolean(
    request.lockedAt
    || request.closedAt
    || request.timedOutAt
    // Bank details alone do not prove payment. Unknown legacy disclosure kinds
    // remain locked because they may represent a usable withdrawal credential.
    || (request.sensitivePaymentSharedAt && request.sensitivePaymentKind !== "bank_details")
    // Older accepted ATM records exposed their credential at acceptance. Keep
    // that history locked even if the current status was rolled back to pending.
    || (request.cardlessCodeAwaitingBuyerConfirmation !== true
      && (request.tradeCreatedAt || request.priceOfferAcceptedAt || request.timeline?.some(event =>
        event.type === "request_accepted" || event.type === "price_offer_accepted"))
      && request.messages?.some(message => message.credentialKind === "cardless_code"))
    // A stale/rolled-back status must never reopen financial terms.
    || request.timeline?.some(event => [
      "payment_sent",
      "seller_confirmed_funds", "buyer_confirmed_funds", "usdt_release_started", "usdt_sent",
      "trade_completed", "buyer_evidence_uploaded", "seller_evidence_uploaded",
      "trade_timed_out", "trade_locked", "request_declined", "price_offer_declined",
      "request_cancelled", "buyer_confirmed_receipt", "buyer_confirmation_overdue", "trade_closed_manually",
    ].includes(event.type)),
  );
}
