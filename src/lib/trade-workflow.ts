import type { PurchaseRequestStatus, UserRole } from "@/types/alpha-exchange";

export function getPurchaseRequestStatusTransitionOptions(currentStatus: PurchaseRequestStatus, actorType: "seller" | "buyer") {
  if (actorType === "seller") {
    if (currentStatus === "pending") return ["accepted", "declined"] as const;
    if (currentStatus === "payment_sent") return ["funds_received"] as const;
    if (currentStatus === "funds_received") return ["usdt_release_pending"] as const;
    if (currentStatus === "usdt_release_pending") return ["usdt_sent"] as const;
    return [] as const;
  }

  if (currentStatus === "pending") return ["cancelled"] as const;
  if (currentStatus === "accepted") return ["payment_sent"] as const;
  if (currentStatus === "usdt_sent") return ["completed"] as const;
  return [] as const;
}

export function getTradeStatusDisplayLabel(status: PurchaseRequestStatus, isAr = false) {
  const labels = {
    pending: isAr ? "قيد الانتظار" : "Pending",
    accepted: isAr ? "تم القبول" : "Accepted",
    payment_sent: isAr ? "في انتظار تأكيد البائع" : "Waiting for bank confirmation",
    funds_received: isAr ? "تم استلام الأموال" : "Funds received",
    usdt_release_pending: isAr ? "إصدار USDT معلق" : "USDT release pending",
    usdt_sent: isAr ? "تم إرسال USDT" : "USDT sent",
    completed: isAr ? "مكتمل" : "Completed",
    locked: isAr ? "مقفل" : "Locked",
    review_open: isAr ? "مفتوح للمراجعة" : "Review open",
    declined: isAr ? "مرفوض" : "Declined",
    cancelled: isAr ? "ملغي" : "Cancelled",
  } satisfies Record<PurchaseRequestStatus, string>;
  return labels[status];
}

export function getTradeActorRole(actorRole: UserRole) {
  if (actorRole === "approved_seller" || actorRole === "pending_seller_approval") return "seller" as const;
  return "buyer" as const;
}
