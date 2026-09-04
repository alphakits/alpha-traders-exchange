import type { PurchaseRequest } from "@/types/alpha-exchange";

export function canBuyerCancelTrade(request: PurchaseRequest, actorUserId: string) {
  return request.buyerId === actorUserId
    && (request.status === "pending"
      || (request.status === "accepted" && !request.buyerEvidence && !request.paymentSentAt));
}

export function canSellerDeclineTrade(request: PurchaseRequest, actorUserId: string) {
  return request.sellerId === actorUserId && request.status === "pending";
}
