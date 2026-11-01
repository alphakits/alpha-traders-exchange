import { describe, expect, it } from "vitest";
import type { PurchaseRequest, SellerReputationSnapshot, SellerReviewRecord } from "@/types/alpha-exchange";
import { measureSellerActivity, withLegacySellerReviews, withMeasuredSellerActivity } from "./seller-activity-metrics";
import { compareSellerResponseTimes, formatMeasuredResponseTime, measuredSellerResponseMinutes, sellerRatingDisplay } from "@alpha-traders/contracts";

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
    expect(formatMeasuredResponseTime(undefined)).toBe("New");
  });
  it("corrects stale estimated facts without changing trust decisions or ranks", () => {
    const original = { rating: 4.9, responseTimeMinutes: 5, completedTrades: 123, trustScore: 77, level: "gold", badges: ["top_rated", "fast_responder", "trusted_seller"] } as SellerReputationSnapshot;
    expect(withMeasuredSellerActivity(original, [])).toMatchObject({ rating: 0, responseTimeMinutes: 0, completedTrades: 0, trustScore: 77, level: "gold", badges: ["trusted_seller"] });
    expect(original.rating).toBe(4.9);
  });
});

describe("public seller metric rules", () => {
  it("distinguishes an instant seller response from missing history and sorts uncapped times", () => {
    const instant = { responseTimeMinutes: 0, responseSampleCount: 1 };
    const missing = { responseTimeMinutes: 0, responseSampleCount: 0 };
    const times = [missing, { responseTimeMinutes: 52 }, instant, { responseTimeMinutes: 11 }];
    expect(times.sort(compareSellerResponseTimes).map(measuredSellerResponseMinutes)).toEqual([0, 11, 52, null]);
    expect(formatMeasuredResponseTime(0, false, 1)).toBe("<1 min");
    expect(formatMeasuredResponseTime(10)).toBe("10 min");
    expect(formatMeasuredResponseTime(10.001)).toBe("10+ min");
    expect(formatMeasuredResponseTime(10.001, true)).toBe("أكثر من 10 دقائق");
    expect(formatMeasuredResponseTime(0, true, 0)).toBe("جديد");
  });
  it("counts one first seller decision and excludes a buyer or admin accepting for the seller", () => {
    const decision = (type: "price_offer_accepted" | "request_declined", actorUserId: string, minute: string) =>
      ({ type, actorUserId, createdAt: `2026-01-01T10:${minute}:00Z` }) as PurchaseRequest["timeline"][number];
    const onBehalf = request({ sellerId: "s", tradeCreatedAt: "2026-01-01T10:05:00Z", timeline: [decision("price_offer_accepted", "admin", "05")] });
    const counter = request({ ...onBehalf, firstSellerResponseAt: "2026-01-01T10:02:00Z", timeline: [decision("price_offer_accepted", "buyer", "05")] });
    const decline = request({ sellerId: "s", timeline: [decision("request_declined", "s", "04")] });
    expect(measureSellerActivity([onBehalf])).toMatchObject({ responseSampleCount: 0 });
    expect(measureSellerActivity([onBehalf, counter, decline])).toMatchObject({ responseSampleCount: 2, responseTimeMinutes: 3 });
  });
  it("shows the starter rating until the first visible review, with no floor on a real rating", () => {
    expect(sellerRatingDisplay({ totalReviews: 0, rating: 0 })).toMatchObject({ value: "4.0", label: "Starter rating" });
    expect(sellerRatingDisplay({ totalReviews: 1, rating: 1 })).toMatchObject({ value: "1.00", label: "1 review" });
    expect(sellerRatingDisplay({ rating: 4.75 }).text).toBe("4.75 ★");
    expect(sellerRatingDisplay(null).value).toBe("—");
    expect(sellerRatingDisplay({ totalReviews: 0 }, true).label).toBe("تقييم مبدئي");
  });
  it("reads a verified legacy review once, with matching parties and current moderation taking precedence", () => {
    const trade = request({ id: "request", tradeId: "trade", status: "completed", buyerId: "b", sellerId: "s" });
    const legacy = { tradeId: "trade", buyerId: "b", sellerId: "s", verifiedTrade: true, rating: 3, hidden: false } as SellerReviewRecord;
    expect(measureSellerActivity(withLegacySellerReviews([trade], [legacy, legacy]))).toMatchObject({rating: 3, totalReviews: 1});
    expect(measureSellerActivity(withLegacySellerReviews([{ ...trade, buyerId: "other" }], [legacy])).totalReviews).toBe(0);
    const hidden = { ...trade, buyerReview: { reviewerUserId: "b", rating: 2, hidden: true } as PurchaseRequest["buyerReview"] };
    expect(measureSellerActivity(withLegacySellerReviews([hidden], [legacy])).totalReviews).toBe(0);
  });
});
