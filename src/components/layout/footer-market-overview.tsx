"use client";

import type { AppLocale } from "@/i18n/routing";
import { useMarketFeed } from "@/components/market/use-market-feed";
import type { MarketPair, MarketPairKey } from "@/types/market";

const PAIR_ORDER: Array<{ key: MarketPairKey; label: string }> = [
  { key: "btcUsdt", label: "BTC / USDT" },
  { key: "ethUsdt", label: "ETH / USDT" },
  { key: "usdtIls", label: "USDT / ILS" },
];

function formatPrice(key: MarketPairKey, price: number | null) {
  if (price === null) return "--";
  if (key === "usdtIls") {
    return `₪${price.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatChange(changePercent: number | null) {
  if (changePercent === null || Number.isNaN(changePercent)) return "--";
  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(2)}%`;
}

function formatIsraelTime(value: string | null | undefined, isAr: boolean) {
  if (!value) return "--:--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString(isAr ? "ar-IL-u-nu-latn" : "en-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  });
}

export function FooterMarketOverview({ locale }: { locale: AppLocale }) {
  const isAr = locale === "ar";
  const { snapshot, isLoading, error } = useMarketFeed({ refreshMs: 45_000 });
  const isLive = Boolean(snapshot?.status === "live" && !snapshot.stale && !error);

  const pairs = PAIR_ORDER.map(({ key, label }) => {
    const pair: MarketPair | null = snapshot?.pairs[key] ?? null;
    return {
      key,
      label: pair?.label ?? label,
      price: pair?.price ?? null,
      changePercent: pair?.changePercent ?? null,
    };
  });

  const statusLabel = isLoading && !snapshot
    ? (isAr ? "جارٍ التحديث" : "Updating")
    : isLive
      ? (isAr ? "مباشر" : "LIVE")
      : (isAr ? "متدهور" : "Degraded");

  return (
    <div
      className="rounded-2xl border border-white/10 bg-black/35 p-5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
          {isAr ? "نظرة السوق" : "Market Overview"}
        </p>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium ${isLive ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-amber-500/25 bg-amber-500/10 text-amber-200"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-emerald-400" : "bg-amber-300"}`} />
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 space-y-2 text-xs text-[#D8DFEA] sm:text-sm">
        {pairs.map((pair) => {
          const positive = pair.changePercent !== null && pair.changePercent >= 0;
          const changeColor = pair.changePercent === null
            ? "text-[#9CA3AF]"
            : positive
              ? "text-emerald-300"
              : "text-rose-300";

          return (
            <div
              key={pair.key}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <bdi dir="ltr" className="me-auto whitespace-nowrap">{pair.label}</bdi>
              <span className="flex shrink-0 items-center gap-2 sm:gap-3">
                <bdi dir="ltr" className="whitespace-nowrap font-semibold text-white">
                  {formatPrice(pair.key, pair.price)}
                </bdi>
                <bdi dir="ltr" className={`min-w-[4.25rem] whitespace-nowrap text-end ${changeColor}`}>
                  {formatChange(pair.changePercent)}
                </bdi>
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-[#9CA3AF] sm:text-[11px]">
        <span>
          {isAr ? "آخر تحديث" : "Last update"}: {" "}
          <bdi dir="ltr">{formatIsraelTime(snapshot?.updatedAt, isAr)}</bdi>
        </span>
        <span>
          {isAr ? "الحالة" : "Status"}: {" "}
          <span className={isLive ? "text-emerald-300" : "text-amber-200"}>{statusLabel}</span>
        </span>
      </div>
    </div>
  );
}
