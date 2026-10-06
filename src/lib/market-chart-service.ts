import "server-only";
import type { MarketCandle, MarketChartSnapshot, MarketChartSymbol } from "@/types/market-chart";

const CACHE_MS = 45_000;
const MAX_STALE_MS = 60 * 60_000;
const PROVIDER_TIMEOUT_MS = 3_000;
const cache = new Map<MarketChartSymbol, { checkedAt: number; snapshot: MarketChartSnapshot | null }>();
const pending = new Map<MarketChartSymbol, Promise<MarketChartSnapshot | null>>();

export function parseMarketCandles(payload: unknown, now = Date.now()): MarketCandle[] {
  if (!Array.isArray(payload) || payload.length < 2 || payload.length > 24) throw new Error("invalid_chart_data");
  let previousTime = 0;
  const candles = payload.map((row: unknown): MarketCandle => {
    if (!Array.isArray(row) || row.length < 5) throw new Error("invalid_chart_data");
    const [time, open, high, low, close] = row.slice(0, 5).map(Number);
    if (![time, open, high, low, close].every(Number.isFinite)
      || !Number.isSafeInteger(time) || time <= previousTime || time > now
      || low <= 0 || high < low || open < low || open > high || close < low || close > high) {
      throw new Error("invalid_chart_data");
    }
    previousTime = time;
    return { time, open, high, low, close };
  });
  if (now - candles[candles.length - 1].time > 2 * 60 * 60_000) throw new Error("outdated_chart_data");
  return candles;
}

async function fetchCandles(origin: string, symbol: MarketChartSymbol) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bound both the headers and body, including a stalled upstream response.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("chart_provider_timeout"));
    }, PROVIDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`${origin}/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`, {
          cache: "no-store", redirect: "error", signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error("chart_provider_unavailable");
        }
        return parseMarketCandles(await response.json());
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function refreshChart(symbol: MarketChartSymbol): Promise<MarketChartSnapshot | null> {
  // Public price data only. Neither credentials nor provider pages reach the client.
  for (const origin of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      const candles = await fetchCandles(origin, symbol);
      const snapshot: MarketChartSnapshot = {
        symbol, interval: "1h", source: "Binance", candles, stale: false, updatedAt: new Date().toISOString(),
      };
      cache.set(symbol, { checkedAt: Date.now(), snapshot });
      return snapshot;
    } catch {
      // Try the second public endpoint before using explicitly delayed data.
    }
  }
  const previous = cache.get(symbol)?.snapshot;
  const snapshot = previous && Date.now() - Date.parse(previous.updatedAt) <= MAX_STALE_MS
    ? { ...previous, stale: true } : null;
  cache.set(symbol, { checkedAt: Date.now(), snapshot });
  return snapshot;
}

export function getMarketChart(symbol: MarketChartSymbol): Promise<MarketChartSnapshot | null> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.checkedAt < CACHE_MS) return Promise.resolve(cached.snapshot);
  const existing = pending.get(symbol);
  if (existing) return existing;
  const request = refreshChart(symbol).finally(() => pending.delete(symbol));
  pending.set(symbol, request);
  return request;
}
