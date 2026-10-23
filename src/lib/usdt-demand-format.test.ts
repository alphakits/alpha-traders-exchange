import { describe, expect, it } from "vitest";
import { formatIls, formatUsdt } from "./usdt-demand-format";

describe("USDT request amount display", () => {
  it.each([
    ["5000", "5,000"],
    ["16665.000000", "16,665"],
    ["5000.123456", "5,000.123456"],
    ["0.000001", "0.000001"],
    ["001000.120000", "1,000.12"],
    ["9007199254740993.123456", "9,007,199,254,740,993.123456"],
    ["0.000000", "0"],
  ])("formats %s USDT without floating-point conversion", (value, expected) => {
    expect(formatUsdt(value)).toBe(expected);
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
    expect(formatIls(value)).toBe("—");
  });

  it("does not hide USDT precision beyond the supported six decimal places", () => {
    expect(formatUsdt("1.1234567")).toBe("—");
  });
});
