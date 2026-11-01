/** Private, allowlisted record. Never add contact details, credentials or free text. */
export interface TradeCompletionReceipt {
  version: 1;
  receiptNumber: string;
  tradeReference: string;
  source: "completion" | "historical_record";
  fiatAmountBasis?: "saved_quote_reconstruction";
  createdAt: string | null;
  completedAt: string | null;
  buyerPublicId: string;
  sellerPublicId: string;
  usdtAmount: string;
  currency: string;
  pricePerUsdt: string | null;
  baseFiatAmount: string | null;
  buyerFeeFiat: string | null;
  fiatAmount: string;
  buyerFeeUsdt: string | null;
  sellerFeeUsdt: string | null;
  totalPlatformFeeUsdt: string | null;
  network: string;
  paymentMethod: string;
  history: Array<{ event: string; at: string; actor: "buyer" | "seller" | "owner" | "admin" | "system" }>;
}

export const RECEIPT_EVENT_LABELS: Record<string, { en: string; ar: string }> = {
  request_submitted: { en: "Request submitted", ar: "تم تقديم الطلب" },
  price_offer_submitted: { en: "Price offer submitted", ar: "تم تقديم عرض السعر" },
  request_accepted: { en: "Request accepted", ar: "تم قبول الطلب" },
  price_offer_accepted: { en: "Price offer accepted", ar: "تم قبول عرض السعر" },
  payment_sent: { en: "Buyer confirmed payment sent", ar: "أكد المشتري إرسال الدفع" },
  seller_confirmed_funds: { en: "Seller confirmed funds received", ar: "أكد البائع استلام الأموال" },
  buyer_confirmed_funds: { en: "Buyer confirmed cash handover", ar: "أكد المشتري تسليم النقد" },
  usdt_release_started: { en: "USDT release started", ar: "بدأ إرسال USDT" },
  usdt_sent: { en: "Seller confirmed USDT sent", ar: "أكد البائع إرسال USDT" },
  trade_completed: { en: "Trade completed", ar: "اكتملت الصفقة" },
  trade_locked: { en: "Trade locked", ar: "تم قفل الصفقة" },
  review_unlocked: { en: "Review window opened", ar: "تم فتح التقييم" },
  trade_timed_out: { en: "Trade deadline elapsed", ar: "انتهت مهلة الصفقة" },
  dispute_opened: { en: "Dispute opened", ar: "تم فتح نزاع" },
  dispute_resolved: { en: "Dispute resolved", ar: "تم حل النزاع" },
  commission_recorded: { en: "Platform fees recorded", ar: "تم تسجيل رسوم المنصة" },
  commission_paid: { en: "Platform fees paid", ar: "تم دفع رسوم المنصة" },
  buyer_evidence_uploaded: { en: "Buyer evidence uploaded", ar: "تم رفع إثبات المشتري" },
  seller_evidence_uploaded: { en: "Seller evidence uploaded", ar: "تم رفع إثبات البائع" },
  request_declined: { en: "Request declined", ar: "تم رفض الطلب" },
  price_offer_declined: { en: "Price offer declined", ar: "تم رفض عرض السعر" },
  request_cancelled: { en: "Request cancelled", ar: "تم إلغاء الطلب" },
  buyer_confirmed_receipt: { en: "Buyer confirmed USDT receipt", ar: "أكد المشتري استلام USDT" },
  buyer_confirmation_overdue: { en: "Buyer confirmation overdue", ar: "تأخر تأكيد المشتري" },
  trade_closed_manually: { en: "Trade administratively closed", ar: "تم إغلاق الصفقة إداريًا" },
  trade_inactivity_warning_sent: { en: "Inactivity reminder sent", ar: "تم إرسال تذكير بعدم النشاط" },
  bank_details_revealed: { en: "Payment details shared securely", ar: "تمت مشاركة بيانات الدفع بأمان" },
};

export function receiptEventLabel(event: string, locale: "ar" | "en") {
  return RECEIPT_EVENT_LABELS[event]?.[locale] ?? (locale === "ar" ? "تحديث الصفقة" : "Trade update");
}

