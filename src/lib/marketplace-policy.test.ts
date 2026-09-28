import { describe, expect, it } from "vitest";

import {
  ALLOWED_LISTING_EXPIRATION_HOURS,
  COMMISSION_GRACE_PERIOD_DAYS,
  COMMISSION_RATE,
  DEFAULT_LISTING_EXPIRATION_HOURS,
  MAX_ACTIVE_LISTINGS_PER_SELLER,
} from "@/lib/marketplace-policy";
import {
  SELLER_PRESTIGE_TIERS,
  getSellerPrestigeProgress,
  resolveSellerPrestigeRank,
} from "@/lib/seller-prestige";

describe("shared marketplace policy contract", () => {
  it("keeps the implemented listing and commission policy exact", () => {
    expect(MAX_ACTIVE_LISTINGS_PER_SELLER).toBe(2);
    expect(ALLOWED_LISTING_EXPIRATION_HOURS).toEqual([1, 6, 12, 24]);
    expect(DEFAULT_LISTING_EXPIRATION_HOURS).toBe(24);
    expect(COMMISSION_RATE).toBe(0.01);
    expect(COMMISSION_GRACE_PERIOD_DAYS).toBe(7);
  });

  it("uses completed volume-only prestige thresholds", () => {
    expect(SELLER_PRESTIGE_TIERS.map(({ rank, minVolumeUsdt }) => ({
      rank,
      minVolumeUsdt,
    }))).toEqual([
      { rank: "bronze", minVolumeUsdt: 0 },
      { rank: "silver", minVolumeUsdt: 15_000 },
      { rank: "gold", minVolumeUsdt: 50_000 },
      { rank: "diamond", minVolumeUsdt: 150_000 },
      { rank: "elite", minVolumeUsdt: 500_000 },
    ]);
    expect(resolveSellerPrestigeRank(49_999)).toBe("silver");
    expect(resolveSellerPrestigeRank(50_000)).toBe("gold");
    expect(getSellerPrestigeProgress(18_450)).toMatchObject({
      nextRank: "gold",
      remainingUsdt: 31_550,
    });
  });
});
