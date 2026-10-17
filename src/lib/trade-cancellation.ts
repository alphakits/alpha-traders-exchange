import type { PurchaseRequest } from "@/types/alpha-exchange";

/** Shared by the client and server; the server also checks stored evidence. */
export function hasIrreversibleRequestProgress(request: PurchaseRequest) {
  if (request.status !== "pending" && request.status !== "accepted") return true;
  return Boolean(
    request.paymentSentAt
    || request.fundsReceivedAt
    || request.usdtReleaseStartedAt
    || request.usdtSentAt
    || request.completedAt
    || request.buyerEvidence
    || request.sellerEvidence
    // Revealing bank account details is reversible. A disclosed withdrawal
    // credential can already be used to collect cash, even with a stale status.
    || (request.sensitivePaymentKind === "cardless_code" && request.sensitivePaymentSharedAt)
    // New accepted requests keep prepared codes private until buyer confirmation.
    // Missing markers on legacy accepted records remain conservatively locked.
    || (request.status === "accepted" && request.cardlessCodeAwaitingBuyerConfirmation !== true
      && request.messages?.some((message) => message.credentialKind === "cardless_code")),
  );
}

/** Only disclosure to the buyer locks their cancellation; it does not prove payment. */
export function hasRevealedBankDetails(request: PurchaseRequest) {
  return Boolean((request.sensitivePaymentKind === "bank_details" && request.sensitivePaymentSharedAt)
    || request.timeline?.some(event => event.type === "bank_details_revealed"
      // Preserve conservative handling of older disclosure events with no actor.
      // Seller/owner inspection must not masquerade as buyer disclosure.
      && (!event.actorUserId || event.actorUserId === request.buyerId)));
}
