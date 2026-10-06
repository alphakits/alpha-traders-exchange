import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketPriceCharts } from "./market-price-charts";

function result(symbol = "ETHUSDT", stale = false) {
  return { chart: { symbol, interval: "1h", source: "Binance", stale, updatedAt: new Date().toISOString(), candles: [
    { time: Date.now() - 3_600_000, open: 2700, high: 2710, low: 2690, close: 2705 },
    { time: Date.now(), open: 2705, high: 2715, low: 2695, close: 2700 },
  ] } };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.ReactNativeWebView; });

describe("charts stay inside Alpha Traders", () => {
  it.each(["en", "ar"] as const)("renders and switches %s charts in browsers and installed shells without external navigation", async (locale) => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => result(url.includes("BTCUSDT") ? "BTCUSDT" : "ETHUSDT") }));
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    for (const native of [false, true]) {
      if (native) window.ReactNativeWebView = { postMessage: vi.fn() };
      const { container } = render(<MarketPriceCharts locale={locale} />);
      const chart = await screen.findByRole("img", { name: /ETH\/USDT/ });
      fireEvent.click(chart);
      fireEvent.touchStart(chart);
      fireEvent.click(screen.getByRole("button", { name: "BTC/USDT" }));
      await screen.findByRole("img", { name: /BTC\/USDT/ });
      expect(container.querySelector("a, iframe, [target], [href]")).toBeNull();
      expect(open).not.toHaveBeenCalled();
      if (native) expect(window.ReactNativeWebView?.postMessage).not.toHaveBeenCalled();
      cleanup();
    }
    expect(fetchMock.mock.calls.every(([url]) => /^\/api\/market\/chart\?symbol=(ETH|BTC)USDT$/.test(url))).toBe(true);
  });

  it("retries an unavailable feed inside the chart without offering an external page", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => result() });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<MarketPriceCharts locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("img", { name: /ETH\/USDT/ });
    expect(container.querySelector("a, iframe")).toBeNull();
  });

  it("cancels the old symbol request and never displays its late response under a different pair", async () => {
    let finishEth!: (value: unknown) => void;
    const fetchMock = vi.fn((url: string) => url.includes("ETHUSDT")
      ? new Promise((resolve) => { finishEth = resolve; })
      : Promise.resolve({ ok: true, json: async () => result("BTCUSDT") }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketPriceCharts locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "BTC/USDT" }));
    await screen.findByRole("img", { name: /BTC\/USDT/ });
    await act(async () => finishEth({ ok: true, json: async () => result() }));
    expect(screen.queryByRole("img", { name: /ETH\/USDT/ })).toBeNull();
    expect(screen.getByRole("img", { name: /BTC\/USDT/ })).not.toBeNull();
  });

  it("labels cached prices as delayed and exposes keyboard focus on symbol controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => result("ETHUSDT", true) })));
    render(<MarketPriceCharts locale="en" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Delayed update"));
    const button = screen.getByRole("button", { name: "ETH/USDT" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("focus-visible:ring-2");
  });
});
