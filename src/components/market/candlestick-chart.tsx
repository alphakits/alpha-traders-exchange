"use client";

import { memo } from "react";
import type { MarketCandle } from "@/types/market-chart";
import { CANDLE_INTERVAL_MS, MAX_CANDLES } from "@/lib/market-candles";

/** A small, passive SVG: no chart scripts, gestures, links or animation loops. */
export const CandlestickChart = memo(function CandlestickChart({ candles, label, locale, reference = false }: {
  candles: MarketCandle[]; label: string; locale: "en" | "ar"; reference?: boolean;
}) {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const low = Math.min(...candles.map((candle) => candle.low));
  const high = Math.max(...candles.map((candle) => candle.high));
  const pad = Math.max((high - low) * 0.12, high * 0.00008);
  const min = low - pad, max = high + pad;
  const y = (price: number) => 12 + ((max - price) / (max - min)) * 104;
  const start = last.time - (MAX_CANDLES - 1) * CANDLE_INTERVAL_MS;
  const step = 268 / MAX_CANDLES;
  const x = (time: number) => 10 + ((time - start) / CANDLE_INTERVAL_MS + 0.5) * step;
  const formatPrice = (price: number) => price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: reference ? 4 : 2 });
  const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const color = last.close >= last.open ? "#26a69a" : "#ef5350";

  return <svg role="img" aria-label={`${label} ${locale === "ar" ? "شموع ٥ دقائق" : "5-minute candlestick chart"}`}
    viewBox="0 0 356 148" className="pointer-events-none block h-auto w-full select-none" style={{ direction: "ltr" }} data-candle-count={candles.length}>
    <title>{`${label}: ${formatPrice(last.close)} · 5m`}</title>
    {[0, 1, 2].map((index) => {
      const price = max - (max - min) * index / 2;
      return <g key={index}>
        <line x1="8" x2="280" y1={y(price)} y2={y(price)} stroke="#ffffff0c" />
        <text x="288" y={y(price) + 4} fontSize="11" fill="#929aa7">{formatPrice(price)}</text>
      </g>;
    })}
    {candles.filter((candle) => candle.time >= start).map((candle) => {
      const fill = candle.close >= candle.open ? "#26a69a" : "#ef5350";
      return <g key={candle.time} data-candle-time={candle.time}>
        <line x1={x(candle.time)} x2={x(candle.time)} y1={y(candle.high)} y2={y(candle.low)} stroke={fill} strokeWidth="1" />
        <rect x={x(candle.time) - step * 0.32} y={Math.min(y(candle.open), y(candle.close))} width={step * 0.64}
          height={Math.max(1.2, Math.abs(y(candle.open) - y(candle.close)))} fill={fill} />
      </g>;
    })}
    <line x1="8" x2="280" y1={y(last.close)} y2={y(last.close)} stroke={color} strokeOpacity=".45" strokeDasharray="2 4" />
    <rect x="284" y={y(last.close) - 8} width="72" height="17" rx="3" fill={color} />
    <text x="288" y={y(last.close) + 4} fontSize="11" fill="white">{formatPrice(last.close)}</text>
    <text x="10" y="140" fontSize="11" fill="#929aa7">{time(start)}</text>
    <text x="278" y="140" textAnchor="end" fontSize="11" fill="#929aa7">{time(last.time)} UTC</text>
  </svg>;
});
