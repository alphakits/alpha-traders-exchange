import { describe, expect, it } from "vitest";
import { calculateCardlessUsdtAmount, parseCardlessCashAmount, validateCardlessIlsAmount } from "@alpha-traders/contracts";
import { calculateFiatAmount } from "./trade-amount";

describe("bank cash withdrawal amounts", () => {
  it.each(["0", "99", "101", "540", "794", "1729", "10001", "10100", "100.01", "1e3", "-100"])("rejects %s", (value) => expect(parseCardlessCashAmount(value)).toBeNull());
  it("accepts all hundred multiples and localized digits", () => {
    for (let cash = 100; cash <= 10000; cash += 100) expect(parseCardlessCashAmount(String(cash))).toBe(cash.toFixed(2));
    expect(parseCardlessCashAmount("١٥٠٠")).toBe("1500.00");
  });
  it("keeps the exact ILS cash total at listing and offer prices", () => {
    for (const price of ["3.27", "3.20", "2.92"]) for (let cash = 100; cash <= 10000; cash += 100) {
      const usdt = calculateCardlessUsdtAmount(String(cash), price)!;
      expect(calculateFiatAmount(usdt, price)).toBe(cash.toFixed(2));
      expect(validateCardlessIlsAmount(String(cash), calculateFiatAmount(usdt, price)!)).toBe(cash.toFixed(2));
    }
  });
  it("rejects a mismatched bank cash amount", () => expect(validateCardlessIlsAmount("500", "540.00")).toBeNull());
});
