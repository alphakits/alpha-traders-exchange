import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const now = Date.parse("2026-10-06T01:30:00Z");
const rows = [
  [now - 5_400_000, "2700", "2710", "2690", "2705"],
  [now - 1_800_000, "2705", "2715", "2695", "2700"],
];
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("first-party chart data", () => {
  it("deduplicates concurrent requests, caches both pairs separately, and returns real ordered candles", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => rows }));
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketChart } = await import("./market-chart-service");
    const [one, two] = await Promise.all([getMarketChart("ETHUSDT"), getMarketChart("ETHUSDT")]);
    expect(one).toEqual(two);
    expect(one?.candles[0]).toEqual({ time: rows[0][0], open: 2700, high: 2710, low: 2690, close: 2705 });
    await getMarketChart("ETHUSDT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getMarketChart("BTCUSDT"))?.symbol).toBe("BTCUSDT");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(expect.arrayContaining([expect.stringContaining("data-api.binance.vision/api/v3/klines?symbol=ETHUSDT")]));
  });

  it("uses the fallback endpoint, marks prior data delayed, and expires old data instead of fabricating prices", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ ok: true, json: async () => rows }).mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketChart } = await import("./market-chart-service");
    const first = await getMarketChart("ETHUSDT");
    expect(first?.stale).toBe(false);
    expect(fetchMock.mock.calls[1][0]).toContain("https://api.binance.com/");
    vi.setSystemTime(now + 60_000);
    const delayed = await getMarketChart("ETHUSDT");
    expect(delayed).toEqual({ ...first, stale: true });
    vi.setSystemTime(now + 3_660_000);
    expect(await getMarketChart("ETHUSDT")).toBeNull();
  });

  it("bounds stalled response bodies and permits a later refresh", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }));
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketChart } = await import("./market-chart-service");
    const request = getMarketChart("ETHUSDT");
    await vi.advanceTimersByTimeAsync(6_001);
    expect(await request).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(now + 60_000);
    fetchMock.mockResolvedValue({ ok: true, json: async () => rows });
    expect((await getMarketChart("ETHUSDT"))?.stale).toBe(false);
  });

  it("rejects invalid, reversed, future and outdated candles", async () => {
    const { parseMarketCandles } = await import("./market-chart-service");
    for (const data of [null, [], [...rows].reverse(), [rows[0], rows[0]],
      [rows[0], [now + 1, 10, 12, 9, 11]], [rows[0], [now, 10, 9, 12, 11]],
      [rows[0], [now, "bad", 20, 1, 11]], rows.map((row) => [Number(row[0]) - 86_400_000, ...row.slice(1)])]) {
      expect(() => parseMarketCandles(data)).toThrow();
    }
  });

  it("rejects unsupported route symbols before any upstream fetch and returns an honest unavailable status", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/market/chart/route");
    expect((await GET(new Request("https://www.alphatraders.co.il/api/market/chart?symbol=invalid"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const response = await GET(new Request("https://www.alphatraders.co.il/api/market/chart?symbol=ETHUSDT"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ chart: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
