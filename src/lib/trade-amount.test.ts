import { describe, expect, it } from "vitest";
import { calculateBuyerCommissionAmount, calculateBuyerFiatFee, calculateBuyerFiatTotal, calculateFiatAmount, calculateSellerCommissionAmount, calculateSellerTotalAlphaDue, canonicalizeNonNegativeTradeAmount, canonicalizeTradeAmount, isTradeAmountLessThan, normalizeLocalizedDecimalInput, normalizeTradeAmountInput, subtractTradeAmounts } from "@/lib/trade-amount";

describe("trade amount input", () => {
  it("preserves fractional USDT amounts up to six decimals", () => {
    expect(normalizeTradeAmountInput("50.5")).toBe("50.5");
    expect(normalizeTradeAmountInput("0.125000")).toBe("0.125000");
    expect(normalizeTradeAmountInput(".5")).toBe("0.5");
    expect(normalizeTradeAmountInput("12,5")).toBe("12.5");
    expect(normalizeTradeAmountInput("000,5")).toBe("0.5");
    expect(normalizeTradeAmountInput("1,000")).toBe("1000");
    expect(normalizeTradeAmountInput("1,234.5678912")).toBe("1234.567891");
    expect(normalizeTradeAmountInput("1.234,5678912")).toBe("1234.567891");
    expect(normalizeTradeAmountInput("٣٫٢٣")).toBe("3.23");
    expect(normalizeTradeAmountInput("۱٬۲۳۴٫۵۶")).toBe("1234.56");
  });

  it("rejects duplicate and ambiguous separators instead of merging digits", () => {
    for (const value of ["1.2.3", "1,2,3", "1,,000", "1,234.5.6", "١٫٢٫٣"]) {
      expect(normalizeTradeAmountInput(value), value).toBe("");
    }
  });

  it("shares localized decimal behavior with lower-precision inputs", () => {
    const priceOptions = { maximumFractionDigits: 2, maximumWholeDigits: 9 };
    expect(normalizeLocalizedDecimalInput("٣٫٢٣", priceOptions)).toBe("3.23");
    expect(normalizeLocalizedDecimalInput("1,000", priceOptions)).toBe("1000");
    expect(normalizeLocalizedDecimalInput(".5", priceOptions)).toBe("0.5");
    expect(normalizeLocalizedDecimalInput("3.2.3", priceOptions)).toBe("");
  });

  it("canonicalizes valid API amounts and rejects malformed precision", () => {
    expect(canonicalizeTradeAmount("1,250.500000")).toBe("1250.5");
    expect(canonicalizeTradeAmount("0.125000")).toBe("0.125");
    expect(canonicalizeTradeAmount("1,000")).toBe("1000");
    expect(canonicalizeTradeAmount("12,5")).toBe("12.5");
    expect(canonicalizeTradeAmount(".5")).toBe("0.5");
    expect(canonicalizeTradeAmount("١٬٢٣٤٫٥٦")).toBe("1234.56");
    for (const value of ["", "0", "-1", "1abc", "1.0000001", "1,00.5", "1.2.3", "1,2,3"]) {
      expect(canonicalizeTradeAmount(value), value).toBeNull();
    }
  });

  it("accepts zero only for non-negative listing minimums", () => {
    expect(canonicalizeNonNegativeTradeAmount("0.000000")).toBe("0");
    expect(canonicalizeTradeAmount("0.000000")).toBeNull();
  });

  it("settles fiat totals with decimal half-up rounding", () => {
    expect(calculateFiatAmount("0.5", "3.23")).toBe("1.62");
    expect(calculateFiatAmount("1.5", "3.23")).toBe("4.85");
    expect(calculateFiatAmount("650", "3.26")).toBe("2119.00");
    expect(calculateFiatAmount("0.000001", "3.23")).toBe("0.00");
  });

  it("subtracts inventory without losing six-decimal precision", () => {
    expect(subtractTradeAmounts("1", "0.123456")).toBe("0.876544");
    expect(subtractTradeAmounts("0.876544", "0.876544")).toBe("0");
    expect(subtractTradeAmounts("0.1", "0.100001")).toBeNull();
    expect(isTradeAmountLessThan("0.876544", "0.9")).toBe(true);
  });

  it("calculates separate 1% buyer and seller fees while Alpha receives 2%", () => {
    expect(calculateBuyerCommissionAmount("1000")).toBe(10);
    expect(calculateSellerCommissionAmount("1000")).toBe(10);
    expect(calculateSellerTotalAlphaDue("1000")).toBe(20);
    expect(calculateBuyerFiatFee("3500.00")).toBe("35.00");
    expect(calculateBuyerFiatTotal("3500.00")).toBe("3535.00");
  });

  it.each([
    ["0.00", "0.00", "0.00"],
    ["0.49", "0.00", "0.49"],
    ["0.50", "0.01", "0.51"],
    ["100", "1.00", "101.00"],
    ["3500.00", "35.00", "3535.00"],
    ["1234.56", "12.35", "1246.91"],
  ])("calculates buyer fiat fee and total for %s", (amount, fee, total) => {
    expect(calculateBuyerFiatFee(amount)).toBe(fee);
    expect(calculateBuyerFiatTotal(amount)).toBe(total);
  });

  it.each(["", "-1", "NaN", "Infinity", "1e3", "3,500", "1.001", " 100", "01"])("rejects invalid buyer fiat amount %s", (amount) => {
    expect(calculateBuyerFiatFee(amount)).toBeNull();
    expect(calculateBuyerFiatTotal(amount)).toBeNull();
  });

  it("calculates the one-percent seller commission with decimal half-up rounding", () => {
    expect(calculateSellerCommissionAmount("0.000001")).toBe(0.01);
    expect(calculateSellerCommissionAmount("0.1")).toBe(0.01);
    expect(calculateSellerCommissionAmount("0.49")).toBe(0.01);
    expect(calculateSellerCommissionAmount("0.5")).toBe(0.01);
    expect(calculateSellerCommissionAmount("0.999999")).toBe(0.01);
    expect(calculateSellerCommissionAmount("1")).toBe(0.01);
    expect(calculateSellerCommissionAmount("1.5")).toBe(0.02);
    expect(calculateSellerCommissionAmount("10.5")).toBe(0.11);
    expect(calculateSellerCommissionAmount("650")).toBe(6.5);
  });
});
