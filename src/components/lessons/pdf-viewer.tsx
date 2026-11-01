"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, ExternalLink, Expand, Loader2, Minimize2 } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { resolveLessonPdfSource } from "@/lib/lesson-pdf";
import type { LessonAsset } from "@/types/academy";
import styles from "@/components/academy/academy-experience.module.css";

export function PdfViewer({
  asset,
  title,
  onOpen,
  onProgress,
  initialProgress = 0,
}: {
  asset: LessonAsset;
  title: string;
  onOpen: () => void;
  onProgress?: (progress: number) => void;
  initialProgress?: number;
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const [loaded, setLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [readingProgress, setReadingProgress] = useState(initialProgress);
  const readingProgressRef = useRef(initialProgress);
  const [hasError, setHasError] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [inlineSupported, setInlineSupported] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasOpenedRef = useRef(false);
  const source = useMemo(() => resolveLessonPdfSource(asset), [asset]);
  const hasDocument = Boolean(source.embedUrl?.trim());
  const isWorkbook = source.embedUrl.endsWith(".html") || source.openUrl.endsWith(".html");

  useEffect(() => {
    readingProgressRef.current = initialProgress;
    setReadingProgress(initialProgress);
  }, [initialProgress]);

  useEffect(() => {
    const directPdf = /\.pdf(?:[?#]|$)/i.test(source.embedUrl);
    setInlineSupported(!directPdf || navigator.pdfViewerEnabled !== false);
  }, [source.embedUrl]);

  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled && containerRef.current?.requestFullscreen));
    const sync = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function bumpProgress(amount: number) {
    const previous = readingProgressRef.current;
    const normalized = Math.min(100, Math.max(0, Math.round(previous + amount)));
    readingProgressRef.current = normalized;
    setReadingProgress(normalized);
    if (normalized > previous) onProgress?.(normalized);
  }

  async function toggleFullscreen() {
    if (!containerRef.current) return;

    try {
      setFullscreenError(false);
      if (!document.fullscreenElement) await containerRef.current.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }

  function handleOpenInNewTab() {
    if (!hasDocument) return;
    window.open(source.openUrl, "_blank", "noopener,noreferrer");
    if (!hasOpenedRef.current) {
      hasOpenedRef.current = true;
      onOpen();
    }
    bumpProgress(8);
  }

  function handleDownload() {
    if (!hasDocument) return;
    const anchor = document.createElement("a");
    anchor.href = source.downloadUrl;
    anchor.download = "";
    anchor.click();
    if (!hasOpenedRef.current) {
      hasOpenedRef.current = true;
      onOpen();
    }
    bumpProgress(8);
  }

  return (
    <div ref={containerRef} className={`space-y-3 ${styles.workbookFullscreen}`}>
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-[#9CA3AF]">
          <span>{isAr ? "تقدم القراءة" : "Reading Progress"}</span>
          <span>{readingProgress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#C9A227] transition-all duration-500" style={{ width: `${readingProgress}%` }} aria-hidden />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canFullscreen && inlineSupported ? <Button variant="secondary" size="sm" onClick={toggleFullscreen} disabled={!hasDocument}>
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          {isAr ? (isFullscreen ? "تصغير" : "ملء الشاشة") : isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </Button> : null}
        <Button variant="secondary" size="sm" onClick={handleOpenInNewTab} disabled={!hasDocument}>
          <ExternalLink className="h-4 w-4" />
          {isAr ? "القراءة أونلاين" : "Read Online"}
        </Button>
        <Button size="sm" onClick={handleDownload} disabled={!hasDocument}>
          <Download className="h-4 w-4" />
          {isAr ? (isWorkbook ? "تنزيل الملف" : "تنزيل PDF") : isWorkbook ? "Download File" : "Download PDF"}
        </Button>
      </div>
      {fullscreenError ? <p role="status" className="text-sm text-amber-200">{isAr ? "تعذر ملء الشاشة. استخدم القراءة أونلاين لفتح الملف." : "Fullscreen is unavailable. Use Read Online to open the workbook."}</p> : null}

      <div
        className={`relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 ${isFullscreen ? "h-[calc(100dvh-150px)]" : "h-[360px] sm:h-[420px] md:h-[560px] lg:h-[680px]"}`}
        onWheel={() => bumpProgress(1.5)}
        onTouchMove={() => bumpProgress(1.2)}
      >
        {!hasDocument ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[#9CA3AF]">
            <div className="space-y-2">
              <AlertCircle className="mx-auto h-5 w-5 text-amber-300" />
              <p>{isAr ? "لا يوجد ملف عمل متاح لهذا الدرس حالياً." : "No workbook is available for this lesson right now."}</p>
            </div>
          </div>
        ) : null}

        {!inlineSupported && hasDocument ? <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[#D1D5DB]"><div className="space-y-3"><ExternalLink className="mx-auto h-6 w-6 text-[#C9A227]"/><p>{isAr ? "افتح ملف العمل أو نزّله لقراءته على جهازك." : "Open or download the workbook to read it on your device."}</p></div></div> : null}

        {!loaded && hasDocument && inlineSupported ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-gradient-to-br from-white/5 to-white/0 text-sm text-[#9CA3AF]">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#C9A227]" />
              <span>{isAr ? "جاري تحميل الملف..." : "Loading workbook..."}</span>
            </div>
          </div>
        ) : null}

        {hasError && hasDocument ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 text-center">
            <div className="space-y-3">
              <AlertCircle className="mx-auto h-5 w-5 text-amber-300" />
              <p className="text-sm text-[#D1D5DB]">
                {isAr ? "تعذر تحميل ملف العمل داخل الصفحة." : "The workbook could not be loaded inside the lesson."}
              </p>
              <a
                href={source.openUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-[#C9A227] hover:text-[#C9A227]"
              >
                {isAr ? "فتح الملف مباشرة" : "Open Workbook Directly"}
              </a>
            </div>
          </div>
        ) : null}

        {hasDocument && inlineSupported ? (
          <iframe
            title={title}
            src={source.embedUrl}
            className="h-full w-full"
            loading="lazy"
            onLoad={() => {
              setLoaded(true);
              setHasError(false);
              if (!hasOpenedRef.current) {
                hasOpenedRef.current = true;
                onOpen();
              }
              bumpProgress(5);
            }}
            onError={() => {
              setHasError(true);
              setLoaded(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
