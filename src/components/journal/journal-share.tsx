"use client";
/* eslint-disable @next/next/no-img-element -- Local, user-approved share images and authenticated journal charts. */
import { useEffect, useMemo, useState } from "react";
import { Copy, Download, LoaderCircle, LockKeyhole, Share2 } from "lucide-react";
import type { JournalAdapter } from "@/lib/journal/client";
import type { JournalAttachment, JournalLocale } from "@/lib/journal/model";
import { selectedShare, shareText, type JournalShare } from "@/lib/journal/sharing";
import { makeShareImage } from "@/lib/journal/share-image";
import { Dialog, phrase } from "./journal-ui";

export function JournalPrivacy({ locale }: { locale: JournalLocale }) {
  const t = phrase(locale);
  return <aside className="j-privacy-notice" aria-label={t("Journal privacy", "خصوصية الجورنال")}>
    <LockKeyhole size={20} aria-hidden="true"/>
    <div><strong>{t("Private to you", "خاص بك وحدك")}</strong><p>{t("Only you can view your journal in Alpha Traders. Others see only the content you choose to share.", "أنت وحدك تستطيع مشاهدة جورنالك داخل Alpha Traders. الآخرون يشاهدون فقط المحتوى الذي تختار مشاركته.")}</p></div>
  </aside>;
}

