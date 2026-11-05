import { describe, expect, it } from "vitest";
import { calculateTradeTermsQuote, calculateTradePaymentTotal, calculateTradeBuyerFiatFee, calculateFiatAmount, calculateCardlessUsdtAmount, tradeCounterPriceIssue } from "@alpha-traders/contracts";

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

  it("preserves the ATM cash total and quotes the USDT at the counter price", () => {
    const trade = { ...base, paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "416.546509", fiatAmount: "1300.00", pricePerUsdt: "3.09" };
    expect(calculateTradeTermsQuote(trade, "counter_offer", "3.10")).toEqual({ usdtAmount: "415.202811", fiatAmount: "1300.00", pricePerUsdt: "3.10" });
    expect(calculateTradeTermsQuote({ ...trade, usdtAmount: "353.606789", fiatAmount: "1000.00", pricePerUsdt: "2.80" }, "counter_offer", "3.08"))
      .toEqual({ usdtAmount: "321.460718", fiatAmount: "1000.00", pricePerUsdt: "3.08" });
    expect(trade).toMatchObject({ usdtAmount: "416.546509", fiatAmount: "1300.00", pricePerUsdt: "3.09" });
    expect(calculateTradeTermsQuote({ ...trade, pricePerUsdt: "3.10" }, "propose_ils_amount", "١٣٠٠")).toEqual({ usdtAmount: "415.202811", fiatAmount: "1300.00", pricePerUsdt: "3.10" });
    expect(calculateTradeTermsQuote(trade, "propose_amount", "420")).toBeNull();
    for (const cash of ["1315", "1315.02", "0", "99", "10001"]) expect(calculateTradeTermsQuote(trade, "propose_ils_amount", cash)).toBeNull();
    for (const cash of ["1315", "1315.02", "0", "99", "10100"]) expect(calculateTradeTermsQuote({ ...trade, fiatAmount: cash }, "counter_offer", "3.30")).toBeNull();
  });

  it("supports the reported 3.30 ATM counter and includes the buyer fee exactly once", () => {
    const trade = { ...base, paymentMethod: "Cardless ATM Withdrawal", fiatAmount: "300.00", pricePerUsdt: "3.20", usdtAmount: "92.821782" };
    const quote = calculateTradeTermsQuote(trade, "counter_offer", "٣٫٣");
    expect(quote).toEqual({ usdtAmount: "90.009001", fiatAmount: "300.00", pricePerUsdt: "3.30" });
    expect(calculateFiatAmount(quote!.usdtAmount, quote!.pricePerUsdt)).toBe("297.03");
    expect(calculateTradeBuyerFiatFee(quote!.usdtAmount, quote!.pricePerUsdt)).toBe("2.97");
    expect(calculateTradeTermsQuote({ ...trade, feePolicyVersion: undefined }, "counter_offer", "3.30"))
      .toEqual({ usdtAmount: "90.909091", fiatAmount: "300.00", pricePerUsdt: "3.30" });
    expect(tradeCounterPriceIssue({ ...trade, listingPriceAtRequest: "3.40" }, "3.20")).not.toContain("quantity is fixed");
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
          // A counter must settle the same supported cash amount, including at
          // the ₪100 and ₪10,000 limits; it must never round cash or add fees twice.
          const counter = calculateTradeTermsQuote({ ...trade, fiatAmount: `${cash}.00` }, "counter_offer", price);
          expect(counter).toEqual({ usdtAmount: calculateCardlessUsdtAmount(String(cash), price, Boolean(feePolicyVersion)), fiatAmount: `${cash}.00`, pricePerUsdt: price });
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
