"use client";

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { currencyText } from "@/components/ui/currency-text";
import { CandlestickChart } from "@/components/market/candlestick-chart";
import { createMarketChartStore } from "@/lib/market-chart-client";
import { isFxReferenceUsable } from "@/lib/fx-reference-policy";
import { sampleReferenceQuote } from "@/lib/market-candles";
import type { MarketCandle, MarketChartSymbol } from "@/types/market-chart";
import type { MarketSnapshot } from "@/types/market";

const feeds = { BTCUSDT: createMarketChartStore("BTCUSDT"), ETHUSDT: createMarketChartStore("ETHUSDT") };
const surface = "min-w-0 shrink-0 basis-[min(100%,320px)] snap-start overflow-hidden rounded-2xl border border-[#C9A227]/15 bg-[linear-gradient(155deg,rgba(201,162,39,0.09),rgba(8,8,8,0.96)_46%)] p-4 lg:basis-auto";

export const CryptoMarketCard = memo(function CryptoMarketCard({ symbol, locale }: { symbol: MarketChartSymbol; locale: "en" | "ar" }) {
  const isAr = locale === "ar";
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const feed = feeds[symbol];
  const subscribe = useCallback((listener: () => void) => visible ? feed.subscribe(listener) : () => {}, [feed, visible]);
  const { chart, live, error } = useSyncExternalStore(subscribe, feed.getSnapshot, feed.getServerSnapshot);
  const label = symbol === "BTCUSDT" ? "BTC / USDT" : "ETH / USDT";
  const last = chart?.candles[chart.candles.length - 1];
  const delayed = error || chart?.stale;
  return <article ref={ref} className={surface} data-market-chart={symbol} aria-label={label}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium tracking-wide text-[#F4D87A]"><bdi dir="ltr">{currencyText(label)}</bdi></p>
      <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-[#BFC6CF]">5m</span>
    </div>
    <p className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight text-emerald-300" data-chart-price>
      <bdi dir="ltr">{last ? `$${last.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</bdi>
    </p>
    <div className="mt-3 min-h-[112px]" data-chart-viewport>
      {chart ? <CandlestickChart candles={chart.candles} label={label} locale={locale} /> : <div className="flex aspect-[356/148] items-center justify-center text-center text-xs text-[#9CA3AF]">
        {error ? (isAr ? "المخطط غير متاح مؤقتًا" : "Chart temporarily unavailable") : (isAr ? "جارٍ تحميل الشموع…" : "Loading candles…")}
      </div>}
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#9CA3AF]">
      <span>Binance · {isAr ? "فوري" : "Spot"}</span>
      <span role="status" className={delayed ? "text-amber-200" : live ? "text-emerald-300" : "text-[#9CA3AF]"}>
        {delayed ? (isAr ? "تحديث متأخر" : "Delayed update") : live ? (isAr ? "مباشر" : "LIVE") : (isAr ? "تحديث تلقائي" : "Auto-refresh")}
      </span>
    </div>
  </article>;
});

function ReferenceMarketCard({ snapshot, locale }: { snapshot: MarketSnapshot | null; locale: "en" | "ar" }) {
  const isAr = locale === "ar";
  const [candles, setCandles] = useState<MarketCandle[]>([]);
  const price = snapshot?.pairs.usdtIls.price;
  const confirmed = isFxReferenceUsable(snapshot);
  const timestamp = snapshot?.pairs.usdtIls.quotedAt;
  useEffect(() => {
    if (!confirmed || !price || !timestamp) return;
    setCandles((previous) => sampleReferenceQuote(previous, price, Date.parse(timestamp)));
  }, [confirmed, price, timestamp]);
  return <article className={surface} aria-label="USD / ILS reference" data-market-chart="USDTILS">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium tracking-wide text-[#F4D87A]"><bdi dir="ltr">{currencyText("USD / ILS")}</bdi></p>
      <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-[#BFC6CF]">5m</span>
    </div>
    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-emerald-300"><bdi dir="ltr">{price ? `₪${price.toFixed(5)}` : "—"}</bdi></p>
    <div className="mt-3 min-h-[112px]">
      {candles.length ? <CandlestickChart candles={candles} label="USD / ILS" locale={locale} reference /> : <div className="flex aspect-[356/148] items-center justify-center text-xs text-[#9CA3AF]">{isAr ? "بانتظار سعر مرجعي محدّث" : "Waiting for a fresh reference"}</div>}
    </div>
    <p className="mt-2 text-xs text-[#9CA3AF]">{currencyText(isAr ? "مرجع USD/ILS لعروض USDT · عينات ٥ دقائق" : "USD/ILS benchmark for USDT listings · 5m samples")}</p>
    <p className="mt-1 text-xs text-[#858D99]">{snapshot?.pairs.usdtIls.source} · {timestamp ? new Date(timestamp).toLocaleTimeString(locale, { hour12: false }) : "—"}</p>
    <p className={`mt-1 text-xs ${confirmed ? "text-[#858D99]" : "text-amber-200"}`}>{confirmed
      ? (snapshot?.pairs.usdtIls.quoteStatus === "closed" ? (isAr ? "السوق مغلق · آخر إغلاق" : "Market closed · last close") : (isAr ? "السجل منذ فتح الصفحة" : "History since this page opened"))
      : (isAr ? "تحديث المرجع متأخر" : "Reference update delayed")}</p>
  </article>;
}

export function LiveMarketCards({ snapshot, locale }: { snapshot: MarketSnapshot | null; locale: "en" | "ar" }) {
  return <div className="flex snap-x snap-proximity gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-3 lg:overflow-visible" data-live-market-cards>
    <ReferenceMarketCard snapshot={snapshot} locale={locale} />
    <CryptoMarketCard symbol="BTCUSDT" locale={locale} />
    <CryptoMarketCard symbol="ETHUSDT" locale={locale} />
  </div>;
}
