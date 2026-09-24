import { describe, expect, it } from "vitest";
import type { PurchaseRequest, SellerReputationSnapshot } from "@/types/alpha-exchange";
import { measureSellerActivity, withMeasuredSellerActivity } from "./seller-activity-metrics";
import { formatMeasuredResponseTime } from "@alpha-traders/contracts";

const request = (overrides: Partial<PurchaseRequest>) => ({ status: "pending", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-02T10:00:00Z", timeline: [], ...overrides }) as PurchaseRequest;
describe("measured user statistics", () => {
  it("uses all actual completed-trade reviews, excluding hidden and uncompleted reviews", () => {
    const requests = Array.from({ length: 20 }, (_, index) => request({ status: "completed", buyerReview: { rating: index < 12 ? 5 : 1 } as PurchaseRequest["buyerReview"] }));
    requests.push(request({ status: "completed", buyerReview: { rating: 5, hidden: true } as PurchaseRequest["buyerReview"] }));
    requests.push(request({ buyerReview: { rating: 5 } as PurchaseRequest["buyerReview"] }));
    expect(measureSellerActivity(requests)).toMatchObject({ totalReviews: 20, rating: 3.4 });
  });
  it("uses actual acceptance, never a later profile/trade edit or the advertised five-minute estimate", () => {
    expect(measureSellerActivity([request({})]).responseSampleCount).toBe(0);
    expect(measureSellerActivity([request({ tradeCreatedAt: "2026-01-01T10:02:00Z" })]).responseTimeMinutes).toBe(2);
    expect(measureSellerActivity([request({ timeline: [{ type: "request_accepted", createdAt: "2026-01-01T10:03:00Z" }] as PurchaseRequest["timeline"] })]).responseTimeMinutes).toBe(3);
    expect(formatMeasuredResponseTime(undefined)).toBe("No data yet");
  });
  it("corrects stale estimated facts without changing trust decisions or ranks", () => {
    const original = { rating: 4.9, responseTimeMinutes: 5, completedTrades: 123, trustScore: 77, level: "gold", badges: ["top_rated", "fast_responder", "trusted_seller"] } as SellerReputationSnapshot;
    expect(withMeasuredSellerActivity(original, [])).toMatchObject({ rating: 0, responseTimeMinutes: 0, completedTrades: 0, trustScore: 77, level: "gold", badges: ["trusted_seller"] });
    expect(original.rating).toBe(4.9);
  });
});
