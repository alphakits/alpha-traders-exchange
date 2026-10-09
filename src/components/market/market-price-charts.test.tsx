import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketPriceCharts } from "./market-price-charts";

function result(symbol = "ETHUSDT", stale = false) {
  const time = Math.floor(Date.now() / 300_000) * 300_000;
  return { chart: { symbol, interval: "5m", source: "Binance", stale, updatedAt: new Date().toISOString(), candles: [
    { time: time - 300_000, open: 2700, high: 2710, low: 2690, close: 2705 },
    { time, open: 2705, high: 2715, low: 2695, close: 2700 },
  ] } };
}
beforeEach(() => { vi.stubGlobal("WebSocket", undefined); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.ReactNativeWebView; });
const goodFetch = () => vi.fn(async (url: string) => ({ ok: true, json: async () => result(url.includes("BTCUSDT") ? "BTCUSDT" : "ETHUSDT") }));

describe("passive live five-minute charts", () => {
  it.each(["en", "ar"] as const)("shows both %s pairs without links, controls, iframes or native navigation", async (locale) => {
    vi.stubGlobal("fetch", goodFetch());
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    window.ReactNativeWebView = { postMessage: vi.fn() };
    const { container } = render(<MarketPriceCharts locale={locale} />);
    const chart = await screen.findByRole("img", { name: /BTC \/ USDT/ });
    await screen.findByRole("img", { name: /ETH \/ USDT/ });
    fireEvent.click(chart); fireEvent.touchStart(chart);
    expect(container.querySelector("a, button, iframe, [target], [href]")).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(window.ReactNativeWebView.postMessage).not.toHaveBeenCalled();
    expect(chart.getAttribute("data-candle-count")).toBe("2");
  });

  it("shares requests, pauses when hidden, and refreshes once per pair on return", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetchMock = goodFetch(); vi.stubGlobal("fetch", fetchMock);
    render(<><MarketPriceCharts locale="en" /><MarketPriceCharts locale="en" /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getAllByRole("status").every(element => element.textContent === "Delayed update")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => { visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("times out a stalled body and recovers automatically without a clickable chart", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketPriceCharts locale="en" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getAllByText("Chart temporarily unavailable")).toHaveLength(2);
    fetchMock.mockImplementation(goodFetch());
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
