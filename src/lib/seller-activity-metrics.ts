import type { PurchaseRequest, SellerReputationSnapshot } from "@/types/alpha-exchange";

/** Facts displayed to users are independent of the platform's computed trust score. */
export function measureSellerActivity(requests: PurchaseRequest[]) {
  const completed = requests.filter(request => ["completed", "review_open", "locked"].includes(request.status) || Boolean(request.completedAt));
  const reviews = completed.map(request => request.buyerReview).filter(review => review && !review.hidden && Number.isFinite(review.rating) && review.rating >= 1 && review.rating <= 5);
  const responseSamples = requests.flatMap(request => {
    const created = Date.parse(request.createdAt);
    const accepted = [request.tradeCreatedAt, ...(request.timeline ?? [])
      .filter(event => event.type === "request_accepted" || event.type === "price_offer_accepted")
      .map(event => event.createdAt)]
      .map(value => Date.parse(value ?? "")).filter(value => Number.isFinite(value) && value >= created && value <= Date.now());
    if (!Number.isFinite(created) || !accepted.length) return [];
    return [(Math.min(...accepted) - created) / 60_000];
  });
  return {
    completedTrades: completed.length,
    totalReviews: reviews.length,
    rating: reviews.length ? reviews.reduce((sum, review) => sum + review!.rating, 0) / reviews.length : 0,
    responseTimeMinutes: responseSamples.length ? responseSamples.reduce((sum, value) => sum + value, 0) / responseSamples.length : 0,
    responseSampleCount: responseSamples.length,
  };
}

export function withMeasuredSellerActivity(snapshot: SellerReputationSnapshot, requests: PurchaseRequest[]): SellerReputationSnapshot {
  const facts = measureSellerActivity(requests);
  const badges: SellerReputationSnapshot["badges"] = snapshot.badges.filter(badge => badge !== "top_rated" && badge !== "fast_responder");
  if (facts.totalReviews > 0 && facts.rating >= 4.9) badges.push("top_rated");
  if (facts.responseSampleCount > 0 && facts.responseTimeMinutes <= 2) badges.push("fast_responder");
  return { ...snapshot, rating: facts.rating, responseTimeMinutes: facts.responseTimeMinutes, completedTrades: facts.completedTrades, badges };
}
