import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_USD_ILS_MARKET_RATE, fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";

describe("listing price validation", () => {
  afterEach(() => {
    delete process.env.ALPHA_EXCHANGE_USD_ILS_RATE;
  });

  it("allows ILS prices at the configured cap", () => {
    const error = getListingPriceValidationError({ price: "3.35", currency: "ILS", marketRate: 3.0 });
    expect(error).toBeNull();
  });

  it("rejects ILS prices above the configured cap", () => {
    const error = getListingPriceValidationError({ price: "3.36", currency: "ILS", marketRate: 3.0 });
    expect(error).toContain("3.35");
  });

  it("does not enforce a cap for non-ILS currencies", () => {
    const error = getListingPriceValidationError({ price: "5000", currency: "USD", marketRate: 3.0 });
    expect(error).toBeNull();
  });

  it("uses the configured market reference rate when present", async () => {
    process.env.ALPHA_EXCHANGE_USD_ILS_RATE = "3.12";
    const rate = await fetchUsdIlsMarketRate();
    expect(rate).toBe(3.12);
    expect(rate).not.toBe(DEFAULT_USD_ILS_MARKET_RATE);
  });
});
