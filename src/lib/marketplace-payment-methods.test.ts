import { describe, expect, it } from "vitest";
import { getDefaultListingPaymentMethods, getMarketplacePaymentMethodOptions, normalizeMarketplacePaymentMethod } from "./marketplace-payment-methods";

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

  it("recognizes the seller-application cardless label and Arabic aliases", () => {
    expect(normalizeMarketplacePaymentMethod("Cardless Withdrawal")).toBe("Cardless ATM Withdrawal");
    expect(normalizeMarketplacePaymentMethod("سحب من الصراف دون بطاقة")).toBe("Cardless ATM Withdrawal");
    expect(normalizeMarketplacePaymentMethod("لقاء شخصي")).toBe("Face-to-Face (Meet in Person)");
  });

  it("uses approved seller preferences as the new-listing defaults", () => {
    expect(getDefaultListingPaymentMethods(["Cardless Withdrawal", "Face-to-Face"])).toEqual([
      "Cardless ATM Withdrawal",
      "Face-to-Face (Meet in Person)",
    ]);
    expect(getDefaultListingPaymentMethods([])).toEqual(["Bank Transfer"]);
  });
});
