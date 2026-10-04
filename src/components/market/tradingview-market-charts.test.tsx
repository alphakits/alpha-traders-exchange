import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingViewMarketCharts } from "./tradingview-market-charts";

afterEach(() => {
  cleanup();
  delete window.ReactNativeWebView;
});

describe("market charts in browsers and installed apps", () => {
  it("keeps browser charts embedded and switches the requested symbol", () => {
    const { container } = render(<TradingViewMarketCharts locale="en" />);
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("BINANCE%3AETHUSDT");
    fireEvent.click(screen.getByRole("button", { name: "BTC/USDT" }));
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("BINANCE%3ABTCUSDT");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it.each(["en", "ar"] as const)("avoids unsolicited browser opening in installed %s apps while preserving deliberate chart access", (locale) => {
    window.ReactNativeWebView = { postMessage: vi.fn() };
    const { container } = render(<TradingViewMarketCharts locale={locale} />);
    expect(container.querySelector("iframe")).toBeNull();
    const link = screen.getByRole("link", { name: locale === "ar" ? "فتح المخطط في المتصفح" : "Open chart in browser" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin).toBe("https://s.tradingview.com");
    expect(url.searchParams.get("symbol")).toBe("BINANCE:ETHUSDT");
    expect(url.searchParams.get("locale")).toBe(locale === "ar" ? "ar_AE" : "en");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    fireEvent.click(screen.getByRole("button", { name: "BTC/USDT" }));
    expect(new URL(link.getAttribute("href")!).searchParams.get("symbol")).toBe("BINANCE:BTCUSDT");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
