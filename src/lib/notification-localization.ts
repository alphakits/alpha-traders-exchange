import type { AppLocale } from "@/i18n/routing";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const ARABIC_TITLE_BY_ENGLISH: Record<string, string> = {
  "listing expired": "انتهت صلاحية العرض",
  "congratulations on your new seller rank": "تهانينا على رتبة البائع الجديدة",
  "commission overdue": "عمولة متأخرة",
  "action required on your trade": "مطلوب إجراء في صفقتك",
  "buyer inactivity warning sent": "تم إرسال تنبيه لعدم نشاط المشتري",
  "action required: trade still waiting": "مطلوب إجراء: الصفقة ما زالت معلقة",
  "trade update: buyer reminder sent": "تحديث الصفقة: تم تذكير المشتري",
  "trade overdue": "الصفقة متأخرة",
  "usdt release overdue": "تأخر إرسال USDT",
  "trade overdue alert": "تنبيه بتأخر الصفقة",
  "trust score increased": "ارتفعت درجة الثقة",
  "prestige rank updated": "تم تحديث رتبة البائع",
  "congratulations! new prestige rank unlocked": "تهانينا! تم فتح رتبة جديدة",
  "prestige promotion unlocked": "تم فتح ترقية جديدة",
  "new approved seller application": "طلب بائع معتمد جديد",
  "seller application submitted": "تم إرسال طلب البائع",
  "seller application needs review": "طلب بائع يحتاج إلى مراجعة",
  "seller application approved": "تمت الموافقة على طلب البائع",
  "application approved": "تمت الموافقة على الطلب",
  "seller application rejected": "تم رفض طلب البائع",
  "application rejected": "تم رفض الطلب",
  "marketplace compliance restriction issued": "تم فرض تقييد امتثال في السوق",
  "payment submitted": "تم إرسال الدفعة",
  "compliance appeal decision": "صدر قرار بشأن استئناف الامتثال",
  "marketplace compliance restriction cleared": "تمت تسوية تقييد الامتثال في السوق",
  "marketplace compliance restriction removed": "تمت إزالة تقييد الامتثال في السوق",
  "seller privileges revoked": "تم إلغاء صلاحيات البائع",
  "seller marketplace privileges revoked": "تم إلغاء صلاحيات البائع في السوق",
  "new listing pending review": "عرض جديد بانتظار المراجعة",
  "listing submitted": "تم إرسال العرض",
  "listing submitted for review": "تم إرسال العرض للمراجعة",
  "listing approval required": "العرض يحتاج إلى موافقة",
  "listing changes need review": "تعديلات العرض تحتاج إلى مراجعة",
  "listing resubmitted for review": "تمت إعادة إرسال العرض للمراجعة",
  "listing renewed": "تم تجديد العرض",
  "seller entered vacation mode": "دخل البائع في وضع الإجازة",
  "trade cancelled": "تم إلغاء الصفقة",
  "listing expiration extended": "تم تمديد صلاحية العرض",
  "listing force closed": "تم إغلاق العرض إدارياً",
  "🟢 new usdt listing available": "🟢 عرض USDT جديد متاح",
  "listing unavailable": "العرض غير متاح",
  "new trade request": "طلب صفقة جديد",
  "new trade request submitted": "تم إرسال طلب صفقة جديد",
  "trade request submitted": "تم إرسال طلب الصفقة",
  "feedback required": "مطلوب تقييم",
  "action required": "مطلوب إجراء",
  "trade closed": "تم إغلاق الصفقة",
  "new trade room message": "رسالة جديدة في غرفة التداول",
  "trade room reminder": "تذكير من غرفة التداول",
  "seller marked usdt sent": "أكد البائع إرسال USDT",
  "trade evidence uploaded": "تم رفع إثبات للصفقة",
  "buyer left a review": "أضاف المشتري تقييماً",
  "review submitted": "تم إرسال التقييم",
  "seller replied to your review": "رد البائع على تقييمك",
  "review response sent": "تم إرسال الرد على التقييم",
  "trade request accepted": "تم قبول طلب الصفقة",
  "usdt release pending": "إرسال USDT قيد الانتظار",
  "trade completed": "اكتملت الصفقة",
  "review available": "التقييم متاح الآن",
  "large-value trade completed": "اكتملت صفقة ذات قيمة كبيرة",
  "commission payment verified": "تم التحقق من دفع العمولة",
  "commission payment received": "تم استلام دفع العمولة",
  "commission marked paid": "تم تسجيل العمولة كمدفوعة",
  "new marketplace feedback submitted": "تم إرسال تقييم جديد للسوق",
  "marketplace feedback submitted": "تم إرسال تقييم السوق",
  "notification preferences updated": "تم تحديث تفضيلات الإشعارات",
  "dispute opened": "تم فتح نزاع",
  "multiple buyer reports detected": "تم رصد عدة بلاغات من المشترين",
  "seller reported": "تم الإبلاغ عن البائع",
};

