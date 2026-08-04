import { describe, expect, it } from "vitest";
import { createExchangeDisplayLookup, normalizeDisplayNumber, replaceExchangeEntityIds } from "@/lib/alpha-exchange-display";

describe("alpha exchange display helpers", () => {
  it("normalizes positive display numbers", () => {
    expect(normalizeDisplayNumber(12)).toBe(12);
    expect(normalizeDisplayNumber("9")).toBe(9);
    expect(normalizeDisplayNumber("0")).toBeUndefined();
  });

  it("replaces entity ids with short refs", () => {
    const lookup = createExchangeDisplayLookup({
      listings: [{ id: "listing-abc", displayNumber: 23 }],
      requests: [{ id: "request-def", displayNumber: 105, tradeId: "trade-xyz" }],
    });
    expect(replaceExchangeEntityIds("Listing listing-abc approved.", lookup)).toBe("Listing #LS-000023 approved.");
    expect(replaceExchangeEntityIds("Buyer accepted trade-xyz.", lookup)).toBe("Buyer accepted Trade #TR-000105.");
  });
});
