import { describe, expect, it, vi } from "vitest";
import { DEFAULT_USD_ILS_MARKET_RATE, fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";

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

  it("falls back to the configured default when the live rate is implausible", async () => {
    const originalFetch = global.fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { ILS: 3.0695 } }),
    }) as unknown as typeof fetch);

    try {
      const rate = await fetchUsdIlsMarketRate();
      expect(rate).toBe(DEFAULT_USD_ILS_MARKET_RATE);
    } finally {
      vi.unstubAllGlobals();
      if (originalFetch) {
        global.fetch = originalFetch;
      }
    }
  });
});