const ARABIC_ACTION_BY_ENGLISH: Record<string, string> = {
  "open seller listings": "فتح عروض البائع",
  "view seller insights": "عرض إحصاءات البائع",
  "manage listing": "إدارة العرض",
  "review listing": "مراجعة العرض",
  "pay commission": "دفع العمولة",
  "review commission": "مراجعة العمولة",
  "open trade room": "فتح غرفة التداول",
  "review trade": "مراجعة الصفقة",
  "review seller": "مراجعة البائع",
  "review application": "مراجعة الطلب",
  "review marketplace compliance": "مراجعة امتثال السوق",
  "monitor request": "متابعة الطلب",
  "leave feedback": "إضافة تقييم",
  "monitor trade": "متابعة الصفقة",
  "verify payment": "التحقق من الدفع",
  "confirm completion": "تأكيد الإكمال",
  "leave review": "إضافة تقييم",
  "continue trade": "متابعة الصفقة",
  "view details": "عرض التفاصيل",
  open: "فتح",
};

export function containsArabicText(value: string) {
  return /[\u0600-\u06ff]/.test(value);
}

function categoryTitle(category: AlphaExchangeNotification["category"]) {
  if (category === "trade") return "تحديث على الصفقة";
  if (category === "listing") return "تحديث على العرض";
  if (category === "application") return "تحديث على طلب البائع";
  if (category === "trust") return "تحديث على الثقة والرتبة";
  if (category === "review") return "تحديث على التقييم";
  if (category === "dispute") return "تحديث على النزاع";
  if (category === "report") return "تحديث على بلاغ في السوق";
  if (category === "account") return "تحديث على الحساب";
  return "تحديث جديد من Alpha Traders";
}

function categoryMessage(category: AlphaExchangeNotification["category"]) {
  if (category === "trade") return "يوجد تحديث جديد على صفقتك. افتح غرفة التداول لمعرفة التفاصيل والخطوة المطلوبة.";
  if (category === "listing") return "يوجد تحديث جديد على أحد عروضك. افتح إدارة العروض لمعرفة التفاصيل.";
  if (category === "application") return "يوجد تحديث على طلب البائع. افتح الطلب لمعرفة التفاصيل.";
  if (category === "trust") return "يوجد تحديث على درجة الثقة أو رتبة البائع.";
  if (category === "review") return "يوجد تحديث جديد متعلق بتقييم صفقة.";
  if (category === "dispute") return "يوجد تحديث على نزاع. افتح التفاصيل للمراجعة.";
  if (category === "report") return "يوجد تحديث متعلق ببلاغ في السوق.";
  if (category === "account") return "يوجد تحديث جديد على حسابك.";
  return "يوجد تحديث جديد في حسابك. افتح التفاصيل لمعرفة المزيد.";
}

function translateDynamicTitle(title: string) {
  const dynamicPrefixes: Array<[RegExp, string]> = [
    [/^trust score drop:\s*(.+)$/i, "انخفاض درجة الثقة: $1"],
    [/^flagged seller:\s*(.+)$/i, "بائع تحت المراجعة: $1"],
    [/^compliance payment:\s*(.+)$/i, "دفعة امتثال: $1"],
    [/^compliance appeal:\s*(.+)$/i, "استئناف امتثال: $1"],
    [/^marketplace announcement:\s*(.+)$/i, "إعلان السوق: $1"],
  ];
  for (const [pattern, replacement] of dynamicPrefixes) {
    if (pattern.test(title)) return title.replace(pattern, replacement);
  }
  return null;
}

export function localizeNotificationCopy(notification: AlphaExchangeNotification, locale: AppLocale) {
  if (locale !== "ar") return { title: notification.title, message: notification.message };

  const title = notification.title.trim();
  const translatedTitle = containsArabicText(title)
    ? title
    : ARABIC_TITLE_BY_ENGLISH[title.toLowerCase()] ?? translateDynamicTitle(title) ?? categoryTitle(notification.category);
  const message = containsArabicText(notification.message)
    ? notification.message
    : categoryMessage(notification.category);
  return { title: translatedTitle, message };
}

export function localizeNotificationActionLabel(
  label: string | null | undefined,
  locale: AppLocale,
  notification: Pick<AlphaExchangeNotification, "category">,
) {
  const normalized = label?.trim();
  if (locale !== "ar") return normalized || "Open";
  if (normalized && containsArabicText(normalized)) return normalized;
  if (normalized && ARABIC_ACTION_BY_ENGLISH[normalized.toLowerCase()]) return ARABIC_ACTION_BY_ENGLISH[normalized.toLowerCase()];
  if (notification.category === "trade") return "متابعة الصفقة";
  if (notification.category === "listing") return "إدارة العرض";
  if (notification.category === "application") return "مراجعة الطلب";
  return "عرض التفاصيل";
}
