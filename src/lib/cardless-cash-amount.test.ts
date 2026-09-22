import { describe, expect, it } from "vitest";
import { calculateCardlessUsdtAmount, getCardlessCashAmountOptions, parseCardlessCashAmount, validateCardlessIlsAmount } from "@alpha-traders/contracts";
import { calculateFiatAmount } from "./trade-amount";

describe("bank cash withdrawal amounts", () => {
  it.each(["0", "99", "101", "540", "794", "1729", "10001", "10100", "100.01", "1e3", "-100"])("rejects %s", (value) => expect(parseCardlessCashAmount(value)).toBeNull());
  it("accepts all hundred multiples and localized digits", () => {
    for (let cash = 100; cash <= 10000; cash += 100) expect(parseCardlessCashAmount(String(cash))).toBe(cash.toFixed(2));
    expect(parseCardlessCashAmount("١٥٠٠")).toBe("1500.00");
  });
  it("keeps the exact ILS cash total at listing and offer prices", () => {
    for (const price of ["3.27", "3.20", "3.03", "2.92"]) for (let cash = 100; cash <= 10000; cash += 100) {
      const usdt = calculateCardlessUsdtAmount(String(cash), price)!;
      expect(calculateFiatAmount(usdt, price)).toBe(cash.toFixed(2));
      expect(validateCardlessIlsAmount(String(cash), calculateFiatAmount(usdt, price)!)).toBe(cash.toFixed(2));
    }
  });
  it("rejects a mismatched bank cash amount", () => expect(validateCardlessIlsAmount("500", "540.00")).toBeNull());

  it("excludes the reported 660.066007 overflow without changing the bank cash amount", () => {
    expect(calculateCardlessUsdtAmount("2000", "3.03")).toBe("660.066007");
    expect(getCardlessCashAmountOptions("3.03", 600, 660)).toEqual([{ ilsAmount: "1900", usdtAmount: "627.062706" }]);
    expect(calculateFiatAmount("660", "3.03")).toBe("1999.80");
    expect(validateCardlessIlsAmount("2000", "1999.80")).toBeNull();
  });

  it("respects inclusive fractional limits and the available balance", () => {
    expect(getCardlessCashAmountOptions("3.03", "660.066007", "660.066007")).toEqual([{ ilsAmount: "2000", usdtAmount: "660.066007" }]);
    expect(getCardlessCashAmountOptions("3.03", "627.062706", "660.066006")).toEqual([{ ilsAmount: "1900", usdtAmount: "627.062706" }]);
    expect(getCardlessCashAmountOptions("3.20", 600, 625)).toEqual([{ ilsAmount: "2000", usdtAmount: "625" }]);
  });

  it("returns no choices when no cash multiple fits or inputs are invalid", () => {
    expect(getCardlessCashAmountOptions("3.03", 650, 660)).toEqual([]);
    expect(getCardlessCashAmountOptions("0", 600, 660)).toEqual([]);
    expect(getCardlessCashAmountOptions("invalid", 600, 660)).toEqual([]);
    expect(getCardlessCashAmountOptions("3.03", 661, 660)).toEqual([]);
    expect(getCardlessCashAmountOptions("3.03", 0, 0)).toEqual([]);
  });

  it("keeps every selectable amount within limits and equal to its cash total", () => {
    for (const price of ["2.85", "3.03", "3.20", "3.27"]) {
      const options = getCardlessCashAmountOptions(price, 600, 660);
      for (const { ilsAmount, usdtAmount } of options) {
        expect(Number(usdtAmount)).toBeGreaterThanOrEqual(600);
        expect(Number(usdtAmount)).toBeLessThanOrEqual(660);
        expect(calculateFiatAmount(usdtAmount, price)).toBe(Number(ilsAmount).toFixed(2));
      }
    }
  });
});
