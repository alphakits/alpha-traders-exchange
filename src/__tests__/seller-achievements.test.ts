import { describe, expect, it } from "vitest";
import { evaluateSellerAchievements } from "@/lib/seller-achievements";

describe("evaluateSellerAchievements", () => {
  it("awards first-trade and fast-responder achievements for qualifying sellers", () => {
    const achievements = evaluateSellerAchievements({
      sellerId: "seller-1",
      sellerName: "Alicia",
      rank: "gold",
      lifetimeVolumeUsdt: 120000,
      completedTrades: 101,
      reviewCount: 101,
      averageRating: 4.96,
      responseTimeMinutes: 1.5,
      completionRate: 100,
      approvedAt: "2024-01-01T00:00:00.000Z",
      createdAt: "2023-12-01T00:00:00.000Z",
      tradeRequests: 101,
      completedTradeMonths: ["2024-01"],
      hasCommissionRecords: true,
      hasDispute: false,
      sellerStatus: "approved_seller",
    });

    const keys = achievements.map((achievement) => achievement.key);
    expect(keys).toContain("first_trade");
    expect(keys).toContain("fast_responder");
    expect(keys).toContain("customer_favorite");
  });
});
