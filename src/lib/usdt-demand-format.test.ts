import { describe, expect, it } from "vitest";
import { formatIls, formatPriceReference, formatUsdt, formatUsdtExact } from "./usdt-demand-format";

describe("USDT request amount display", () => {
  it.each([["3.1", "3.10"], ["3.10450", "3.1045"], ["3.100000001", "3.100000001"]])("shows reference %s without rounding away the reason for its price limits", (input, expected) => {
    expect(formatPriceReference(input)).toBe(expected);
  });
  it.each([
    ["660.6607", "≈661"],
    ["1004", "1,004"],
    ["5000", "5,000"],
    ["16665.000000", "16,665"],
    ["5000.123456", "≈5,000"],
    ["0.000001", "<1"],
    ["0.49", "<1"],
    ["0.499999", "<1"],
    ["0.500000", "≈1"],
    ["0.999999", "≈1"],
    ["001000.120000", "≈1,000"],
    ["999.499999", "≈999"],
    ["999.500000", "≈1,000"],
    ["999999.999999", "≈1,000,000"],
    ["9007199254740993.123456", "≈9,007,199,254,740,993"],
    ["9007199254740993.500000", "≈9,007,199,254,740,994"],
    ["999999999999999999.999999", "≈1,000,000,000,000,000,000"],
    ["0000.000000", "0"],
    ["0", "0"],
    [" 1004.000000 ", "1,004"],
  ])("shows %s USDT as a grouped whole number without changing exact quantities", (value, expected) => {
    expect(formatUsdt(value)).toBe(expected);
  });

  it.each([
    ["660.6607", "660.6607"],
    ["1004", "1,004"],
    ["5000", "5,000"],
    ["16665.000000", "16,665"],
    ["5000.123456", "5,000.123456"],
    ["0.000001", "0.000001"],
    ["001000.120000", "1,000.12"],
    ["9007199254740993.123456", "9,007,199,254,740,993.123456"],
    ["0.000000", "0"],
  ])("retains exact %s USDT in explicit details without floating-point conversion", (value, expected) => {
    expect(formatUsdtExact(value)).toBe(expected);
  });

  it.each([
    ["16665", "16,665.00"],
    ["5000.1", "5,000.10"],
    ["1.005", "1.01"],
    ["999.995", "1,000.00"],
    ["0.004999", "0.00"],
    ["9007199254740993.015", "9,007,199,254,740,993.02"],
    ["0", "0.00"],
  ])("formats %s ILS to cents using exact half-up rounding", (value, expected) => {
    expect(formatIls(value)).toBe(expected);
  });

  it.each([null, undefined, "", " ", "NaN", "Infinity", "5,000", "1e3", "-1", "+2", "1..2", "3."])("does not invent a monetary value from %s", value => {
    expect(formatUsdt(value)).toBe("—");
    expect(formatUsdtExact(value)).toBe("—");
    expect(formatIls(value)).toBe("—");
  });

  it("does not hide USDT precision beyond the supported six decimal places", () => {
    expect(formatUsdt("1.1234567")).toBe("—");
    expect(formatUsdtExact("1.1234567")).toBe("—");
  });
});
