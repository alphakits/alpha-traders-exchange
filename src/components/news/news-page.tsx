"use client";

import { brandText } from "@/components/ui/currency-text";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, Folder, RefreshCw } from "lucide-react";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { Button } from "@/components/ui/button";
import { NewsPreferences } from "./news-preferences";
import { getSignedOutPageDestination } from "@/lib/protected-page";
import { newsFeedStaleAfterMs, newsDayKey, newsEventStatus, newsEventTitle, newsResultSummary, type NewsEvent, type NewsFeed, type NewsLocale } from "@/lib/economic-news/model";

type Filter = "week" | "upcoming" | "today" | "released";
type RefreshFeedback = "preparing" | "updated" | "unavailable" | "failed";
const LIVE_CHECK_INTERVAL_MS = 30_000;
const ACTIVATION_CHECK_INTERVAL_MS = 5 * 60_000;
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]";

function formatDate(iso: string, locale: NewsLocale, timeZone: string, includeTime = true) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-GB", {
    timeZone, weekday: "short", day: "numeric", month: "short", ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(iso));
}

function countdown(iso: string, now: number, locale: NewsLocale) {
  const minutes = Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
  const isAr = locale === "ar";
  if (minutes < 60) return isAr ? `خلال ${minutes} دقيقة` : `In ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isAr ? `خلال ${hours} ساعة و${minutes % 60} دقيقة` : `In ${hours}h ${minutes % 60}m`;
  return isAr ? `خلال ${Math.floor(hours / 24)} يوم و${hours % 24} ساعة` : `In ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function EventCard({ event, locale, timeZone, now, selected = false, weekly = false }: {
  event: NewsEvent; locale: NewsLocale; timeZone: string; now: number; selected?: boolean; weekly?: boolean;
}) {
  const isAr = locale === "ar";
  const status = newsEventStatus(event, now);
  const labels = isAr ? {
    released: "صدرت النتيجة", scheduled: "قادم", awaiting: "بانتظار النتيجة", tentative: "موعد مبدئي", no_numeric_result: "حدث دون نتيجة رقمية",
  } : { released: "Released", scheduled: "Upcoming", awaiting: "Awaiting result", tentative: "Tentative time", no_numeric_result: "No numeric result" };
  if (weekly) {
    labels.released = isAr ? "نتيجة مؤكدة" : "Confirmed result";
    labels.awaiting = isAr ? "انتهى الموعد المجدول" : "Scheduled time passed";
  }
  return (
    <article id={`event-${event.id}`} className={`scroll-mt-24 rounded-2xl border bg-[#0B0C0E]/90 p-4 sm:p-5 ${selected ? "border-[#D4AF37]/70" : "border-white/10"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-2 font-medium text-red-300"><Folder className="h-3.5 w-3.5 fill-red-400/20" aria-hidden="true" />USD · {weekly ? (isAr ? "حدث رئيسي" : "Major event") : (isAr ? "تأثير مرتفع" : "High impact")}</span>
        <span className={`rounded-full px-2.5 py-1 ${status === "released" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-[#C7CDD6]"}`}>{labels[status]}</span>
      </div>
      <h2 className="mt-3 text-base font-semibold text-white sm:text-lg" dir="auto">{newsEventTitle(event, locale)}</h2>
      {isAr && event.titleAr !== event.title ? <p className="mt-1 text-xs text-[#8F96A3]" dir="ltr">{event.title}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#9CA3AF]">
        <time dateTime={event.scheduledAt}>{formatDate(event.scheduledAt, locale, timeZone, event.timing === "exact")}</time>
        {status === "scheduled" ? <span className="text-[#D4AF37]">{countdown(event.scheduledAt, now, locale)}</span> : null}
        {event.reference ? <span dir="auto">{event.reference}</span> : null}
      </div>
      {!weekly || event.previous !== null || status === "released" ? <dl className={`mt-4 grid ${weekly ? "grid-cols-2" : "grid-cols-3"} divide-x divide-white/10 rounded-xl border border-white/[0.07] bg-white/[0.025] py-3`} dir="ltr">
        {[
          { label: isAr ? "السابق" : "Previous", value: event.previous, gold: false },
          ...(!weekly ? [{ label: isAr ? "المتوقع" : "Forecast", value: event.forecast, gold: false }] : []),
          { label: isAr ? "النتيجة" : "Actual", value: status === "released" ? event.actual : null, gold: status === "released" },
        ].map((item) => <div key={item.label} className="min-w-0 px-2 text-center"><dt className="text-[11px] text-[#9CA3AF]">{item.label}</dt><dd className={`mt-1 break-words text-base font-semibold tabular-nums ${item.gold ? "text-[#E6C66A]" : "text-white"}`}>{item.value ?? "—"}</dd></div>)}
      </dl> : null}
      {status === "released" ? <p className="mt-3 text-xs leading-relaxed text-[#BAC2CF]">{newsResultSummary(event, locale)}</p> : null}
      {event.revised !== null || event.corrected ? <p className="mt-2 text-xs text-amber-200">{isAr ? "تتضمن البيانات مراجعة من المصدر." : "Includes a source revision."}</p> : null}
      {status === "no_numeric_result" ? <p className="mt-3 text-xs text-[#9CA3AF]">{isAr ? "هذا الحدث لا يتضمن نتيجة رقمية. نص البيان أو الخطاب غير متاح في هذه التغذية." : "This event has no numeric result. The statement or speech text is not included in this feed."}</p> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-[11px] text-[#8F96A3]">
        {event.source ? <span>{event.source}</span> : null}
        {event.providerUpdatedAt ? <span>{isAr ? "تحديث المصدر: " : "Source updated: "}{formatDate(event.providerUpdatedAt, locale, timeZone)}</span> : null}
      </div>
    </article>
  );
}

export function NewsPage({ locale, initialFeed, initialNow, eventId }: {
  locale: NewsLocale; initialFeed: NewsFeed; initialNow: number; eventId?: string;
}) {
  const isAr = locale === "ar";
  const router = useRouter();
  const { user } = useCanonicalSession();
  const [feed, setFeed] = useState(initialFeed);
  const [now, setNow] = useState(initialNow);
  const [filter, setFilter] = useState<Filter>(initialFeed.mode === "weekly" ? "week" : "upcoming");
  const [timeZone, setTimeZone] = useState("Asia/Jerusalem");
  const [deviceZone, setDeviceZone] = useState("Asia/Jerusalem");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshFeedback, setRefreshFeedback] = useState<RefreshFeedback | null>(null);
  const feedStatusRef = useRef(initialFeed.status);
  const feedModeRef = useRef(initialFeed.mode);

  useEffect(() => { setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);
  useEffect(() => {
    let active: AbortController | null = null;
    let disposed = false;
    let inFlight = false;
    let unauthorized = false;
    let lastCheckStartedAt = Date.now();
    async function refresh(manual = false) {
      if (document.visibilityState === "hidden" || inFlight || unauthorized || disposed) return;
      active = new AbortController();
      inFlight = true;
      lastCheckStartedAt = Date.now();
      setRefreshing(true);
      const timeout = setTimeout(() => active?.abort(), 12_000);
      try {
        const query = eventId ? `?event=${encodeURIComponent(eventId)}` : "";
        const response = await fetch(`/api/news${query}`, { signal: active.signal, cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          unauthorized = true;
          if (!disposed) {
            setFeed({ status: "unavailable", updatedAt: null, provider: null, events: [] });
            router.replace(getSignedOutPageDestination(`/${locale}/news${query}`));
          }
          return;
        }
        if (!response.ok) throw new Error("news");
        const data = await response.json() as NewsFeed;
        if (!disposed) {
          feedStatusRef.current = data.status;
          if (data.mode === "weekly" && feedModeRef.current !== "weekly") setFilter("week");
          feedModeRef.current = data.mode;
          setFeed(data);
          setNow(Date.now());
          setRefreshFeedback(manual
            ? data.status === "not_configured" ? "preparing" : data.status === "ready" ? "updated" : "unavailable"
            : null);
        }
      } catch {
        if (!disposed) {
          setFeed((previous) => ({ ...previous, status: previous.events.length ? "stale" : "unavailable" }));
          if (manual) setRefreshFeedback("failed");
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!disposed) setRefreshing(false);
      }
    }
    const onVisible = () => { if (document.visibilityState === "visible") { setNow(Date.now()); void refresh(); } };
    if (refreshKey > 0) void refresh(true);
    // A page opened before activation must discover it without a reload. Keep
    // inactive checks infrequent; returning to the app checks immediately.
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
      const interval = feedStatusRef.current === "not_configured" || feedModeRef.current === "weekly" ? ACTIVATION_CHECK_INTERVAL_MS : LIVE_CHECK_INTERVAL_MS;
      if (Date.now() - lastCheckStartedAt >= interval) void refresh();
    }, LIVE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      disposed = true;
      active?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [eventId, refreshKey, locale, router]);

  const weekly = feed.mode === "weekly";
  const stale = feed.status === "stale" || (feed.updatedAt !== null && now - Date.parse(feed.updatedAt) > newsFeedStaleAfterMs(feed));
  const available = (feed.status === "ready" || feed.status === "stale")
    && (!weekly || !feed.coverageEnd || now < Date.parse(feed.coverageEnd));
  const selected = eventId ? feed.events.find((event) => event.id === eventId) : undefined;
  const next = feed.events.find((event) => newsEventStatus(event, now) === "scheduled");
  const today = newsDayKey(new Date(now).toISOString(), timeZone);
  const filtered = feed.events.filter((event) => event.id !== selected?.id && (
    filter === "week" && feed.weekStart && feed.weekEnd ? newsDayKey(event.scheduledAt, timeZone) >= feed.weekStart && newsDayKey(event.scheduledAt, timeZone) < feed.weekEnd
      : filter === "today" ? newsDayKey(event.scheduledAt, timeZone) === today
      : filter === "released" ? newsEventStatus(event, now) === "released"
        : newsEventStatus(event, now) !== "released" && (Date.parse(event.scheduledAt) > now || newsDayKey(event.scheduledAt, timeZone) === today)
  ));
  if (filter === "released") filtered.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const filterLabels: Record<Filter, string> = isAr ? { week: "الأسبوع", upcoming: "القادمة", today: "اليوم", released: "النتائج" } : { week: "Week", upcoming: "Upcoming", today: "Today", released: "Results" };
  const filters: Filter[] = weekly ? ["week", "upcoming", "today", "released"] : ["upcoming", "today", "released"];
  const refreshMessages: Record<RefreshFeedback, string> = isAr ? {
    preparing: "تم التحقق. لم تبدأ تحديثات الأخبار المباشرة بعد.",
    updated: "تم تحديث الأخبار.",
    unavailable: "تم التحقق. لا تتوفر تحديثات جديدة حاليًا.",
    failed: "تعذر تحديث الأخبار. تحقق من الاتصال وحاول مرة أخرى.",
  } : {
    preparing: "Checked. Live news updates have not started yet.",
    updated: "News updated.",
    unavailable: "Checked. Fresh news updates are currently unavailable.",
    failed: "Could not refresh news. Check your connection and try again.",
  };

  return (
    <div className="section-container py-6 sm:py-9" dir={isAr ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D4AF37]">{brandText("ALPHA TRADERS")}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{isAr ? "أخبار الدولار" : "USD news"}</h1><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#9CA3AF]">{isAr ? "الأحداث الاقتصادية ذات التأثير المرتفع ومواعيدها ونتائجها، في مكان واحد." : "High-impact economic events, upcoming releases and published results, in one place."}</p></div>
          <Button variant="secondary" size="sm" className="shrink-0" loading={refreshing} loadingLabel={isAr ? "جارٍ التحقق…" : "Checking…"} aria-label={isAr ? "تحديث الأخبار" : "Refresh news"} onClick={() => { setRefreshFeedback(null); setRefreshKey((value) => value + 1); }}><span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4" aria-hidden="true" />{isAr ? "تحديث" : "Refresh"}</span></Button>
        </div>
        {refreshFeedback ? <p role="status" className={`mt-3 text-sm ${refreshFeedback === "failed" ? "text-amber-200" : "text-[#C7CDD6]"}`}>{refreshMessages[refreshFeedback]}</p> : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-3 text-xs">
          <span className="inline-flex items-center gap-2 text-red-300"><Folder className="h-4 w-4 fill-red-400/20" aria-hidden="true" />USD · {weekly ? (isAr ? "أحداث رئيسية مختارة" : "Selected major events") : (isAr ? "تأثير مرتفع فقط" : "High impact only")}</span>
          <label className="flex max-w-full items-center gap-2 text-[#9CA3AF]"><Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="shrink-0">{isAr ? "التوقيت" : "Timezone"}</span><select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className={`min-h-9 min-w-0 max-w-[13rem] rounded-lg border border-white/15 bg-[#101114] px-2 text-white ${FOCUS}`}><option value="Asia/Jerusalem">{isAr ? "توقيت إسرائيل" : "Israel time"}</option>{deviceZone !== "Asia/Jerusalem" ? <option value={deviceZone}>{isAr ? "توقيت الجهاز" : "Device time"} · {deviceZone}</option> : null}</select></label>
        </div>
        {weekly ? <div className="mt-4 rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-3 text-sm leading-relaxed text-[#C7CDD6]"><p className="font-medium text-[#E6C66A]">{isAr ? "أخبار الأسبوع القادم · تحديث كل أحد" : "Week ahead · Updated every Sunday"}</p>{feed.weekStart && feed.weekEnd ? <p className="mt-1 text-xs font-medium">{formatDate(`${feed.weekStart}T12:00:00Z`, locale, "UTC", false)} — {formatDate(new Date(Date.parse(`${feed.weekEnd}T12:00:00Z`) - 86_400_000).toISOString(), locale, "UTC", false)}</p> : null}<p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "نجهّز كل أحد مواعيد الأسبوع القادم من الاثنين إلى الأحد، من المصادر الرسمية المجانية. النتائج هي آخر أرقام مؤكدة وقت التحديث الأسبوعي، وليست تحديثات لحظية. لا يشمل توقعات السوق المجمّعة." : "Every Sunday we prepare the coming week, Monday through Sunday, from free official sources. Results are the last confirmed figures at the weekly update, not a live feed. Consensus forecasts are not included."}</p></div> : null}
        {stale ? <p role="status" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">{weekly ? (isAr ? "قد يكون التقويم الأسبوعي قديمًا. المعروض هو آخر تحديث تم التحقق منه." : "The weekly calendar may be out of date. This is the last verified snapshot.") : (isAr ? "تحديث الأخبار متأخر. الأرقام المعروضة هي آخر بيانات تم استلامها." : "News updates are delayed. The figures shown are the last received data.")}</p> : null}
        {!available ? (
          <div role="status" className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-10 text-center"><CalendarDays className="mx-auto h-7 w-7 text-[#D4AF37]" aria-hidden="true" /><h2 className="mt-3 font-semibold">{feed.status === "not_configured" ? (isAr ? "جارٍ تجهيز أخبار الدولار" : "USD news is being prepared") : (isAr ? "الأخبار غير متاحة مؤقتًا" : "News is temporarily unavailable")}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#9CA3AF]">{feed.status === "not_configured"
            ? (isAr ? "تحديثات الأخبار المباشرة لم تبدأ بعد. تفحص الصفحة التفعيل تلقائيًا، وستظهر المواعيد والنتائج هنا عند بدء الخدمة." : "Live news updates have not started yet. This page checks automatically and will show schedules and results here when the service is activated.")
            : (isAr ? "ستظهر هنا المواعيد والنتائج المؤكدة عند توفر تحديثات الأخبار." : "Verified schedules and results will appear here when news updates are available.")}</p></div>
        ) : (
          <>
            {selected ? <div className="mt-5"><EventCard event={selected} locale={locale} timeZone={timeZone} now={now} selected weekly={weekly} /></div> : eventId ? <p role="status" className="mt-4 text-sm text-[#9CA3AF]">{isAr ? "هذا الخبر غير متاح حاليًا." : "This event is currently unavailable."}</p> : next ? (
              <a href={`#event-${next.id}`} onClick={() => setFilter("upcoming")} className={`mt-5 flex items-center justify-between gap-4 rounded-2xl border border-[#C9A227]/25 bg-gradient-to-r from-[#C9A227]/10 to-transparent p-4 sm:p-5 ${FOCUS}`}><div><p className="text-xs text-[#D4AF37]">{isAr ? "الخبر القادم" : "Next release"}</p><p className="mt-1 font-semibold" dir="auto">{newsEventTitle(next, locale)}</p><p className="mt-1 text-xs text-[#9CA3AF]">{formatDate(next.scheduledAt, locale, timeZone)}</p></div><span className="shrink-0 text-sm font-semibold text-[#E6C66A]">{countdown(next.scheduledAt, now, locale)}</span></a>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/20 p-1 min-[360px]:flex" role="group" aria-label={isAr ? "عرض الأخبار" : "News view"}>{filters.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={`min-h-11 min-w-0 flex-1 rounded-lg px-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${FOCUS} ${filter === item ? "bg-white/10 text-white" : "text-[#9CA3AF] hover:text-white"}`}>{filterLabels[item]}</button>)}</div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">{filtered.map((event) => <EventCard key={event.id} event={event} locale={locale} timeZone={timeZone} now={now} weekly={weekly} />)}</div>
            {!filtered.length ? <p className="py-10 text-center text-sm text-[#9CA3AF]">{isAr ? "لا توجد أحداث أخرى مطابقة لهذا العرض." : "No other events match this view."}</p> : null}
          </>
        )}
        {feed.updatedAt ? <p className="mt-4 text-xs text-[#8F96A3]">{weekly ? (isAr ? "آخر تحقق أسبوعي: " : "Last weekly verification: ") : (isAr ? "آخر مزامنة: " : "Last synced: ")}{formatDate(feed.updatedAt, locale, timeZone)}</p> : null}
        {user && !weekly ? <div className="mt-6"><NewsPreferences key={`${user.id}:${available}`} locale={locale} /></div> : null}
        <p className="mt-5 text-xs leading-relaxed text-[#737C8C]">{isAr ? "قد تتغير مواعيد الإصدار. النتائج معلومات اقتصادية ولا تضمن اتجاه حركة السوق." : "Release times may change. Results are economic information and do not guarantee a market direction."}</p>
      </div>
    </div>
  );
}
