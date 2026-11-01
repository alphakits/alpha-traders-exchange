"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, LoaderCircle, X } from "lucide-react";
import { currencyText } from "@/components/ui/currency-text";
import type { TradeEvidenceFile } from "@/types/alpha-exchange";

type Props = {
  requestId: string;
  evidence: Pick<TradeEvidenceFile, "id" | "fileName" | "mimeType">;
  isAr: boolean;
  className?: string;
};

/** Keep authenticated receipts in the trade room, with an always-visible exit. */
export function TradeEvidenceViewer({ requestId, evidence, isAr, className }: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const source = `/api/alpha-exchange/purchase-requests/${encodeURIComponent(requestId)}/evidence/${encodeURIComponent(evidence.id)}`;
  const isImage = evidence.mimeType?.startsWith("image/") ?? /\.(png|jpe?g|webp)$/i.test(evidence.fileName);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" aria-haspopup="dialog" className={className ?? "mt-2 inline-flex min-h-11 items-center break-all text-start text-[#C9A227] hover:underline"}
      onClick={() => { setLoaded(false); setFailed(false); setOpen(true); }}>
      {currencyText(evidence.fileName)}
    </button>
    {open ? createPortal(<dialog ref={dialogRef} aria-labelledby={titleId} dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-black/85 p-3 text-white backdrop:bg-black/70 sm:p-6"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, a[href]"));
        if (!controls.length) return;
        event.preventDefault();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
        controls[next].focus();
      }}
      onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0B0B0B]">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/15 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <h2 id={titleId} className="line-clamp-2 min-w-0 flex-1 break-all text-sm font-semibold">{currencyText(evidence.fileName)}</h2>
          <button type="button" autoFocus onClick={() => setOpen(false)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-semibold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A227]">
            <X className="h-5 w-5" aria-hidden="true" />{isAr ? "إغلاق" : "Close"}
          </button>
        </header>
        <div className="relative min-h-0 flex-1 overflow-auto overscroll-contain p-3">
          {isImage && !failed ? <>
            {!loaded ? <p role="status" className="absolute inset-x-3 top-3 flex items-center justify-center gap-2 text-sm text-[#D1D5DB]">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{isAr ? "جارٍ تحميل الصورة…" : "Loading image…"}
            </p> : null}
            {/* Authenticated private bytes must load directly, without an image-optimization proxy. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source} alt={evidence.fileName} className="h-full w-full object-contain" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
          </> : <p role={failed ? "alert" : undefined} className="p-4 text-center text-sm text-[#D1D5DB]">
            {failed ? (isAr ? "تعذر تحميل الصورة. يمكنك تنزيل الملف أو إغلاق العارض والمحاولة مجددًا." : "The image could not load. Download the file, or close the viewer and try again.")
              : (isAr ? "نزّل هذا المستند لعرضه على جهازك." : "Download this document to view it on your device.")}
          </p>}
        </div>
        <footer className="shrink-0 border-t border-white/15 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <a href={source} download={evidence.fileName} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-[#FDE68A] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A227]">
            <Download className="h-4 w-4" aria-hidden="true" />{isAr ? "تنزيل الملف" : "Download file"}
          </a>
        </footer>
      </section>
    </dialog>, document.body) : null}
  </>;
}
