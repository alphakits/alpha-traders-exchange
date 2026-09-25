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
                  {metric(t("Tracked visitors", "الزوار المرصودون"), traffic.data?.visitorsToday)}
                  {metric(t("Tab sessions", "جلسات علامات التبويب"), traffic.data?.sessionsToday)}
                  {metric(t("Page views", "مشاهدات الصفحات"), traffic.data?.pageViewsToday)}
                  {metric(t("Web sessions", "جلسات الموقع"), traffic.data?.webToday)}
                  {metric(t("iOS app sessions", "جلسات تطبيق iOS"), traffic.data?.iosToday)}
                  {metric(t("Android app sessions", "جلسات تطبيق Android"), traffic.data?.androidToday)}
                  {metric(t("Mobile sessions", "جلسات الهاتف"), traffic.data?.mobileToday)}
                  {metric(t("Desktop sessions", "جلسات الحاسوب"), traffic.data?.desktopToday)}
                </dl>
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <div className="min-w-0 rounded-xl border border-white/10 p-4">
                    <h3 className="font-semibold text-white">{t("Top pages today", "أكثر الصفحات زيارة اليوم")}</h3>
                    {traffic.data ? traffic.data.topPages.length ? <ul className="mt-3 space-y-2">{traffic.data.topPages.map((row, index) =>
                      <li key={`${index}:${row.path}`} className="flex min-w-0 justify-between gap-3 text-sm text-[#D1D5DB]"><span className="min-w-0 break-all" dir="ltr">{row.path}</span><span className="shrink-0" dir="ltr">{displayAnalyticsCount(row.views)}</span></li>
                    )}</ul> : <p className="mt-2 text-sm text-[#9CA3AF]">{t("No page views recorded today.", "لم تُسجّل مشاهدات صفحات اليوم.")}</p>
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
                "These are observed records, not a reconstructed history. Active accounts and tracked visitors measure different things; visitors use browser storage and sessions use browser tabs. Privacy settings and blocked tracking can reduce coverage. Referrer groups can overlap; platform labels are telemetry, not proof of device testing. This live panel is separate from the existing marketplace summary below.",
                "هذه سجلات مرصودة وليست سجلًا تاريخيًا مُعادًا. الحسابات النشطة والزوار المرصودون مقياسان مختلفان؛ يعتمد الزوار على تخزين المتصفح والجلسات على علامات التبويب. قد تقل التغطية بسبب إعدادات الخصوصية أو حظر التتبع. قد تتداخل مجموعات مصادر الإحالة؛ وتصنيف المنصة ليس إثباتًا لاختبار الجهاز. هذه اللوحة المباشرة مستقلة عن ملخص السوق الحالي أدناه.",
              )}</p>
            </> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
