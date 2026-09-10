import { describe, expect, it } from "vitest";
import { getMarketplacePaymentMethodOptions } from "./marketplace-payment-methods";

describe("getMarketplacePaymentMethodOptions", () => {
  it("keeps cardless withdrawal visible when a seller did not enable it", () => {
    expect(getMarketplacePaymentMethodOptions([
      "Bank Transfer",
      "Face-to-Face (Meet in Person)",
    ])).toEqual([
      { method: "Bank Transfer", available: true },
      { method: "Face-to-Face (Meet in Person)", available: true },
      { method: "Cardless ATM Withdrawal", available: false },
    ]);
  });
});
