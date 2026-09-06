import type { MobileSellerListing } from "@alpha-traders/contracts";
import type { MarketplaceListing } from "@/types/alpha-exchange";

export function toMobileSellerListing(listing: MarketplaceListing): MobileSellerListing {
  return {
    id: listing.id,
    displayNumber: listing.displayNumber,
    availableAmount: listing.availableAmount,
    price: listing.price,
    currency: listing.currency,
    network: listing.network,
    paymentMethods: [...listing.paymentMethods],
    minimumTrade: listing.minimumTrade,
    maximumTrade: listing.maximumTrade,
    status: listing.status,
    approvalStatus: listing.approvalStatus,
    expiresAt: listing.expiresAt,
    updatedAt: listing.updatedAt,
    actions: {
      canPause: listing.status === "active",
      canResume: listing.status === "paused",
    },
  };
}

export function isIdempotentSellerListingStatus(
  listing: MarketplaceListing,
  status: "active" | "paused",
) {
  return listing.status === status;
}

export function sellerListingMutationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/not found|only your own listings/i.test(message)) {
    return { code: "NOT_FOUND" as const, status: 404 };
  }
  if (
    /locked|no longer editable|pending approval|pending commission|remain hidden|restricted|only switch|changed while/i.test(message)
  ) {
    return { code: "LISTING_ACTION_NOT_ALLOWED" as const, status: 409 };
  }
  return { code: "SERVICE_UNAVAILABLE" as const, status: 503 };
}
