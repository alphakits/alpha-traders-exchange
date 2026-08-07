import { describe, expect, it } from "vitest";
import {
  LISTING_CHANGE_REASONS,
  isListingChangeReason,
  listingEditRequiresReason,
  validateListingChangeReason,
} from "@/lib/listing-change-reasons";

describe("listing change reasons", () => {
  it("exposes the required reason vocabulary", () => {
    expect(LISTING_CHANGE_REASONS).toEqual([
      "Changed available balance",
      "Price updated",
      "Network issue",
      "Personal reason",
      "Other",
    ]);
  });

  it("recognizes valid reasons", () => {
    expect(isListingChangeReason("Price updated")).toBe(true);
    expect(isListingChangeReason("nope")).toBe(false);
    expect(isListingChangeReason(42)).toBe(false);
  });

  it("requires a reason", () => {
    const result = validateListingChangeReason({ reason: "", explanation: "balance changed" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/choose a reason/i);
  });

  it("rejects an unknown reason", () => {
    const result = validateListingChangeReason({ reason: "Because", explanation: "balance changed" });
    expect(result.ok).toBe(false);
  });

  it("requires a meaningful explanation", () => {
    const result = validateListingChangeReason({ reason: "Price updated", explanation: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/explanation/i);
  });

  it("accepts and normalizes a valid reason + explanation", () => {
    const result = validateListingChangeReason({
      reason: "  Price updated  ",
      explanation: "  Adjusted to match the market rate.  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("Price updated");
      expect(result.explanation).toBe("Adjusted to match the market rate.");
    }
  });

  it("flags edits that change amount/price/availability", () => {
    const current = { availableAmount: "1000", price: "3.60", minimumTrade: "100", maximumTrade: "1000" };
    expect(listingEditRequiresReason(current, { price: "3.70" })).toBe(true);
    expect(listingEditRequiresReason(current, { availableAmount: "900" })).toBe(true);
    expect(listingEditRequiresReason(current, { maximumTrade: "800" })).toBe(true);
  });

  it("does not require a reason for unchanged or non-sensitive fields", () => {
    const current = { availableAmount: "1000", price: "3.60", minimumTrade: "100", maximumTrade: "1000" };
    expect(listingEditRequiresReason(current, { price: "3.60" })).toBe(false);
    expect(listingEditRequiresReason(current, { availableAmount: " 1000 " })).toBe(false);
    expect(listingEditRequiresReason(current, {})).toBe(false);
  });
});
