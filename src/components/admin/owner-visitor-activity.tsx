"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { analyticsActionLabel, analyticsPageLabel, type OwnerVisitor, type VisitorDirectory, type VisitorEvent, type VisitorPeriod, type VisitorTimeline } from "@/lib/owner-visitor-activity";
import { LIVE_ANALYTICS_TIME_ZONE } from "@/lib/owner-live-analytics";

const buttonClass = "min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm text-[#F4D978] disabled:opacity-50";
function useActivityPages<T>(url: string | null, field: "visitors" | "events", revision: string | null) {
  const [rows,setRows] = useState<T[]>([]);
  const [cursor,setCursor] = useState<string | null>(null);
  const [loading,setLoading] = useState(false);
  const [failed,setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (next?: string | null) => {
    if (!url) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true); setFailed(false);
    if (!next) { setRows([]); setCursor(null); }
    const timeout = window.setTimeout(() => current.abort(),15_000);
    try {
      const response = await fetch(`${url}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, {
        signal: current.signal, cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) throw Error("Activity unavailable");
      const body: VisitorDirectory & VisitorTimeline = await response.json();
      if (!Array.isArray(body[field])) throw Error("Invalid activity");
      if (current.signal.aborted || controller.current !== current) return;
      setRows(previous => next ? [...previous,...body[field] as T[]] : body[field] as T[]);
      setCursor(body.nextCursor);
    } catch {
      if (controller.current === current) { setFailed(true); setRows([]); setCursor(null); }
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === current) setLoading(false);
    }
  },[url,field]);
  useEffect(() => {
    void load();
    return () => { const current = controller.current; controller.current = null; current?.abort(); };
  },[load,revision]);
  return { rows,cursor,loading,failed,load };
}

function VisitorHistory({ visitor,period,locale,revision }: { visitor: OwnerVisitor; period: VisitorPeriod; locale: "ar" | "en"; revision: string | null }) {
  const t = (en: string,ar: string) => locale === "ar" ? ar : en;
  const history = useActivityPages<VisitorEvent>(`/api/admin/visitor-activity?period=${period}&person=${encodeURIComponent(visitor.key)}`,"events",revision);
  const time = (value: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-GB",{ timeZone: LIVE_ANALYTICS_TIME_ZONE,dateStyle:"short",timeStyle:"medium" }).format(new Date(value));
  return <div className="mt-4 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/5 p-4" aria-label={t("Visitor timeline","سجل الزائر")}>
    <h4 className="break-words font-semibold text-white">{visitor.accountId ?? t("Guest","ضيف")}{visitor.name ? ` (${visitor.name})` : ""}</h4>
    <p className="mt-1 text-xs leading-5 text-[#9CA3AF]">{t("Newest first. Page visits include returns. Actions are recorded server events performed by this account.","الأحدث أولًا. زيارات الصفحات تشمل الرجوع. الإجراءات هي الأحداث المسجّلة في الخادم باسم هذا الحساب.")}</p>
    {history.loading && !history.rows.length ? <p role="status" className="mt-3 text-sm text-[#9CA3AF]">{t("Loading activity…","جارٍ تحميل النشاط…")}</p> : null}
    {history.failed ? <p role="alert" className="mt-3 text-sm text-amber-200">{t("Activity unavailable. Refresh to try again.","النشاط غير متاح. حدّث للمحاولة مجددًا.")}</p> : null}
    {!history.loading && !history.failed && !history.rows.length ? <p className="mt-3 text-sm text-[#9CA3AF]">{t("No recorded events in this period.","لا توجد أحداث مسجّلة خلال هذه الفترة.")}</p> : null}
    <ol className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto">
      {history.rows.map(event => <li key={event.id} className="border-s-2 border-[#D4AF37]/40 ps-3">
        <p className="break-words text-sm text-white">{event.kind === "page" ? `${t("Visited","زار")} ${analyticsPageLabel(event.label,locale)}` : analyticsActionLabel(event.label,locale)}</p>
        <p className="mt-1 text-xs text-[#9CA3AF]">{time(event.at)} · {event.platform ?? t("Account action","إجراء الحساب")}</p>
      </li>)}
    </ol>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={history.loading} onClick={() => void history.load()}>{t("Refresh activity","تحديث النشاط")}</button>
      {history.cursor ? <button type="button" className={buttonClass} disabled={history.loading} onClick={() => void history.load(history.cursor)}>{t("Older activity","نشاط أقدم")}</button> : null}
    </div>
  </div>;
}

export function OwnerVisitorActivity({ period,locale,revision }: { period: VisitorPeriod; locale: "ar" | "en"; revision: string | null }) {
  const [open,setOpen] = useState(false);
  const [selected,setSelected] = useState<OwnerVisitor | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selected) timelineRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  },[selected]);
  const t = (en: string,ar: string) => locale === "ar" ? ar : en;
  const directory = useActivityPages<OwnerVisitor>(open ? `/api/admin/visitor-activity?period=${period}` : null,"visitors",revision);
  const time = (value: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-GB",{ timeZone:LIVE_ANALYTICS_TIME_ZONE,dateStyle:"short",timeStyle:"short" }).format(new Date(value));
  return <div className="rounded-xl border border-white/10 p-4">
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-start text-white" aria-expanded={open} onClick={() => { setOpen(!open); setSelected(null); }}>
      <span className="font-semibold">{t("People & activity","الأشخاص والنشاط")}</span><span className="text-sm text-[#F4D978]">{open ? t("Hide","إخفاء") : t("View people","عرض الأشخاص")}</span>
    </button>
    <p className="text-xs leading-5 text-[#9CA3AF]">{t("One row per visitor in the selected period. Select a person to see their recorded journey. Names are visible only to you.","صف واحد لكل زائر خلال الفترة المختارة. اختر شخصًا لرؤية سجل زياراته وإجراءاته. الأسماء ظاهرة للمالك فقط.")}</p>
    {open ? <>
      {directory.failed ? <p role="alert" className="mt-3 text-sm text-amber-200">{t("People unavailable. Refresh to try again.","قائمة الأشخاص غير متاحة. حدّث للمحاولة مجددًا.")}</p> : null}
      {directory.loading && !directory.rows.length ? <p role="status" className="mt-3 text-sm text-[#9CA3AF]">{t("Loading people…","جارٍ تحميل الأشخاص…")}</p> : null}
      {!directory.loading && !directory.failed && !directory.rows.length ? <p className="mt-3 text-sm text-[#9CA3AF]">{t("No visitors recorded in this period.","لا يوجد زوار مسجّلون خلال هذه الفترة.")}</p> : null}
      <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
        {directory.rows.map(person => <button type="button" key={person.key} aria-pressed={selected?.key === person.key}
          className={`min-w-0 rounded-xl border p-4 text-start ${selected?.key === person.key ? "border-[#D4AF37] bg-[#D4AF37]/10" : "border-white/10 bg-black/20"}`}
          onClick={() => setSelected(person)}>
          <span className="block break-words text-sm font-semibold text-white">{person.accountId ?? `${t("Guest","ضيف")} ${person.key.slice(-6)}`}{person.name ? ` (${person.name})` : ""}</span>
          <span className="mt-1 block text-xs text-[#F4D978]">{person.platforms.join(" · ")}{person.role ? ` · ${person.role}` : ""}</span>
          <span className="mt-2 block text-xs text-[#D1D5DB]">{person.pages} {t("pages","صفحات")} · {person.visits} {t("visits","زيارات")} · {person.sessions} {t("opens / tabs","مرات فتح / تبويبات")}</span>
          <span className="mt-2 block break-words text-xs text-[#9CA3AF]">{t("Last visit","آخر زيارة")}: {time(person.lastSeen)}<br />{analyticsPageLabel(person.lastPath,locale)}</span>
          <span className="mt-3 block text-xs text-[#F4D978]">{t("View recorded activity ↓","عرض النشاط المسجّل ↓")}</span>
        </button>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={directory.loading} onClick={() => void directory.load()}>{t("Refresh people","تحديث الأشخاص")}</button>
        {directory.cursor ? <button type="button" className={buttonClass} disabled={directory.loading} onClick={() => void directory.load(directory.cursor)}>{t("More people","أشخاص إضافيون")}</button> : null}
      </div>
      {selected && !directory.failed ? <div ref={timelineRef} className="scroll-mt-24"><VisitorHistory key={selected.key} visitor={selected} period={period} locale={locale} revision={revision} /></div> : null}
      <p className="mt-3 text-xs leading-5 text-[#9CA3AF]">{t("This shows recorded pages and account actions, not a screen recording or every tap. Guests cannot be assigned a real name until a reliable account link exists.","يعرض الصفحات وإجراءات الحساب المسجّلة، وليس تسجيل شاشة أو كل لمسة. الضيف لا يرتبط باسم حقيقي إلا عند توفر ربط واضح بالحساب.")}</p>
    </> : null}
  </div>;
}
