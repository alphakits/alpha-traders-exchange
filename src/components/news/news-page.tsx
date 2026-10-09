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

type Filter = "week" | "next" | "previous";
const FILTERS: Filter[] = ["week", "next", "previous"];
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
  const [filter, setFilter] = useState<Filter>(() => {
    const linked = initialFeed.events.find((event) => event.id === eventId);
    if (linked) {
      const day = newsDayKey(linked.scheduledAt, "Asia/Jerusalem");
      for (const [name, offset] of [["previous", -1], ["next", 1]] as const) {
        const range = newsWeekRange(initialNow, "Asia/Jerusalem", offset);
        if (day >= range.start && day < range.end) return name;
      }
    }
    return "week";
  });
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
  const linked = eventId ? orderedEvents.find((event) => event.id === eventId) : undefined;
  const today = newsDayKey(new Date(now).toISOString(), timeZone);
  const ranges = {
    week: newsWeekRange(now, timeZone),
    next: newsWeekRange(now, timeZone, 1),
    previous: newsWeekRange(now, timeZone, -1),
  };
  const range = ranges[filter];
  const linkedDay = linked ? newsDayKey(linked.scheduledAt, timeZone) : null;
  const selected = linkedDay && (linkedDay >= range.start && linkedDay < range.end
    || filter === "week" && (linkedDay < ranges.previous.start || linkedDay >= ranges.next.end)) ? linked : undefined;
  const rangeSunday = new Date(Date.parse(`${range.end}T12:00:00Z`) - 86_400_000).toISOString();
  const next = orderedEvents.find((event) => newsEventStatus(event, now) === "scheduled"
    && newsDayKey(event.scheduledAt, timeZone) < ranges.week.end);
  const filtered = orderedEvents.filter((event) => {
    if (event.id === selected?.id) return false;
    const day = newsDayKey(event.scheduledAt, timeZone);
    return day >= range.start && day < range.end;
  });
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
    next: "لم تُضف أحداث مؤكّدة للأسبوع القادم بعد.",
    previous: "لا تتوفر أحداث محفوظة للأسبوع السابق.",
  } : {
    week: "No economic events are listed for this week.",
    next: "No confirmed events have been added for next week yet.",
    previous: "No events are saved for the previous week.",
  };
  const filterLabels: Record<Filter, string> = isAr
    ? { week: "هذا الأسبوع", next: "الأسبوع القادم", previous: "الأسبوع السابق" }
    : { week: "This week", next: "Next week", previous: "Previous week" };
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
        {weekly ? <p className={styles.weeklyNote}><CalendarDays size={16} aria-hidden="true" /><span>{isAr ? "نتائج مؤكدة من المصادر الرسمية · ليست لحظية" : "Verified official results · Not real time"}</span></p> : null}
        {stale ? <p role="status" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">{weekly ? (isAr ? "قد يكون التقويم الأسبوعي قديمًا. المعروض هو آخر تحديث تم التحقق منه." : "The weekly calendar may be out of date. This is the last verified snapshot.") : (isAr ? "تحديث الأخبار متأخر. الأرقام المعروضة هي آخر بيانات تم استلامها." : "News updates are delayed. The figures shown are the last received data.")}</p> : null}
        {!available ? (
          <div role="status" className={styles.empty}><CalendarDays size={28} aria-hidden="true" /><h2 className="font-semibold text-white">{feed.status === "not_configured" ? (isAr ? "جارٍ تجهيز أخبار الدولار" : "USD news is being prepared") : (isAr ? "الأخبار غير متاحة مؤقتًا" : "News is temporarily unavailable")}</h2><p className="mx-auto mt-2 max-w-md">{feed.status === "not_configured"
            ? (isAr ? "ستظهر الأحداث هنا عند توفرها. نتحقق تلقائيًا من التحديثات." : "Events will appear here when available. We check for updates automatically.")
            : (isAr ? "حاول التحديث بعد قليل." : "Try refreshing again shortly.")}</p></div>
        ) : (
          <>
            <div className={styles.filters} role="group" aria-label={isAr ? "عرض الأخبار" : "News view"}>{FILTERS.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={styles.filter}>{filterLabels[item]}</button>)}</div>
            <p className={styles.range}>{formatDate(`${range.start}T12:00:00Z`, locale, "UTC", false)} — {formatDate(rangeSunday, locale, "UTC", false)}</p>
            <p className={styles.weekHint}>{filter === "week"
              ? (isAr ? "ما حدث وما تبقّى هذا الأسبوع. اضغط على الخبر للتفاصيل." : "What happened and what is still ahead. Tap an event for details.")
              : filter === "next" ? (isAr ? "مواعيد الأسبوع القادم، وما نتابعه، والأرقام السابقة للمقارنة." : "Next week's schedule, what to watch, and previous readings.")
                : (isAr ? "أحداث الأسبوع السابق ونتائجها المؤكدة." : "Last week's events and their confirmed results.")}</p>
            {selected ? <EventCard event={selected} locale={locale} timeZone={timeZone} now={now} selected weekly={weekly} /> : eventId && !linked ? <p role="status" className="mt-4 text-sm text-[#9CA3AF]">{isAr ? "هذا الخبر غير متاح حاليًا." : "This event is currently unavailable."}</p> : next && filter === "week" ? (
              <a href={`#event-${next.id}`} onClick={(e) => { e.preventDefault(); setScrollTarget(next.id); }} className={styles.nextEvent}>
                <div><div className={styles.nextTop}><p className={styles.nextLabel}><Clock3 size={15} aria-hidden="true" />{isAr ? "الخبر القادم" : "Next release"}</p><span className={styles.countdown}>{countdown(next.scheduledAt, now, locale)}</span></div><p className={styles.nextTitle} dir="auto">{newsEventTitle(next, locale)}</p><p className={styles.nextDate}>{formatDate(next.scheduledAt, locale, timeZone)}</p></div>
              </a>
            ) : null}
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
            <div><dt className={styles.forecast}>{isAr ? "المتوقع" : "Forecast"}</dt><dd>{isAr ? "التقدير قبل صدور النتيجة، إن توفر." : "The estimate before release, when available."}</dd></div>
            <div><dt className={styles.previous}>{isAr ? "السابق" : "Previous"}</dt><dd>{isAr ? "رقم الفترة السابقة للمقارنة." : "The prior period’s figure for comparison."}</dd></div>
            <div><dt>{isAr ? "غير مضافة / غير متاح" : "Not added / Not available"}</dt><dd>{isAr ? "لا توجد قيمة مؤكدة في التقويم. لا يعني ذلك صفرًا." : "No confirmed value in the calendar. It does not mean zero."}</dd></div>
            <div><dt><span className={styles.resultPositive}>{isAr ? "+ إيجابي" : "+ Positive"}</span>{" / "}<span className={styles.resultNegative}>{isAr ? "− سلبي" : "− Negative"}</span></dt><dd>{isAr ? "لون القيمة الموقعة يتبع + أو −. دون إشارة، نقارن الوظائف والنمو والإنفاق؛ انخفاض البطالة والطلبات إيجابي. يوضح النص أساس المقارنة." : "Signed values follow + or −. Otherwise, jobs, growth and spending use a comparison; lower unemployment and claims are positive. The label explains the comparison."}</dd></div>
            <div><dt className={styles.resultNeutral}>{isAr ? "محايد" : "Neutral"}</dt><dd>{isAr ? "لا تغيير أو لا توجد دلالة واضحة. التضخم والفائدة والأجور والخطابات لا تحصل على حكم تلقائي. الألوان لا تتنبأ بحركة السوق." : "Unchanged or no clear interpretation. Inflation, rates, wages and speeches are not automatically rated. Colors do not predict market moves."}</dd></div>
          </dl>
        </details> : null}
        {feed.updatedAt ? <p className={styles.verification}>{weekly ? (isAr ? "آخر تحقق أسبوعي: " : "Last weekly verification: ") : (isAr ? "آخر مزامنة: " : "Last synced: ")}{formatDate(feed.updatedAt, locale, timeZone)}</p> : null}
        {weekly && feed.resultsVerifiedAt ? <p className={styles.verification}>{isAr ? "آخر تحقق من النتائج: " : "Results checked: "}{formatDate(feed.resultsVerifiedAt, locale, timeZone)}</p> : null}
        {user && !weekly ? <div className="mt-6"><NewsPreferences key={`${user.id}:${available}`} locale={locale} /></div> : null}
        <p className={styles.disclaimer}>{isAr ? "قد تتغير المواعيد. النتيجة لا تحدد اتجاه السوق." : "Times may change. A result does not determine market direction."}</p>
      </div>
    </div>
  );
}
