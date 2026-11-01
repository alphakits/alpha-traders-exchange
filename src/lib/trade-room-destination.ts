import type { PurchaseRequest } from "@/types/alpha-exchange";
import { isCashTradePaymentMethod, isFaceToFacePaymentMethod, isSellerTradeCompletionAvailable } from "@/lib/marketplace-payment-methods";

export type TradeRoomActionTarget =
  | "accept-trade"
  | "confirm-cash-payment"
  | "upload-payment-receipt"
  | "confirm-money-received"
  | "release-usdt"
  | "confirm-usdt-sent"
  | "complete-cash-trade"
  // Legacy deep-link target retained for already-delivered notifications.
  | "send-usdt-complete"
  | "upload-seller-evidence"
  | "confirm-usdt-received"
  | "review-trade"
  | "open-trade";

export type TradeRoomActionSnapshot = {
  requestId?: string;
  currentStage?: string;
  sellerId?: string;
  buyerId?: string;
  paymentMethod?: string;
};

type TradeActionRequest = Pick<PurchaseRequest, "id" | "sellerId" | "buyerId"> & { status: string; paymentMethod?: string };

function isSellerActor(request: TradeActionRequest, actorUserId: string) {
  return request.sellerId === actorUserId;
}

function isBuyerActor(request: TradeActionRequest, actorUserId: string) {
  return request.buyerId === actorUserId;
}

function resolveTradeRoomActionTarget(request: TradeActionRequest, actorUserId: string): TradeRoomActionTarget {
  if (request.status === "pending" && isSellerActor(request, actorUserId)) {
    return "accept-trade";
  }
  if (request.status === "accepted" && isBuyerActor(request, actorUserId)) {
    return isCashTradePaymentMethod(request.paymentMethod) ? "confirm-cash-payment" : "upload-payment-receipt";
  }
  if (isSellerActor(request, actorUserId) && (request.status === "payment_sent" || (request.status === "accepted" && isFaceToFacePaymentMethod(request.paymentMethod)))) {
    return "confirm-money-received";
  }
  if (isSellerActor(request, actorUserId) && isSellerTradeCompletionAvailable(request.paymentMethod, request.status)) {
    return "complete-cash-trade";
  }
  if (request.status === "funds_received" && isSellerActor(request, actorUserId)) {
    return isCashTradePaymentMethod(request.paymentMethod) ? "confirm-usdt-sent" : "release-usdt";
  }
  if (request.status === "usdt_release_pending" && isSellerActor(request, actorUserId)) {
    return isCashTradePaymentMethod(request.paymentMethod) ? "confirm-usdt-sent" : "upload-seller-evidence";
  }
  if ((request.status === "review_open" || request.status === "completed" || request.status === "locked") && (isBuyerActor(request, actorUserId) || isSellerActor(request, actorUserId))) {
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

export function buildTradeRoomDestination(request: TradeActionRequest, actorUserId: string) {
  const action = resolveTradeRoomActionTarget(request, actorUserId);
  const hash = resolveTradeRoomHashForAction(action);
  return `/trade-room/${request.id}?action=${encodeURIComponent(action)}#${hash}`;
}

/** Resolve stored notification snapshots with the same rules as live trade links. */
export function getTradeRoomSnapshotAction(snapshot: TradeRoomActionSnapshot | null | undefined, actorUserId: string) {
  const id = String(snapshot?.requestId ?? "").trim();
  const status = String(snapshot?.currentStage ?? "").trim();
  const sellerId = String(snapshot?.sellerId ?? "").trim();
  const buyerId = String(snapshot?.buyerId ?? "").trim();
  if (!id || !status || !sellerId || !buyerId) return null;
  return resolveTradeRoomActionTarget({ id, status, sellerId, buyerId, paymentMethod: snapshot?.paymentMethod }, actorUserId);
}

export function tradeRoomActionLabel(action: string, locale: "ar" | "en") {
  const isAr = locale === "ar";
  if (action === "accept-trade") return isAr ? "مراجعة طلب الصفقة" : "Review trade request";
  if (action === "confirm-cash-payment") return isAr ? "تأكيد تسليم النقد أو الرمز" : "Confirm cash or code sent";
  if (action === "upload-payment-receipt") return isAr ? "رفع إيصال الدفع" : "Upload payment receipt";
  if (action === "confirm-money-received") return isAr ? "تأكيد استلام الدفعة" : "Confirm payment received";
  if (action === "release-usdt") return isAr ? "بدء إرسال USDT" : "Begin USDT release";
  if (action === "upload-seller-evidence") return isAr ? "رفع الإثبات وإرسال USDT" : "Upload proof and send USDT";
  if (action === "confirm-usdt-sent") return isAr ? "تأكيد إرسال USDT" : "Confirm USDT sent";
  if (action === "complete-cash-trade" || action === "send-usdt-complete") return isAr ? "تحديد الصفقة كمكتملة" : "Mark trade as completed";
  if (action === "review-trade") return isAr ? "إضافة تقييم للصفقة" : "Leave a trade review";
  return isAr ? "عرض تفاصيل الصفقة" : "View trade details";
}
