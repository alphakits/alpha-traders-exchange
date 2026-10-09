// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "@/types/market";

function healthyResponse(url: string) {
  const payload = url.includes("fx.example")
    ? { base: "USD", quote: "ILS", symbol: "SAXO:USDILS", price: 3.25, quotedAt: new Date().toISOString(), marketState: "open" }
    : url.includes("BTC")
      ? { price: "81000", data: { amount: "81000" } }
      : { price: "2700", data: { amount: "2700" } };
  return { ok: true, json: async () => payload } as Response;
}

function isPrimaryProvider(url: string) {
  return url.includes("fx.example") || url.includes("binance");
}

describe("market provider reliability", () => {
  it("shares the exact display quote with listing validation and rejects a lost FX feed", async () => {
    const fetchMock = vi.fn((input: string) => Promise.resolve(healthyResponse(input)));
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketSnapshot, getUsdtIlsReferenceRate } = await import("@/lib/market-service");
    const snapshot = await getMarketSnapshot();
    expect(await getUsdtIlsReferenceRate()).toBe(snapshot.pairs.usdtIls.price);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockImplementation((input: string) => Promise.resolve(input.includes("fx.example") ? { ok: false } as Response : healthyResponse(input)));
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(getUsdtIlsReferenceRate()).rejects.toThrow("out of date");
    const failed = await getMarketSnapshot();
    expect(failed.pairs.usdtIls).toMatchObject({ price: 3.25, quotedAt: snapshot.pairs.usdtIls.quotedAt, quoteStatus: "stale" });
  });

  it("does not block a valid FX quote just because crypto is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string) => Promise.resolve(input.includes("fx.example") ? healthyResponse(input) : { ok: false } as Response)));
    const { getMarketSnapshot, getUsdtIlsReferenceRate } = await import("@/lib/market-service");
    expect((await getMarketSnapshot()).stale).toBe(true);
    expect(await getUsdtIlsReferenceRate()).toBe(3.25);
  });

  it("does not label FX live after it expires while waiting for crypto", async () => {
    const quotedAt = new Date(Date.now() - 59_000).toISOString();
    vi.stubGlobal("fetch", vi.fn((input: string) => Promise.resolve(input.includes("fx.example")
      ? { ok: true, json: async () => ({ base: "USD", quote: "ILS", symbol: "SAXO:USDILS", price: 3.05272, quotedAt, marketState: "open" }) } as Response
      : { ok: true, json: () => new Promise((resolve) => setTimeout(() => resolve({ price: input.includes("BTC") ? "81000" : "2700" }), 2_000)) } as Response)));
    const { getMarketSnapshot, getUsdtIlsReferenceRate } = await import("@/lib/market-service");
    const pending = getMarketSnapshot();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toMatchObject({ status: "degraded", unavailablePairs: ["usdtIls"] });
    await expect(getUsdtIlsReferenceRate()).rejects.toThrow("out of date");
  });

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("ALPHA_EXCHANGE_USD_ILS_RATE", "");
    vi.stubEnv("ALPHA_FX_REFERENCE_URL", "https://fx.example/quote");
    vi.stubEnv("ALPHA_FX_REFERENCE_SYMBOL", "SAXO:USDILS");
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

  it("bounds concurrent callers when FX stalls and uses crypto backup providers", async () => {
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
    expect(results[0]).toMatchObject({ status: "degraded", stale: true, unavailablePairs: ["usdtIls"] });
    expect(results[0].pairs.usdtIls.price).toBe(0);
    expect(primarySignals).toHaveLength(3);
    expect(primarySignals.every((signal) => signal.aborted)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
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

    expect(result).toMatchObject({ status: "degraded", stale: true, unavailablePairs: ["usdtIls"] });
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);

    const recoveredFetch = vi.fn((input: string) => Promise.resolve(healthyResponse(input)));
    vi.stubGlobal("fetch", recoveredFetch);
    const recovered = await getMarketSnapshot({ forceRefresh: true });
    expect(recovered).toMatchObject({ status: "live", stale: false, unavailablePairs: [] });
    expect(recovered.pairs.usdtIls.price).toBe(3.25);
    expect(recoveredFetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks unavailable FX on HTTP failure and briefly caches failures without substituting another source", async () => {
    const fetchMock = vi.fn((input: string) => Promise.resolve(isPrimaryProvider(input)
      ? { ok: false, status: 503 } as Response
      : healthyResponse(input)));
    vi.stubGlobal("fetch", fetchMock);
    const { getMarketSnapshot } = await import("@/lib/market-service");
    const result = await getMarketSnapshot();

    expect(result).toMatchObject({ status: "degraded", stale: true, unavailablePairs: ["usdtIls"] });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(await getMarketSnapshot()).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
