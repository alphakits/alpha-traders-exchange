import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    usdtIls: { key: "usdtIls", label: "USDT / ILS", price: 3.64, changePercent: 0, source: "test" },
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

describe("FooterMarketOverview", () => {
  it("renders the current feed values instead of hardcoded footer prices", () => {
    render(<FooterMarketOverview locale="en" />);

    expect(useMarketFeedMock).toHaveBeenCalledWith({ refreshMs: 45_000 });
    expect(screen.getByText("$101,234.56")).toBeTruthy();
    expect(screen.getByText("$3,456.78")).toBeTruthy();
    expect(screen.getByText("₪3.64")).toBeTruthy();
    expect(screen.getByText("+2.35%")).toBeTruthy();
    expect(screen.getByText("-1.20%")).toBeTruthy();
    expect(screen.getByText("0.00%")).toBeTruthy();
    expect(screen.queryByText("$118,000")).toBeNull();
  });

  it("keeps all pair text visible and directionally stable on narrow and Arabic layouts", () => {
    render(<FooterMarketOverview locale="ar" />);

    const pairLabel = screen.getByText("USDT / ILS");
    const row = pairLabel.closest("div");
    expect(pairLabel.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("₪3.64").closest("bdi")?.getAttribute("dir")).toBe("ltr");
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
