import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
    usdtIls: { key: "usdtIls", label: "USDT/ILS", price: 3.6, changePercent: 0, source: "SAXO:USDILS", quoteStatus: "live", quotedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString() },
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AlphaMarketCenterView", () => {
  it.each(["en", "ar"] as const)("never labels a failed or stale %s feed as live", (locale) => {
    const props = { locale, isLoading: false, error: "Market feed unavailable" };
    const { rerender } = render(<AlphaMarketCenterView {...props} snapshot={snapshot} />);
    const delayed = locale === "ar" ? "تحديث متأخر" : "Delayed update";
    const live = locale === "ar" ? "مباشر" : "LIVE";
    expect(screen.queryByText(live, { exact: true })).toBeNull();
    expect(screen.getAllByText(delayed, { exact: true })).toHaveLength(2);
    expect(screen.getByText("$100,000")).toBeTruthy();
    rerender(<AlphaMarketCenterView {...props} error={null} snapshot={{ ...snapshot, stale: true }} />);
    expect(screen.queryByText(live, { exact: true })).toBeNull();
    expect(screen.getAllByText(delayed, { exact: true })).toHaveLength(2);
    rerender(<AlphaMarketCenterView {...props} error={null} snapshot={snapshot} />);
    expect(screen.getAllByText(live, { exact: true })).toHaveLength(2);
    expect(screen.queryByText(delayed)).toBeNull();
  });

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

  it("isolates financial values and market symbols in the Arabic layout", () => {
    const { container } = render(
      <AlphaMarketCenterView
        locale="ar"
        snapshot={snapshot}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText("مركز ألفا للسوق")).toBeTruthy();
    expect(screen.getByText("$100,000").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText((_, element) => element?.tagName === "BDI" && element.textContent === "BTC/USDT").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(container.querySelectorAll('bdi[dir="ltr"]').length).toBeGreaterThan(5);
  });
});
