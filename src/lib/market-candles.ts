import type { MarketCandle, MarketChartSnapshot, MarketChartSymbol } from "@/types/market-chart";

export const CANDLE_INTERVAL_MS = 300_000;
export const MAX_CANDLES = 48;

export function isMarketCandle(value: unknown): value is MarketCandle {
  if (!value || typeof value !== "object") return false;
  const candle = value as MarketCandle;
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && Number.isSafeInteger(candle.time) && candle.time > 0 && candle.time % CANDLE_INTERVAL_MS === 0
    && candle.low > 0 && candle.high >= candle.low
    && candle.open >= candle.low && candle.open <= candle.high
    && candle.close >= candle.low && candle.close <= candle.high;
}

export function validMarketChart(value: unknown, symbol: MarketChartSymbol): value is MarketChartSnapshot {
  if (!value || typeof value !== "object") return false;
  const chart = value as MarketChartSnapshot;
  return chart.symbol === symbol && chart.interval === "5m" && chart.source === "Binance"
    && Number.isFinite(Date.parse(chart.updatedAt)) && typeof chart.stale === "boolean"
    && Array.isArray(chart.candles) && chart.candles.length >= 2 && chart.candles.length <= MAX_CANDLES
    && chart.candles.every((candle, index) => isMarketCandle(candle)
      && candle.time <= Date.now() + 5_000 && (!index || candle.time > chart.candles[index - 1].time));
}

export function parseCandleEvent(value: unknown, symbol: MarketChartSymbol, now = Date.now()) {
  if (!value || typeof value !== "object") return null;
  const event = value as { e?: string; E?: number; s?: string; k?: { s?: string; i?: string; t?: number; o?: string; h?: string; l?: string; c?: string } };
  const k = event.k;
  if (event.e !== "kline" || event.s !== symbol || k?.s !== symbol || k.i !== "5m"
    || !Number.isSafeInteger(event.E) || event.E! > now + 5_000 || now - event.E! > 15_000) return null;
  const candle = { time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c) };
  if (!isMarketCandle(candle) || candle.time > event.E! || event.E! - candle.time > CANDLE_INTERVAL_MS + 5_000) return null;
  return { candle, eventTime: event.E! };
}

/** Replace the open candle or append the next real candle; never fill missing prices. */
export function mergeCandle(candles: MarketCandle[], candle: MarketCandle): MarketCandle[] {
  const last = candles[candles.length - 1];
  if (last && candle.time < last.time) return candles;
  return [...(last?.time === candle.time ? candles.slice(0, -1) : candles), candle].slice(-MAX_CANDLES);
}

/** Reference candles contain only quotes actually observed while the page is open. */
export function sampleReferenceQuote(candles: MarketCandle[], price: number, timestamp: number): MarketCandle[] {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) return candles;
  const time = Math.floor(timestamp / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
  const last = candles[candles.length - 1];
  if (last && time < last.time) return candles;
  const candle = last?.time === time
    ? { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
    : { time, open: price, high: price, low: price, close: price };
  return mergeCandle(candles, candle);
}
