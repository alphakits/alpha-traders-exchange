import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { buildTradeRoomDestination } from "@/lib/trade-room-destination";

export function listingDestination(listing: Pick<MarketplaceListing, "id">) {
  return `/usdt-exchange#listing-${encodeURIComponent(listing.id)}`;
}

export function sellerListingWorkspaceDestination(listing: Pick<MarketplaceListing, "id">) {
  void listing;
  return "/usdt-exchange#my-listings-section";
}

export function sellerApplicationStatusDestination() {
  return "/usdt-exchange#seller-application";
}

export function sellerApplicationReviewDestination(applicationId: string) {
  return `/admin/alpha-exchange?section=seller-applications&sellerApplication=${encodeURIComponent(applicationId)}`;
}

export function tradeDestination(request: PurchaseRequest, actorUserId: string) {
  if (request.status === "review_open" || request.status === "completed" || request.status === "locked") {
    return request.buyerId === actorUserId
      ? buildTradeRoomDestination(request, actorUserId)
      : completedTradeDestination(request);
  }
  return buildTradeRoomDestination(request, actorUserId);
}

export function completedTradeDestination(request: PurchaseRequest) {
  return `/usdt-exchange?trade=${encodeURIComponent(request.id)}#my-trade-requests-section`;
}
