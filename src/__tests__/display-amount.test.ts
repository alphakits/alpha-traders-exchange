import { describe, expect, it } from "vitest";
import { formatListingCardUsdt, formatMoneyNumber, splitAccentText } from "@alpha-traders/contracts";

const parts = (s: string) => splitAccentText(s, { groupQuantities: true });
const visible = (s: string) => parts(s)?.map(p => p.text).join("") ?? s;
const green = (s: string) => parts(s)?.filter(p => p.tone === "money").map(p => p.text) ?? [];

describe("financial presentation in English and Arabic", () => {
  it("groups thousands without rounding, converting or padding stored digits", () => {
    expect(["99", "100", "999", "1000", "12345.000001", "999999999999999999999.5000", "١٢٣٤٥٫٠٠", "-12345.67"].map(formatMoneyNumber))
      .toEqual(["99", "100", "999", "1,000", "12,345.000001", "999,999,999,999,999,999,999.5000", "١٢,٣٤٥٫٠٠", "-12,345.67"]);
    expect(formatMoneyNumber("12,345.000001")).toBe("12,345.000001");
  });
  it("rounds only the listing card presentation to two decimal places", () => {
    expect(["13762.376237", "13752", "1,000.005", "١٣٬٧٦٢٫٣٧٦٢٣٧", "999999999999.994999", 0].map(formatListingCardUsdt))
      .toEqual(["13,762.38", "13,752.00", "1,000.01", "13,762.38", "999,999,999,999.99", "0.00"]);
    expect(formatMoneyNumber("13762.376237")).toBe("13,762.376237");
  });
  it("accents currency symbols, precise prices, ranges, labels and translated amounts", () => {
    expect(green("Price / AMOUNT: $15000.50 • 1000–12000 USDT | ₪ | $")).toEqual(["Price", "AMOUNT: $15,000.50", "1,000–12,000 USDT", "₪", "$"]);
    expect(green("المبلغ: ١٢٣٤٥٫٠٠ والسعر بالشيكل، كمية USDT")).toEqual(["المبلغ: ١٢,٣٤٥٫٠٠", "والسعر", "بالشيكل", "كمية", "USDT"]);
    expect(green("USD 1000.5000")).toEqual(["USD 1,000.5000"]);
    expect(green("اختر سعرًا للدفع")).toEqual(["سعرًا"]);
    expect(green("$USDT and $BTC")).toEqual(["$", "USDT", "$"]);
    expect(splitAccentText("1000 USDT", { groupNumbers: false })?.[0].text).toBe("1000 USDT");
  });
  it("groups counts without changing opaque identifiers, dates, addresses or codes", () => {
    const original = "Trade #12345, ID AT-123456, 2026-11-01, +972501234567, OTP 123456, 0x1234USDTabc, https://example.org/USDT/12345, usdt12345@example.org; 15000+ trades / ١٠٠٠ صفقة.";
    expect(visible(original)).toBe(original.replace("15000+ trades", "15,000+ trades").replace("١٠٠٠ صفقة", "١,٠٠٠ صفقة"));
    expect(green(original)).toEqual([]);
    expect(visible("Completed trades: 12345 · المشاهدات:١٥٠٠٠ · ID:12345")).toBe("Completed trades: 12,345 · المشاهدات:١٥,٠٠٠ · ID:12345");
  });
});
