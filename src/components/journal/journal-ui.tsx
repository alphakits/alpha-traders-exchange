"use client";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X, Plus, BookOpen, Sparkles } from "lucide-react";
import { dailyResults, money, shiftDate, type JournalLocale, type JournalTrade } from "@/lib/journal/model";

export const phrase = (locale: JournalLocale) => (en: string, ar: string) => locale === "ar" ? ar : en;
export function dateLabel(date: string, locale: JournalLocale, short = false) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-US", {
    weekday: short ? undefined : "long", day: "numeric", month: short ? "short" : "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function codeLabel(key: string, locale: JournalLocale) {
  const labels: Record<string,[string,string]> = {
    calm:["Calm","هادئ"], confident:["Confident","واثق"], fearful:["Fearful","خائف"],
    greedy:["Greedy","طمع"], frustrated:["Frustrated","محبط"], fomo:["FOMO","خوف من فوات الفرصة"],
    revenge:["Revenge trading","تداول انتقامي"], early_exit:["Early exit","خروج مبكر"],
    moved_stop:["Moved stop","تحريك وقف الخسارة"], no_stop:["No stop loss","بدون وقف خسارة"],
    oversized:["Too much risk","مخاطرة زائدة"], overtraded:["Overtrading","إفراط في التداول"],
    chased_entry:["Chased entry","ملاحقة السعر"], asia:["Asia","آسيا"], london:["London","لندن"],
    new_york:["New York","نيويورك"], other:["Other","أخرى"], unrecorded:["Not recorded","غير مسجل"],
  };
  return labels[key]?.[locale === "ar" ? 1 : 0] ?? key;
}
export function Amount({ cents, locale, className = "" }: { cents:number;locale:JournalLocale;className?:string }) {
  const formatted=money(cents,locale,true);
  return <span dir="ltr" style={{fontSize:formatted.length>12?".67em":formatted.length>10?".8em":undefined}} className={`j-money ${cents > 0 ? "positive" : cents < 0 ? "negative" : "neutral"} ${className}`}>{formatted}</span>;
}
export function Empty({ title, body, action }: { title:string;body?:string;action?:ReactNode }) {
  return <div className="j-empty"><div className="j-empty-art" aria-hidden="true"><BookOpen size={29}/><Sparkles size={16}/></div><h3>{title}</h3>{body && <p>{body}</p>}{action}</div>;
}
export function ProgressRing({ value, size = 100 }: { value:number|null;size?:number }) {
  return <svg className="j-progress-ring" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
    <circle className="j-ring-track" cx="50" cy="50" r="43"/>
    <circle className="j-ring-value" cx="50" cy="50" r="43" pathLength="100" strokeDasharray="100" strokeDashoffset={100-(value??0)} transform="rotate(-90 50 50)"/>
  </svg>;
}
export function Dialog({ title, children, onClose, wide = false }: { title:string;children:ReactNode;onClose:()=>void;wide?:boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current; const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal(); const original = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = original; previous?.focus(); };
  },[]);
  return <dialog ref={ref} className={`j-dialog ${wide ? "j-dialog-wide" : ""}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="j-dialog-head"><h2>{title}</h2><button type="button" className="j-icon" onClick={onClose} aria-label="Close / إغلاق"><X size={20}/></button></div>
    <div className="j-dialog-body">{children}</div>
  </dialog>;
}
export function EquityChart({ trades, locale }: { trades:JournalTrade[];locale:JournalLocale }) {
  const t = phrase(locale), id = useId().replaceAll(":", "");
  const [selectedDate,setSelectedDate] = useState<string|null>(null);
  const days = useMemo(()=>dailyResults(trades),[trades]);
  if (!days.length) return <Empty title={t("Your progress starts here","رحلتك تبدأ هنا")} body={t("Close your first trade to see your performance.","سجّل أول صفقة مغلقة لعرض أدائك.")}/>;
  let running = 0;
  const values = [0,...days.map(d => running += d.net)];
  const max = Math.max(...values), min = Math.min(...values), span = Math.max(100,max-min);
  const w=720,h=216,p=14;
  const start=Date.parse(days[0].date)-86400000, duration=Date.parse(days[days.length-1].date)-start;
  const points = values.map((value,i) => [p+(i?(Date.parse(days[i-1].date)-start)/duration:0)*(w-2*p),p+(max-value)/span*(h-2*p)]);
  const line = points.map(([x,y],i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const zero = p+max/span*(h-2*p);
  const active=days.findIndex(day=>day.date===selectedDate), activeDay=days[active];
  const point=points[active>=0?active+1:points.length-1];
  const color=running>=0?"var(--j-green)":"var(--j-red)";
  const explore=(clientX:number,element:SVGSVGElement)=>{
    const rect=element.getBoundingClientRect(),x=(clientX-rect.left)/rect.width*w;
    let nearest=0;
    for(let i=1;i<days.length;i++)if(Math.abs(points[i+1][0]-x)<Math.abs(points[nearest+1][0]-x))nearest=i;
    setSelectedDate(days[nearest].date);
  };
  return <div className="j-equity" dir="ltr">
    <div className="j-chart-readout" dir={locale==="ar"?"rtl":"ltr"}>
      <div><span>{activeDay?`${dateLabel(activeDay.date,locale,true)} · ${t("Cumulative","تراكمي")}`:t("Period total","إجمالي الفترة")}</span><strong><Amount cents={active>=0?values[active+1]:running} locale={locale}/></strong></div>
      <div className="j-chart-detail">{activeDay?<><span>{t("Session net","صافي الجلسة")}</span><Amount cents={activeDay.net} locale={locale}/></>:<><span>{t("Your progress, one session at a time","تقدمك، جلسة بعد جلسة")}</span><small>{t("Hover or drag below to explore","مرر المؤشر أو اسحب أدناه للاستكشاف")}</small></>}</div>
    </div>
    <div className="j-chart-plot">
      <div className="j-chart-axis"><span>{money(max,locale)}</span><span>{money(min,locale)}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={t("Cumulative net profit and loss after fees","الربح والخسارة التراكمية بعد الرسوم")} onPointerMove={e=>explore(e.clientX,e.currentTarget)} onPointerDown={e=>explore(e.clientX,e.currentTarget)} onPointerLeave={e=>{if(e.pointerType==="mouse")setSelectedDate(null);}}>
        <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".2"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
        {[.25,.5,.75].map(v=><line key={v} x1={p} y1={h*v} x2={w-p} y2={h*v} className="j-chart-grid"/>)}
        <line x1={p} x2={w-p} y1={zero} y2={zero} className="j-chart-zero" strokeDasharray="4 6"/>
        <path className="j-chart-area" d={`${line} L${w-p},${h} L${p},${h} Z`} fill={`url(#${id}-fill)`}/>
        <path key={line} className="j-chart-line" pathLength="1" d={line} fill="none" stroke={color} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
        {active>=0&&<line x1={point[0]} x2={point[0]} y1={p} y2={h} className="j-chart-crosshair" strokeDasharray="3 5"/>}
        {days.map((day,i)=><circle key={day.date} cx={points[i+1][0]} cy={points[i+1][1]} r="3" fill="var(--j-panel)" stroke={color} strokeWidth="1.5"><title>{`${dateLabel(day.date,locale,true)}: ${money(day.net,locale,true)} · ${t("Cumulative","تراكمي")}: ${money(values[i+1],locale,true)}`}</title></circle>)}
        <circle className="j-chart-halo" cx={point[0]} cy={point[1]} r="10" fill={color} fillOpacity=".12"/>
        <circle cx={point[0]} cy={point[1]} r="4.5" fill={color} stroke="var(--j-panel)" strokeWidth="2"/>
      </svg>
    </div>
    <div className="j-chart-labels"><span>{t("Start","البداية")}</span><span>{dateLabel(days[0].date,locale,true)} — {dateLabel(days[days.length-1].date,locale,true)}</span></div>
    <input className="j-chart-scrubber" type="range" min={0} max={Math.max(0,days.length-1)} value={active>=0?active:days.length-1} aria-label={t("Explore daily results","استكشاف النتائج اليومية")} aria-valuetext={`${dateLabel((activeDay??days[days.length-1]).date,locale,true)}, ${t("Cumulative","تراكمي")} ${money(active>=0?values[active+1]:running,locale,true)}`} onChange={e=>setSelectedDate(days[Number(e.target.value)].date)} onKeyDown={e=>{if(e.key==="Escape")setSelectedDate(null);}}/>
  </div>;
}
export function Calendar({ month,onMonth,trades,locale,today,onDay,reviews }: {
  month:string;onMonth:(s:string)=>void;trades:JournalTrade[];locale:JournalLocale;today:string;onDay:(s:string)=>void;reviews:string[];
}) {
  const t=phrase(locale); const first=`${month}-01`;
  const start=shiftDate(first,-((new Date(`${first}T12:00:00Z`).getUTCDay()+6)%7));
  const days=dailyResults(trades); const map=new Map(days.map(d=>[d.date,d]));
  const change=(direction:number)=>{const d=new Date(`${first}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+direction);onMonth(d.toISOString().slice(0,7));};
  const monthLabel=new Intl.DateTimeFormat(locale === "ar" ? "ar-IL":"en-US",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${first}T12:00:00Z`));
  const weekdays=locale==="ar" ? ["إثن","ثلا","أرب","خمي","جمع","سبت","أحد"]:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  return <section className="j-panel j-calendar-panel">
    <div className="j-panel-head"><div><span className="j-kicker">{t("ONE DAY AT A TIME","يوماً بعد يوم")}</span><h2>{t("Trading calendar","تقويم التداول")}</h2></div>
      <div className="j-month-control" dir="ltr"><button className="j-icon" onClick={()=>change(-1)} aria-label={t("Previous month","الشهر السابق")}><ChevronLeft size={17}/></button><span>{monthLabel}</span><button className="j-icon" onClick={()=>change(1)} aria-label={t("Next month","الشهر التالي")}><ChevronRight size={17}/></button></div>
    </div>
    <div className="j-calendar" dir="ltr" key={month}>
      {weekdays.map(d=><span className="j-weekday" key={d}>{d}</span>)}
      {Array.from({length:42},(_,i)=>{
        const date=shiftDate(start,i), day=map.get(date),outside=!date.startsWith(month),hasReview=reviews.includes(date);
        return <button key={date} onClick={()=>onDay(date)} className={`j-day ${outside ? "outside":""} ${date===today ? "today":""} ${day ? day.net>0 ? "win-day" : day.net<0 ? "loss-day":"flat-day":""}`} aria-label={`${dateLabel(date,locale)}${day ? `, ${money(day.net,locale,true)}, ${day.count} ${t("trades","صفقات")}`:""}`}>
          <span className="j-day-number">{Number(date.slice(8))}{hasReview && <span className="j-note-dot" aria-label={t("Has review","يوجد تقييم")}/>}</span>
          {day ? <><span className={day.net<0 ? "negative":day.net>0?"positive":"neutral"}>{day.net>0?"+":day.net<0?"−":""}{new Intl.NumberFormat("en-US",{maximumFractionDigits:Math.abs(day.net)%100 ? 2:0}).format(Math.abs(day.net)/100)}</span><small>{day.count} {t("trades","صفقات")}</small></>:<span className="j-day-empty"><Plus size={12}/></span>}
        </button>;
      })}
    </div>
    <div className="j-calendar-foot"><span>{t("Tap a day to review the session","اضغط على اليوم لمراجعة الجلسة")}</span><span>{t("Net P&L · USD","صافي الربح والخسارة · USD")}</span></div>
  </section>;
}
