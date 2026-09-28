import { describe, expect, it } from "vitest";
import {
  currencyAmountToUsd,
  financialNumber,
  formatCount,
  formatCurrencyAmountAsUsd,
  formatFinancialText,
  formatFinancialNumber,
  formatUsdt,
  formatUsd,
  priceForUsdInput,
  usdAmountToCurrency,
} from "../../apps/mobile/src/finance/financial-display";

describe("native financial display", () => {
  it("groups every four-digit or larger number with commas", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1_000)).toBe("1,000");
    expect(formatFinancialNumber("1050000.00", { minimumFractionDigits: 2 })).toBe("1,050,000.00");
    expect(formatUsdt("350000")).toBe("350,000 USDT");
    expect(formatUsd(350000)).toBe("$350,000.00 USD");
  });

  it("normalizes stored ILS values into the app's USD display", () => {
    expect(currencyAmountToUsd("3.30", "ILS", 3)).toBeCloseTo(1.1);
    expect(formatCurrencyAmountAsUsd("1050000", "ILS", 3)).toBe("$350,000.00 USD");
    expect(priceForUsdInput("3.30", "ILS", 3)).toBe("1.10");
  });

  it("converts USD input back to the stored settlement currency without changing USD", () => {
    expect(usdAmountToCurrency("1.10", "ILS", 3)).toBeCloseTo(3.3);
    expect(usdAmountToCurrency("1,000", "USD", 3)).toBe(1_000);
    expect(financialNumber("$1,050,000.00 USD")).toBe(1_050_000);
  });

  it("normalizes and groups financial values embedded in app notifications", () => {
    expect(formatFinancialText("Layla offered ₪2.95 per USDT for 1000 USDT.", 2.95)).toBe(
      "Layla offered $1.00 USD per USDT for 1,000 USDT.",
    );
    expect(formatFinancialText("Trade completed at ILS 1050000.00.", 3)).toBe(
      "Trade completed at $350,000.00 USD.",
    );
    expect(formatFinancialText("USDT / ILS reference", 3)).toBe("USDT / USD reference");
  });
});
