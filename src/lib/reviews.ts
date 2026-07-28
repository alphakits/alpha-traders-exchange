import type { SellerReviewRecord } from "@/types/alpha-exchange";

export type SellerReviewStats = {
  reviewCount: number;
  averageRating: number;
  ratingDistribution: Record<number, number>;
  positiveReviewPercentage: number;
};

export function createSellerReviewRecord(input: {
  reviewId: string;
  tradeId: string;
  buyerId: string;
  sellerId: string;
  rating: number;
  comment: string;
  tradeAmount: string;
  network: string;
  createdAt: string;
  updatedAt?: string;
  sellerReply?: string;
  hidden?: boolean;
  hiddenReason?: string;
}): SellerReviewRecord {
  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  return {
    id: input.reviewId,
    tradeId: input.tradeId,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    rating,
    comment: input.comment.trim(),
    sellerReply: input.sellerReply?.trim(),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    editedAt: undefined,
    hidden: input.hidden ?? false,
    hiddenReason: input.hiddenReason,
    verifiedTrade: true,
    tradeAmount: input.tradeAmount,
    network: input.network,
  };
}

export function getVisibleSellerReviews(reviews: SellerReviewRecord[]) {
  return reviews.filter((review) => !review.hidden);
}

export function buildSellerReviewStats(reviews: SellerReviewRecord[]): SellerReviewStats {
  if (!reviews.length) {
    return {
      reviewCount: 0,
      averageRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      positiveReviewPercentage: 0,
    };
  }

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>;
  let total = 0;
  for (const review of reviews) {
    distribution[review.rating] += 1;
    total += review.rating;
  }

  const positiveReviews = reviews.filter((review) => review.rating >= 4).length;
  return {
    reviewCount: reviews.length,
    averageRating: Number((total / reviews.length).toFixed(2)),
    ratingDistribution: distribution,
    positiveReviewPercentage: Number(((positiveReviews / reviews.length) * 100).toFixed(2)),
  };
}

export function isSellerReviewImmutable(review: SellerReviewRecord, now: string) {
  const createdAt = new Date(review.createdAt).getTime();
  const current = new Date(now).getTime();
  return Number.isFinite(createdAt) && Number.isFinite(current) && current - createdAt >= 9 * 24 * 60 * 60 * 1000;
}

export function replyToSellerReviewRecord(review: SellerReviewRecord, reply: string) {
  if (!reply.trim() || review.hidden) return review;
  return {
    ...review,
    sellerReply: review.sellerReply ? review.sellerReply : reply.trim(),
    updatedAt: review.updatedAt,
  };
}
