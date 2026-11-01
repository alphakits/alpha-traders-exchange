import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SellerRankCard, type SellerRankSummary } from "./seller-rank-card";

afterEach(cleanup);
const summary: SellerRankSummary = { sellerLevel: "silver", nextLevel: "gold", lifetimeCompletedVolumeUsdt: 38_000, amountToNextLevelUsdt: 12_000, progressToNextLevelPercent: 65.71 };
describe("seller rank card", () => {
  it.each(["en", "ar"] as const)("shows own sales, remaining volume and earned rank in %s", locale => {
    const { container } = render(<SellerRankCard summary={summary} locale={locale} />);
    expect(screen.getByRole("heading", { name: locale === "ar" ? "بائع فضي" : "Silver Seller" })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("66");
    expect(container.textContent).toContain("38,000 USDT");
    expect(container.textContent).toContain("12,000 USDT");
    expect(container.querySelectorAll(".currency-usdt")).toHaveLength(2);
    expect(screen.getByText(locale === "ar" ? "بائع ذهبي" : "Gold Seller")).toBeTruthy();
  });
  it("does not invent zero sales while loading or after a failed initial read", () => {
    const { container, rerender } = render(<SellerRankCard locale="en" />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toContain("0 USDT");
    rerender(<SellerRankCard locale="en" error />);
    expect(screen.getByRole("status").textContent).toContain("could not be loaded");
  });
  it("handles the highest rank and never claims a promotion before its threshold", () => {
    const { rerender } = render(<SellerRankCard locale="en" summary={{ ...summary, amountToNextLevelUsdt: 1, progressToNextLevelPercent: 99.99 }} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("99");
    rerender(<SellerRankCard locale="en" summary={{ sellerLevel: "elite", lifetimeCompletedVolumeUsdt: 510_000, amountToNextLevelUsdt: 0, progressToNextLevelPercent: 100 }} />);
    expect(screen.getByText("Top tier reached")).toBeTruthy();
    expect(screen.queryByText("Next rank")).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
});
