import type { PurchaseRequest, SellerReviewRecord, SellerReputationSnapshot } from "@/types/alpha-exchange";

function isCompletedSellerTrade(request: PurchaseRequest) {
  return ["completed", "review_open", "locked"].includes(request.status) || Boolean(request.completedAt);
}

/** Local legacy snapshots kept a verified review separately from its trade. */
export function withLegacySellerReviews(requests: PurchaseRequest[], legacy: SellerReviewRecord[] = []) {
  if (!legacy.length) return requests;
  const byTrade = new Map<string, SellerReviewRecord>();
  for (const review of legacy) {
    const previous = byTrade.get(review.tradeId);
    if (!previous || review.updatedAt > previous.updatedAt || (review.updatedAt === previous.updatedAt && review.hidden)) byTrade.set(review.tradeId, review);
  }
  return requests.map(request => {
    const review = byTrade.get(request.tradeId ?? request.id);
    if (!isCompletedSellerTrade(request) || request.buyerReview || !review?.verifiedTrade || review.buyerId !== request.buyerId || review.sellerId !== request.sellerId) return request;
    return { ...request, buyerReview: {
      reviewerUserId: review.buyerId, rating: review.rating, comment: review.comment, createdAt: review.createdAt,
      hidden: review.hidden, hiddenReason: review.hiddenReason,
    } };
  });
}

export function hasVisibleCompletedReview(request: PurchaseRequest) {
  const review = request.buyerReview;
  return Boolean(isCompletedSellerTrade(request) && review && !review.hidden
    && (!review.reviewerUserId || review.reviewerUserId === request.buyerId) && Number.isFinite(review.rating) && review.rating >= 1 && review.rating <= 5);
}

/** Facts displayed to users are independent of the platform's computed trust score. */
export function measureSellerActivity(requests: PurchaseRequest[], now = Date.now()) {
  const completed = requests.filter(isCompletedSellerTrade);
  const reviews = completed.filter(hasVisibleCompletedReview).map(request => request.buyerReview!);
  let publicResponsePoints = 0;
  const responseSamples = requests.flatMap(request => {
    const created = Date.parse(request.createdAt);
    const decisions = (request.timeline ?? []).filter(event =>
      ["request_accepted", "price_offer_accepted", "request_declined", "price_offer_declined"].includes(event.type));
    const sellerDecisions = decisions.filter(event =>
      event.actorUserId === request.sellerId || (!event.actorUserId && event.actorRole !== "buyer" && event.actorRole !== "admin" && event.actorRole !== "owner"));
    // Trade creation was the only acceptance timestamp on older requests.
    // A buyer accepting a counteroffer or a moderator acting for the seller
    // does not establish the seller's response time.
    const timestamps = sellerDecisions.map(event => event.createdAt);
    if (!decisions.length && request.tradeCreatedAt) timestamps.push(request.tradeCreatedAt);
    if (request.firstSellerResponseAt) timestamps.push(request.firstSellerResponseAt);
    else if (request.termsProposal) {
      // Previous proposals can be superseded. Their server-authored messages
      // retain the first proposal time on requests predating the explicit field.
      timestamps.push(request.termsProposal.createdAt);
      for (const message of request.messages ?? []) {
        if (message.kind === "system" && message.senderUserId === request.sellerId && message.message.startsWith("Seller proposed ")) timestamps.push(message.createdAt);
      }
    }
    const responses = timestamps.map(value => Date.parse(value))
      .filter(value => Number.isFinite(value) && value >= created && value <= now);
    if (!Number.isFinite(created) || !responses.length) return [];
    const minutes = (Math.min(...responses) - created) / 60_000;
    const sellerDeclined = sellerDecisions.some(event => event.type === "request_declined" || event.type === "price_offer_declined");
    // A prompt decline counts as a reply but cannot earn a trust bonus.
    publicResponsePoints += Math.min(sellerDeclined ? 80 : 100, responsePointsForMinutes(minutes));
    return [minutes];
  });
  return {
    completedTrades: completed.length,
    totalReviews: reviews.length,
    rating: reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0,
    responseTimeMinutes: responseSamples.length ? responseSamples.reduce((sum, value) => sum + value, 0) / responseSamples.length : 0,
    responseSampleCount: responseSamples.length,
    publicResponsePoints,
  };
}

function responsePointsForMinutes(minutes: number) {
  return Math.max(0, 100 - minutes * 8);
}

export function measuredResponseScore(facts: ReturnType<typeof measureSellerActivity>) {
  return facts.responseSampleCount ? responsePointsForMinutes(facts.responseTimeMinutes) : 0;
}

/** The public Alpha Score gives the verified starting score one observation.
 * Each visible rating and measured response adds one observation. The operational
 * trust score still limits the public score during a restriction. */
export function calculatePublicSellerScore(facts: ReturnType<typeof measureSellerActivity>, inGoodStanding: boolean, trustScore: number) {
  const observations = facts.totalReviews + facts.responseSampleCount;
  const earned = (80 + facts.totalReviews * facts.rating * 20 + facts.publicResponsePoints) / (1 + observations);
  return { value: Number((inGoodStanding ? earned : Math.min(earned, trustScore)).toFixed(1)), starter: inGoodStanding && observations === 0 };
}

export function withMeasuredSellerActivity(snapshot: SellerReputationSnapshot, requests: PurchaseRequest[]): SellerReputationSnapshot {
  const facts = measureSellerActivity(requests);
  const badges: SellerReputationSnapshot["badges"] = snapshot.badges.filter(badge => badge !== "top_rated" && badge !== "fast_responder");
  if (facts.totalReviews > 0 && facts.rating >= 4.9) badges.push("top_rated");
  if (facts.responseSampleCount > 0 && facts.responseTimeMinutes <= 2) badges.push("fast_responder");
  const inGoodStanding = snapshot.verificationScore === 100 && !snapshot.accountSuspended && snapshot.marketplaceViolations === 0;
  return { ...snapshot, rating: facts.rating, totalReviews: facts.totalReviews, completedTrades: facts.completedTrades,
    responseTimeMinutes: facts.responseTimeMinutes, responseSampleCount: facts.responseSampleCount, badges,
    alphaScore: calculatePublicSellerScore(facts, inGoodStanding, snapshot.trustScore),
    customerSatisfaction: facts.totalReviews ? facts.rating / 5 * 100 : undefined,
    disputesLost: undefined, profileViews: undefined, listingViews: undefined, monthlyGrowthPercent: undefined };
}
