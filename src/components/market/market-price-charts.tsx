"use client";

import { useEffect, useState } from "react";
import { currencyText } from "@/components/ui/currency-text";
import type { MarketChartSnapshot, MarketChartSymbol } from "@/types/market-chart";
import { runClientRequest } from "@/lib/client-request-deadline";

type Locale = "ar" | "en";
const TABS = [
  { label: "ETH/USDT", symbol: "ETHUSDT" },
  { label: "BTC/USDT", symbol: "BTCUSDT" },
] as const;

function CandleChart({ chart, locale }: { chart: MarketChartSnapshot; locale: Locale }) {
  const low = Math.min(...chart.candles.map((candle) => candle.low));
  const high = Math.max(...chart.candles.map((candle) => candle.high));
  const padding = Math.max((high - low) * 0.1, high * 0.001);
  const min = low - padding;
  const max = high + padding;
  const y = (price: number) => 16 + ((max - price) / (max - min)) * 236;
  const step = 280 / chart.candles.length;
  const last = chart.candles[chart.candles.length - 1];
  const price = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const time = (value: number) => new Date(value).toLocaleTimeString(locale === "ar" ? "ar" : "en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });

  // Plain SVG has no iframe, hyperlink, third-party script or navigation handler.
  // Older installed WebViews therefore cannot hand a chart request to Safari.
  return (
    <svg role="img" aria-label={`${chart.symbol.replace("USDT", "/USDT")} ${locale === "ar" ? "مخطط شموع آخر ٢٤ ساعة" : "24-hour candlestick chart"}`}
      viewBox="0 0 380 288" className="block h-[288px] w-full select-none" style={{ direction: "ltr" }}>
      <title>{`${chart.symbol}: ${price(last.close)} USDT`}</title>
      {[0, 1, 2, 3, 4].map((index) => {
        const value = max - ((max - min) * index) / 4;
        return <g key={index}>
          <line x1="12" x2="296" y1={y(value)} y2={y(value)} stroke="#ffffff12" />
          <text x="304" y={y(value) + 4} fill="#6ee7b7" fontSize="12">{price(value)}</text>
        </g>;
      })}
      {chart.candles.map((candle, index) => {
        const x = 16 + step * (index + 0.5);
        const color = candle.close >= candle.open ? "#34d399" : "#fb7185";
        return <g key={candle.time}>
          <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={color} />
          <rect x={x - step * 0.3} y={Math.min(y(candle.open), y(candle.close))} width={step * 0.6}
            height={Math.max(1, Math.abs(y(candle.open) - y(candle.close)))} fill={color} />
        </g>;
      })}
      <text x="16" y="278" fill="#9CA3AF" fontSize="12">{time(chart.candles[0].time)}</text>
      <text x="294" y="278" textAnchor="end" fill="#9CA3AF" fontSize="12">{time(last.time)} UTC</text>
    </svg>
  );
}

function MarketChart({ title, symbol, locale }: { title: string; symbol: MarketChartSymbol; locale: Locale }) {
  const [chart, setChart] = useState<MarketChartSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const isAr = locale === "ar";

  useEffect(() => {
    let stopped = false;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const available = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
    async function load() {
      if (stopped || controller || !available()) return;
      clearTimeout(refresh);
      const current = new AbortController();
      controller = current;
      try {
        const next = await runClientRequest(current, 10_000, async (signal) => {
          const response = await fetch(`/api/market/chart?symbol=${symbol}`, { signal });
          if (!response.ok) throw new Error("chart_unavailable");
          const payload = await response.json() as { chart: MarketChartSnapshot | null };
          if (!payload.chart || payload.chart.symbol !== symbol || payload.chart.candles.length < 2) {
            throw new Error("chart_unavailable");
          }
          return payload.chart;
        });
        if (!stopped && controller === current) { setChart(next); setFailed(false); }
      } catch {
        if (!stopped && controller === current) setFailed(true);
      } finally {
        if (controller === current) {
          controller = null;
          if (!stopped && available()) refresh = setTimeout(load, 60_000);
        }
      }
    }
    let active = available();
    const syncAvailability = () => {
      const next = available();
      if (next === active) return;
      active = next;
      if (active) void load();
      else {
        setFailed(true);
        clearTimeout(refresh);
        const previous = controller;
        controller = null;
        previous?.abort();
      }
    };
    document.addEventListener("visibilitychange", syncAvailability);
    window.addEventListener("online", syncAvailability);
    window.addEventListener("offline", syncAvailability);
    void load();
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(refresh);
      document.removeEventListener("visibilitychange", syncAvailability);
      window.removeEventListener("online", syncAvailability);
      window.removeEventListener("offline", syncAvailability);
    };
  }, [symbol, retry]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30" data-market-chart={symbol}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2 text-sm text-[#9CA3AF]">
        <span>{currencyText(title)}</span>
        <span>{isAr ? "٢٤ ساعة · شموع ساعة" : "24h · 1h candles"}</span>
      </div>
      {chart ? <CandleChart chart={chart} locale={locale} /> : (
        <div className="flex h-[288px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-[#B9C0CD]" role="status">
          <p>{failed ? (isAr ? "المخطط غير متاح مؤقتًا." : "Chart temporarily unavailable.")
            : (isAr ? "جارٍ تحميل المخطط…" : "Loading chart…")}</p>
          {failed ? <button type="button" onClick={() => { setFailed(false); setRetry((value) => value + 1); }}
            className="min-h-11 rounded-xl border border-[#C9A227]/40 px-5 text-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]">
            {isAr ? "إعادة المحاولة" : "Try again"}
          </button> : null}
        </div>
      )}
      {chart ? <div className={`px-4 pb-3 text-xs ${chart.stale || failed ? "text-amber-200" : "text-[#9CA3AF]"}`} role="status">
        {chart.stale || failed ? (isAr ? "تحديث متأخر · " : "Delayed update · ") : ""}
        {isAr ? "آخر تحديث: " : "Updated: "}{new Date(chart.updatedAt).toLocaleTimeString(isAr ? "ar" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
        {" · Binance"}
      </div> : null}
    </div>
  );
}

export function MarketPriceCharts({ locale }: { locale: Locale }) {
  const [symbol, setSymbol] = useState<MarketChartSymbol>("ETHUSDT");
  const active = TABS.find((item) => item.symbol === symbol) ?? TABS[0];
  return <div className="space-y-3" data-market-charts>
    <div className="mb-3 flex gap-2 rounded-2xl border border-white/10 bg-[#0A0A0A]/90 p-1">
      {TABS.map((item) => <button key={item.symbol} type="button" aria-pressed={symbol === item.symbol}
        className={`min-h-11 flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${symbol === item.symbol ? "bg-[#C9A227]/15 text-[#D4AF37]" : "text-[#9CA3AF] hover:bg-white/5 hover:text-white"}`}
        onClick={() => setSymbol(item.symbol)}>{currencyText(item.label)}</button>)}
    </div>
    <MarketChart key={symbol} title={active.label} symbol={symbol} locale={locale} />
  </div>;
}
