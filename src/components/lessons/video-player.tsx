"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import type { LessonAsset } from "@/types/academy";

function extractVideoId(url: string, provider: LessonAsset["videoProvider"]) {
  if (provider === "youtube") {
    const parsed = new URL(url);
    const byQuery = parsed.searchParams.get("v");
    if (byQuery) return byQuery;
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? "";
  }

  if (provider === "vimeo") {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? "";
  }

  if (provider === "google-drive") {
    const match = url.match(/\/d\/([^/]+)/);
    return match?.[1] ?? "";
  }

  return "";
}

function buildEmbedUrl(asset: LessonAsset) {
  const id = asset.videoId || extractVideoId(asset.videoUrl, asset.videoProvider);

  if (asset.videoProvider === "youtube" && id) {
    return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
  }
  if (asset.videoProvider === "vimeo" && id) {
    return `https://player.vimeo.com/video/${id}`;
  }
  if (asset.videoProvider === "google-drive" && id) {
    return `https://drive.google.com/file/d/${id}/preview`;
  }
  if (asset.videoProvider === "bunny-stream" && id) {
    return `https://iframe.mediadelivery.net/embed/${id}`;
  }
  return asset.videoUrl;
}

export function VideoPlayer({
  asset,
  title,
  initialTimeSeconds = 0,
  onVideoPlay,
  onVideoComplete,
  onVideoTimeUpdate,
}: {
  asset: LessonAsset;
  title: string;
  initialTimeSeconds?: number;
  onVideoPlay: () => void;
  onVideoComplete: () => void;
  onVideoTimeUpdate?: (seconds: number) => void;
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const embedUrl = useMemo(() => buildEmbedUrl(asset), [asset]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSyncedRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const hasVideoSource = Boolean(asset.videoUrl?.trim());
  const isSelfHosted = asset.videoProvider === "self-hosted" || asset.videoProvider === "supabase" || asset.videoProvider === "cloudflare-r2";

  useEffect(() => {
    if (!isSelfHosted || !videoRef.current || !initialTimeSeconds) return;
    const boundedTime = Math.max(0, initialTimeSeconds);
    if (Math.abs(videoRef.current.currentTime - boundedTime) > 1) {
      videoRef.current.currentTime = boundedTime;
    }
  }, [initialTimeSeconds, isSelfHosted]);

  useEffect(() => {
    if (isSelfHosted || !hasVideoSource) return;
    setIsLoading(true);
    setHasError(false);
    const timer = window.setTimeout(() => {
      setHasError(true);
      setIsLoading(false);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [embedUrl, hasVideoSource, isSelfHosted]);

  if (!hasVideoSource) {
    return (
      <div className="grid h-full w-full place-items-center bg-black/30 p-6 text-center text-sm text-[#9CA3AF]">
        <div className="space-y-2">
          <AlertCircle className="mx-auto h-5 w-5 text-[#C9A227]" />
          <p>{isAr ? "لا يوجد فيديو متاح لهذا الدرس حالياً." : "No video is available for this lesson right now."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      {isLoading ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 text-sm text-[#9CA3AF]">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-[#C9A227]" />
            <span>{isAr ? "جاري تحميل الفيديو..." : "Loading video..."}</span>
          </div>
        </div>
      ) : null}

      {hasError ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 text-center">
          <div className="space-y-3">
            <AlertCircle className="mx-auto h-5 w-5 text-amber-300" />
            <p className="text-sm text-[#D1D5DB]">
              {isAr ? "تعذر تحميل الفيديو داخل الصفحة." : "This video could not be loaded inside the lesson."}
            </p>
            <a
              href={asset.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-[#C9A227] hover:text-[#C9A227]"
            >
              {isAr ? "فتح المصدر مباشرة" : "Open Source Directly"}
            </a>
          </div>
        </div>
      ) : null}

      {isSelfHosted ? (
        <video
          ref={videoRef}
          className="block h-full w-full bg-black object-contain"
          controls
          controlsList="nodownload"
          preload="metadata"
          playsInline
          onPlaying={() => {
            setIsLoading(false);
            setHasError(false);
            onVideoPlay();
          }}
          onWaiting={() => setIsLoading(true)}
          onLoadedData={() => {
            setIsLoading(false);
            setHasError(false);
          }}
          onError={() => {
            setHasError(true);
            setIsLoading(false);
          }}
          onEnded={() => {
            setHasError(false);
            setIsLoading(false);
            onVideoComplete();
          }}
          onTimeUpdate={(event) => {
            if (!onVideoTimeUpdate) return;
            const seconds = event.currentTarget.currentTime;
            if (Math.abs(seconds - lastSyncedRef.current) < 5) return;
            lastSyncedRef.current = seconds;
            onVideoTimeUpdate(seconds);
          }}
        >
          <source src={asset.videoUrl} />
        </video>
      ) : (
        <iframe
          title={title}
          src={embedUrl}
          loading="lazy"
          className="block h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          onLoad={() => {
            setIsLoading(false);
            setHasError(false);
          }}
        />
      )}
    </div>
  );
}
