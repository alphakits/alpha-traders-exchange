export type TradeRoomSystemMessageLocale = "ar" | "en";

export type TradeRoomSystemMessageSegment = {
  value: string;
  isolate?: boolean;
};

export type LocalizedTradeRoomSystemMessage = {
  text: string;
  segments: TradeRoomSystemMessageSegment[];
  dir: "rtl" | "ltr" | "auto";
  matched: boolean;
};

type LocalizedExactTemplate = Record<TradeRoomSystemMessageLocale, string>;

const EXACT_SYSTEM_MESSAGES: Record<string, LocalizedExactTemplate> = {
  "Seller accepted the trade request. Buyer can now upload the payment receipt.": {
    ar: "وافق البائع على طلب الصفقة. يمكن للمشتري الآن رفع إيصال الدفع.",
    en: "Seller accepted the trade request. Buyer can now upload the payment receipt.",
  },
  "Seller accepted request": {
    ar: "وافق البائع على الطلب.",
    en: "Seller accepted request.",
  },
  "Seller declined the trade request.": {
    ar: "رفض البائع طلب الصفقة.",
    en: "Seller declined the trade request.",
  },
  "The seller declined this trade request.": {
    ar: "رفض البائع طلب الصفقة هذا.",
    en: "The seller declined this trade request.",
  },
  "Seller declined request": {
    ar: "رفض البائع الطلب.",
    en: "Seller declined request.",
  },
  "Buyer cancelled the trade request.": {
    ar: "ألغى المشتري طلب الصفقة.",
    en: "Buyer cancelled the trade request.",
  },
  "The buyer cancelled this trade request.": {
    ar: "ألغى المشتري طلب الصفقة هذا.",
    en: "The buyer cancelled this trade request.",
  },
  "Buyer cancelled request": {
    ar: "ألغى المشتري الطلب.",
    en: "Buyer cancelled request.",
  },
  "Buyer uploaded the payment receipt.": {
    ar: "رفع المشتري إيصال الدفع.",
    en: "Buyer uploaded the payment receipt.",
  },
  "Buyer uploaded payment evidence": {
    ar: "رفع المشتري إثبات الدفع.",
    en: "Buyer uploaded payment evidence.",
  },
  "Seller attached release evidence.": {
    ar: "أرفق البائع إثبات إرسال USDT.",
    en: "Seller attached release evidence.",
  },
  "Seller uploaded USDT evidence": {
    ar: "رفع البائع إثبات إرسال USDT.",
    en: "Seller uploaded USDT evidence.",
  },
  "Buyer submitted payment. Seller should now confirm the money was received.": {
    ar: "أرسل المشتري الدفع. يجب على البائع الآن تأكيد استلام الأموال.",
    en: "Buyer submitted payment. Seller should now confirm the money was received.",
  },
  "Buyer marked payment sent": {
    ar: "أكّد المشتري إرسال الدفع.",
    en: "Buyer marked payment sent.",
  },
  "Seller confirmed the funds were received. USDT release is now unlocked.": {
    ar: "أكّد البائع استلام الأموال. أصبح إرسال USDT متاحًا الآن.",
    en: "Seller confirmed the funds were received. USDT release is now unlocked.",
  },
  "Seller confirmed funds received": {
    ar: "أكّد البائع استلام الأموال.",
    en: "Seller confirmed funds received.",
  },
  "Seller started the 45-minute USDT release window.": {
    ar: "بدأ البائع مهلة إرسال USDT ومدتها 45 دقيقة.",
    en: "Seller started the 45-minute USDT release window.",
  },
  "Seller started USDT release": {
    ar: "بدأ البائع إرسال USDT.",
    en: "Seller started USDT release.",
  },
  "Seller marked USDT as sent. Buyer should now confirm receipt.": {
    ar: "أكّد البائع إرسال USDT. يجب على المشتري الآن تأكيد الاستلام.",
    en: "Seller marked USDT as sent. Buyer should now confirm receipt.",
  },
  "Seller marked USDT sent": {
    ar: "أكّد البائع إرسال USDT.",
    en: "Seller marked USDT sent.",
  },
  "Buyer confirmed USDT receipt. The trade is complete and has moved to history.": {
    ar: "أكّد المشتري استلام USDT. اكتملت الصفقة وانتقلت إلى السجل.",
    en: "Buyer confirmed USDT receipt. The trade is complete and has moved to history.",
  },
  "Buyer confirmed trade completed": {
    ar: "أكّد المشتري اكتمال الصفقة.",
    en: "Buyer confirmed trade completed.",
  },
  "Buyer sent a reminder to continue this Trade Room.": {
    ar: "أرسل المشتري تذكيرًا لمتابعة غرفة الصفقة.",
    en: "Buyer sent a reminder to continue this Trade Room.",
  },
  "Seller sent a reminder to continue this Trade Room.": {
    ar: "أرسل البائع تذكيرًا لمتابعة غرفة الصفقة.",
    en: "Seller sent a reminder to continue this Trade Room.",
  },
  "Buyer inactivity warning sent.": {
    ar: "تم إرسال تحذير للمشتري بسبب عدم النشاط.",
    en: "Buyer inactivity warning sent.",
  },
  "The buyer received an inactivity reminder.": {
    ar: "تلقّى المشتري تذكيرًا بسبب عدم النشاط.",
    en: "The buyer received an inactivity reminder.",
  },
  "USDT release window expired — trade marked overdue.": {
    ar: "انتهت مهلة إرسال USDT — تم تصنيف الصفقة كمتأخرة.",
    en: "USDT release window expired — trade marked overdue.",
  },
  "Trade bank details viewed": {
    ar: "تم عرض تفاصيل الحساب البنكي للصفقة.",
    en: "Trade bank details viewed.",
  },
  "Trade bank details viewed in the trade room": {
    ar: "تم عرض تفاصيل الحساب البنكي داخل غرفة الصفقة.",
    en: "Trade bank details viewed in the trade room.",
  },
  "Review window unlocked": {
    ar: "أصبح بإمكانك الآن إضافة تقييم.",
    en: "Review window unlocked.",
  },
  "You can now leave a rating and review for this trade.": {
    ar: "يمكنك الآن إضافة تقييم ومراجعة لهذه الصفقة.",
    en: "You can now leave a rating and review for this trade.",
  },
  "A buyer submitted a review for a completed trade.": {
    ar: "أرسل المشتري مراجعة لصفقة مكتملة.",
    en: "A buyer submitted a review for a completed trade.",
  },
  "The seller responded to your completed trade review.": {
    ar: "ردّ البائع على مراجعتك للصفقة المكتملة.",
    en: "The seller responded to your completed trade review.",
  },
  "Dispute opened for this trade.": {
    ar: "تم فتح نزاع لهذه الصفقة.",
    en: "Dispute opened for this trade.",
  },
  "Trade locked": {
    ar: "تم إغلاق الصفقة.",
    en: "Trade locked.",
  },
  "Admin force-completed this trade": {
    ar: "أكملت الإدارة هذه الصفقة إجباريًا.",
    en: "Admin force-completed this trade.",
  },
  "Admin cancelled this trade": {
    ar: "ألغت الإدارة هذه الصفقة.",
    en: "Admin cancelled this trade.",
  },
  "Admin unlocked review window": {
    ar: "أتاحت الإدارة إضافة مراجعة.",
    en: "Admin unlocked review window.",
  },
};

