import type { PurchaseRequest } from "@/types/alpha-exchange";

/** Presentation only. The trade room remains the authority for every action. */
export function workspaceTradeNextStep(request: Pick<PurchaseRequest, "status">, side: "buyer" | "seller", isAr: boolean) {
  const seller = side === "seller";
  switch (request.status) {
    case "pending":
      return seller
        ? (isAr ? "راجع طلب المشتري داخل غرفة الصفقة." : "Review the buyer's request in the trade room.")
        : (isAr ? "طلبك بانتظار قرار البائع. يمكنك متابعة حالته داخل غرفة الصفقة." : "Your request is awaiting the seller's decision. Track it in the trade room.");
    case "accepted":
      return seller
        ? (isAr ? "تابع ترتيبات الدفع داخل غرفة الصفقة؛ أكد الاستلام بعد وصول الدفع فقط." : "Follow the payment arrangements in the trade room. Confirm receipt only after payment arrives.")
        : (isAr ? "راجع تعليمات طريقة الدفع المقبولة داخل غرفة الصفقة قبل الدفع." : "Review the accepted payment instructions in the trade room before paying.");
    case "payment_sent":
      return seller
        ? (isAr ? "تحقق من استلام الدفع الفعلي ثم تابع الخطوة المتاحة داخل غرفة الصفقة." : "Verify actual receipt of payment, then continue with the available trade-room action.")
        : (isAr ? "البائع يتحقق من الدفع. تابع التحديثات داخل غرفة الصفقة." : "The seller is checking payment. Follow updates in the trade room.");
    case "funds_received":
    case "usdt_release_pending":
      return seller
        ? (isAr ? "افتح غرفة الصفقة لمتابعة إرسال USDT حسب الخطوة الحالية." : "Open the trade room to continue sending USDT from the current step.")
        : (isAr ? "تم تسجيل استلام الدفع. تابع إرسال USDT داخل غرفة الصفقة." : "Payment receipt has been recorded. Track USDT delivery in the trade room.");
    case "usdt_sent":
      return isAr ? "تم تسجيل إرسال USDT. افتح غرفة الصفقة لمراجعة الإجراء التالي المتاح لك." : "USDT sending has been recorded. Open the trade room to review your available next action.";
    case "locked":
      return isAr ? "الصفقة مقفلة حاليًا. راجع سبب القفل وحالة المتابعة داخل غرفة الصفقة." : "This trade is currently locked. Review its reason and support status in the trade room.";
    default:
      return isAr ? "راجع تفاصيل الصفقة والخطوات المتاحة داخل غرفة الصفقة." : "Review the trade details and available steps in the trade room.";
  }
}
