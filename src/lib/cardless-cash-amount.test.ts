import { describe, expect, it } from "vitest";
import { cardlessPaymentAmountNotice, calculateCardlessUsdtAmount, getCardlessCashAmountOptions, parseCardlessCashAmount, validateCardlessIlsAmount } from "@alpha-traders/contracts";
import { calculateFiatAmount, calculateTradePaymentTotal } from "./trade-amount";

describe("bank cash withdrawal amounts", () => {
  it("keeps every offered two-sided-fee cash amount exact without exceeding inventory", () => {
    for (const price of ["0.01", "2.85", "3.03", "3.20", "3.27"]) {
      const options = getCardlessCashAmountOptions(price, 1, 1000000, true);
      expect(options).toHaveLength(100);
      for (const { ilsAmount, usdtAmount } of options) {
        expect(calculateTradePaymentTotal(usdtAmount, price, true)).toBe(Number(ilsAmount).toFixed(2));
        expect(Number(usdtAmount)).toBeGreaterThanOrEqual(1);
        expect(Number(usdtAmount)).toBeLessThanOrEqual(1000000);
      }
    }
  });

  it.each(["0", "99.99", "10000.01", "10001", "10100", "100.001", "1e3", "-100", "1,31,5.02"])("rejects %s", (value) => expect(parseCardlessCashAmount(value)).toBeNull());
  it("accepts all hundred multiples and localized digits", () => {
    for (let cash = 100; cash <= 10000; cash += 100) expect(parseCardlessCashAmount(String(cash))).toBe(cash.toFixed(2));
    expect(parseCardlessCashAmount("١٥٠٠")).toBe("1500.00");
  });
  it("accepts the exact full ATM payment including cents and Arabic digits", () => {
    expect(calculateTradePaymentTotal("420", "3.10", true)).toBe("1315.02");
    for (const input of ["1315.02", "1,315.02", "١٬٣١٥٫٠٢"]) {
      expect(parseCardlessCashAmount(input)).toBe("1315.02");
      expect(validateCardlessIlsAmount(input, "1315.02")).toBe("1315.02");
      expect(cardlessPaymentAmountNotice(input, "1315.02")).toBeNull();
    }
    for (const input of ["1000", "1300", "1302", "1315.01", "1315.03", "1400"]) {
      expect(validateCardlessIlsAmount(input, "1315.02")).toBeNull();
      expect(cardlessPaymentAmountNotice(input, "1315.02")).toContain("exactly ₪1,315.02");
    }
    expect(cardlessPaymentAmountNotice("1300", "1315.02")).toContain("₪15.02 short");
    expect(cardlessPaymentAmountNotice("1315.01", "1315.02")).toContain("₪0.01 short");
    expect(cardlessPaymentAmountNotice("1300", "1315.02", "ar")).toContain("ينقص رمز السحب ₪15.02");
    expect(validateCardlessIlsAmount("1315.02", "1315.021")).toBeNull();
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
