import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMarketFeed } from "./use-market-feed";
import { DEFAULT_MARKET_REFRESH_MS, MARKET_FEED_TIMEOUT_MS } from "@/lib/market-feed-client";
import type { MarketSnapshot } from "@/types/market";

function snapshot(price = 3.6): MarketSnapshot {
  return {
    status: "live", stale: false, updatedAt: new Date().toISOString(), unavailablePairs: [],
    pairs: {
      ethUsdt: { key: "ethUsdt", label: "ETH/USDT", price: 3200, changePercent: null, source: "test" },
      btcUsdt: { key: "btcUsdt", label: "BTC/USDT", price: 100000, changePercent: null, source: "test" },
      usdtIls: { key: "usdtIls", label: "USDT/ILS", price, changePercent: null, source: "test", quoteStatus: "live", quotedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString() },
    },
  };
}
const response = (price = 3.6) => ({ ok: true, json: async () => ({ snapshot: snapshot(price) }) });
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
function visibility(value: "visible" | "hidden") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(value);
  document.dispatchEvent(new Event("visibilitychange"));
}
function online(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("shared public market connection", () => {
  it("loads and refreshes the page and footer with one request each cycle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const page = renderHook(() => useMarketFeed());
    const footer = renderHook(() => useMarketFeed());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(page.result.current.snapshot).toBe(footer.result.current.snapshot);
    expect(page.result.current.hasLiveFeed).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_MARKET_REFRESH_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    page.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_MARKET_REFRESH_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    footer.unmount();
    await vi.advanceTimersByTimeAsync(DEFAULT_MARKET_REFRESH_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("joins a pending read and recovers after a stalled response body", async () => {
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_url, init) => {
      signal = init.signal;
      return Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderHook(() => useMarketFeed());
    renderHook(() => useMarketFeed());
    const first = page.result.current.refresh();
    expect(page.result.current.refresh()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_FEED_TIMEOUT_MS); });
    expect(signal.aborted).toBe(true);
    expect(page.result.current.isLoading).toBe(false);
    expect(page.result.current.error).toBeTruthy();
    fetchMock.mockResolvedValue(response());
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_MARKET_REFRESH_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.result.current.hasLiveFeed).toBe(true);
  });

  it("does no hidden or offline polling and resumes with one fresh request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const page = renderHook(() => useMarketFeed());
    renderHook(() => useMarketFeed());
    await settle();
    act(() => visibility("hidden"));
    expect(page.result.current.snapshot?.pairs.usdtIls.price).toBe(3.6);
    expect(page.result.current.snapshot?.stale).toBe(true);
    expect(page.result.current.hasLiveFeed).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * DEFAULT_MARKET_REFRESH_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => online(false));
    act(() => visibility("visible"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => online(true));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.result.current.hasLiveFeed).toBe(true);
    act(() => window.dispatchEvent(new Event("online")));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels an outgoing read and ignores its late result after resume", async () => {
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise(resolve => { finish = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderHook(() => useMarketFeed());
    act(() => visibility("hidden"));
    expect(signal.aborted).toBe(true);
    fetchMock.mockResolvedValue(response(3.8));
    act(() => visibility("visible"));
    await settle();
    await act(async () => { finish(response(3.1)); });
    expect(page.result.current.snapshot?.pairs.usdtIls.price).toBe(3.8);
    expect(page.result.current.error).toBeNull();
  });

  it("retains last confirmed prices on failure without claiming a live feed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const page = renderHook(() => useMarketFeed());
    await settle();
    fetchMock.mockResolvedValue({ ok: false });
    await act(async () => { await page.result.current.refresh(); });
    expect(page.result.current.snapshot?.pairs.usdtIls.price).toBe(3.6);
    expect(page.result.current.snapshot?.stale).toBe(true);
    expect(page.result.current.snapshot?.status).toBe("degraded");
    expect(page.result.current.hasLiveFeed).toBe(false);
    expect(page.result.current.error).toBeTruthy();
  });

  it("starts hidden without a request and releases an in-flight read on last unmount", async () => {
    visibility("hidden");
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderHook(() => useMarketFeed());
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => visibility("visible"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    page.unmount();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(DEFAULT_MARKET_REFRESH_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
