import type { AnchorHTMLAttributes } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemandPublicIdentity } from "@/types/usdt-demand";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale: string }) => <a href={`/${locale}${href}`} {...props} />,
}));

import { RequestCounterpartyIdentity } from "./request-counterparty-identity";

const buyer: DemandPublicIdentity = {
  displayName: "AT-123456", accountId: "AT-123456", profileHref: "/u/seller-abc12345",
  approvedSeller: false, sellerRank: null, completedPurchases: 5000,
  buyerProgress: { rank: "gold", nextRank: "diamond", progressPercent: 42.5 },
};

afterEach(cleanup);

describe("request counterparty identity", () => {
  it("links the exact server profile in a separate tab without duplicating the account ID", () => {
    render(<RequestCounterpartyIdentity identity={buyer} locale="en" audience="buyer" />);
    expect(screen.getAllByText("AT-123456")).toHaveLength(1);
    const link = screen.getByRole("link", { name: "View profile: AT-123456 (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("/en/u/seller-abc12345");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("5,000").parentElement?.textContent).toBe("5,000 completed purchases");
    expect(screen.getByText("Gold Buyer")).toBeTruthy();
    expect(screen.getByText("Next: Diamond Buyer")).toBeTruthy();
    const progress = screen.getByRole("progressbar", { name: "Buyer rank progress" });
    expect(progress.getAttribute("aria-valuenow")).toBe("42.5");
    expect(progress.getAttribute("aria-valuetext")).toBe("42.5% toward Diamond Buyer");
  });

  it("shows a distinct server-projected public name beside its account ID", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, displayName: "Example Trading", completedPurchases: 1 }} locale="en" audience="buyer" />);
    expect(screen.getByText("Example Trading")).toBeTruthy();
    expect(screen.getByText("AT-123456")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View profile: Example Trading (AT-123456) (opens in a new tab)" })).toBeTruthy();
    expect(screen.getByText("1").parentElement?.textContent).toBe("1 completed purchase");
  });

  it("keeps buyer progress distinct from the approved seller's earned selling rank", () => {
    const seller = { ...buyer, approvedSeller: true, sellerRank: "gold" as const };
    const view = render(<RequestCounterpartyIdentity identity={seller} locale="en" audience="seller" />);
    expect(screen.getByText("Approved Seller")).toBeTruthy();
    expect(screen.getByText("Gold Seller")).toBeTruthy();
    expect(screen.getByText("5,000")).toBeTruthy();
    expect(screen.getByText("Gold Buyer")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Buyer rank progress" })).toBeTruthy();
    view.rerender(<RequestCounterpartyIdentity identity={{ ...seller, approvedSeller: false }} locale="en" audience="seller" />);
    expect(screen.queryByText("Approved Seller")).toBeNull();
    expect(screen.queryByText("Gold Seller")).toBeNull();
    expect(screen.getByText("Gold Buyer")).toBeTruthy();
  });

  it("keeps seller rank and completed purchases visible when an approved seller is buying", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, approvedSeller: true, sellerRank: "diamond" }} locale="en" audience="buyer" />);
    expect(screen.getByText("Diamond Seller")).toBeTruthy();
    expect(screen.getByText("5,000")).toBeTruthy();
    expect(screen.getByText("Gold Buyer")).toBeTruthy();
  });

  it("does not invent a bronze rank when an approved seller rank is unavailable", () => {
    const { container } = render(<RequestCounterpartyIdentity identity={{ ...buyer, approvedSeller: true, sellerRank: null }} locale="en" audience="seller" />);
    expect(screen.getByText("Approved Seller")).toBeTruthy();
    expect(screen.queryByText("Bronze Seller")).toBeNull();
    expect(container.querySelector("[data-profile-rank]")).toBeNull();
  });

  it.each([null, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("does not turn unavailable or invalid purchase history %s into a fabricated count", completedPurchases => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, completedPurchases }} locale="en" audience="buyer" />);
    expect(screen.queryByText(/completed purchase/)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("Gold Buyer")).toBeNull();
  });

  it("shows a verified zero purchase count without implying missing history", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, completedPurchases: 0, buyerProgress: { rank: "bronze", nextRank: "silver", progressPercent: 0 } }} locale="en" audience="buyer" />);
    expect(screen.getByText("0").parentElement?.textContent).toBe("0 completed purchases");
    expect(screen.getByText("Bronze Buyer")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("Next: Silver Buyer")).toBeTruthy();
  });

  it("does not invent a buyer rank when the public projection omits progress", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, buyerProgress: null }} locale="en" audience="seller" />);
    expect(screen.getByText("5,000")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Bronze Buyer|Gold Buyer/)).toBeNull();
  });

  it("shows a completed top buyer tier without inventing a next rank", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, buyerProgress: { rank: "elite", nextRank: null, progressPercent: 100 } }} locale="en" audience="seller" />);
    expect(screen.getByText("Elite Buyer")).toBeTruthy();
    expect(screen.getByText("Highest buyer rank reached")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.queryByText(/Next:/)).toBeNull();
  });

  it("uses the earned rank when rounded progress reaches 100 before the next tier", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, buyerProgress: { rank: "bronze", nextRank: "silver", progressPercent: 100 } }} locale="en" audience="buyer" />);
    expect(screen.getByText("Bronze Buyer")).toBeTruthy();
    expect(screen.getByText("Next: Silver Buyer")).toBeTruthy();
    expect(screen.queryByText("Highest buyer rank reached")).toBeNull();
    expect(screen.queryByText("Silver Buyer", { exact: true })).toBeNull();
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("does not display invalid buyer progress %s", progressPercent => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, buyerProgress: { rank: "silver", nextRank: "gold", progressPercent } }} locale="en" audience="buyer" />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("Silver Buyer")).toBeNull();
    expect(screen.getByText("5,000")).toBeTruthy();
  });

  it("keeps approved seller identity but hides buyer activity when public statistics are private", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, approvedSeller: true, sellerRank: "silver", completedPurchases: null, buyerProgress: null }} locale="en" audience="seller" />);
    expect(screen.getByText("Approved Seller")).toBeTruthy();
    expect(screen.getByText("Silver Seller")).toBeTruthy();
    expect(screen.getByRole("link")).toBeTruthy();
    expect(screen.queryByText(/completed purchase/)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it.each([null, "javascript:alert(1)", "https://outside.example/profile", "//outside.example/profile", "/u/name?email=private", "/profile"])("never fabricates a destination from an absent or unexpected profile link %s", profileHref => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, profileHref }} locale="en" audience="buyer" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("AT-123456")).toBeTruthy();
  });

  it("preserves Arabic labels, locale, account direction, and grouped purchase counts", () => {
    render(<RequestCounterpartyIdentity identity={{ ...buyer, displayName: "متجر تجريبي", approvedSeller: true, sellerRank: "silver" }} locale="ar" audience="buyer" />);
    const link = screen.getByRole("link", { name: "عرض الملف: متجر تجريبي (AT-123456) (يفتح في علامة تبويب جديدة)" });
    expect(link.getAttribute("href")).toBe("/ar/u/seller-abc12345");
    expect(screen.getByText("متجر تجريبي").getAttribute("dir")).toBe("auto");
    expect(screen.getByText("AT-123456").getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("5,000").parentElement?.textContent).toBe("5,000 عملية شراء مكتملة");
    expect(screen.getByText("بائع فضي")).toBeTruthy();
    expect(screen.getByText("مشتري ذهبي")).toBeTruthy();
    expect(screen.getByText("التالي: مشتري ماسي")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "تقدم رتبة المشتري" }).getAttribute("aria-valuetext")).toBe("42.5% نحو مشتري ماسي");
  });

  it("renders projected text safely without deriving contacts from extra fields", () => {
    const identity = { ...buyer, displayName: "<img src=x onerror=alert(1)>", email: "private@example.test", whatsappNumber: "+972501234567" };
    const { container } = render(<RequestCounterpartyIdentity identity={identity} locale="en" audience="buyer" />);
    expect(screen.getByText(identity.displayName)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain(identity.email);
    expect(container.textContent).not.toContain(identity.whatsappNumber);
  });
});
