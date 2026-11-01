import { runClientRequest } from "@/lib/client-request-deadline";
import { CANDLE_INTERVAL_MS, mergeCandle, parseCandleEvent, validMarketChart } from "@/lib/market-candles";
import type { MarketChartSnapshot, MarketChartSymbol } from "@/types/market-chart";

type ChartState = { chart: MarketChartSnapshot | null; live: boolean; error: boolean };
const EMPTY: ChartState = { chart: null, live: false, error: false };

/** Shared by every instance of this pair. At most two small public sockets per page. */
export function createMarketChartStore(symbol: MarketChartSymbol) {
  let state = EMPTY;
  const listeners = new Set<() => void>();
  let socket: WebSocket | null = null;
  let pending: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let tick: ReturnType<typeof parseCandleEvent> = null;
  let retryMs = 1_000;
  let socketActivityAt = 0;
  let active = false;
  const available = () => listeners.size > 0 && document.visibilityState !== "hidden" && navigator.onLine !== false;
  const fresh = () => Boolean(tick && Date.now() - tick.eventTime < 12_000);
  const publish = (next: ChartState) => { state = next; listeners.forEach((listener) => listener()); };

  async function refresh() {
    if (!available() || pending) return;
    clearTimeout(timer);
    const controller = new AbortController();
    pending = controller;
    try {
      let chart = await runClientRequest(controller, 10_000, async (signal) => {
        const response = await fetch(`/api/market/chart?symbol=${symbol}`, { signal });
        if (!response.ok) throw new Error("chart_unavailable");
        const payload = await response.json() as { chart?: unknown };
        if (!validMarketChart(payload.chart, symbol)) throw new Error("invalid_chart");
        return payload.chart;
      });
      if (pending !== controller || !available()) return;
      // A cached history response must never overwrite a newer stream update.
      if (tick && tick.eventTime > Date.parse(chart.updatedAt)) chart = {
        ...chart, candles: mergeCandle(chart.candles, tick.candle),
        updatedAt: new Date(tick.eventTime).toISOString(), stale: !fresh(),
      };
      publish({ chart, live: fresh() && !chart.stale, error: chart.stale });
    } catch {
      if (pending === controller) publish({ ...state, live: fresh(), error: !fresh() });
    } finally {
      if (pending === controller) {
        pending = null;
        if (available()) timer = setTimeout(() => void refresh(), fresh() ? 60_000 : 15_000);
      }
    }
  }

  function connect() {
    if (!available() || socket || typeof WebSocket === "undefined") return;
    try {
      const current = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@kline_5m`);
      socket = current;
      socketActivityAt = Date.now();
      current.onmessage = (message) => {
        if (socket !== current || !available()) return;
        try {
          const next = parseCandleEvent(JSON.parse(message.data), symbol);
          if (!next || (tick && next.eventTime <= tick.eventTime)) return;
          tick = next;
          socketActivityAt = Date.now();
          retryMs = 1_000;
          const chart = state.chart;
          if (!chart) { void refresh(); return; }
          const last = chart.candles[chart.candles.length - 1];
          if (next.candle.time < last.time) return;
          publish({ chart: { ...chart, candles: mergeCandle(chart.candles, next.candle),
            updatedAt: new Date(next.eventTime).toISOString(), stale: false }, live: true, error: false });
          if (next.candle.time > last.time + CANDLE_INTERVAL_MS) void refresh();
        } catch { /* Ignore malformed public messages; history remains visible. */ }
      };
      current.onclose = () => {
        if (socket !== current) return;
        socket = null;
        publish({ ...state, live: false });
        if (available()) {
          reconnect = setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
          void refresh();
        }
      };
      current.onerror = () => { if (socket === current) current.close(); };
    } catch {
      reconnect = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }

  function stop() {
    clearTimeout(timer); clearTimeout(reconnect); clearInterval(watchdog);
    const request = pending; pending = null; request?.abort();
    const previous = socket; socket = null; previous?.close();
    tick = null;
  }
  function sync() {
    const next = available();
    if (next === active) return;
    active = next;
    if (!active) {
      stop();
      publish({ ...state, live: false, error: Boolean(state.chart) });
      return;
    }
    void refresh(); connect();
    watchdog = setInterval(() => {
      if ((state.live && !fresh()) || (socket && Date.now() - socketActivityAt > 15_000)) {
        publish({ ...state, live: false, error: true });
        const previous = socket; socket = null; previous?.close();
        connect(); void refresh();
      }
    }, 5_000);
  }
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => EMPTY,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        document.addEventListener("visibilitychange", sync);
        window.addEventListener("online", sync); window.addEventListener("offline", sync);
        sync();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        stop(); active = false; state = EMPTY;
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("online", sync); window.removeEventListener("offline", sync);
      };
    },
  };
}
