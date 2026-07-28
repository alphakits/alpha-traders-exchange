import { describe, expect, it } from "vitest";
import { getListingPriceValidationError } from "@/lib/listing-price-validation";

describe("listing price validation", () => {
  it("allows ILS prices at the configured cap", () => {
    const error = getListingPriceValidationError({ price: "39.55", currency: "ILS", marketRate: 39.2 });
    expect(error).toBeNull();
  });

  it("rejects ILS prices above the configured cap", () => {
    const error = getListingPriceValidationError({ price: "39.56", currency: "ILS", marketRate: 39.2 });
    expect(error).toContain("39.55");
  });

  it("does not enforce a cap for non-ILS currencies", () => {
    const error = getListingPriceValidationError({ price: "5000", currency: "USD", marketRate: 39.2 });
    expect(error).toBeNull();
  });
});
