import type { PurchaseRequest } from "@/types/alpha-exchange";

export type TradeRoomActionTarget =
  | "accept-trade"
  | "upload-payment-receipt"
  | "confirm-money-received"
  | "release-usdt"
  | "upload-seller-evidence"
  | "confirm-usdt-received"
  | "review-trade"
  | "open-trade";

function isSellerActor(request: PurchaseRequest, actorUserId: string) {
  return request.sellerId === actorUserId;
}

function isBuyerActor(request: PurchaseRequest, actorUserId: string) {
  return request.buyerId === actorUserId;
}

function resolveTradeRoomActionTarget(request: PurchaseRequest, actorUserId: string): TradeRoomActionTarget {
  if (request.status === "pending" && isSellerActor(request, actorUserId)) {
    return "accept-trade";
  }
  if (request.status === "accepted" && isBuyerActor(request, actorUserId)) {
    return "upload-payment-receipt";
  }
  if (request.status === "payment_sent" && isSellerActor(request, actorUserId)) {
    return "confirm-money-received";
  }
  if (request.status === "funds_received" && isSellerActor(request, actorUserId)) {
    return "upload-seller-evidence";
  }
  if (request.status === "usdt_release_pending" && isSellerActor(request, actorUserId)) {
    return "upload-seller-evidence";
  }
  if (request.status === "usdt_sent" && isBuyerActor(request, actorUserId)) {
    return "confirm-usdt-received";
  }
  if ((request.status === "review_open" || request.status === "completed" || request.status === "locked") && isBuyerActor(request, actorUserId)) {
    return "review-trade";
  }
  return "open-trade";
}

function resolveTradeRoomHashForAction(action: TradeRoomActionTarget) {
  if (action === "upload-payment-receipt" || action === "upload-seller-evidence") return "evidence";
  if (action === "review-trade") return "status-banner";
  if (action === "open-trade") return "status-banner";
  return "action-required";
}

export function buildTradeRoomDestination(request: PurchaseRequest, actorUserId: string) {
  const action = resolveTradeRoomActionTarget(request, actorUserId);
  const hash = resolveTradeRoomHashForAction(action);
  return `/trade-room/${request.id}?action=${encodeURIComponent(action)}#${hash}`;
}
