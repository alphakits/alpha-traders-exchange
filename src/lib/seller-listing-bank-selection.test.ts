import { describe, expect, it } from "vitest";
import { ensurePayoutBankIsSupported, isPayoutBankSupported, syncListingBankSelection } from "@/lib/seller-listing-bank-selection";

describe("seller listing payout bank selection", () => {
  const savedAccount = { id: "saved-bank", bankName: "Bank Leumi", isDefault: true };

  it.each([
    ["Cardless ATM Withdrawal"],
    ["Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"],
  ])("keeps ATM choices independent of profile payout details: %s", (...paymentMethods) => {
    const form = { paymentMethods, bankAccountId: "", bankName: "Bank Hapoalim" };
    expect(syncListingBankSelection(form, [])).toBe(form);
    expect(syncListingBankSelection(form, [savedAccount])).toBe(form);
    expect(syncListingBankSelection({ ...form, bankAccountId: savedAccount.id }, [savedAccount]))
      .toEqual(form);
  });

  it("clears all bank fields when only Face to Face is selected", () => {
    expect(syncListingBankSelection({
      paymentMethods: ["Face-to-Face (Meet in Person)"], bankAccountId: savedAccount.id, bankName: savedAccount.bankName,
    }, [savedAccount])).toMatchObject({ bankAccountId: "", bankName: "" });
  });

  it("selects a saved payout account only after Bank Transfer is enabled", () => {
    const form = { paymentMethods: ["Cardless ATM Withdrawal", "Bank Transfer"], bankAccountId: "", bankName: "Bank Hapoalim" };
    expect(syncListingBankSelection(form, [])).toBe(form);
    expect(syncListingBankSelection(form, [savedAccount])).toMatchObject({
      bankAccountId: savedAccount.id, bankName: "Bank Leumi, Bank Hapoalim",
    });
  });

  it("does not silently replace a removed payout account with a different account", () => {
    const form = { paymentMethods: ["Bank Transfer"], bankAccountId: "removed-bank", bankName: "Bank Hapoalim" };
    expect(syncListingBankSelection(form, [savedAccount])).toBe(form);
  });

  it("automatically includes the selected payout bank", () => {
    expect(ensurePayoutBankIsSupported(["Bank Hapoalim"], "Bank Leumi")).toEqual([
      "Bank Leumi",
      "Bank Hapoalim",
    ]);
  });

  it("keeps the payout bank while enforcing the two-bank limit", () => {
    expect(
      ensurePayoutBankIsSupported(
        ["Bank Hapoalim", "Mizrahi-Tefahot"],
        "Bank Leumi",
      ),
    ).toEqual(["Bank Leumi", "Bank Hapoalim"]);
  });

  it("deduplicates banks and detects a missing payout bank", () => {
    expect(
      ensurePayoutBankIsSupported(["Bank Leumi", "Bank Leumi"], "Bank Leumi"),
    ).toEqual(["Bank Leumi"]);
    expect(isPayoutBankSupported(["Bank Hapoalim"], "Bank Leumi")).toBe(false);
    expect(isPayoutBankSupported(["Bank Hapoalim", "Bank Leumi"], "Bank Leumi")).toBe(true);
  });
});
