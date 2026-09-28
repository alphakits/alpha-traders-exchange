import { describe, expect, it } from "vitest";
import { formatTradeCountdown } from "../../apps/mobile/src/trades/trade-countdown";

describe("native trade countdown", () => {
  it.each([
    [null, "--:--"],
    [Number.NaN, "--:--"],
    [-1, "0:00"],
    [0, "0:00"],
    [5, "0:05"],
    [65, "1:05"],
    [3_661, "1:01:01"],
  ])("formats %s as %s without allowing a negative timer", (value, expected) => {
    expect(formatTradeCountdown(value)).toBe(expected);
  });
});
