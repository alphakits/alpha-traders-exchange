"use client";
/* eslint-disable @next/next/no-img-element -- Private chart endpoints require the viewer's cookie and must bypass the public image optimizer. */
import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import type { JournalAdapter } from "@/lib/journal/client";
import { JournalClientError, prepareChart, tradeInput } from "@/lib/journal/client";
import { EMOTIONS, MISTAKES, parseMoney, type JournalTrade, type JournalAttachment, type JournalLocale } from "@/lib/journal/model";
import { journalTradeInput } from "@/lib/journal/validation";
import { Amount, Dialog, codeLabel, phrase } from "./journal-ui";

export function TradeEditor({ initial, adapter, locale, timezone, onSaved, onDeleted, onClose }: {
  initial:JournalTrade;adapter:JournalAdapter;locale:JournalLocale;timezone:string;
  onSaved:(trade:JournalTrade)=>void;onDeleted:(id:string)=>void;onClose:()=>void;
}) {
  const t=phrase(locale); const [trade,setTrade]=useState(initial);
  const [gross,setGross]=useState(initial.version ? (initial.grossPnlCents/100).toFixed(2):"");
  const [fees,setFees]=useState((initial.feesCents/100).toFixed(2));
  const [risk,setRisk]=useState(initial.riskCents ? (initial.riskCents/100).toFixed(2):"");
  const [tab,setTab]=useState<"trade"|"notes"|"charts">("trade");
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [dirty,setDirty]=useState(false);
  const [charts,setCharts]=useState<JournalAttachment[]>([]); const [chartLoading,setChartLoading]=useState(false);
  const [viewChart,setViewChart]=useState<JournalAttachment|null>(null); const [confirmDelete,setConfirmDelete]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);
  const field=<K extends keyof JournalTrade>(key:K,value:JournalTrade[K])=>{setTrade(v=>({...v,[key]:value}));setDirty(true);setError("");};
  const reportError=(e:unknown)=>setError(e instanceof JournalClientError && e.status===409
    ? t("This trade changed on another device. Close this form and reload before editing again.","تغيّرت الصفقة على جهاز آخر. أغلق النموذج وأعد التحميل قبل التعديل.")
    : locale==="ar" ? "تعذّر إتمام العملية. راجع البيانات أو أعد المحاولة؛ لم يتم تجاهل تعديلاتك." : e instanceof Error ? e.message : "Could not save. Please try again.");
  useEffect(()=>{
    if (!initial.version) return;
    let current=true; setChartLoading(true);
    adapter.charts(initial.id).then(value=>{if(current)setCharts(value);}).catch(e=>{if(current)reportError(e);}).finally(()=>{if(current)setChartLoading(false);});
    return ()=>{current=false;};
    // Initial trade identity controls this request; later saves retain the same charts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[adapter,initial.id]);
  useEffect(()=>{
    if(!dirty)return; const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  const close=()=>{if(!busy && (!dirty || window.confirm(t("Discard unsaved changes?","تجاهل التعديلات غير المحفوظة؟"))))onClose();};
  const save=async(stay=false)=>{
    if(busy)return;
    const pnl=trade.status==="open" ? 0:parseMoney(gross),fee=parseMoney(fees),r=risk.trim()?parseMoney(risk):null;
    if(pnl===null || fee===null || fee<0 || (risk.trim() && (r===null || r<=0))) {
      setTab("trade");setError(t("Enter the result and fees with no more than 2 decimal places. Risk must be above zero.","أدخل النتيجة والرسوم بمنزلتين عشريتين كحد أقصى. يجب أن تكون المخاطرة أكبر من صفر."));return;
    }
    const parsed=journalTradeInput.safeParse({...tradeInput(trade),grossPnlCents:pnl,feesCents:fee,riskCents:r});
    if(!parsed.success){setTab("trade");setError(t("Check the symbol, date, and trade details.","راجع الرمز والتاريخ وتفاصيل الصفقة."));return;}
    setBusy(true);setError("");
    try{const result=await adapter.saveTrade(parsed.data);onSaved(result);setTrade(result);setDirty(false);if(!stay)onClose();else setTab("charts");}
    catch(e){reportError(e);}finally{setBusy(false);}
  };
  const remove=async()=>{setBusy(true);setError("");try{await adapter.deleteTrade(trade);onDeleted(trade.id);onClose();}catch(e){reportError(e);}finally{setBusy(false);}};
  const upload=async(file?:File)=>{
    if(!file || busy || !trade.version)return;
    setBusy(true);setError("");
    try{const blob=await prepareChart(file);const chart=await adapter.uploadChart(trade.id,blob);setCharts(old=>[...old,chart]);}
    catch(e){reportError(e);}finally{setBusy(false);if(fileRef.current)fileRef.current.value="";}
  };
  const optionalPrice=(key:"entry"|"exit"|"stop"|"target"|"quantity",label:string)=><label className="j-field" key={key}><span>{label}</span><input type="number" inputMode="decimal" min="0.00000001" step="any" dir="ltr" value={trade[key]??""} onChange={e=>field(key,e.target.value===""?null:Number(e.target.value))}/></label>;
  const net=trade.status==="closed" && parseMoney(gross)!==null && parseMoney(fees)!==null ? (parseMoney(gross)??0)-(parseMoney(fees)??0):null;
  return <Dialog title={trade.version?t("Trade details","تفاصيل الصفقة"):t("Add a trade","إضافة صفقة")} onClose={close}>
    <div className="j-editor-tabs" role="tablist" aria-label={t("Trade sections","أقسام الصفقة")}>
      {(["trade","notes","charts"] as const).map(key=><button key={key} role="tab" aria-selected={tab===key} className={tab===key?"active":""} onClick={()=>setTab(key)}>{key==="trade"?t("Trade","الصفقة"):key==="notes"?t("Notes & behavior","ملاحظات وسلوك"):t("Charts","الرسوم")}</button>)}
    </div>
    {error && <div className="j-error" role="alert">{error}</div>}
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      <div hidden={tab!=="trade"}>
        <div className="j-form-grid">
          <label className="j-field"><span>{t("Symbol","الرمز")}</span><input autoFocus list="journal-symbols" value={trade.symbol} placeholder="NQ, ES, EURUSD, BTCUSD" maxLength={30} dir="ltr" onChange={e=>field("symbol",e.target.value.toUpperCase())}/><datalist id="journal-symbols">{["NQ","MNQ","ES","MES","XAUUSD","EURUSD","GBPUSD","BTCUSD","ETHUSD"].map(s=><option value={s} key={s}/>)}</datalist></label>
          <label className="j-field"><span>{t("Direction","الاتجاه")}</span><select value={trade.direction} onChange={e=>field("direction",e.target.value as "long"|"short")}><option value="long">{t("Long / Buy","شراء / Long")}</option><option value="short">{t("Short / Sell","بيع / Short")}</option></select></label>
          <label className="j-field"><span>{t("Session date","تاريخ الجلسة")}</span><input type="date" dir="ltr" value={trade.date} onChange={e=>field("date",e.target.value)}/></label>
          <label className="j-field"><span>{t("Entry time","وقت الدخول")}</span><input type="time" dir="ltr" value={trade.time} onChange={e=>field("time",e.target.value)}/></label>
          <label className="j-field"><span>{t("Status","الحالة")}</span><select value={trade.status} onChange={e=>field("status",e.target.value as "closed"|"open")}><option value="closed">{t("Closed","مغلقة")}</option><option value="open">{t("Still open","ما زالت مفتوحة")}</option></select></label>
          <label className="j-field"><span>{t("Session","الجلسة")}</span><select value={trade.session} onChange={e=>field("session",e.target.value)}><option value="">{t("Not recorded","غير مسجل")}</option>{["asia","london","new_york","other"].map(s=><option key={s} value={s}>{codeLabel(s,locale)}</option>)}</select></label>
          <label className="j-field"><span>{t("P&L before fees · USD","النتيجة قبل الرسوم · USD")}</span><input type="text" inputMode="decimal" dir="ltr" disabled={trade.status==="open"} value={trade.status==="open"?"":gross} placeholder={t("Use − for a loss","ضع − للخسارة")} onChange={e=>{setGross(e.target.value);setDirty(true);}}/></label>
          <label className="j-field"><span>{t("Fees · USD","الرسوم · USD")}</span><input type="text" inputMode="decimal" dir="ltr" value={fees} onChange={e=>{setFees(e.target.value);setDirty(true);}}/></label>
        </div>
        <div className="j-result-strip"><span>{t("Net result","صافي النتيجة")}</span>{net!==null?<Amount cents={net} locale={locale}/>:<span>{t("Not realized","غير محقق")}</span>}</div>
        <p className="j-hint">{t("Record a closed trade on its closing session date.","سجّل الصفقة المغلقة في تاريخ جلسة إغلاقها.")} <span dir="ltr">{timezone.replaceAll("_"," ")}</span></p>
        <details className="j-optional"><summary>{t("Setup, risk & prices","الإعداد والمخاطرة والأسعار")} <span>{t("Optional","اختياري")}</span></summary>
          <div className="j-form-grid">
            <label className="j-field"><span>{t("Setup / strategy","الإعداد / الاستراتيجية")}</span><input dir="auto" list="journal-setups" maxLength={80} value={trade.strategy} placeholder="FVG, Breaker, Liquidity sweep…" onChange={e=>field("strategy",e.target.value)}/><datalist id="journal-setups">{["FVG","Breaker block","Liquidity sweep","Order block","Silver bullet","Breakout"].map(s=><option key={s} value={s}/>)}</datalist></label>
            <label className="j-field"><span>{t("Initial risk · USD","المخاطرة الأولية · USD")}</span><input dir="ltr" inputMode="decimal" value={risk} placeholder="100.00" onChange={e=>{setRisk(e.target.value);setDirty(true);}}/></label>
            {optionalPrice("quantity",t("Quantity","الحجم"))}{optionalPrice("entry",t("Entry price","سعر الدخول"))}{optionalPrice("exit",t("Exit price","سعر الخروج"))}{optionalPrice("stop",t("Stop loss","وقف الخسارة"))}{optionalPrice("target",t("Take profit","جني الأرباح"))}
          </div><p className="j-hint">{t("Enter your broker’s actual result. Prices alone do not account for contract size or conversion.","أدخل النتيجة الفعلية من الوسيط؛ الأسعار وحدها لا تعكس حجم العقد أو تحويل العملة.")}</p>
        </details>
      </div>
      <div hidden={tab!=="notes"}>
        <label className="j-field"><span>{t("How did you feel?","كيف كان شعورك؟")}</span><select value={trade.emotion} onChange={e=>field("emotion",e.target.value)}><option value="">{t("Not recorded","غير مسجل")}</option>{EMOTIONS.map(s=><option key={s} value={s}>{codeLabel(s,locale)}</option>)}</select></label>
        <fieldset className="j-fieldset"><legend>{t("Did you follow your plan?","هل التزمت بخطتك؟")}</legend><div className="j-choices">{([true,false,null] as const).map(v=><button type="button" aria-pressed={trade.followedPlan===v} className={trade.followedPlan===v?"selected":""} key={String(v)} onClick={()=>field("followedPlan",v)}>{v===true?t("Yes","نعم"):v===false?t("No","لا"):t("Not reviewed","لم أراجع بعد")}</button>)}</div></fieldset>
        <fieldset className="j-fieldset"><legend>{t("Anything to learn from?","ما الذي يمكن التعلم منه؟")}</legend><div className="j-tags">{MISTAKES.map(m=><button key={m} type="button" aria-pressed={trade.mistakes.includes(m)} className={trade.mistakes.includes(m)?"selected":""} onClick={()=>field("mistakes",trade.mistakes.includes(m)?trade.mistakes.filter(x=>x!==m):[...trade.mistakes,m])}>{codeLabel(m,locale)}</button>)}</div></fieldset>
        <label className="j-field"><span>{t("Trade notes","ملاحظات الصفقة")}</span><textarea rows={7} maxLength={8000} dir="auto" value={trade.notes} placeholder={t("Why did you enter? What happened? What would you repeat or change?","لماذا دخلت؟ ماذا حدث؟ ما الذي ستكرره أو تغيره؟")} onChange={e=>field("notes",e.target.value)}/></label>
      </div>
      <div hidden={tab!=="charts"}>
        {!trade.version?<div className="j-empty"><ImagePlus size={30}/><h3>{t("Keep the chart with the trade","احتفظ بالرسم مع الصفقة")}</h3><p>{t("Save the trade first, then add up to 3 screenshots.","احفظ الصفقة أولاً ثم أضف حتى 3 صور.")}</p><button type="button" className="j-btn primary" disabled={busy} onClick={()=>void save(true)}>{t("Save & add charts","حفظ وإضافة رسوم")}</button></div>:<>
          <div className="j-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(charts.length<3)void upload(e.dataTransfer.files[0]);}}>
            <ImagePlus size={28} aria-hidden="true"/><h3>{t("Before. During. After.","قبل الصفقة. خلالها. بعدها.")}</h3><p>{t("PNG, JPEG or WebP · up to 3 charts","PNG أو JPEG أو WebP · حتى 3 صور")}</p><button type="button" className="j-btn" disabled={busy || charts.length>=3} onClick={()=>fileRef.current?.click()}>{busy?<LoaderCircle className="j-spin" size={16}/>:<ImagePlus size={16}/>} {t("Add chart","إضافة رسم")}</button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>void upload(e.target.files?.[0])}/>
          </div>
          {chartLoading && <p role="status">{t("Loading charts…","جار تحميل الرسوم…")}</p>}
          <div className="j-charts-grid">{charts.map((chart,i)=><div key={chart.id}><button type="button" className="j-chart-thumbnail" onClick={()=>setViewChart(chart)} aria-label={`${t("View chart","عرض الرسم")} ${i+1}`}><img src={chart.url} alt={`${t("Trade chart","رسم الصفقة")} ${i+1}`}/></button><div><span>{t("Chart","الرسم")} {i+1}</span><button type="button" className="j-icon" disabled={busy} aria-label={`${t("Remove chart","حذف الرسم")} ${i+1}`} onClick={async()=>{if(!window.confirm(t("Remove this chart?","حذف هذا الرسم؟")))return;setBusy(true);try{await adapter.deleteChart(chart.id);setCharts(old=>old.filter(c=>c.id!==chart.id));}catch(e){reportError(e);}finally{setBusy(false);}}}><X size={16}/></button></div></div>)}</div>
        </>}
      </div>
      <div className="j-editor-footer">
        {trade.version>0?<button className="j-btn danger" type="button" disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={16}/>{t("Delete","حذف")}</button>:<button className="j-btn ghost" type="button" onClick={close}>{t("Cancel","إلغاء")}</button>}
        <button type="submit" className="j-btn primary" disabled={busy}>{busy?<LoaderCircle className="j-spin" size={16}/>:<Check size={16}/>} {trade.version?t("Save changes","حفظ التعديلات"):t("Save trade","حفظ الصفقة")}</button>
      </div>
    </form>
    {confirmDelete && <div className="j-delete-confirm" role="alert"><p>{t("Delete this trade and its charts? This cannot be undone.","حذف هذه الصفقة ورسومها؟ لا يمكن التراجع.")}</p><div className="j-actions"><button className="j-btn" disabled={busy} onClick={()=>setConfirmDelete(false)}>{t("Keep trade","الاحتفاظ بالصفقة")}</button><button className="j-btn danger" disabled={busy} onClick={()=>void remove()}>{t("Delete trade","حذف الصفقة")}</button></div></div>}
    {viewChart && <Dialog title={t("Chart review","مراجعة الرسم")} wide onClose={()=>setViewChart(null)}><img className="j-full-chart" src={viewChart.url} alt={t("Trade chart","رسم الصفقة")}/></Dialog>}
  </Dialog>;
}
