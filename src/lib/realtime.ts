import type { AlphaExchangeNotification, MarketplaceListing, PurchaseRequest, SellerOnlineStatus, SellerPublicProfile, PremiumSellerProfileData } from "@/types/alpha-exchange";

type SellerMetricUpdate = Partial<Pick<PremiumSellerProfileData,
  "averageRating" | "alphaScore" | "responseTimeMinutes" | "responseSampleCount">>;

export type RealtimeEvent = (
  | { type: "listing.created"; payload: { listing: MarketplaceListing } }
  | { type: "listing.removed"; payload: { listingId: string } }
  | { type: "listing.quantity_changed"; payload: { listingId: string; availableAmount: string } }
  | { type: "listing.status_changed"; payload: { listingId: string; status: MarketplaceListing["status"] } }
  | { type: "seller.status_changed"; payload: { sellerId: string; onlineStatus: SellerOnlineStatus } }
  | { type: "trade.status_changed"; payload: { requestId?: string; request?: PurchaseRequest; status?: PurchaseRequest["status"]; timeline?: PurchaseRequest["timeline"]; publishedAtEpochMs?: number; removed?: boolean } }
  | { type: "trade.request_created"; payload: { request: PurchaseRequest } }
  | { type: "trade.message_created"; payload: { requestId: string; messageId: string } }
  | { type: "trade.message_updated"; payload: { requestId: string; messageIds: string[] } }
  | { type: "notification.created"; payload: { notification: AlphaExchangeNotification } }
  | { type: "notification.updated"; payload: { notification: AlphaExchangeNotification } }
  | { type: "notification.deleted"; payload: { notificationId: string; userId: string } }
  | { type: "reputation.updated"; payload: SellerMetricUpdate & { sellerId: string; trustScore?: number; reviewCount?: number } }
  | { type: "review.count_changed"; payload: SellerMetricUpdate & { sellerId: string; reviewCount: number } }
) & { recipientUserId?: string };

const realtimeListeners = new Set<(event: RealtimeEvent) => void>();

export function publishRealtimeEvent(event: RealtimeEvent) {
  realtimeListeners.forEach((listener) => listener(event));
}

/** Continue to healthy subscribers after a committed event fails at one listener. */
export function publishIsolatedRealtimeEvent(event: RealtimeEvent) {
  let delivered = true;
  for (const listener of realtimeListeners) {
    try { listener(event); }
    catch { delivered = false; }
  }
  return delivered;
}

export function subscribeRealtimeEvents(listener: (event: RealtimeEvent) => void) {
  realtimeListeners.add(listener);
  return () => {
    realtimeListeners.delete(listener);
  };
}

export function applyRealtimeMarketplaceEvent<T>(items: T[], event: RealtimeEvent) {
  switch (event.type) {
    case "reputation.updated":
    case "review.count_changed": {
      return items.map(item => {
        const listing = item as MarketplaceListing;
        const previous = listing.sellerReputation;
        if (listing.sellerId !== event.payload.sellerId || !previous) return item;
        const { averageRating, alphaScore, responseTimeMinutes, responseSampleCount, reviewCount } = event.payload;
        return { ...listing, sellerReputation: { ...previous,
          rating: averageRating ?? previous.rating, totalReviews: reviewCount ?? previous.totalReviews,
          alphaScore: alphaScore ?? previous.alphaScore,
          responseTimeMinutes: responseTimeMinutes ?? previous.responseTimeMinutes,
          responseSampleCount: responseSampleCount ?? previous.responseSampleCount,
          trustScore: event.type === "reputation.updated" ? event.payload.trustScore ?? previous.trustScore : previous.trustScore,
        } } as T;
      });
    }
    case "listing.created": {
      return items.some((item) => (item as MarketplaceListing).id === event.payload.listing.id)
        ? items
        : [...items, event.payload.listing as T];
    }
    case "listing.removed": {
      return items.filter((item) => (item as MarketplaceListing).id !== event.payload.listingId);
    }
    case "listing.quantity_changed": {
      return (items as MarketplaceListing[]).map((item) => (item.id === event.payload.listingId ? { ...item, availableAmount: event.payload.availableAmount, updatedAt: new Date().toISOString() } : item)) as T[];
    }
    case "listing.status_changed": {
      return (items as MarketplaceListing[]).map((item) => (item.id === event.payload.listingId ? { ...item, status: event.payload.status, updatedAt: new Date().toISOString() } : item)) as T[];
    }
    default:
      return items;
  }
}

export function applyRealtimeNotificationEvent(items: AlphaExchangeNotification[], event: RealtimeEvent) {
  if (event.type === "notification.created") {
    return [event.payload.notification, ...items.filter((item) => item.id !== event.payload.notification.id)];
  }
  if (event.type === "notification.updated") {
    return items.map((item) => item.id === event.payload.notification.id ? event.payload.notification : item);
  }
  if (event.type === "notification.deleted") {
    return items.filter((item) => item.id !== event.payload.notificationId);
  }
  return items;
}

export function applyRealtimeTradeEvent(items: PurchaseRequest[], event: RealtimeEvent) {
  if (event.type !== "trade.status_changed") return items;
  if (event.payload.removed) {
    return items.filter((request) => request.id !== event.payload.requestId);
  }
  return items.map((request) => (request.id === event.payload.requestId ? { ...request, status: event.payload.status, timeline: event.payload.timeline ?? request.timeline, updatedAt: new Date().toISOString() } : request));
}

export function applyRealtimeSellerStatusEvent(seller: SellerPublicProfile | null | undefined, event: RealtimeEvent) {
  if (event.type !== "seller.status_changed" || !seller) return seller;
  return seller.sellerId === event.payload.sellerId ? { ...seller, onlineStatus: event.payload.onlineStatus } : seller;
}

export function applyRealtimeSellerProfileEvent(profileData: PremiumSellerProfileData | null, event: RealtimeEvent) {
  if (!profileData) return profileData;
  if (event.type === "seller.status_changed" && profileData.profile.sellerId === event.payload.sellerId) {
    return {
      ...profileData,
      profile: { ...profileData.profile, onlineStatus: event.payload.onlineStatus },
    };
  }
  if ((event.type === "reputation.updated" || event.type === "review.count_changed") && profileData.sellerId === event.payload.sellerId) {
    return {
      ...profileData,
      trustScore: event.type === "reputation.updated" && typeof event.payload.trustScore === "number" ? event.payload.trustScore : profileData.trustScore,
      alphaScore: event.payload.alphaScore ?? profileData.alphaScore,
      averageRating: event.payload.averageRating ?? profileData.averageRating,
      responseTimeMinutes: event.payload.responseTimeMinutes ?? profileData.responseTimeMinutes,
      responseSampleCount: event.payload.responseSampleCount ?? profileData.responseSampleCount,
      totalReviews: event.payload.reviewCount ?? profileData.totalReviews,
    };
  }
  return profileData;
}
