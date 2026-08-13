import { describe, expect, it } from "vitest";
import { resolveSellerPrestigeRankWithFloor } from "@/lib/seller-prestige";

describe("seller prestige rank resolution", () => {
  it("advances when completed volume crosses each threshold", () => {
    expect(resolveSellerPrestigeRankWithFloor(0, "bronze")).toBe("bronze");
    expect(resolveSellerPrestigeRankWithFloor(15_000, "bronze")).toBe("silver");
    expect(resolveSellerPrestigeRankWithFloor(50_000, "silver")).toBe("gold");
    expect(resolveSellerPrestigeRankWithFloor(150_000, "gold")).toBe("diamond");
    expect(resolveSellerPrestigeRankWithFloor(500_000, "diamond")).toBe("elite");
  });

  it("does not downgrade a persisted rank when source volume is temporarily lower", () => {
    expect(resolveSellerPrestigeRankWithFloor(1_000, "gold")).toBe("gold");
  });
});