import { describe, expect, it } from "vitest";
import {
  MAX_PRICE_OFFER_DISCOUNT_ILS,
  getPriceOfferBounds,
  normalizePriceOfferInput,
  validatePriceOffer,
} from "@/lib/price-offer";

describe("buyer price offers", () => {
  it("keeps the negotiated range within the fixed ILS 0.35 limit", () => {
    expect(MAX_PRICE_OFFER_DISCOUNT_ILS).toBe(0.35);
    expect(getPriceOfferBounds("3.30")).toEqual({
      listingPrice: "3.30",
      minimumPrice: "2.95",
      maximumDiscount: "0.35",
    });
    expect(validatePriceOffer("3.30", "2.95")).toEqual({
      ok: true,
      listingPrice: "3.30",
      offeredPrice: "2.95",
      discount: "0.35",
    });
  });

  it("accepts any cent price inside the range and rejects both boundaries outside it", () => {
    expect(validatePriceOffer("3.30", "3.29")).toMatchObject({ ok: true, discount: "0.01" });
    expect(validatePriceOffer("3.30", "3.30")).toMatchObject({ ok: false, code: "PRICE_OFFER_NOT_LOWER" });
    expect(validatePriceOffer("3.30", "2.94")).toMatchObject({
      ok: false,
      code: "PRICE_OFFER_BELOW_MINIMUM",
      minimumPrice: "2.95",
    });
  });

  it("rejects malformed, zero, negative, and over-precise values", () => {
    for (const value of ["", "0", "-1", "3.001", "hello", "1.2.3"]) {
      expect(validatePriceOffer("3.30", value), value).toMatchObject({ ok: false, code: "PRICE_OFFER_INVALID_FORMAT" });
    }
  });

  it("normalizes phone and desktop input without allowing hidden precision", () => {
    expect(normalizePriceOfferInput("₪ 2.9999")).toBe("2.99");
    expect(normalizePriceOfferInput("3..2")).toBe("3.2");
  });
});
