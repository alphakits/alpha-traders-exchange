"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, Clock3, RefreshCw } from "lucide-react";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { Button } from "@/components/ui/button";
import { NewsPreferences } from "./news-preferences";
import { EventCard, formatNewsDate as formatDate } from "./news-event-card";
import styles from "./news-page.module.css";
import { getSignedOutPageDestination } from "@/lib/protected-page";
import { newsFeedStaleAfterMs, newsDayKey, newsWeekRange, newsEventStatus, newsEventTitle, type NewsEvent, type NewsFeed, type NewsLocale } from "@/lib/economic-news/model";

type Filter = "week" | "upcoming" | "today" | "released";
type RefreshFeedback = "preparing" | "updated" | "unavailable" | "failed";
const LIVE_CHECK_INTERVAL_MS = 30_000;
const ACTIVATION_CHECK_INTERVAL_MS = 5 * 60_000;

function countdown(iso: string, now: number, locale: NewsLocale) {
  const minutes = Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
  const isAr = locale === "ar";
  if (minutes < 60) return isAr ? `خلال ${minutes} دقيقة` : `In ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isAr ? `خلال ${hours} ساعة و${minutes % 60} دقيقة` : `In ${hours}h ${minutes % 60}m`;
  return isAr ? `خلال ${Math.floor(hours / 24)} يوم و${hours % 24} ساعة` : `In ${Math.floor(hours / 24)}d ${hours % 24}h`;
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
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
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
  const orderedEvents = [...feed.events].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id));
  const selected = eventId ? orderedEvents.find((event) => event.id === eventId) : undefined;
  const next = orderedEvents.find((event) => newsEventStatus(event, now) === "scheduled");
  const today = newsDayKey(new Date(now).toISOString(), timeZone);
  const thisWeek = newsWeekRange(now, timeZone);
  const thisWeekSunday = new Date(Date.parse(`${thisWeek.end}T12:00:00Z`) - 86_400_000).toISOString();
  const nextFilter: Filter = weekly && next && newsDayKey(next.scheduledAt, timeZone) < thisWeek.end ? "week" : "upcoming";
  const filtered = orderedEvents.filter((event) => {
    if (event.id === selected?.id) return false;
    const day = newsDayKey(event.scheduledAt, timeZone);
    if (filter === "week") return day >= thisWeek.start && day < thisWeek.end;
    if (filter === "today") return day === today;
    if (filter === "released") return newsEventStatus(event, now) === "released";
    return newsEventStatus(event, now) !== "released"
      && (Date.parse(event.scheduledAt) > now || day === today)
      && (!weekly || day >= thisWeek.end);
  });
  if (filter === "released") filtered.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const grouped = new Map<string, NewsEvent[]>();
  for (const event of filtered) {
    const day = newsDayKey(event.scheduledAt, timeZone);
    const group = grouped.get(day);
    if (group) group.push(event);
    else grouped.set(day, [event]);
  }

  useEffect(() => {
    if (!scrollTarget) return;
    const target = document.getElementById(`event-${scrollTarget}`);
    if (target) {
      target.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    }
    setScrollTarget(null);
  }, [scrollTarget, filter]);

  const emptyMessages: Record<Filter, string> = isAr ? {
    week: "لا توجد أحداث اقتصادية مدرجة لهذا الأسبوع.",
    upcoming: "لم تتوفر بعد مواعيد مؤكّدة للأسابيع التالية.",
    today: "لا توجد أحداث مجدولة اليوم.",
    released: "لا توجد نتائج مؤكّدة حاليًا.",
  } : {
    week: "No economic events are listed for this week.",
    upcoming: "No later events have been confirmed yet.",
    today: "No events are scheduled for today.",
    released: "No confirmed results are available yet.",
  };
  const filterLabels: Record<Filter, string> = isAr ? { week: "هذا الأسبوع", upcoming: "القادمة", today: "اليوم", released: "النتائج" } : { week: "This week", upcoming: "Upcoming", today: "Today", released: "Results" };
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
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.heading}>{isAr ? "أخبار الدولار" : "USD news"}</h1>
          <Button variant="secondary" size="sm" className={styles.refresh} loading={refreshing} loadingLabel={isAr ? "جارٍ التحقق…" : "Checking…"} aria-label={isAr ? "تحديث الأخبار" : "Refresh news"} onClick={() => { setRefreshFeedback(null); setRefreshKey((value) => value + 1); }}><span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4" aria-hidden="true" />{isAr ? "تحديث" : "Refresh"}</span></Button>
        </div>
        {refreshFeedback ? <p role="status" className={`mt-3 text-sm ${refreshFeedback === "failed" ? "text-amber-200" : "text-[#C7CDD6]"}`}>{refreshMessages[refreshFeedback]}</p> : null}
        <div className={styles.toolbar}>
          <label className={styles.timezone}><Clock3 size={16} aria-hidden="true" /><span>{isAr ? "التوقيت" : "Timezone"}</span><select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}><option value="Asia/Jerusalem">{isAr ? "توقيت إسرائيل" : "Israel time"}</option>{deviceZone !== "Asia/Jerusalem" ? <option value={deviceZone}>{isAr ? "توقيت الجهاز" : "Device time"} · {deviceZone}</option> : null}</select></label>
        </div>
        {weekly ? <p className={styles.weeklyNote}><CalendarDays size={16} aria-hidden="true" /><span>{isAr ? "تحديث كل أحد · النتائج ليست لحظية" : "Updated Sundays · Results are not live"}</span></p> : null}
        {stale ? <p role="status" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">{weekly ? (isAr ? "قد يكون التقويم الأسبوعي قديمًا. المعروض هو آخر تحديث تم التحقق منه." : "The weekly calendar may be out of date. This is the last verified snapshot.") : (isAr ? "تحديث الأخبار متأخر. الأرقام المعروضة هي آخر بيانات تم استلامها." : "News updates are delayed. The figures shown are the last received data.")}</p> : null}
        {!available ? (
          <div role="status" className={styles.empty}><CalendarDays size={28} aria-hidden="true" /><h2 className="font-semibold text-white">{feed.status === "not_configured" ? (isAr ? "جارٍ تجهيز أخبار الدولار" : "USD news is being prepared") : (isAr ? "الأخبار غير متاحة مؤقتًا" : "News is temporarily unavailable")}</h2><p className="mx-auto mt-2 max-w-md">{feed.status === "not_configured"
            ? (isAr ? "ستظهر الأحداث هنا عند توفرها. نتحقق تلقائيًا من التحديثات." : "Events will appear here when available. We check for updates automatically.")
            : (isAr ? "حاول التحديث بعد قليل." : "Try refreshing again shortly.")}</p></div>
        ) : (
          <>
            {selected ? <EventCard event={selected} locale={locale} timeZone={timeZone} now={now} selected weekly={weekly} /> : eventId ? <p role="status" className="mt-4 text-sm text-[#9CA3AF]">{isAr ? "هذا الخبر غير متاح حاليًا." : "This event is currently unavailable."}</p> : next ? (
              <a href={`#event-${next.id}`} onClick={(e) => { e.preventDefault(); setFilter(nextFilter); setScrollTarget(next.id); }} className={styles.nextEvent}>
                <div><div className={styles.nextTop}><p className={styles.nextLabel}><Clock3 size={15} aria-hidden="true" />{isAr ? "الخبر القادم" : "Next release"}</p><span className={styles.countdown}>{countdown(next.scheduledAt, now, locale)}</span></div><p className={styles.nextTitle} dir="auto">{newsEventTitle(next, locale)}</p><p className={styles.nextDate}>{formatDate(next.scheduledAt, locale, timeZone)}</p></div>
              </a>
            ) : null}
            <div className={styles.filters} role="group" aria-label={isAr ? "عرض الأخبار" : "News view"}>{filters.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={styles.filter}>{filterLabels[item]}</button>)}</div>
            {weekly && filter === "week" ? <p className={styles.range}>{formatDate(`${thisWeek.start}T12:00:00Z`, locale, "UTC", false)} — {formatDate(thisWeekSunday, locale, "UTC", false)}</p> : null}
            {weekly && filter === "upcoming" ? <p className={styles.range}>{isAr ? "بعد هذا الأسبوع · من " : "After this week · From "}{formatDate(`${thisWeek.end}T12:00:00Z`, locale, "UTC", false)}</p> : null}
            <div aria-label={isAr ? "الأحداث الاقتصادية" : "Economic events"}>
              {[...grouped].map(([day, events]) => <section key={day} className={styles.dayGroup} aria-labelledby={`day-${day}`}>
                <h2 id={`day-${day}`} className={styles.dayHeading}>
                  <CalendarDays size={17} aria-hidden="true" />
                  <time dateTime={day}>{new Intl.DateTimeFormat(isAr ? "ar-IL" : "en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</time>
                  {day === today ? <span className={styles.dayBadge}>{isAr ? "اليوم" : "Today"}</span> : null}
                </h2>
                <div className={styles.eventGrid}>{events.map((event) => <EventCard key={event.id} event={event} locale={locale} timeZone={timeZone} now={now} weekly={weekly} />)}</div>
              </section>)}
            </div>
            {!filtered.length && !selected ? <div className={styles.empty}><CalendarDays size={24} aria-hidden="true" /><p>{emptyMessages[filter]}</p></div> : null}
          </>
        )}
        {available ? <details className={styles.guide}>
          <summary><span>{isAr ? "كيف أقرأ النتائج؟" : "How to read results"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <dl className={styles.guideContent}>
            <div><dt className={styles.actual}>{isAr ? "النتيجة الفعلية" : "Actual"}</dt><dd>{isAr ? "الرقم المؤكد الصادر عن المصدر." : "The confirmed figure from the source."}</dd></div>
            {!weekly ? <div><dt className={styles.forecast}>{isAr ? "المتوقع" : "Forecast"}</dt><dd>{isAr ? "التقدير قبل صدور النتيجة، إن توفر." : "The estimate before release, when available."}</dd></div> : null}
            <div><dt className={styles.previous}>{isAr ? "السابق" : "Previous"}</dt><dd>{isAr ? "رقم الفترة السابقة للمقارنة." : "The prior period’s figure for comparison."}</dd></div>
            <div><dt>{isAr ? "غير مضافة / غير متاح" : "Not added / Not available"}</dt><dd>{isAr ? "لا توجد قيمة مؤكدة في التقويم. لا يعني ذلك صفرًا." : "No confirmed value in the calendar. It does not mean zero."}</dd></div>
          </dl>
        </details> : null}
        {feed.updatedAt ? <p className={styles.verification}>{weekly ? (isAr ? "آخر تحقق أسبوعي: " : "Last weekly verification: ") : (isAr ? "آخر مزامنة: " : "Last synced: ")}{formatDate(feed.updatedAt, locale, timeZone)}</p> : null}
        {user && !weekly ? <div className="mt-6"><NewsPreferences key={`${user.id}:${available}`} locale={locale} /></div> : null}
        <p className={styles.disclaimer}>{isAr ? "قد تتغير المواعيد. النتيجة لا تحدد اتجاه السوق." : "Times may change. A result does not determine market direction."}</p>
      </div>
    </div>
  );
}
