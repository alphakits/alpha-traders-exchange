import { describe, expect, it } from "vitest";
import { isPrivateMobileQueryKey } from "../../apps/mobile/src/query/private-query-cache";

describe("native private query cache boundary", () => {
  it.each([
    [["mobile-trades", "user-1", "en"]],
    [["mobile-trade", "user-1", "request-1", "ar"]],
    [["mobile-notifications", "user-1", "en"]],
  ])("classifies authenticated account data as private", (queryKey) => {
    expect(isPrivateMobileQueryKey(queryKey)).toBe(true);
  });

  it.each([
    [["mobile-marketplace", "en"]],
    [["mobile-seller-profile", "listing-1", "ar"]],
    [[]],
  ])("preserves privacy-safe public cache entries", (queryKey) => {
    expect(isPrivateMobileQueryKey(queryKey)).toBe(false);
  });
});