function plain(value: string): TradeRoomSystemMessageSegment {
  return { value };
}

function isolated(value: string): TradeRoomSystemMessageSegment {
  return { value, isolate: true };
}

function result(
  locale: TradeRoomSystemMessageLocale,
  segments: TradeRoomSystemMessageSegment[],
  matched = true,
): LocalizedTradeRoomSystemMessage {
  const displaySegments = locale === "ar"
    ? segments.flatMap((segment) => {
        if (segment.isolate) return segment;
        return segment.value
          .split(/(USDT|Trade Room)/g)
          .filter(Boolean)
          .map((value) => (value === "USDT" || value === "Trade Room" ? isolated(value) : plain(value)));
      })
    : segments;
  return {
    text: displaySegments.map((segment) => segment.value).join(""),
    segments: displaySegments,
    dir: matched ? (locale === "ar" ? "rtl" : "ltr") : "auto",
    matched,
  };
}

type DynamicTemplate = {
  pattern: RegExp;
  render: (
    locale: TradeRoomSystemMessageLocale,
    captures: string[],
  ) => TradeRoomSystemMessageSegment[];
};

const DYNAMIC_SYSTEM_MESSAGES: DynamicTemplate[] = [
  {
    pattern: /^Seller accepted the price offer of ₪(.+?) per USDT\. Buyer can now upload the payment receipt\.$/,
    render: (locale, [price]) => locale === "ar"
      ? [plain("وافق البائع على عرض السعر بقيمة ₪"), isolated(price), plain(" لكل USDT. يمكن للمشتري الآن رفع إيصال الدفع.")]
      : [plain("Seller accepted the price offer of ₪"), isolated(price), plain(" per USDT. Buyer can now upload the payment receipt.")],
  },
  {
    pattern: /^Trade closed manually: ([\s\S]+)$/,
    render: (locale, [reason]) => locale === "ar"
      ? [plain("تم إغلاق الصفقة يدويًا: "), isolated(reason)]
      : [plain("Trade closed manually: "), isolated(reason)],
  },
  {
    pattern: /^Trade was closed manually\. Reason: ([\s\S]+)$/,
    render: (locale, [reasonAndExplanation]) => locale === "ar"
      ? [plain("تم إغلاق الصفقة يدويًا. السبب: "), isolated(reasonAndExplanation)]
      : [plain("Trade was closed manually. Reason: "), isolated(reasonAndExplanation)],
  },
  {
    pattern: /^Inactivity warning sent after (.+) minutes without buyer progress\.$/,
    render: (locale, [minutes]) => locale === "ar"
      ? [plain("تم إرسال تحذير بسبب عدم إحراز المشتري أي تقدّم لمدة "), isolated(minutes), plain(" دقيقة.")]
      : [plain("Inactivity warning sent after "), isolated(minutes), plain(" minutes without buyer progress.")],
  },
  {
    pattern: /^Seller started the (.+)-minute USDT release window\.$/,
    render: (locale, [minutes]) => locale === "ar"
      ? [plain("بدأ البائع مهلة إرسال USDT ومدتها "), isolated(minutes), plain(" دقيقة.")]
      : [plain("Seller started the "), isolated(minutes), plain("-minute USDT release window.")],
  },
  {
    pattern: /^Commission due was created for the seller \((.+) USDT\)\.$/,
    render: (locale, [amount]) => locale === "ar"
      ? [plain("تم إنشاء عمولة مستحقة على البائع بقيمة "), isolated(amount), plain(" USDT.")]
      : [plain("Commission due was created for the seller ("), isolated(amount), plain(" USDT).")],
  },
  {
    pattern: /^Commission created \((.+) USDT\)\.$/,
    render: (locale, [amount]) => locale === "ar"
      ? [plain("تم إنشاء عمولة بقيمة "), isolated(amount), plain(" USDT.")]
      : [plain("Commission created ("), isolated(amount), plain(" USDT).")],
  },
  {
    pattern: /^Commission paid on-chain \((.+) USDT\)\.$/,
    render: (locale, [amount]) => locale === "ar"
      ? [plain("تم دفع العمولة على الشبكة بقيمة "), isolated(amount), plain(" USDT.")]
      : [plain("Commission paid on-chain ("), isolated(amount), plain(" USDT).")],
  },
  {
    pattern: /^Commission marked paid \((.+) USDT\)\.$/,
    render: (locale, [amount]) => locale === "ar"
      ? [plain("تم تأكيد دفع العمولة بقيمة "), isolated(amount), plain(" USDT.")]
      : [plain("Commission marked paid ("), isolated(amount), plain(" USDT).")],
  },
  {
    pattern: /^Commission for trade (.+) has been marked paid\.$/,
    render: (locale, [tradeId]) => locale === "ar"
      ? [plain("تم تأكيد دفع عمولة الصفقة "), isolated(tradeId), plain(".")]
      : [plain("Commission for trade "), isolated(tradeId), plain(" has been marked paid.")],
  },
  {
    pattern: /^Your commission payment for trade (.+) was verified\. Your account is now fully unlocked\.$/,
    render: (locale, [tradeId]) => locale === "ar"
      ? [plain("تم التحقق من دفع عمولة الصفقة "), isolated(tradeId), plain(". أصبح حسابك متاحًا بالكامل الآن.")]
      : [plain("Your commission payment for trade "), isolated(tradeId), plain(" was verified. Your account is now fully unlocked.")],
  },
  {
    pattern: /^Request (.+) was declined because the listing matched another buyer\.$/,
    render: (locale, [requestId]) => locale === "ar"
      ? [plain("تم رفض الطلب "), isolated(requestId), plain(" لأن الإعلان ارتبط بمشترٍ آخر.")]
      : [plain("Request "), isolated(requestId), plain(" was declined because the listing matched another buyer.")],
  },
  {
    pattern: /^Trade (.+) was cancelled by an admin listing action\.$/,
    render: (locale, [tradeId]) => locale === "ar"
      ? [plain("أُلغيت الصفقة "), isolated(tradeId), plain(" بسبب إجراء إداري على الإعلان.")]
      : [plain("Trade "), isolated(tradeId), plain(" was cancelled by an admin listing action.")],
  },
  {
    pattern: /^Trade (.+) completed\.$/,
    render: (locale, [tradeId]) => locale === "ar"
      ? [plain("اكتملت الصفقة "), isolated(tradeId), plain(".")]
      : [plain("Trade "), isolated(tradeId), plain(" completed.")],
  },
  {
    pattern: /^Review submitted for trade (.+)\.$/,
    render: (locale, [tradeId]) => locale === "ar"
      ? [plain("تم إرسال مراجعة للصفقة "), isolated(tradeId), plain(".")]
      : [plain("Review submitted for trade "), isolated(tradeId), plain(".")],
  },
  {
    pattern: /^(A dispute was opened|Dispute opened) for trade (.+)\.$/,
    render: (locale, [prefix, tradeId]) => locale === "ar"
      ? [plain("تم فتح نزاع للصفقة "), isolated(tradeId), plain(".")]
      : [plain(prefix), plain(" for trade "), isolated(tradeId), plain(".")],
  },
  {
    pattern: /^Bank details for trade (.+) were viewed\.$/,
    render: (locale, [tradeId]) => locale === "ar"
      ? [plain("تم عرض تفاصيل الحساب البنكي للصفقة "), isolated(tradeId), plain(".")]
      : [plain("Bank details for trade "), isolated(tradeId), plain(" were viewed.")],
  },
  {
    pattern: /^Seller accepted (.+)'s (.+) USDT request\. The trade is now active\.$/,
    render: (locale, [buyerName, amount]) => locale === "ar"
      ? [plain("وافق البائع على طلب "), isolated(buyerName), plain(" لشراء "), isolated(amount), plain(" USDT. الصفقة نشطة الآن.")]
      : [plain("Seller accepted "), isolated(buyerName), plain("'s "), isolated(amount), plain(" USDT request. The trade is now active.")],
  },
];

/**
 * Localizes only recognized server-authored Trade Room messages. Unknown text
 * is returned byte-for-byte so historical records and user-authored content
 * are never guessed at or rewritten.
 */
export function localizeTradeRoomSystemMessage(
  message: string,
  locale: TradeRoomSystemMessageLocale,
): LocalizedTradeRoomSystemMessage {
  const exact = EXACT_SYSTEM_MESSAGES[message];
  if (exact) return result(locale, [plain(locale === "en" ? message : exact.ar)]);

  for (const template of DYNAMIC_SYSTEM_MESSAGES) {
    const match = message.match(template.pattern);
    if (!match) continue;
    return result(locale, template.render(locale, match.slice(1)));
  }

  return result(locale, [isolated(message)], false);
}
