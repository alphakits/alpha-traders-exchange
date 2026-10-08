"use client";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, SlidersHorizontal, Star } from "lucide-react";
import type { JournalAdapter } from "@/lib/journal/client";
import { journalReviewInput, journalSettingsInput } from "@/lib/journal/validation";
import { parseMoney, type JournalReview, type JournalSettings, type JournalLocale } from "@/lib/journal/model";
import { phrase } from "./journal-ui";

export function ReviewForm({ initial,locale,adapter,onSaved,onDirty }: {
  initial:JournalReview;locale:JournalLocale;adapter:JournalAdapter;onSaved:(r:JournalReview)=>void;onDirty:(v:boolean)=>void;
}) {
  const t=phrase(locale),[review,setReview]=useState(initial),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [error,setError]=useState("");
  const fields: ["preparation"|"wentWell"|"improve"|"nextSession",string,string,string][]=[
    ["preparation","My plan","خطتي",t("What did you plan to focus on?","على ماذا خططت للتركيز؟")],
    ["wentWell","What went well","ما الذي نجح",t("A good decision, even on a losing trade…","قرار جيد، حتى في صفقة خاسرة…")],
    ["improve","What I learned","ما تعلمته",t("One pattern or mistake worth reviewing…","نمط أو خطأ يستحق المراجعة…")],
    ["nextSession","My next focus","تركيزي القادم",t("One clear action for the next session…","خطوة واضحة للجلسة القادمة…")],
  ];
  useEffect(()=>()=>onDirty(false),[onDirty]);
  const change=(next:JournalReview)=>{setReview(next);onDirty(true);setMessage("");};
  return <form className="j-panel j-review-form" onSubmit={async e=>{
    e.preventDefault();if(busy)return;setBusy(true);setError("");setMessage("");
    try{const value=journalReviewInput.parse(review);const saved=await adapter.saveReview(value);setReview(saved);onSaved(saved);onDirty(false);setMessage(t("Review saved","تم حفظ المراجعة"));}
    catch{setError(t("Could not save. If this review changed elsewhere, reload before editing again.","تعذّر الحفظ. إذا تغيرت المراجعة على جهاز آخر، أعد التحميل قبل التعديل."));}finally{setBusy(false);}
  }}>
    <div className="j-panel-head"><div><span className="j-kicker">{t("REFLECT & RESET","راجع واستعد")}</span><h2>{review.period==="week"?t("Weekly notes","ملاحظات الأسبوع"):t("Session notes","ملاحظات الجلسة")}</h2></div><span className="j-pill">{t("Private","خاصة")}</span></div>
    {error && <p className="j-error" role="alert">{error}</p>}
    <div className="j-form-grid">{fields.map(([key,en,ar,placeholder],index)=><div className="j-field j-reflection-field" key={key}><div className="j-reflection-label"><span className="j-reflection-emoji" aria-hidden="true">{["📝","✨","💡","🎯"][index]}</span><label htmlFor={`journal-review-${key}`}>{t(en,ar)}</label></div><textarea id={`journal-review-${key}`} rows={4} dir="auto" maxLength={4000} value={review[key]} placeholder={placeholder} onChange={e=>change({...review,[key]:e.target.value})}/></div>)}</div>
    <div className="j-review-footer"><fieldset className="j-fieldset"><legend>{t("How was your execution?","كيف كان تنفيذك؟")}</legend><div className="j-rating">{[1,2,3,4,5].map(n=><button key={n} type="button" aria-label={`${t("Execution score","تقييم التنفيذ")} ${n}/5`} aria-pressed={review.rating===n} className={`${review.rating===n?"selected ":""}${review.rating!==null&&n<=review.rating?"filled":""}`} onClick={()=>change({...review,rating:review.rating===n?null:n})}><Star size={17} aria-hidden="true"/><span>{n}</span></button>)}</div></fieldset>
      <div><span className="j-save-status" role="status">{message}</span><button className="j-btn primary" disabled={busy}>{busy?<LoaderCircle size={16} className="j-spin"/>:<Check size={16}/>} {t("Save review","حفظ المراجعة")}</button></div>
    </div>
  </form>;
}
export function RulesForm({ initial,locale,adapter,onSaved,onDirty }: {initial:JournalSettings;locale:JournalLocale;adapter:JournalAdapter;onSaved:(s:JournalSettings)=>void;onDirty:(value:boolean)=>void}) {
  const t=phrase(locale),[settings,setSettings]=useState(initial),[limit,setLimit]=useState(String(initial.dailyLossLimitCents/100)),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  return <form className="j-panel j-rules-form" onChange={()=>{setDirty(true);onDirty(true);setMessage("");}} onSubmit={async e=>{
    e.preventDefault();if(busy)return;setError("");setMessage("");
    const parsed=journalSettingsInput.safeParse({...settings,dailyLossLimitCents:parseMoney(limit)});
    if(!parsed.success){setError(t("Check your timezone and enter positive limits.","راجع المنطقة الزمنية وأدخل حدوداً موجبة."));return;}
    setBusy(true);try{const saved=await adapter.saveSettings(parsed.data);setSettings(saved);onSaved(saved);setDirty(false);onDirty(false);setMessage(t("Rules saved","تم حفظ القواعد"));}catch{setError(t("Could not save. Reload if your rules changed on another device.","تعذّر الحفظ. أعد التحميل إذا تغيرت قواعدك على جهاز آخر."));}finally{setBusy(false);}
  }}>
    <div className="j-panel-head"><div><span className="j-kicker">{t("YOUR PROCESS","طريقتك")}</span><h2>{t("Trading rules","قواعد التداول")}</h2></div><SlidersHorizontal size={22} className="j-gold"/></div>
    <p className="j-section-copy">{t("Set your own limits. The journal flags them in your review; it does not control your broker.","حدد حدودك الخاصة. يظهر السجل التنبيهات في المراجعة ولا يتحكم بحساب الوسيط.")}</p>
    {error && <p className="j-error" role="alert">{error}</p>}
    <div className="j-form-grid">
      <label className="j-field"><span>{t("Daily loss limit · USD","حد الخسارة اليومي · USD")}</span><input value={limit} dir="ltr" inputMode="decimal" onChange={e=>setLimit(e.target.value)}/></label>
      <label className="j-field"><span>{t("Maximum trades per day","أقصى عدد صفقات يومياً")}</span><input type="number" min={1} max={100} value={settings.maxTradesPerDay} onChange={e=>setSettings({...settings,maxTradesPerDay:Number(e.target.value)})}/></label>
      <label className="j-field j-span-2"><span>{t("Journal timezone","المنطقة الزمنية للسجل")}</span><select value={settings.timezone} onChange={e=>setSettings({...settings,timezone:e.target.value})}>
        {[...new Set([settings.timezone,"Asia/Jerusalem","Europe/Bucharest","America/New_York","Europe/London","Asia/Dubai","Asia/Singapore","UTC"])].map(zone=><option key={zone} value={zone}>{zone.replaceAll("_"," ")}</option>)}
      </select><small>{t("Dates you enter stay exactly as recorded. This controls “Today” and “This week”.","تبقى التواريخ المدخلة كما سجلتها. هذا الإعداد يحدد «اليوم» و«هذا الأسبوع».")}</small></label>
      <label className="j-field j-span-2"><span>{t("My trading plan","خطة التداول الخاصة بي")}</span><textarea maxLength={4000} rows={7} dir="auto" value={settings.rules} onChange={e=>setSettings({...settings,rules:e.target.value})} placeholder={t("Example: wait for my setup, define risk before entry, review after the session.","مثال: أنتظر الإعداد، أحدد المخاطرة قبل الدخول، وأراجع بعد الجلسة.")}/></label>
    </div>
    <div className="j-review-footer"><p className="j-hint">{t("Journal currency: USD. No automatic currency conversion.","عملة السجل: USD. لا يوجد تحويل تلقائي للعملات.")}</p><div><span className="j-save-status" role="status">{message}</span><button className="j-btn primary" disabled={busy}>{busy?<LoaderCircle className="j-spin" size={16}/>:<Check size={16}/>} {t("Save rules","حفظ القواعد")}</button></div></div>
  </form>;
}
