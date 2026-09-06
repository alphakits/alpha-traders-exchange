import type {
  MobileLocale,
  MobileTradeStatus,
  MobileTradeTimelineEvent,
} from "@alpha-traders/contracts";

const statusLabels: Record<MobileTradeStatus, Record<MobileLocale, string>> = {
  pending: { en: "Awaiting seller", ar: "بانتظار البائع" },
  accepted: { en: "Accepted", ar: "تم القبول" },
  payment_sent: { en: "Payment sent", ar: "تم إرسال الدفعة" },
  funds_received: { en: "Funds confirmed", ar: "تم تأكيد الأموال" },
  usdt_release_pending: { en: "USDT release", ar: "تحويل USDT" },
  usdt_sent: { en: "USDT sent", ar: "تم إرسال USDT" },
  completed: { en: "Completed", ar: "مكتملة" },
  locked: { en: "Under review", ar: "قيد المراجعة" },
  review_open: { en: "Completed", ar: "مكتملة" },
  declined: { en: "Declined", ar: "مرفوضة" },
  cancelled: { en: "Cancelled", ar: "ملغاة" },
};

const eventLabels: Record<MobileTradeTimelineEvent, Record<MobileLocale, string>> = {
  request_submitted: { en: "Purchase request submitted", ar: "تم إرسال طلب الشراء" },
  price_offer_submitted: { en: "Price offer submitted", ar: "تم إرسال عرض السعر" },
  request_accepted: { en: "Seller accepted the request", ar: "قبل البائع الطلب" },
  price_offer_accepted: { en: "Seller accepted the price offer", ar: "قبل البائع عرض السعر" },
  payment_sent: { en: "Buyer submitted payment", ar: "أرسل المشتري الدفعة" },
  seller_confirmed_funds: { en: "Seller confirmed the funds", ar: "أكد البائع استلام الأموال" },
  usdt_release_started: { en: "USDT release started", ar: "بدأ تحويل USDT" },
  usdt_sent: { en: "Seller sent USDT", ar: "أرسل البائع USDT" },
  trade_completed: { en: "Trade completed", ar: "اكتملت الصفقة" },
  trade_timed_out: { en: "Trade timed out", ar: "انتهت مهلة الصفقة" },
  trade_locked: { en: "Trade moved to review", ar: "تم نقل الصفقة للمراجعة" },
  review_unlocked: { en: "Review is available", ar: "أصبح التقييم متاحًا" },
  dispute_opened: { en: "A dispute was opened", ar: "تم فتح نزاع" },
  commission_recorded: { en: "Commission recorded", ar: "تم تسجيل العمولة" },
  commission_paid: { en: "Commission paid", ar: "تم دفع العمولة" },
  buyer_evidence_uploaded: { en: "Payment receipt uploaded", ar: "تم رفع إثبات الدفع" },
  seller_evidence_uploaded: { en: "USDT transfer proof uploaded", ar: "تم رفع إثبات تحويل USDT" },
  request_declined: { en: "Seller declined the request", ar: "رفض البائع الطلب" },
  price_offer_declined: { en: "Seller declined the price offer", ar: "رفض البائع عرض السعر" },
  request_cancelled: { en: "Buyer cancelled the request", ar: "ألغى المشتري الطلب" },
  buyer_confirmed_receipt: { en: "Buyer confirmed receipt", ar: "أكد المشتري الاستلام" },
  buyer_confirmation_overdue: { en: "Buyer confirmation overdue", ar: "تأخر تأكيد المشتري" },
  trade_closed_manually: { en: "Trade closed", ar: "تم إغلاق الصفقة" },
  trade_inactivity_warning_sent: { en: "Inactivity reminder sent", ar: "تم إرسال تذكير بعدم النشاط" },
  bank_details_revealed: { en: "Bank details viewed", ar: "تم عرض التفاصيل البنكية" },
};

export function mobileTradeStatusLabel(status: MobileTradeStatus, locale: MobileLocale) {
  return statusLabels[status][locale];
}

export function mobileTradeEventLabel(event: MobileTradeTimelineEvent, locale: MobileLocale) {
  return eventLabels[event][locale];
}

export function mobilePaymentMethodLabel(method: string, locale: MobileLocale) {
  if (locale === "en") return method;
  if (method === "Bank Transfer") return "تحويل بنكي";
  if (method === "Face-to-Face (Meet in Person)") return "لقاء مباشر وجهًا لوجه";
  if (method === "Cardless ATM Withdrawal") return "سحب من الصراف دون بطاقة";
  return method;
}
