import { describe, expect, it } from "vitest";
import {
  currencyPriceFromUsdInput,
  priceForUsdInput,
} from "./financial-display";

describe("native USD offer input", () => {
  it("round-trips every canonical ILS-cent boundary used by Make Offer", () => {
    const usdIlsRate = 3.05;

    for (const ilsPrice of ["3.25", "3.23", "2.91"]) {
      const usdInput = priceForUsdInput(ilsPrice, "ILS", usdIlsRate);
      expect(currencyPriceFromUsdInput(usdInput, "ILS", usdIlsRate)).toBe(ilsPrice);
    }
  });

  it("canonicalizes a USD input before server validation and submission", () => {
    expect(currencyPriceFromUsdInput("1.059", "ILS", 3.05)).toBe("3.23");
    expect(currencyPriceFromUsdInput("0.9541", "ILS", 3.05)).toBe("2.91");
  });
});
