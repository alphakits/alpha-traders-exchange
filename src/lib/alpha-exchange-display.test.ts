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

  it("preserves trade references when commissions and disputes point to that trade", () => {
    const lookup = createExchangeDisplayLookup({
      requests: [{ id: "request-def", displayNumber: 105, tradeId: "trade-xyz" }],
      commissions: [{ id: "commission-abc", displayNumber: 2, tradeId: "trade-xyz" }],
      disputes: [{ id: "dispute-abc", displayNumber: 3, tradeId: "trade-xyz" }],
    });
    expect(replaceExchangeEntityIds("trade-xyz", lookup)).toBe("Trade #TR-000105");
    expect(replaceExchangeEntityIds("request-def", lookup)).toBe("Trade #TR-000105");
    expect(replaceExchangeEntityIds("commission-abc", lookup)).toBe("Commission #CM-000002");
  });

  it("does not label an unknown trade as its associated commission or dispute", () => {
    const lookup = createExchangeDisplayLookup({
      commissions: [{ id: "commission-abc", displayNumber: 2, tradeId: "trade-xyz" }],
      disputes: [{ id: "dispute-abc", displayNumber: 3, tradeId: "trade-unknown" }],
    });
    expect(replaceExchangeEntityIds("trade-xyz / trade-unknown", lookup)).toBe("trade-xyz / trade-unknown");
  });
});
