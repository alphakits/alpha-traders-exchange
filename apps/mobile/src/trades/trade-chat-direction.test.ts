import { describe, expect, it } from "vitest";
import { tradeChatTextDirection } from "@alpha-traders/contracts";

describe("chat content direction", () => {
  it.each([
    ["بدي كل المبلغ 1,500 USDT", "rtl"],
    ["Send 1,500 USDT تمام", "ltr"],
    ["😎 80 شيكل مع bit", "rtl"],
    ["1,500 USDT بالعربي", "ltr"],
    ["١٥٠٠ دولار", "rtl"],
    ["1,500.25", "ltr"],
    ["١٬٥٠٠٫٢٥", "ltr"],
    ["תשלום 80 ILS", "rtl"],
  ] as const)("uses the content of %s in both app languages", (message, expected) => {
    expect(tradeChatTextDirection(message, "ltr")).toBe(expected);
    expect(tradeChatTextDirection(message, "rtl")).toBe(expected);
  });

  it("uses the interface direction for an empty draft without mutating mixed text", () => {
    expect(tradeChatTextDirection("", "rtl")).toBe("rtl");
    expect(tradeChatTextDirection("", "ltr")).toBe("ltr");
    const draft = "بدي 1,500 USDT\nSend 80 ILS تمام";
    expect(tradeChatTextDirection(draft)).toBe("rtl");
    expect(draft).toBe("بدي 1,500 USDT\nSend 80 ILS تمام");
  });
});
