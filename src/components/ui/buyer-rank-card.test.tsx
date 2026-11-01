import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { deriveBuyerRankSummary } from "@/lib/buyer-rank";
import { BuyerRankCard } from "./buyer-rank-card";

afterEach(cleanup);
const summaryFor = (volume: number) => deriveBuyerRankSummary({ lifetimeCompletedVolumeUsdt: volume, completedTrades: 1, activeTrades: 0, reviewsGiven: 1 });

describe("buyer rank card", () => {
  it.each(["en", "ar"] as const)("shows earned Silver Buyer progress at 15,000 USDT in %s", locale => {
    const { container } = render(<BuyerRankCard locale={locale} summary={summaryFor(15_000)} />);
    expect(screen.getByRole("heading", { name: locale === "ar" ? "مشتري فضي" : "Silver Buyer" })).toBeTruthy();
    expect(container.textContent).toContain("15,000 USDT");
    expect(container.textContent).toContain("35,000 USDT");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("does not display an unearned Bronze rank or zero total while loading or after failure", () => {
    const { container, rerender } = render(<BuyerRankCard locale="en" />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Bronze Buyer")).toBeNull();
    expect(container.textContent).not.toContain("0 USDT");
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<BuyerRankCard locale="en" error />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("could not be loaded");
  });

  it("labels retained progress when refresh fails and does not claim 100% before the threshold", () => {
    const { rerender } = render(<BuyerRankCard locale="en" summary={summaryFor(14_999)} error />);
    expect(screen.getByRole("heading", { name: "Bronze Buyer" })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("99");
    expect(screen.getByRole("status").textContent).toContain("last loaded progress");
    rerender(<BuyerRankCard locale="en" summary={summaryFor(500_000)} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("Top tier")).toBeTruthy();
  });
});
