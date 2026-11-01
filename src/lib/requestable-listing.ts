import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";
import { isCardlessAtmPaymentMethod, resolveListingPaymentMethods } from "@/lib/marketplace-payment-methods";
import type { MarketplaceListing } from "@/types/alpha-exchange";

export const MAX_SELLER_ACTIVE_TRADES = 3;

function listingAmount(value: string | null | undefined) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

/** The next ATM buyer can request a smaller code-backed quantity with seller approval. */
export function minimumRequestableListingAmount(listing: MarketplaceListing) {
  const methods = resolveListingPaymentMethods(listing.paymentMethods, listing.paymentMethod);
  const listedMinimum = Math.max(0, listingAmount(listing.minimumTrade));
  if (!methods.some(isCardlessAtmPaymentMethod)) return listedMinimum;
  const atmMinimum = listingAmount(calculateCardlessUsdtAmount("100", listing.price, true));
  return methods.every(isCardlessAtmPaymentMethod) ? atmMinimum : Math.min(listedMinimum, atmMinimum);
}

/** Count listings that can take another request, including a partially reserved listing. */
export function isRequestableMarketplaceListing(
  listing: MarketplaceListing,
  availableAmount = listing.availableAmount,
  now = Date.now(),
) {
  if (!["active", "matched", "in_trade"].includes(listing.status)
    || (listing.approvalStatus !== undefined && listing.approvalStatus !== "approved")
    || listing.newRequestBlockReason || (listing.sellerActiveTradeCount ?? 0) >= MAX_SELLER_ACTIVE_TRADES) return false;
  const available = Number(availableAmount);
  const maximum = Number(listing.maximumTrade) || available;
  const minimum = minimumRequestableListingAmount(listing);
  if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(maximum)
    || Math.min(available, maximum) < minimum) return false;
  if (listing.expiresAt) {
    const expiry = Date.parse(listing.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) return false;
  }
  return true;
}
