import { describe, expect, it } from "vitest";
import {
  RELIABILITY_NEUTRAL_BASELINE,
  computeListingReliability,
} from "@/lib/listing-reliability";

const HOUR = 60 * 60 * 1000;

describe("computeListingReliability", () => {
  it("returns a neutral baseline for a seller with no history (never fabricates)", () => {
    const result = computeListingReliability({
      completedTrades: 0,
      cancelledTrades: 0,
      totalListings: 0,
      editCount: 0,
      removalCount: 0,
      listingLifetimesMs: [],
    });
    expect(result.reliabilityScore).toBe(RELIABILITY_NEUTRAL_BASELINE);
    expect(result.cancellationRate).toBe(0);
    expect(result.warningTier).toBe("none");
    expect(result.confidence).toBe(0);
  });

  it("computes cancellation, edit and removal rates from real counts", () => {
    const result = computeListingReliability({
      completedTrades: 8,
      cancelledTrades: 2,
      totalListings: 10,
      editCount: 3,
      removalCount: 1,
      listingLifetimesMs: [],
    });
    expect(result.cancellationRate).toBe(20); // 2 / 10 trades
    expect(result.editRate).toBe(30); // 3 / 10 listings
    expect(result.removalRate).toBe(10); // 1 / 10 listings
  });

  it("computes average listing lifetime in hours", () => {
    const result = computeListingReliability({
      completedTrades: 4,
      cancelledTrades: 0,
      totalListings: 4,
      editCount: 0,
      removalCount: 0,
      listingLifetimesMs: [10 * HOUR, 20 * HOUR, 30 * HOUR, 40 * HOUR],
    });
    expect(result.averageListingLifetimeHours).toBe(25);
  });

  it("is deterministic — identical input yields identical output", () => {
    const input = {
      completedTrades: 15,
      cancelledTrades: 5,
      totalListings: 12,
      editCount: 4,
      removalCount: 2,
      listingLifetimesMs: [5 * HOUR, 15 * HOUR],
    };
    expect(computeListingReliability(input)).toEqual(computeListingReliability(input));
  });

  it("rewards a clean, high-volume seller with a strong score", () => {
    const result = computeListingReliability({
      completedTrades: 40,
      cancelledTrades: 0,
      totalListings: 20,
      editCount: 0,
      removalCount: 0,
      listingLifetimesMs: [48 * HOUR],
    });
    expect(result.reliabilityScore).toBe(100);
    expect(result.warningTier).toBe("none");
  });

  it("escalates warnings as abuse increases", () => {
    const notice = computeListingReliability({
      completedTrades: 12,
      cancelledTrades: 4,
      totalListings: 15,
      editCount: 6,
      removalCount: 2,
      listingLifetimesMs: [],
    });
    expect(notice.warningTier).toBe("notice");
    expect(notice.warningLabel).not.toBe("");

    const critical = computeListingReliability({
      completedTrades: 5,
      cancelledTrades: 15,
      totalListings: 20,
      editCount: 30,
      removalCount: 15,
      listingLifetimesMs: [],
    });
    expect(critical.warningTier).toBe("critical");
    expect(critical.cancellationRate).toBe(75);
    expect(critical.reliabilityScore).toBeLessThan(50);
  });

  it("dampens the score toward neutral when history is thin", () => {
    // Same penalty profile but very little evidence -> closer to baseline.
    const thin = computeListingReliability({
      completedTrades: 0,
      cancelledTrades: 1,
      totalListings: 1,
      editCount: 0,
      removalCount: 0,
      listingLifetimesMs: [],
    });
    const rich = computeListingReliability({
      completedTrades: 0,
      cancelledTrades: 20,
      totalListings: 20,
      editCount: 0,
      removalCount: 0,
      listingLifetimesMs: [],
    });
    // Both have 100% cancellation, but the thin sample is pulled toward baseline.
    expect(thin.reliabilityScore).toBeGreaterThan(rich.reliabilityScore);
  });
});
