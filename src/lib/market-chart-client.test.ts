import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMarketChartStore } from "./market-chart-client";
import { sampleReferenceQuote } from "./market-candles";

const now = Date.parse("2026-10-09T01:02:00Z");
const start = Math.floor(now / 300_000) * 300_000;
const candle = { time: start, open: 100, high: 105, low: 99, close: 103 };
const history = { symbol: "BTCUSDT", interval: "5m", source: "Binance", updatedAt: new Date(now - 1_000).toISOString(), stale: false,
  candles: [{ ...candle, time: start - 300_000 }, candle] };
class Socket {
  static instances: Socket[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  close = vi.fn();
  constructor(public url: string) { Socket.instances.push(this); }
  send(close: number, eventTime = Date.now(), time = start, extra = {}) {
    this.onmessage?.({ data: JSON.stringify({ e: "kline", E: eventTime, s: "BTCUSDT", k: { s: "BTCUSDT", i: "5m", t: time, o: "100", h: "110", l: "99", c: String(close), ...extra } }) });
  }
}
const stops: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ chart: history }) })));
});
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("real candle stream lifecycle", () => {
  it("shares a socket, updates the current candle, rejects wrong intervals and old events, and rolls over", async () => {
    const store = createMarketChartStore("BTCUSDT");
    stops.push(store.subscribe(vi.fn()), store.subscribe(vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    expect(Socket.instances).toHaveLength(1);
    expect(Socket.instances[0].url).toContain("@kline_5m");
    Socket.instances[0].send(106);
    expect(store.getSnapshot().chart?.candles.at(-1)?.close).toBe(106);
    expect(store.getSnapshot().live).toBe(true);
    Socket.instances[0].send(109, now - 100);
    Socket.instances[0].send(109, now + 1, start, { i: "1h" });
    expect(store.getSnapshot().chart?.candles.at(-1)?.close).toBe(106);
    vi.setSystemTime(start + 300_001);
    Socket.instances[0].send(108, Date.now(), start + 300_000);
    expect(store.getSnapshot().chart?.candles).toHaveLength(3);
    expect(store.getSnapshot().chart?.candles.at(-1)?.close).toBe(108);
  });
  it("does not let a late REST response overwrite a newer live candle", async () => {
    let resolve!: (value: Response | PromiseLike<Response>) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(done => { resolve = done; }) as Promise<Response>);
    const store = createMarketChartStore("BTCUSDT"); stops.push(store.subscribe(vi.fn()));
    Socket.instances[0].send(108);
    resolve(new Response(JSON.stringify({ chart: history }), { headers: { "Content-Type": "application/json" } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().chart?.candles.at(-1)?.close).toBe(108);
  });
  it("closes hidden sockets, reconnects after visibility resumes, and marks silent streams delayed", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const store = createMarketChartStore("BTCUSDT"); stops.push(store.subscribe(vi.fn()));
    await vi.advanceTimersByTimeAsync(0); Socket.instances[0].send(106);
    visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
    expect(Socket.instances[0].close).toHaveBeenCalledOnce();
    expect(store.getSnapshot().live).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(1);
    visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0); expect(Socket.instances).toHaveLength(2);
    Socket.instances[1].send(107);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(store.getSnapshot().live).toBe(false);
    expect(Socket.instances[1].close).toHaveBeenCalledOnce();
  });
  it("samples reference quotes without generating candles for unobserved intervals", () => {
    let candles = sampleReferenceQuote([], 3.07, now);
    candles = sampleReferenceQuote(candles, 3.08, now + 10_000);
    expect(candles).toEqual([{ time: start, open: 3.07, high: 3.08, low: 3.07, close: 3.08 }]);
    candles = sampleReferenceQuote(candles, 3.06, now + 900_000);
    expect(candles).toHaveLength(2);
    expect(candles[1].open).toBe(3.06);
    expect(sampleReferenceQuote(candles, NaN, now)).toBe(candles);
  });
});
