"use client";

import { useEffect, useRef, useState } from "react";
import {
  displayAnalyticsCount, initialLiveAnalyticsState, LIVE_ANALYTICS_TIME_ZONE,
  sourceDisplay, type LiveAnalyticsState,
} from "@/lib/owner-live-analytics";
import { startOwnerAnalyticsPolling } from "@/lib/owner-live-analytics-poller";

export function OwnerLiveAnalyticsPanel({ locale }: { locale: "ar" | "en" }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LiveAnalyticsState>(initialLiveAnalyticsState);
  const [now, setNow] = useState(() => Date.now());
  const [sectionPeriod, setSectionPeriod] = useState<"all" | "today">("all");
  const refreshRef = useRef<(() => void) | null>(null);
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;

  useEffect(() => {
    if (!open) return;
    setState(initialLiveAnalyticsState());
    setNow(Date.now());
    const polling = startOwnerAnalyticsPolling({
      onChange: (value) => { setState(value); setNow(Date.now()); },
      isVisible: () => document.visibilityState === "visible",
      fetcher: (signal) => fetch("/api/admin/live-analytics", { signal, cache: "no-store", credentials: "same-origin" }),
      subscribeVisibility: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      subscribeSignOut: (listener) => {
        window.addEventListener("alpha-auth-signed-out", listener);
        return () => window.removeEventListener("alpha-auth-signed-out", listener);
      },
    });
    refreshRef.current = polling.refresh;
    // Freshness is based on successful reads, never the age of the last visit.
    const ticker = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 10_000);
    return () => { polling.stop(); refreshRef.current = null; window.clearInterval(ticker); };
  }, [open]);

  const presence = sourceDisplay(state.snapshot?.presence, state.failed, now);
  const traffic = sourceDisplay(state.snapshot?.traffic, state.failed, now);
  const sectionPages = sectionPeriod === "today" ? traffic.data?.topPages : traffic.data?.allTimePages;
  const sectionLabel = (path: string) => ({
    "/": t("Home", "الرئيسية"),
    "/usdt-exchange": "Alpha Exchange",
    "/prop-firms": t("Prop Firms", "الشركات المموّلة"),
    "/academy": t("Academy", "الأكاديمية"),
    "/ict-mentorship": "ICT Mentorship",
    "/learn-with-mark": t("Learn with Mark", "تعلّم مع مارك"),
    "/learn-trading-free": t("Free trading course", "دورة التداول المجانية"),
    "/news": t("News", "الأخبار"),
    "/community": t("Community", "المجتمع"),
    "/contact": t("Contact", "التواصل"),
  } as Record<string, string>)[path] ?? path;
  const statusLabel = (status: string) => status === "ready" ? t("Updated", "محدّث")
    : status === "stale" ? t("Stale — refresh needed", "بيانات قديمة — يلزم التحديث")
      : status === "loading" ? t("Loading", "جارٍ التحميل") : t("Unavailable", "غير متاح");
  const readTime = (value: string | null) => value ? new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-GB", {
    timeZone: LIVE_ANALYTICS_TIME_ZONE, dateStyle: "short", timeStyle: "medium",
  }).format(new Date(value)) : "—";
  const metric = (label: string, value: unknown) => (
    <div key={label} className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-4">
      <dt className="text-sm text-[#9CA3AF]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-white" dir="ltr">{displayAnalyticsCount(value)}</dd>
    </div>
  );

  return (
    <section className="section-container pt-5" dir={locale === "ar" ? "rtl" : "ltr"} aria-label={t("Live user analytics", "تحليلات المستخدمين المباشرة")}>
      <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#0B0B0B]/95 p-4 sm:p-6">
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-start text-[#F4D978]"
          aria-expanded={open} aria-controls="owner-live-analytics-content"
          onClick={() => { setOpen(!open); if (open) setState(initialLiveAnalyticsState()); }}>
          <span className="text-lg font-semibold">{t("Live User Analytics", "تحليلات المستخدمين المباشرة")}</span>
          <span className="shrink-0 text-sm">{open ? t("Hide", "إخفاء") : t("Open", "فتح")}</span>
        </button>
        <p className="mt-1 text-sm text-[#9CA3AF]">{t("Owner-only traffic and activity. Open to refresh independently of trade controls.", "الزيارات والنشاط للمالك فقط. افتح للتحديث بشكل مستقل عن أدوات إدارة الصفقات.")}</p>
        {!state.forbidden ? <a href={`/${locale}/admin/learning-interest`} className="mt-3 inline-flex min-h-11 items-center text-sm text-[#F4D978] underline underline-offset-4">{t("ICT Mentorship Enquiries", "استفسارات ICT Mentorship")}</a> : null}
        {open ? (
          <div id="owner-live-analytics-content" className="mt-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[#D1D5DB]">{t("Reporting day: midnight in Israel (Asia/Jerusalem).", "يبدأ يوم التقرير عند منتصف الليل بتوقيت إسرائيل (Asia/Jerusalem).")}</p>
              <button type="button" disabled={state.refreshing || state.forbidden} onClick={() => refreshRef.current?.()}
                className="min-h-11 rounded-xl border border-white/20 px-4 py-2 text-sm text-white disabled:opacity-50">
                {state.refreshing ? t("Refreshing…", "جارٍ التحديث…") : t("Refresh now", "تحديث الآن")}
              </button>
            </div>
            <p role="status" className="text-sm text-[#D1D5DB]">
              {state.forbidden ? t("Owner access is required. Sign in again to view these reports.", "يلزم الدخول بحساب المالك لعرض هذه التقارير.")
                : t("Refreshes every 30 seconds while open and visible. — means unavailable, not zero.", "يتحدّث كل 30 ثانية أثناء فتح اللوحة وظهورها. الرمز — يعني أن البيانات غير متاحة، وليس صفرًا.")}
            </p>
            {!state.forbidden ? <>
              <p className="rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/5 p-3 text-sm text-[#F4D978]">
                {t("New statistics started", "بداية الإحصاءات الجديدة")}: {readTime(state.snapshot?.reportingStartedAt ?? null)}.
                {" "}{t("Earlier activity is excluded from every count below.", "كل النشاط السابق مستبعد من جميع العدادات أدناه.")}
              </p>
              <div className="space-y-3">
                <h2 className="font-semibold text-white">{t("Registered-user activity", "نشاط المستخدمين المسجلين")}</h2>
                <p className="text-xs text-[#9CA3AF]">{statusLabel(presence.status)} · {t("Last successful read", "آخر قراءة ناجحة")}: {readTime(presence.asOf)}</p>
                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {metric(t("Online now", "متصلون الآن"), presence.data?.onlineNow)}
                  {metric(t("Active today", "نشطون اليوم"), presence.data?.activeToday)}
                  {metric(t("Observed in last 7 days", "تم رصدهم خلال آخر 7 أيام"), presence.data?.activeLast7Days)}
                  {metric(t("Observed in last 30 days", "تم رصدهم خلال آخر 30 يومًا"), presence.data?.activeLast30Days)}
                </dl>
              </div>
              <div className="space-y-3">
                <h2 className="font-semibold text-white">{t("Recorded traffic today", "الزيارات المسجلة اليوم")}</h2>
                <p className="text-xs text-[#9CA3AF]">{statusLabel(traffic.status)} · {t("Last successful read", "آخر قراءة ناجحة")}: {readTime(traffic.asOf)}</p>
                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {metric(t("Unique visitors", "الزوار بدون تكرار"), traffic.data?.visitorsToday)}
                  {metric(t("Tab sessions", "جلسات علامات التبويب"), traffic.data?.sessionsToday)}
                  {metric(t("Total page visits (includes repeats)", "إجمالي زيارات الصفحات (يشمل التكرار)"), traffic.data?.pageViewsToday)}
                  {metric(t("Web sessions", "جلسات الموقع"), traffic.data?.webToday)}
                  {metric(t("iOS app sessions", "جلسات تطبيق iOS"), traffic.data?.iosToday)}
                  {metric(t("Android app sessions", "جلسات تطبيق Android"), traffic.data?.androidToday)}
                  {metric(t("Mobile sessions", "جلسات الهاتف"), traffic.data?.mobileToday)}
                  {metric(t("Desktop sessions", "جلسات الحاسوب"), traffic.data?.desktopToday)}
                </dl>
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <div className="min-w-0 rounded-xl border border-white/10 p-4">
                    <h3 className="font-semibold text-white">{t("Unique visitors by section", "زوار كل قسم بدون تكرار")}</h3>
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("Section reporting period", "فترة إحصاءات الأقسام")}>
                      {(["all", "today"] as const).map((period) => <button key={period} type="button"
                        aria-pressed={sectionPeriod === period} onClick={() => setSectionPeriod(period)}
                        className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${sectionPeriod === period ? "border-[#D4AF37] bg-[#D4AF37]/10 text-[#F4D978]" : "border-white/20 text-[#D1D5DB]"}`}>
                        {period === "all" ? t("Since the new start", "من البداية الجديدة") : t("Today", "اليوم")}
                      </button>)}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#9CA3AF]">{sectionPeriod === "all"
                      ? t("Each person counts once per section since the new start. Returning does not add another person.", "يُحسب كل شخص مرة واحدة لكل قسم من البداية الجديدة. الرجوع للقسم لا يضيف شخصًا جديدًا.")
                      : t("Each person counts once per section today. Repeat visits and language changes do not add another person.", "يُحسب كل شخص مرة واحدة لكل قسم اليوم. تكرار الزيارة وتغيير اللغة لا يضيفان شخصًا جديدًا.")}</p>
                    {traffic.data ? sectionPages?.length ? <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-start text-sm text-[#D1D5DB]">
                        <thead><tr className="border-b border-white/10 text-xs text-[#9CA3AF]">
                          <th scope="col" className="py-2 text-start">{t("Section", "القسم")}</th>
                          <th scope="col" className="px-2 py-2 text-end">{t("Unique visitors", "زوار بدون تكرار")}</th>
                          <th scope="col" className="py-2 text-end">{t("Total visits", "إجمالي الزيارات")}</th>
                        </tr></thead>
                        <tbody>{sectionPages.map((row) => <tr key={row.path} className="border-b border-white/5">
                          <th scope="row" className="max-w-40 break-words py-3 text-start font-normal">{sectionLabel(row.path)}</th>
                          <td className="px-2 py-3 text-end font-semibold tabular-nums text-white">{displayAnalyticsCount(row.uniqueVisitors)}</td>
                          <td className="py-3 text-end tabular-nums text-[#9CA3AF]">{displayAnalyticsCount(row.views)}</td>
                        </tr>)}</tbody>
                      </table>
                    </div> : <p className="mt-2 text-sm text-[#9CA3AF]">{t("No visits recorded for this period.", "لم تُسجّل زيارات خلال هذه الفترة.")}</p>
                      : <p className="mt-2 text-sm text-[#9CA3AF]">{statusLabel(traffic.status)}</p>}
                  </div>
                  <div className="min-w-0 rounded-xl border border-white/10 p-4">
                    <h3 className="font-semibold text-white">{t("Recorded referrers · tab sessions", "مصادر الإحالة المسجلة · جلسات علامات التبويب")}</h3>
                    {traffic.data ? traffic.data.sources.length ? <ul className="mt-3 space-y-2">{traffic.data.sources.map((row, index) =>
                      <li key={`${index}:${row.source}`} className="flex min-w-0 justify-between gap-3 text-sm text-[#D1D5DB]"><span className="min-w-0 break-all">{row.source === "Direct" ? t("Direct / referrer not provided", "مباشر / مصدر الإحالة غير متاح") : row.source}</span><span className="shrink-0" dir="ltr">{displayAnalyticsCount(row.sessions)}</span></li>
                    )}</ul> : <p className="mt-2 text-sm text-[#9CA3AF]">{t("No referrers recorded today.", "لم تُسجّل مصادر إحالة اليوم.")}</p>
                      : <p className="mt-2 text-sm text-[#9CA3AF]">{statusLabel(traffic.status)}</p>}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-6 text-[#9CA3AF]">{t(
                "Unique visitors use the signed-in account across devices, or the saved browser identity for guests. Guest visits are linked only when that browser is associated with one account in the new period. Shared browsers, cleared storage and guests on different devices can limit deduplication. Arabic and English pages belong to the same section. Total visits include repeats; sessions count browser tabs. Daily, 7-day and 30-day counts include activity since the new start only. Privacy settings and blocked tracking can reduce coverage. Referrer groups can overlap; platform labels do not prove device testing.",
                "يعتمد عدّ الزوار بدون تكرار على الحساب المسجّل عبر الأجهزة، أو هوية المتصفح المحفوظة للضيف. تُربط زيارات الضيف بالحساب فقط عندما يرتبط المتصفح بحساب واحد خلال الفترة الجديدة. المتصفحات المشتركة ومسح التخزين وزيارة الضيف من أجهزة مختلفة قد تحدّ من منع التكرار. الصفحات العربية والإنجليزية تتبع القسم نفسه. إجمالي الزيارات يشمل التكرار؛ والجلسات تحسب علامات التبويب. عدادات اليوم و7 و30 يوم تشمل النشاط من البداية الجديدة فقط. إعدادات الخصوصية وحظر التتبع قد تقللان التغطية، وقد تتداخل مصادر الإحالة؛ وتصنيف المنصة ليس إثباتًا لاختبار الجهاز.",
              )}</p>
            </> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