export function JournalShareDialog({ doc, locale, onClose, adapter, tradeId }: { doc: JournalShare; locale: JournalLocale; onClose: () => void; adapter: JournalAdapter; tradeId?: string }) {
  const t = phrase(locale);
  const [keys, setKeys] = useState(() => new Set(doc.fields.filter(field => field.selected).map(field => field.key)));
  const [charts, setCharts] = useState<JournalAttachment[]>([]), [chartKeys, setChartKeys] = useState<Set<string>>(() => new Set());
  const [chartError, setChartError] = useState(false), [chartLoading, setChartLoading] = useState(Boolean(tradeId));
  const [image, setImage] = useState<{ doc: JournalShare; urls: string[]; blob: Blob; url: string } | null>(null);
  const [showImage, setShowImage] = useState(false);
  const [imageFailed, setImageFailed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const projection = useMemo(() => selectedShare(doc, keys), [doc, keys]);
  const chartUrls = useMemo(() => charts.filter(chart => chartKeys.has(chart.id)).map(chart => chart.url), [charts, chartKeys]);
  const text = useMemo(() => shareText(projection), [projection]);
  const hasSelection = projection.fields.length > 0 || chartUrls.length > 0;
  // Compare the projection identity too: a changed selection can never share the previous image.
  const readyImage = image?.doc === projection && image.urls === chartUrls ? image : null;
  useEffect(() => {
    if (!tradeId) return;
    let active = true;
    adapter.charts(tradeId).then(value => { if (active) setCharts(value); }).catch(() => { if (active) setChartError(true); }).finally(() => { if (active) setChartLoading(false); });
    return () => { active = false; };
  }, [adapter, tradeId]);
  useEffect(() => {
    const controller = new AbortController(); let url: string | undefined;
    setImage(null); setImageFailed(false);
    if (hasSelection) makeShareImage(projection, locale, chartUrls, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setImage({ doc: projection, urls: chartUrls, blob, url });
    }).catch(() => { if (!controller.signal.aborted) setImageFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [projection, locale, chartUrls, hasSelection]);
  const toggle = (key: string, chart = false) => {
    const update = (old: Set<string>) => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; };
    if (chart) setChartKeys(update); else setKeys(update);
    setMessage("");
  };
  const download = () => {
    if (!readyImage) return;
    if (window.ReactNativeWebView) { setShowImage(true); return; }
    const link = document.createElement("a"); link.href = readyImage.url; link.download = "alpha-traders-journal.png"; link.click();
    setMessage(t("Image download started. Your journal stays private.", "بدأ تنزيل الصورة. جورنالك يبقى خاصاً."));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMessage(t("Selected text copied. Charts are included only in the image.", "تم نسخ النص المختار. صور الشارت تُضمّن في الصورة فقط.")); }
    catch { setMessage(t("Copy is unavailable here. Select and copy the text below.", "النسخ غير متاح هنا. حدد النص أدناه وانسخه.")); }
  };
  const share = async () => {
    if (!readyImage || busy) return;
    const file = new File([readyImage.blob], "alpha-traders-journal.png", { type: "image/png" });
    // Prepared before the click so iOS still has the user activation needed for its share sheet.
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) { download(); return; }
    setBusy(true); setMessage("");
    try { await navigator.share({ title: "Alpha Traders · Trading Journal", files: [file] }); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setMessage(t("Sharing could not open. Download the image or copy the text below.", "تعذّر فتح المشاركة. نزّل الصورة أو انسخ النص أدناه.")); }
    finally { setBusy(false); }
  };
  return <Dialog title={t("Choose what to share", "اختر ما تريد مشاركته")} onClose={() => { if (!busy) onClose(); }} wide>
    <div className="j-share-intro"><LockKeyhole size={18}/><p>{t("Share a copy of selected content. This does not give anyone access to your journal. Recipients can keep or forward the copy.", "شارك نسخة من المحتوى المختار فقط، دون منح أي شخص وصولاً إلى جورنالك. يستطيع المستلم الاحتفاظ بالنسخة أو إعادة إرسالها.")}</p></div>
    <div className="j-share-layout">
      <fieldset className="j-share-options" disabled={busy}><legend>{t("Include in this share", "تضمين في هذه المشاركة")}</legend>
        {doc.fields.map(field => <label key={field.key}><input type="checkbox" checked={keys.has(field.key)} onChange={() => toggle(field.key)}/><span>{field.label}</span></label>)}
        {chartLoading && <p className="j-hint" role="status">{t("Loading optional charts…", "تحميل صور الشارت الاختيارية…")}</p>}
        {chartError && <p className="j-hint" role="alert">{t("Charts could not load. Close and reopen sharing to retry.", "تعذّر تحميل الشارت. أغلق المشاركة وافتحها مجدداً للمحاولة.")}</p>}
        {charts.map((chart, index) => <label key={chart.id}><input type="checkbox" checked={chartKeys.has(chart.id)} onChange={() => toggle(chart.id, true)}/><span>{t("Chart", "الشارت")} {index + 1}</span></label>)}
        <p className="j-hint">{t("Notes and charts are off unless you select them.", "الملاحظات والشارت لا تُشارك إلا إذا اخترتها.")}</p>
      </fieldset>
      <section className="j-share-preview" aria-label={t("Share preview", "معاينة المشاركة")}>
        <span className="j-kicker">{t("ONLY THIS WILL BE SHARED", "هذا فقط ما ستتم مشاركته")}</span>
        <div className="j-share-card"><strong className="j-share-brand">Alpha Traders</strong><span>TRADING JOURNAL</span><h3>{projection.title}</h3>{projection.context && <p>{projection.context}</p>}
          {projection.fields.map(field => <div className="j-share-value" key={field.key}><span>{field.label}</span><strong className={field.tone ?? ""} dir="auto">{field.value}</strong></div>)}
          {charts.filter(chart => chartKeys.has(chart.id)).map((chart, index) => <img key={chart.id} src={chart.url} alt={`${t("Selected chart", "الشارت المختار")} ${index + 1}`}/>)}
          {!hasSelection && <p>{t("Select at least one item.", "اختر عنصراً واحداً على الأقل.")}</p>}
        </div>
      </section>
    </div>
    {imageFailed && <p className="j-hint" role="status">{t("The image could not be prepared. You can copy the selected text, or select less content and retry.", "تعذّر تجهيز الصورة. يمكنك نسخ النص المختار، أو اختيار محتوى أقل والمحاولة مجدداً.")}</p>}
    {message && <p className="j-notice" role="status">{message}</p>}
    <div className="j-share-actions">
      <button type="button" className="j-btn primary" disabled={!readyImage || busy} onClick={() => void share()}>{hasSelection && !readyImage && !imageFailed ? <LoaderCircle className="j-spin" size={16}/> : <Share2 size={16}/>} {t("Share image", "مشاركة الصورة")}</button>
      <button type="button" className="j-btn" disabled={!readyImage || busy} onClick={download}><Download size={16}/>{t("Download image", "تنزيل الصورة")}</button>
      <button type="button" className="j-btn" disabled={!projection.fields.length || busy} onClick={() => void copy()}><Copy size={16}/>{t("Copy text", "نسخ النص")}</button>
    </div>
    <p className="j-hint">{t("If your browser has no share menu, the image downloads for you to send.", "إذا لم يدعم المتصفح قائمة المشاركة، تُنزّل الصورة لتتمكن من إرسالها.")}</p>
    {showImage&&readyImage&&<Dialog title={t("Your share image","صورة المشاركة")} onClose={()=>setShowImage(false)}><p className="j-hint">{t("Press and hold the image to save it, or take a screenshot. You can also close this image and copy the selected text.","اضغط مطولاً على الصورة لحفظها، أو التقط لقطة شاشة. يمكنك أيضاً إغلاق الصورة ونسخ النص المختار.")}</p><img className="j-full-chart j-share-export" src={readyImage.url} alt={t("Your selected journal content","محتوى الجورنال الذي اخترته")}/></Dialog>}
    <details className="j-share-text"><summary>{t("View selected text", "عرض النص المختار")}</summary><textarea readOnly value={projection.fields.length ? text : ""} rows={6} aria-label={t("Selected share text", "نص المشاركة المختار")} dir="auto"/></details>
  </Dialog>;
}
