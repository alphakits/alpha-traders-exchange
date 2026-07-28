import { describe, expect, it } from "vitest";
import { createDefaultSellerListingDraft, normalizeSellerListingDraft, readSellerListingDraft } from "./seller-listing-draft";

describe("seller listing draft helpers", () => {
  it("normalizes values and preserves a safe default", () => {
    const fallback = createDefaultSellerListingDraft();
    const draft = normalizeSellerListingDraft({ availableAmount: "100", price: "1.25", currency: "ILS", network: "TRC20", paymentMethods: "Bank transfer", minimumTrade: "10", maximumTrade: "100" }, fallback);

    expect(draft).toEqual({
      availableAmount: "100",
      price: "1.25",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: "Bank transfer",
      minimumTrade: "10",
      maximumTrade: "100",
    });
  });

  it("falls back to the default when localStorage is empty", () => {
    const fallback = createDefaultSellerListingDraft();
    expect(readSellerListingDraft("seller@example.com", fallback)).toEqual(fallback);
  });
});
