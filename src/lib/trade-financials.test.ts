import { describe, expect, it } from "vitest";
import {
  calculateTradeFinancialBreakdown,
  calculateTradeTermsQuote,
  tradeTermsQuoteValidationIssue,
} from "@alpha-traders/contracts";
import {
  calculateBuyerCommissionAmount,
  calculateLegacySellerCommissionAmount,
  calculateLegacySellerTotalAlphaDue,
  calculateSellerCommissionAmount,
  calculateSellerTotalAlphaDue,
} from "@/lib/trade-amount";

const modern = { feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2" };

describe("shared trade financial breakdown", () => {
  it.each(["Bank Transfer", "Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"])(
    "recalculates 3.20 to 3.40 with the same quantity and the issued fees for %s",
    paymentMethod => {
      const trade = { ...modern, paymentMethod, currency: "ILS", usdtAmount: "1547.029703", fiatAmount: "5000.00", pricePerUsdt: "3.20" };
      expect(calculateTradeFinancialBreakdown(trade)).toEqual({
        subtotal: "4950.50", buyerFiatFee: "49.50", fiatAmount: "5000.00",
        sellerFeeUsdt: "15.470297", buyerFeeUsdt: "15.470297", totalCommissionUsdt: "30.940594",
      });
      const quote = calculateTradeTermsQuote(trade, "counter_offer", "3.40")!;
      expect(quote).toEqual({ usdtAmount: "1547.029703", fiatAmount: "5312.50", pricePerUsdt: "3.40" });
      expect(calculateTradeFinancialBreakdown({ ...trade, ...quote })).toEqual({
        subtotal: "5259.90", buyerFiatFee: "52.60", fiatAmount: "5312.50",
        sellerFeeUsdt: "15.470297", buyerFeeUsdt: "15.470297", totalCommissionUsdt: "30.940594",
      });
      expect(Boolean(tradeTermsQuoteValidationIssue(trade, quote))).toBe(paymentMethod === "Cardless ATM Withdrawal");
      expect(trade).toMatchObject({ usdtAmount: "1547.029703", fiatAmount: "5000.00", pricePerUsdt: "3.20" });
    },
  );

  it("allocates cent rounding to the buyer fee instead of adding it twice or rounding the base first", () => {
    expect(calculateTradeFinancialBreakdown({ ...modern, usdtAmount: "3.333333", pricePerUsdt: "3.20" })).toEqual({
      subtotal: "10.67", buyerFiatFee: "0.10", fiatAmount: "10.77",
      sellerFeeUsdt: "0.033333", buyerFeeUsdt: "0.033333", totalCommissionUsdt: "0.066666",
    });
  });

  it.each([
    { ...modern, seller: "0.001", buyer: "0.001", total: "0.002" },
    { feePolicyVersion: modern.feePolicyVersion, commissionCalculationVersion: undefined, seller: "0.01", buyer: "0.01", total: "0.02" },
    { feePolicyVersion: undefined, commissionCalculationVersion: modern.commissionCalculationVersion, seller: "0.001", buyer: "0", total: "0.001" },
    { feePolicyVersion: undefined, commissionCalculationVersion: undefined, seller: "0.01", buyer: "0", total: "0.01" },
  ])("preserves fee-policy and legacy-rounding versions: $feePolicyVersion/$commissionCalculationVersion", version => {
    const result = calculateTradeFinancialBreakdown({ ...version, usdtAmount: "0.1", pricePerUsdt: "3.20" })!;
    expect(result).toMatchObject({ sellerFeeUsdt: version.seller, buyerFeeUsdt: version.buyer, totalCommissionUsdt: version.total });
    expect(Number(result.subtotal) + Number(result.buyerFiatFee)).toBe(Number(result.fiatAmount));
  });

  it.each([undefined, "usdt_6dp_v2"])("matches the exact commission functions consumed by server settlement (%s)", commissionCalculationVersion => {
    for (const usdtAmount of ["0.1", "3.333333", "353.606789", "1547.029703"]) {
      const result = calculateTradeFinancialBreakdown({ ...modern, usdtAmount, pricePerUsdt: "3.40", commissionCalculationVersion })!;
      const precise = commissionCalculationVersion === "usdt_6dp_v2";
      expect(Number(result.sellerFeeUsdt)).toBe((precise ? calculateSellerCommissionAmount : calculateLegacySellerCommissionAmount)(usdtAmount));
      expect(Number(result.buyerFeeUsdt)).toBe((precise ? calculateBuyerCommissionAmount : calculateLegacySellerCommissionAmount)(usdtAmount));
      expect(Number(result.totalCommissionUsdt)).toBe((precise ? calculateSellerTotalAlphaDue : calculateLegacySellerTotalAlphaDue)(usdtAmount));
    }
  });

  it("fails closed for malformed terms and modern quantities whose commission cannot be paid", () => {
    for (const usdtAmount of ["0", "-1", "NaN", "1.1234567", "0.000001"]) {
      expect(calculateTradeFinancialBreakdown({ ...modern, usdtAmount, pricePerUsdt: "3.40" })).toBeNull();
    }
    for (const pricePerUsdt of ["0", "-3.20", "3.201", "NaN"]) {
      expect(calculateTradeFinancialBreakdown({ ...modern, usdtAmount: "100", pricePerUsdt })).toBeNull();
    }
  });
});
