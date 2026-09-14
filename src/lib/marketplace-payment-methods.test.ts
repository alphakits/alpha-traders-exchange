import { describe, expect, it } from "vitest";
import {
  getDefaultListingPaymentMethods,
  getMarketplacePaymentMethodOptions,
  isBuyerEvidenceRequiredForPaymentMethod,
  isCashTradeCompletionAvailable,
  isSellerEvidenceRequiredForPaymentMethod,
  normalizeMarketplacePaymentMethod,
  requiresIsraeliBankSelection,
  requiresSellerPayoutBankAccount,
} from "./marketplace-payment-methods";

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

  it("does not require a payout account for Cardless ATM listings", () => {
    const methods = ["Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"];

    expect(requiresIsraeliBankSelection(methods)).toBe(true);
    expect(requiresSellerPayoutBankAccount(methods)).toBe(false);
    expect(requiresSellerPayoutBankAccount([...methods, "Bank Transfer"])).toBe(true);
  });

  it("uses confirmations instead of photo evidence for both cash methods", () => {
    for (const method of ["Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"]) {
      expect(isBuyerEvidenceRequiredForPaymentMethod(method)).toBe(false);
      expect(isSellerEvidenceRequiredForPaymentMethod(method)).toBe(false);
      expect(isCashTradeCompletionAvailable(method, "accepted")).toBe(false);
      expect(isCashTradeCompletionAvailable(method, "payment_sent")).toBe(false);
      expect(isCashTradeCompletionAvailable(method, "funds_received")).toBe(true);
    }
    expect(isBuyerEvidenceRequiredForPaymentMethod("Bank Transfer")).toBe(true);
    expect(isBuyerEvidenceRequiredForPaymentMethod("Legacy transfer method")).toBe(true);
  });
});
