// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_RAW_UNITS, formatUnits, parseRawUnits, parseUnits, quoteTrade } from "./amounts";
import { calculateTradePaymentTotal } from "../../../packages/contracts/src/marketplace-fees";
import { calculateSellerTotalAlphaDue } from "../../../packages/contracts/src/commission-amount";

describe("exact wallet amounts and existing fee contract", () => {
  it("keeps TRON six decimals and Binance-Peg simulation eighteen decimals distinct", () => {
    expect(parseUnits("500", 6)).toBe(BigInt("500000000"));
    expect(parseUnits("500", 18)).toBe(BigInt("500000000000000000000"));
    expect(formatUnits(parseUnits("1.000000000000000001", 18), 18)).toBe("1.000000000000000001");
  });
  it.each(["-1", "+1", "1e6", " 500", "500 ", "1,000", "NaN", "Infinity", ".5", "01", "1."])("rejects ambiguous decimal input %s", input => {
    expect(() => parseUnits(input, 6)).toThrow();
  });
  it("rejects excess precision without rounding", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrow(/precision/);
    expect(() => quoteTrade("bsc-sim-binance-peg-usdt", "1.0000001", "3.75")).toThrow(/precision/);
  });
  it("bounds raw token units exactly", () => {
    expect(parseRawUnits(MAX_RAW_UNITS.toString())).toBe(MAX_RAW_UNITS);
    expect(() => parseRawUnits((MAX_RAW_UNITS + BigInt(1)).toString())).toThrow();
    expect(() => parseRawUnits("1.5")).toThrow();
    expect(() => parseRawUnits("01")).toThrow();
    expect(() => parseUnits((MAX_RAW_UNITS + BigInt(1)).toString(), 0)).toThrow();
  });
  it.each(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"] as const)("preserves full 500 principal and separate 1%% + 1%% commission on %s", assetId => {
    const result = quoteTrade(assetId, "500", "3.75");
    const decimals = assetId === "tron-sim-usdt" ? 6 : 18;
    expect(formatUnits(result.principalRaw, decimals)).toBe("500");
    expect(formatUnits(result.buyerFeeRaw, decimals)).toBe("5");
    expect(formatUnits(result.sellerFeeRaw, decimals)).toBe("5");
    expect(formatUnits(result.totalFeeRaw, decimals)).toBe("10");
    expect(result.fiatTotalMinor).toBe(BigInt(189375));
  });
  it.each([
    ["200", "3.75"], ["1.00005", "3.20"], ["13752.123456", "3.78"], ["999999.999999", "3.01"],
  ])("matches existing marketplace fiat and fee policy for %s at %s", (amount, price) => {
    const result = quoteTrade("tron-sim-usdt", amount, price);
    expect(formatUnits(result.fiatTotalMinor, 2)).toBe(formatUnits(parseUnits(calculateTradePaymentTotal(amount, price, true)!, 2), 2));
    expect(formatUnits(result.totalFeeRaw, 6)).toBe(String(calculateSellerTotalAlphaDue(amount)));
  });
  it("keeps half-up per-party six-decimal rounding on BSC", () => {
    const result = quoteTrade("bsc-sim-binance-peg-usdt", "1.00005", "3.75");
    expect(formatUnits(result.buyerFeeRaw, 18)).toBe("0.010001");
    expect(formatUnits(result.totalFeeRaw, 18)).toBe("0.020002");
  });
  it("rejects trades that would round to zero fiat or zero payable fees", () => {
    expect(() => quoteTrade("tron-sim-usdt", "0.00005", "3.20")).toThrow(/Fiat total/);
    expect(() => quoteTrade("tron-sim-usdt", "0.000001", "3.20")).toThrow(/fee/);
  });
});
