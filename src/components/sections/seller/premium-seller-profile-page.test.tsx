import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; locale?: string }) => {
    void locale;
    return <a href={href} {...props} />;
  },
}));

import { SellerListingPurchaseAction } from "./premium-seller-profile-page";

describe("SellerListingPurchaseAction", () => {
  it("links a buyer to the exact listing purchase flow", () => {
    render(<SellerListingPurchaseAction locale="ar" listingId="listing-123" />);

    expect(screen.getByRole("link", { name: "شراء" }).getAttribute("href"))
      .toBe("/usdt-exchange?listing=listing-123");
  });

  it("links the listing owner to listing management instead of buying their own offer", () => {
    render(<SellerListingPurchaseAction locale="en" listingId="listing-123" viewerOwnsProfile />);

    expect(screen.getByRole("link", { name: "Manage listing" }).getAttribute("href"))
      .toBe("/dashboard/seller#my-listings-section");
  });
});
