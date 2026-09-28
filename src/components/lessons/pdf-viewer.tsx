"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, ExternalLink, Expand, Loader2, Minimize2 } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { resolveLessonPdfSource } from "@/lib/lesson-pdf";
import type { LessonAsset } from "@/types/academy";

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
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasOpenedRef = useRef(false);
  const source = useMemo(() => resolveLessonPdfSource(asset), [asset]);
  const hasDocument = Boolean(source.embedUrl?.trim());
  const isWorkbook = source.embedUrl.endsWith(".html") || source.openUrl.endsWith(".html");

  useEffect(() => {
    setReadingProgress(initialProgress);
  }, [initialProgress]);

  function bumpProgress(amount: number) {
    setReadingProgress((current) => {
      const normalized = Math.min(100, Math.max(0, Math.round(current + amount)));
      if (normalized > current) {
        onProgress?.(normalized);
      }
      return normalized;
    });
  }

  async function toggleFullscreen() {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
      return;
    }

    await document.exitFullscreen();
    setIsFullscreen(false);
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
    <div className="space-y-3">
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
        <Button variant="secondary" size="sm" onClick={toggleFullscreen} disabled={!hasDocument}>
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          {isAr ? (isFullscreen ? "تصغير" : "ملء الشاشة") : isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleOpenInNewTab} disabled={!hasDocument}>
          <ExternalLink className="h-4 w-4" />
          {isAr ? "القراءة أونلاين" : "Read Online"}
        </Button>
        <Button size="sm" onClick={handleDownload} disabled={!hasDocument}>
          <Download className="h-4 w-4" />
          {isAr ? (isWorkbook ? "تنزيل الملف" : "تنزيل PDF") : isWorkbook ? "Download File" : "Download PDF"}
        </Button>
      </div>

      <div
        ref={containerRef}
        className="relative h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black/20 sm:h-[420px] md:h-[560px] lg:h-[680px]"
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

        {!loaded && hasDocument ? (
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

        {hasDocument ? (
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
