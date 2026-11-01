import { describe, expect, it } from "vitest";
import { calculateTradeTermsQuote, calculateTradePaymentTotal, calculateTradeBuyerFiatFee, calculateFiatAmount } from "@alpha-traders/contracts";

const base = { paymentMethod: "Bank Transfer", currency: "ILS", usdtAmount: "420", fiatAmount: "1315.02", pricePerUsdt: "3.10", feePolicyVersion: "buyer_seller_1pct_v1" };

describe("shared trade adjustment calculations", () => {
  it.each(["Bank Transfer", "Face-to-Face (Meet in Person)"])("keeps payment, quantity and the inclusive fee synchronized for %s", paymentMethod => {
    const trade = { ...base, paymentMethod };
    expect(calculateTradeTermsQuote(trade, "propose_amount", "500.5")).toEqual({ usdtAmount: "500.5", fiatAmount: "1567.07", pricePerUsdt: "3.10" });
    expect(calculateTradeTermsQuote(trade, "propose_ils_amount", "١٬٣٠٠")).toEqual({ usdtAmount: "415.202811", fiatAmount: "1300.00", pricePerUsdt: "3.10" });
    expect(calculateTradeTermsQuote(trade, "counter_offer", "3.20")).toEqual({ usdtAmount: "420", fiatAmount: "1357.44", pricePerUsdt: "3.20" });
    expect(calculateTradeTermsQuote({ ...trade, currency: "USD" }, "propose_amount", "500")).toEqual({ usdtAmount: "500", fiatAmount: "1565.50", pricePerUsdt: "3.10" });
    expect(calculateTradeTermsQuote({ ...trade, feePolicyVersion: undefined }, "propose_amount", "500")).toEqual({ usdtAmount: "500", fiatAmount: "1550.00", pricePerUsdt: "3.10" });
  });

  it("derives ATM USDT from cash and preserves that cash when the price changes", () => {
    const trade = { ...base, paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "416.546509", fiatAmount: "1300.00", pricePerUsdt: "3.09" };
    expect(calculateTradeTermsQuote(trade, "counter_offer", "3.10")).toEqual({ usdtAmount: "415.202811", fiatAmount: "1300.00", pricePerUsdt: "3.10" });
    expect(calculateTradeTermsQuote({ ...trade, pricePerUsdt: "3.10" }, "propose_ils_amount", "١٣٠٠")).toEqual({ usdtAmount: "415.202811", fiatAmount: "1300.00", pricePerUsdt: "3.10" });
    expect(calculateTradeTermsQuote(trade, "propose_amount", "420")).toBeNull();
    for (const cash of ["1315", "1315.02", "0", "99", "10001"]) expect(calculateTradeTermsQuote(trade, "propose_ils_amount", cash)).toBeNull();
  });

  it("round-trips every ATM denomination without a missing or doubled buyer fee", () => {
    for (const price of ["0.01", "2.85", "3.10", "3.20", "3.33", "4.00", "99.99"]) {
      for (const feePolicyVersion of [undefined, "buyer_seller_1pct_v1"]) {
        for (let cash = 100; cash <= 10000; cash += 100) {
          const trade = { ...base, paymentMethod: "Cardless ATM Withdrawal", pricePerUsdt: price, feePolicyVersion };
          const quote = calculateTradeTermsQuote(trade, "propose_ils_amount", String(cash));
          expect(quote, `${price}/${cash}/${feePolicyVersion}`).not.toBeNull();
          expect(quote!.fiatAmount).toBe(`${cash}.00`);
          expect(calculateTradePaymentTotal(quote!.usdtAmount, price, Boolean(feePolicyVersion))).toBe(`${cash}.00`);
          if (feePolicyVersion) {
            const subtotal = calculateFiatAmount(quote!.usdtAmount, price)!;
            const fee = calculateTradeBuyerFiatFee(quote!.usdtAmount, price)!;
            expect(Math.round(Number(subtotal) * 100) + Math.round(Number(fee) * 100)).toBe(cash * 100);
          }
        }
      }
    }
  });

  it("rejects malformed, zero-rounded and wrong-currency quotes", () => {
    for (const value of ["0", "-1", "1e3", "NaN", "0.000001", "1.1234567", "1.2.3"]) expect(calculateTradeTermsQuote(base, "propose_amount", value)).toBeNull();
    expect(calculateTradeTermsQuote(base, "counter_offer", "3.101")).toBeNull();
    expect(calculateTradeTermsQuote({ ...base, currency: "USD" }, "propose_ils_amount", "1300")).toBeNull();
  });
});
