import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlphaMarketCenterView } from "@/components/market/alpha-market-center";
import type { MarketSnapshot } from "@/types/market";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const snapshot: MarketSnapshot = {
  status: "live",
  updatedAt: new Date().toISOString(),
  stale: false,
  unavailablePairs: [],
  pairs: {
    ethUsdt: { key: "ethUsdt", label: "ETH/USDT", price: 3200, changePercent: 1, source: "test" },
    btcUsdt: { key: "btcUsdt", label: "BTC/USDT", price: 100000, changePercent: 2, source: "test" },
    usdtIls: { key: "usdtIls", label: "USDT/ILS", price: 3.6, changePercent: 0, source: "test" },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AlphaMarketCenterView", () => {
  it("renders a supplied feed without starting another market request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <AlphaMarketCenterView
        locale="en"
        snapshot={snapshot}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText("Alpha Market Center")).toBeTruthy();
    expect(screen.getByText("$100,000")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
