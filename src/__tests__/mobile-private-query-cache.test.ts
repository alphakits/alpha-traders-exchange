import { describe, expect, it } from "vitest";
import { isPrivateMobileQueryKey } from "../../apps/mobile/src/query/private-query-cache";

describe("native private query cache boundary", () => {
  it.each([
    [["mobile-academy", "user-1", "en"]],
    [["mobile-academy-lesson", "user-1", "candles-foundation", "ar"]],
    [["mobile-trades", "user-1", "en"]],
    [["mobile-trade", "user-1", "request-1", "ar"]],
    [["mobile-notifications", "user-1", "en"]],
    [["mobile-seller-listings", "seller-1", "ar"]],
  ])("classifies authenticated account data as private", (queryKey) => {
    expect(isPrivateMobileQueryKey(queryKey)).toBe(true);
  });

  it.each([
    [["mobile-marketplace", "en"]],
    [["mobile-marketplace-listing", "listing-1", "en"]],
    [["mobile-seller-profile", "listing-1", "ar"]],
    [[]],
  ])("preserves privacy-safe public cache entries", (queryKey) => {
    expect(isPrivateMobileQueryKey(queryKey)).toBe(false);
  });
});
