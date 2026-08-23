import { describe, expect, it } from "vitest";
import { ensurePayoutBankIsSupported, isPayoutBankSupported } from "@/lib/seller-listing-bank-selection";

describe("seller listing payout bank selection", () => {
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
