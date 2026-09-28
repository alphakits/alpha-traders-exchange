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
    // Prepared codes on pending requests are still hidden from the seller.
    || (request.status === "accepted" && request.messages?.some((message) => message.credentialKind === "cardless_code")),
  );
}

/** Bank disclosure locks buyer cancellation, but does not prove payment. */
export function hasRevealedBankDetails(request: PurchaseRequest) {
  return Boolean((request.sensitivePaymentKind === "bank_details" && request.sensitivePaymentSharedAt)
    || request.timeline?.some(event => event.type === "bank_details_revealed"));
}
