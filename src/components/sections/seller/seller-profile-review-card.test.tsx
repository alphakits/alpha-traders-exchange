import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { publicAccountId } from "@/lib/public-account-identity";
import type { SellerProfileReviewEntry } from "@/types/alpha-exchange";
import { SellerProfileReviewCard } from "./seller-profile-review-card";

afterEach(cleanup);

const review: SellerProfileReviewEntry = {
  id: "review-one", tradeId: "trade-one", buyerId: "buyer-one", buyerName: "AT-123456",
  rating: 5, comment: "Fast reliable service", createdAt: "2026-09-21T12:00:00.000Z",
  verifiedPurchase: true,
  sellerResponse: { responderUserId: "seller-one", message: "Thank you for the review.", createdAt: "2026-09-21T13:00:00.000Z" },
};

describe("public seller review cards", () => {
  it("renders the buyer's public identity and the actual public review response", () => {
    const { container } = render(<SellerProfileReviewCard review={review} locale="en" />);
    expect(screen.getByRole("article", { name: "Review by AT-123456" })).toBeTruthy();
    expect(screen.getByText("AT-123456")).toBeTruthy();
    expect(screen.getByRole("img", { name: "5 out of 5 stars" })).toBeTruthy();
    expect(screen.getByText("Verified trade")).toBeTruthy();
    expect(screen.getByText("Thank you for the review.")).toBeTruthy();
    expect(container.querySelector("time")?.dateTime).toBe(review.createdAt);
    expect(container.textContent).not.toMatch(/undefined|Trade amount|Trade date/);
  });

  it.each(["Legacy Private Name", "#B-123456", "#S-123456"])("safely handles historical identity %s", (buyerName) => {
    const expected = buyerName.startsWith("#") ? "AT-123456" : publicAccountId({ id: review.buyerId });
    const { container } = render(<SellerProfileReviewCard review={{ ...review, buyerName }} locale="en" />);
    expect(screen.getByRole("article", { name: `Review by ${expected}` })).toBeTruthy();
    expect(container.innerHTML).not.toContain(buyerName);
  });

  it("hides moderated reviews even in an authorized owner's projection", () => {
    const { container } = render(<SellerProfileReviewCard review={{ ...review, hidden: true }} locale="en" />);
    expect(container.innerHTML).toBe("");
  });

  it("supports Arabic reviews without inventing missing dates, ratings or trade verification", () => {
    const { container } = render(<SellerProfileReviewCard review={{ ...review, comment: "خدمة ممتازة وسريعة", rating: Number.NaN, createdAt: "", verifiedPurchase: false, sellerResponse: undefined }} locale="ar" />);
    expect(screen.getByRole("article").dir).toBe("rtl");
    expect(screen.getByText("خدمة ممتازة وسريعة")).toBeTruthy();
    expect(screen.getByRole("img", { name: "0 من 5 نجوم" })).toBeTruthy();
    expect(container.querySelector("time")).toBeNull();
    expect(container.textContent).not.toMatch(/Invalid Date|undefined|NaN|صفقة موثقة/);
  });
});
