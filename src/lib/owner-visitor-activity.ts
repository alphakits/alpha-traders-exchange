/** Owner-only response contract. Never use in a public user projection. */
export type VisitorPeriod = "all" | "today";
export type OwnerVisitor = {
  key: string;
  accountId: string | null;
  name: string | null;
  role: string | null;
  firstSeen: string;
  lastSeen: string;
  pages: number;
  visits: number;
  sessions: number;
  platforms: string[];
  lastPath: string;
};
export type VisitorDirectory = { visitors: OwnerVisitor[]; nextCursor: string | null; asOf: string };
export type VisitorEvent = { id: string; at: string; kind: "page" | "action"; label: string; platform: string | null };
export type VisitorTimeline = { events: VisitorEvent[]; nextCursor: string | null; asOf: string };

export function analyticsPageLabel(path: string, locale: "ar" | "en") {
  const normalized = path.split(/[?#]/, 1)[0].replace(/^\/(en|ar)(\/|$)/, "/").replace(/\/+$/, "") || "/";
  const sections: Record<string, [string, string]> = {
    "/": ["Home", "الرئيسية"], "/usdt-exchange": ["Alpha Exchange", "Alpha Exchange"],
    "/prop-firms": ["Prop Firms", "الشركات المموّلة"], "/academy": ["Academy", "الأكاديمية"],
    "/ict-mentorship": ["ICT Mentorship", "ICT Mentorship"], "/news": ["News", "الأخبار"],
    "/learn-with-mark": ["Learn with Mark", "تعلّم مع مارك"], "/learn-trading-free": ["Free trading course", "دورة التداول المجانية"],
    "/community": ["Community", "المجتمع"], "/contact": ["Contact", "التواصل"],
    "/login": ["Sign in", "تسجيل الدخول"], "/register": ["Registration", "التسجيل"],
    "/account": ["My account", "الحساب"], "/admin": ["Owner dashboard", "لوحة المالك"],
    "/trade-room": ["Trade room", "غرفة الصفقة"],
  };
  const section = `/${normalized.split("/")[1] ?? ""}`;
  const label = sections[section]?.[locale === "ar" ? 1 : 0];
  return label ? normalized === section ? label : `${label} · ${normalized}` : normalized;
}

export function analyticsActionLabel(action: string, locale: "ar" | "en") {
  const labels: Record<string, [string, string]> = {
    listing_created: ["Created a listing", "أنشأ عرضًا"], listing_edited: ["Edited a listing", "عدّل عرضًا"],
    listing_paused: ["Paused a listing", "أوقف عرضًا مؤقتًا"], listing_resumed: ["Resumed a listing", "أعاد تفعيل عرض"],
    purchase_request_submitted: ["Submitted a trade request", "أرسل طلب صفقة"],
    purchase_completed: ["Completed a purchase", "أكمل عملية شراء"],
    trade_review_submitted: ["Submitted a trade review", "أرسل تقييم الصفقة"],
    listing_matched: ["Matched a listing to a trade", "ربط العرض بصفقة"],
    listing_closed: ["Closed a listing", "أغلق عرضًا"],
    listing_renewed: ["Renewed a listing", "جدّد عرضًا"],
    trade_closed_manually: ["Closed a trade manually", "أغلق صفقة يدويًا"],
    purchase_request_created: ["Requested a trade", "طلب صفقة"], purchase_request_accepted: ["Accepted a trade", "قبل صفقة"],
    purchase_request_rejected: ["Rejected a trade", "رفض صفقة"], trade_completed: ["Completed a trade", "أكمل صفقة"],
    trade_cancelled: ["Cancelled a trade", "ألغى صفقة"], commission_paid: ["Commission paid", "دفع العمولة"],
    trade_evidence_uploaded: ["Uploaded payment evidence", "رفع إثبات الدفع"],
    trade_bank_details_revealed: ["Viewed bank details", "فتح بيانات البنك"],
  };
  return labels[action]?.[locale === "ar" ? 1 : 0] ?? action.replace(/_/g, " ");
}