export function receiptDate(value: string | null, locale: "ar" | "en") {
  if (!value || !Number.isFinite(Date.parse(value))) return locale === "ar" ? "غير مسجل" : "Not recorded";
  // The same explicitly named timezone in email, browser and native app.
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

type ReceiptDisplayRow = [label: string, value: string, isMoney?: boolean];

export function tradeReceiptDisplayRows(receipt: TradeCompletionReceipt, locale: "ar" | "en"): ReceiptDisplayRow[] {
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;
  const missing = t("Not recorded", "غير مسجل");
  const methods: Record<string, string> = { "Bank Transfer": t("Bank transfer", "تحويل بنكي"), "Cardless ATM": t("Cardless ATM", "سحب من الصراف دون بطاقة"), "Face-to-Face": t("Face-to-Face", "لقاء شخصي"), "Wise (USD)": t("Wise (USD)", "Wise (دولار أمريكي)") };
  const method = Object.hasOwn(methods, receipt.paymentMethod) ? (methods[receipt.paymentMethod] ?? missing) : missing;
  const moneyRow = (label: string, value: string | null, currency = receipt.currency): ReceiptDisplayRow =>
    value === null ? [label, missing] : [label, `${value} ${currency}`, true];
  return [
    [t("Receipt number", "رقم الإيصال"), receipt.receiptNumber],
    [t("Trade", "الصفقة"), receipt.tradeReference],
    [t("Buyer", "المشتري"), receipt.buyerPublicId],
    [t("Seller", "البائع"), receipt.sellerPublicId],
    [t("Requested", "وقت الطلب"), receiptDate(receipt.createdAt, locale)],
    [t("Completed", "وقت الإتمام"), receiptDate(receipt.completedAt, locale)],
    moneyRow(t("USDT amount", "كمية USDT"), receipt.usdtAmount, "USDT"),
    moneyRow(t("Price per USDT", "السعر لكل USDT"), receipt.pricePerUsdt),
    moneyRow(t("Trade subtotal", "قيمة الصفقة قبل الرسوم"), receipt.baseFiatAmount),
    moneyRow(t("Buyer fee included in payment", "رسوم المشتري المشمولة بالدفع"), receipt.buyerFeeFiat),
    moneyRow(receipt.fiatAmountBasis ? t("Payment total reconstructed from saved quote", "إجمالي الدفع المحسوب من السعر المحفوظ") : t("Recorded payment total to seller", "إجمالي الدفع المسجل للبائع"), receipt.fiatAmount),
    moneyRow(t("Buyer platform fee (USDT equivalent)", "رسوم المشتري للمنصة بما يعادل USDT"), receipt.buyerFeeUsdt, "USDT"),
    moneyRow(t("Seller platform fee", "رسوم البائع للمنصة"), receipt.sellerFeeUsdt, "USDT"),
    moneyRow(t("Total platform fees assessed", "إجمالي رسوم المنصة المسجلة"), receipt.totalPlatformFeeUsdt, "USDT"),
    [t("Network", "الشبكة"), receipt.network],
    [t("Payment method", "طريقة الدفع"), method],
  ];
}

export function tradeReceiptRows(receipt: TradeCompletionReceipt, locale: "ar" | "en"): Array<[string, string]> {
  return tradeReceiptDisplayRows(receipt, locale).map(([label, value]) => [label, value]);
}

export function receiptNotice(receipt: TradeCompletionReceipt, locale: "ar" | "en") {
  if (receipt.source === "historical_record") return locale === "ar"
    ? "إيصال من السجل المحفوظ. أي بيانات أو أوقات غير مسجلة تبقى غير محددة. الرسوم المسجلة لا تعني أنها مدفوعة."
    : "Receipt from the saved trade record. Unrecorded details or times remain unspecified. Assessed fees do not indicate payment.";
  return locale === "ar"
    ? "تم حفظ هذا الإيصال عند إتمام الصفقة. رسوم المشتري مشمولة في إجمالي الدفع عند تطبيقها؛ الرسوم المسجلة لا تعني أنها مدفوعة للمنصة."
    : "Saved when the trade completed. The buyer fee is included in the payment total where applicable; assessed fees do not indicate payment to the platform.";
}
