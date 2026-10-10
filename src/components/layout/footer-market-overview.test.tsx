import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FooterMarketOverview } from "@/components/layout/footer-market-overview";
import type { MarketSnapshot } from "@/types/market";

const { useMarketFeedMock } = vi.hoisted(() => ({
  useMarketFeedMock: vi.fn(),
}));

vi.mock("@/components/market/use-market-feed", () => ({
  useMarketFeed: useMarketFeedMock,
}));

const snapshot: MarketSnapshot = {
  status: "live",
  updatedAt: "2026-08-27T10:00:00.000Z",
  stale: false,
  unavailablePairs: [],
  pairs: {
    btcUsdt: { key: "btcUsdt", label: "BTC / USDT", price: 101234.56, changePercent: 2.35, source: "test" },
    ethUsdt: { key: "ethUsdt", label: "ETH / USDT", price: 3456.78, changePercent: -1.2, source: "test" },
    usdtIls: { key: "usdtIls", label: "USDT / ILS", price: 3.64, changePercent: 0, source: "WISE:USDILS", quoteStatus: "live", quotedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString() },
  },
};

beforeEach(() => {
  useMarketFeedMock.mockReset();
  useMarketFeedMock.mockReturnValue({
    snapshot,
    isLoading: false,
    error: null,
    hasLiveFeed: true,
    refresh: vi.fn(),
  });
});

afterEach(cleanup);

describe("FooterMarketOverview", () => {
  it.each(["en", "ar"] as const)("distinguishes normal FX closure from degraded data in %s", (locale) => {
    const closed: MarketSnapshot = {
      ...snapshot, status: "degraded",
      pairs: { ...snapshot.pairs, usdtIls: { ...snapshot.pairs.usdtIls, quoteStatus: "closed" } },
    };
    useMarketFeedMock.mockReturnValue({ snapshot: closed, isLoading: false, error: null });
    render(<FooterMarketOverview locale={locale} />);
    expect(screen.getAllByText(locale === "ar" ? "إغلاق USD/ILS" : "USD/ILS closed")).toHaveLength(2);
    expect(screen.queryByText(locale === "ar" ? "متدهور" : "Degraded")).toBeNull();
    expect(screen.queryByText(locale === "ar" ? "مباشر" : "LIVE")).toBeNull();
  });

  it.each(["expired", "stale", "missing crypto", "zero crypto", "fetch error"])("keeps the warning during FX closure with %s", (failure) => {
    const closed: MarketSnapshot = {
      ...snapshot, status: "degraded", stale: failure === "stale",
      unavailablePairs: failure === "missing crypto" ? ["ethUsdt"] : [],
      pairs: {
        ...snapshot.pairs,
        btcUsdt: { ...snapshot.pairs.btcUsdt, price: failure === "zero crypto" ? 0 : snapshot.pairs.btcUsdt.price },
        usdtIls: {
          ...snapshot.pairs.usdtIls, quoteStatus: "closed",
          validUntil: new Date(Date.now() + (failure === "expired" ? -1_000 : 60_000)).toISOString(),
        },
      },
    };
    useMarketFeedMock.mockReturnValue({ snapshot: closed, isLoading: false, error: failure === "fetch error" ? "unavailable" : null });
    render(<FooterMarketOverview locale="en" />);
    expect(screen.getAllByText("Degraded")).toHaveLength(2);
    expect(screen.queryByText("USD/ILS closed")).toBeNull();
  });

  it("renders the current feed values instead of hardcoded footer prices", () => {
    render(<FooterMarketOverview locale="en" />);

    expect(useMarketFeedMock).toHaveBeenCalledWith();
    expect(screen.getByText("$101,234.56")).toBeTruthy();
    expect(screen.getByText("$3,456.78")).toBeTruthy();
    expect(screen.getByText("₪3.64000")).toBeTruthy();
    expect(screen.getByText("+2.35%")).toBeTruthy();
    expect(screen.getByText("-1.20%")).toBeTruthy();
    expect(screen.getByText("0.00%")).toBeTruthy();
    expect(screen.queryByText("$118,000")).toBeNull();
  });

  it("keeps all pair text visible and directionally stable on narrow and Arabic layouts", () => {
    render(<FooterMarketOverview locale="ar" />);

    const pairLabel = screen.getByText((_, element) => element?.tagName === "BDI" && element.textContent === "USDT / ILS");
    const row = pairLabel.closest("div");
    expect(pairLabel.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("₪3.64000").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(row?.className).toContain("flex-wrap");
    expect(row?.className).not.toContain("truncate");
    expect(screen.getAllByText("مباشر").length).toBeGreaterThan(0);
  });

  it("does not claim the feed is live when the snapshot is stale", () => {
    useMarketFeedMock.mockReturnValue({
      snapshot: { ...snapshot, stale: true },
      isLoading: false,
      error: "Market feed unavailable",
      hasLiveFeed: true,
      refresh: vi.fn(),
    });

    render(<FooterMarketOverview locale="en" />);

    expect(screen.getAllByText("Degraded").length).toBeGreaterThan(0);
    expect(screen.queryByText("LIVE")).toBeNull();
  });
});
