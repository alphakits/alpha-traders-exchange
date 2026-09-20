// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "@/types/market";

function healthyResponse(url: string) {
  const payload = url.includes("open.er-api") || url.includes("frankfurter")
    ? { rates: { ILS: 3.25 } }
    : url.includes("BTC")
      ? { price: "81000", data: { amount: "81000" } }
      : { price: "2700", data: { amount: "2700" } };
  return { ok: true, json: async () => payload } as Response;
}

function isPrimaryProvider(url: string) {
  return url.includes("open.er-api") || url.includes("binance");
}

describe("market provider reliability", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("ALPHA_EXCHANGE_USD_ILS_RATE", "");
    vi.stubEnv("ALPHA_MARKET_BTC_USDT_RATE", "");
    vi.stubEnv("ALPHA_MARKET_ETH_USDT_RATE", "");
    vi.stubEnv("ALPHA_MARKET_CACHE_TTL_MS", "");
    vi.stubEnv("ALPHA_MARKET_CACHE_TTL_SECONDS", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("releases concurrent callers through backup providers when initial connections stall", async () => {
    const primarySignals: AbortSignal[] = [];
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (isPrimaryProvider(input)) {
        if (init?.signal) primarySignals.push(init.signal);
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(healthyResponse(input));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketSnapshot } = await import("@/lib/market-service");
    const results: MarketSnapshot[] = [];
    void getMarketSnapshot().then((result) => results.push(result));
    void getMarketSnapshot().then((result) => results.push(result));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(results).toHaveLength(2);
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toMatchObject({ status: "live", stale: false });
    expect(results[0].pairs.usdtIls.price).toBe(3.25);
    expect(primarySignals).toHaveLength(3);
    expect(primarySignals.every((signal) => signal.aborted)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also bounds a response body that stalls after headers arrive", async () => {
    const primarySignals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
      if (isPrimaryProvider(input)) {
        if (init?.signal) primarySignals.push(init.signal);
        return Promise.resolve({ ok: true, json: () => new Promise(() => undefined) } as Response);
      }
      return Promise.resolve(healthyResponse(input));
    }));
    const { getMarketSnapshot } = await import("@/lib/market-service");
    let result: MarketSnapshot | undefined;
    void getMarketSnapshot().then((snapshot) => { result = snapshot; });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(result).toMatchObject({ status: "live", stale: false });
    expect(primarySignals).toHaveLength(3);
    expect(primarySignals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns an explicitly degraded result within six seconds and recovers on the next refresh", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketSnapshot } = await import("@/lib/market-service");
    let result: MarketSnapshot | undefined;
    void getMarketSnapshot().then((snapshot) => { result = snapshot; });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(result).toMatchObject({ status: "degraded", stale: true });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);

    const recoveredFetch = vi.fn((input: string) => Promise.resolve(healthyResponse(input)));
    vi.stubGlobal("fetch", recoveredFetch);
    const recovered = await getMarketSnapshot({ forceRefresh: true });
    expect(recovered).toMatchObject({ status: "live", stale: false, unavailablePairs: [] });
    expect(recovered.pairs.usdtIls.price).toBe(3.25);
    expect(recoveredFetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back immediately on HTTP failures and reuses healthy cached results", async () => {
    const fetchMock = vi.fn((input: string) => Promise.resolve(isPrimaryProvider(input)
      ? { ok: false, status: 503 } as Response
      : healthyResponse(input)));
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketSnapshot } = await import("@/lib/market-service");
    const result = await getMarketSnapshot();

    expect(result).toMatchObject({ status: "live", stale: false });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(await getMarketSnapshot()).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });
});
