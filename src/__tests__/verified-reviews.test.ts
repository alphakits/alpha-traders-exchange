import { describe, expect, it } from "vitest";
import { buildSellerReviewStats, createSellerReviewRecord, getVisibleSellerReviews, isSellerReviewImmutable, replyToSellerReviewRecord } from "@/lib/reviews";

describe("verified reviews", () => {
  it("creates a review record with verified trade metadata", () => {
    const review = createSellerReviewRecord({
      reviewId: "review-1",
      tradeId: "trade-42",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      rating: 5,
      comment: "Excellent service",
      tradeAmount: "1000",
      network: "TRC20",
      createdAt: "2026-01-10T00:00:00.000Z",
    });

    expect(review.verifiedTrade).toBe(true);
    expect(review.tradeAmount).toBe("1000");
    expect(review.network).toBe("TRC20");
    expect(review.hidden).toBe(false);
  });

  it("builds review statistics and excludes hidden reviews", () => {
    const reviews = [
      createSellerReviewRecord({ reviewId: "1", tradeId: "t1", buyerId: "b1", sellerId: "s1", rating: 5, comment: "Great", tradeAmount: "100", network: "TRC20", createdAt: "2026-01-01T00:00:00.000Z" }),
      createSellerReviewRecord({ reviewId: "2", tradeId: "t2", buyerId: "b2", sellerId: "s1", rating: 4, comment: "Good", tradeAmount: "200", network: "ERC20", createdAt: "2026-01-02T00:00:00.000Z" }),
      createSellerReviewRecord({ reviewId: "3", tradeId: "t3", buyerId: "b3", sellerId: "s1", rating: 2, comment: "Bad", tradeAmount: "300", network: "BEP20", createdAt: "2026-01-03T00:00:00.000Z", hidden: true, hiddenReason: "spam" }),
    ];

    const visibleReviews = getVisibleSellerReviews(reviews);
    const stats = buildSellerReviewStats(visibleReviews);

    expect(visibleReviews).toHaveLength(2);
    expect(stats.reviewCount).toBe(2);
    expect(stats.averageRating).toBe(4.5);
    expect(stats.positiveReviewPercentage).toBe(100);
    expect(stats.ratingDistribution[5]).toBe(1);
    expect(stats.ratingDistribution[2]).toBe(0);
  });

  it("marks reviews immutable after seven days", () => {
    const review = createSellerReviewRecord({
      reviewId: "4",
      tradeId: "t4",
      buyerId: "b4",
      sellerId: "s1",
      rating: 5,
      comment: "Excellent",
      tradeAmount: "500",
      network: "SOL",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(isSellerReviewImmutable(review, "2026-01-09T00:00:00.000Z")).toBe(false);
    expect(isSellerReviewImmutable(review, "2026-01-10T00:00:00.000Z")).toBe(true);
  });

  it("allows a single seller reply and preserves the original review", () => {
    const review = createSellerReviewRecord({
      reviewId: "5",
      tradeId: "t5",
      buyerId: "b5",
      sellerId: "s1",
      rating: 4,
      comment: "Thanks",
      tradeAmount: "400",
      network: "TRC20",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const updated = replyToSellerReviewRecord(review, "We appreciate your feedback");

    expect(updated.sellerReply).toBe("We appreciate your feedback");
    expect(updated.comment).toBe("Thanks");
    expect(replyToSellerReviewRecord(updated, "Second reply").sellerReply).toBe("We appreciate your feedback");
  });
});
