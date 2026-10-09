import { CalendarDays, Check, ChevronDown, Clock3, FileText, Folder } from "lucide-react";
import { newsEventStatus, newsEventTitle, newsResultSummary, type NewsEvent, type NewsLocale } from "@/lib/economic-news/model";
import styles from "./news-page.module.css";
import { newsEventContext } from "@/lib/economic-news/event-context";

export function formatNewsDate(iso: string, locale: NewsLocale, timeZone: string, includeTime = true) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-GB", {
    timeZone, weekday: "short", day: "numeric", month: "short",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(iso));
}

export function EventCard({ event, locale, timeZone, now, selected = false, weekly = false }: {
  event: NewsEvent; locale: NewsLocale; timeZone: string; now: number; selected?: boolean; weekly?: boolean;
}) {
  const isAr = locale === "ar";
  const status = newsEventStatus(event, now);
  const released = status === "released";
  const published = status === "published";
  const title = newsEventTitle(event, locale);
  const labels = isAr ? {
    released: "نتيجة مؤكدة", scheduled: "قادم", awaiting: weekly ? "النتيجة غير مضافة" : "بانتظار النتيجة",
    tentative: "الموعد غير مؤكد", no_numeric_result: "بانتظار ملخص مؤكد", published: "صدر الملخص",
  } : {
    released: "Confirmed result", scheduled: "Upcoming", awaiting: weekly ? "Result not added" : "Awaiting result",
    tentative: "Time unconfirmed", no_numeric_result: "Summary pending", published: "Summary available",
  };
  const resultItems = [
    { label: isAr ? "النتيجة الفعلية" : "Actual", value: released ? event.actual : null, tone: released ? styles.actual : styles.missing,
      missing: isAr ? (status === "awaiting" ? "غير مضافة" : "لم تصدر بعد") : (status === "awaiting" ? "Not added" : "Pending") },
    { label: isAr ? "المتوقع" : "Forecast", value: event.forecast, tone: styles.forecast, missing: isAr ? "غير متاح" : "Not available" },
    { label: isAr ? "السابق" : "Previous", value: event.previous, tone: styles.previous, missing: isAr ? "غير متاح" : "Not available" },
  ];
  const action = published ? (isAr ? "ماذا حدث؟" : "What happened") : released || status === "awaiting"
    ? (isAr ? "عرض النتائج" : "View results")
    : event.kind === "speech" ? (isAr ? "عرض التفاصيل" : "View details")
      : (isAr ? "عرض التوقعات" : "View expectations");
  return (
    <article id={`event-${event.id}`} tabIndex={-1} aria-labelledby={`title-${event.id}`} className={`${styles.eventCard} ${selected ? styles.selectedCard : ""}`}>
      <details className={styles.eventDetails} open={selected}>
        <summary aria-label={`${action}: ${title}`}>
          <div className={styles.eventMeta}>
            <span className={styles.eventKind}>
              {event.kind === "speech" ? <FileText size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
              <bdi>USD</bdi><span aria-hidden="true">·</span>{event.kind === "speech" ? (isAr ? "خطاب / بيان" : "Speech / statement") : (isAr ? "بيانات اقتصادية" : "Economic release")}
            </span>
            <span className={`${styles.status} ${released || published ? styles.confirmed : ""}`}>
              {released || published ? <Check size={13} aria-hidden="true" /> : null}{labels[status]}
            </span>
          </div>
          <h3 id={`title-${event.id}`} className={styles.eventTitle} dir="auto">{title}</h3>
          <div className={styles.eventWhen}>
            <span><CalendarDays size={16} aria-hidden="true" /><time dateTime={event.scheduledAt}>{formatNewsDate(event.scheduledAt, locale, timeZone, false)}</time></span>
            <span><Clock3 size={16} aria-hidden="true" />{event.timing === "exact"
              ? <time dateTime={event.scheduledAt} className={styles.eventTime}>{new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.scheduledAt))}</time>
              : <span>{isAr ? "لم يُحدد الوقت" : "Time to be confirmed"}</span>}</span>
          </div>
          {released ? <p className={styles.resultPreview}><span>{isAr ? "النتيجة" : "Result"}</span><bdi dir="ltr">{event.actual}</bdi></p> : null}
          <span className={styles.disclosureHint}><span>{action}</span><ChevronDown size={16} aria-hidden="true" /></span>
        </summary>
        <div className={styles.expandedContent}>
          {published ? <div className={styles.outcome}><h4>{isAr ? "ماذا حدث؟" : "What happened"}</h4><p>{event.outcome?.[locale]}</p></div> : null}
          {event.kind === "release" || released ? (
            <dl className={styles.results} style={{ gridTemplateColumns: `repeat(${resultItems.length}, minmax(0, 1fr))` }}>
              {resultItems.map((item) => <div key={item.label} className={styles.resultCell}>
                <dt>{item.label}</dt>
                <dd className={item.value === null ? styles.missing : item.tone}>{item.value === null ? item.missing : <bdi dir="ltr">{item.value}</bdi>}</dd>
              </div>)}
            </dl>
          ) : null}
          {event.revised !== null || event.corrected ? <p className={styles.revision}>{isAr ? "تتضمن البيانات مراجعة من المصدر." : "Includes a source revision."}</p> : null}
          <div className={styles.detailBody}>
            <p className={styles.context}>{newsEventContext(event, locale)}</p>
            {isAr && event.titleAr !== event.title ? <p dir="ltr">{event.title}</p> : null}
            {event.reference ? <p>{isAr ? "الفترة: " : "Period: "}<bdi>{event.reference}</bdi></p> : null}
            {released ? <p>{newsResultSummary(event, locale)}</p> : null}
            {event.revised !== null ? <p>{isAr ? "السابق بعد المراجعة: " : "Revised previous: "}<bdi dir="ltr">{event.revised}</bdi></p> : null}
            {event.kind === "speech" && !published && status !== "scheduled" && status !== "tentative" ? <p>{isAr ? "مرّ الموعد، ولم يُتحقق من ملخص المصدر بعد." : "The scheduled time has passed. A source summary has not been verified yet."}</p> : null}
            {weekly && status === "awaiting" ? <p>{isAr ? "مرّ الموعد المجدول. ستظهر النتيجة بعد التحقق من نشر المصدر." : "The scheduled time has passed. The result will appear after its official publication is verified."}</p> : null}
            {weekly && event.kind === "release" && event.forecast === null ? <p>{isAr ? "التوقع الرقمي غير متاح من المصادر الرسمية. الرقم السابق للمقارنة وليس توقعًا." : "Official sources do not provide a consensus forecast. Previous is a comparison, not a prediction."}</p> : null}
            {event.source ? <p>{isAr ? "المصدر: " : "Source: "}<bdi>{event.source}</bdi></p> : null}
            {event.providerUpdatedAt ? <p>{isAr ? "تحديث المصدر: " : "Source updated: "}{formatNewsDate(event.providerUpdatedAt, locale, timeZone)}</p> : null}
            {event.publishedAt ? <p>{isAr ? "نُشر: " : "Published: "}{formatNewsDate(event.publishedAt, locale, timeZone)}</p> : null}
          </div>
        </div>
      </details>
    </article>
  );
}
