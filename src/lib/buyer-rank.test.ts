import { describe, expect, it } from "vitest";
import {
  BUYER_PRESTIGE_TIERS,
  deriveBuyerRankSummary,
  getBuyerPrestigeProgress,
  resolveBuyerPrestigeRank,
} from "@/lib/buyer-rank";
import { SELLER_PRESTIGE_TIERS } from "@/lib/seller-prestige";

describe("buyer volume ranks", () => {
  it("mirrors the approved seller volume thresholds", () => {
    expect(BUYER_PRESTIGE_TIERS).toEqual(
      SELLER_PRESTIGE_TIERS.map(({ rank, minVolumeUsdt }) => ({ rank, minVolumeUsdt })),
    );
  });

  it.each([
    [0, "bronze"],
    [14_999.99, "bronze"],
    [15_000, "silver"],
    [49_999.99, "silver"],
    [50_000, "gold"],
    [149_999.99, "gold"],
    [150_000, "diamond"],
    [499_999.99, "diamond"],
    [500_000, "elite"],
  ] as const)("resolves %s completed USDT as %s", (volume, rank) => {
    expect(resolveBuyerPrestigeRank(volume)).toBe(rank);
  });

  it("calculates exact segment progress and the amount remaining", () => {
    expect(getBuyerPrestigeProgress(7_500)).toEqual({
      rank: "bronze",
      nextRank: "silver",
      requiredVolumeUsdt: 15_000,
      remainingVolumeUsdt: 7_500,
      progressPercent: 50,
    });

    const goldProgress = getBuyerPrestigeProgress(100_000);
    expect(goldProgress.rank).toBe("gold");
    expect(goldProgress.nextRank).toBe("diamond");
    expect(goldProgress.remainingVolumeUsdt).toBe(50_000);
    expect(goldProgress.progressPercent).toBe(50);
  });

  it("uses completed purchase volume only while retaining activity achievements", () => {
    expect(deriveBuyerRankSummary({
      lifetimeCompletedVolumeUsdt: 52_500,
      completedTrades: 8,
      reviewsGiven: 4,
      activeTrades: 2,
    })).toMatchObject({
      key: "gold",
      label: "Gold Buyer",
      labelAr: "مشتري ذهبي",
      lifetimeCompletedVolumeUsdt: 52_500,
      requiredVolumeUsdt: 150_000,
      remainingVolumeUsdt: 97_500,
      completedTrades: 8,
      reviewsGiven: 4,
      activeTrades: 2,
    });
  });

  it("treats invalid volume as zero and caps Elite at 100 percent", () => {
    expect(getBuyerPrestigeProgress(Number.NaN).rank).toBe("bronze");
    expect(getBuyerPrestigeProgress(-100).remainingVolumeUsdt).toBe(15_000);
    expect(getBuyerPrestigeProgress(900_000)).toEqual({
      rank: "elite",
      nextRank: undefined,
      requiredVolumeUsdt: 900_000,
      remainingVolumeUsdt: 0,
      progressPercent: 100,
    });
  });
});
