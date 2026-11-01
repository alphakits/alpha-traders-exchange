import { describe, expect, it } from "vitest";
import { getListingPriceValidationError } from "@/lib/listing-price-validation";
import { maximumIlsListingPrice } from "@/lib/fx-reference-policy";

describe("listing price validation", () => {
  it("allows the exact cap and rejects the next cent", () => {
    expect(getListingPriceValidationError({ price: "3.35", currency: "ILS", marketRate: 3 })).toBeNull();
    expect(getListingPriceValidationError({ price: "3.36", currency: "ILS", marketRate: 3 })).toContain("3.35");
  });
  it("floors fractional ceilings so the displayed maximum is always accepted", () => {
    for (const rate of [3.05437, 3.05827, 3.068082]) {
      const cap = maximumIlsListingPrice(rate);
      expect(getListingPriceValidationError({ price: cap.toFixed(2), marketRate: rate })).toBeNull();
      expect(getListingPriceValidationError({ price: (cap + .01).toFixed(2), marketRate: rate })).toContain(cap.toFixed(2));
      expect(cap).toBeLessThanOrEqual(rate + .35);
    }
    expect(maximumIlsListingPrice(3.05827)).toBe(3.40);
  });
  it.each([undefined, null, 0, NaN, Infinity, -3, 1.5, 11])("rejects missing/invalid reference %s", (marketRate) => {
    expect(getListingPriceValidationError({ price: "3.20", marketRate })).toContain("out of date");
  });
  it.each(["-3.2", "1e300", "bad3.2"])("rejects invalid price %s without stripping its sign or junk", (price) => {
    expect(getListingPriceValidationError({ price, marketRate: 3 })).not.toBeNull();
  });
  it("preserves unrelated currency and non-price update behavior", () => {
    expect(getListingPriceValidationError({ price: "5000", currency: "USD", marketRate: 3 })).toBeNull();
    expect(getListingPriceValidationError({ price: "", currency: "ILS" })).toBeNull();
  });
});
