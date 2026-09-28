import { canonicalizeTradeAmount, isTradeAmountLessThan } from "@/lib/trade-amount";

/** Existing listings can retain their original limit after a partial sale. */
export function listingMaximumForAvailableAmount(listing: {
  availableAmount?: string | null;
  maximumTrade?: string | null;
}): string {
  const available = canonicalizeTradeAmount(listing.availableAmount);
  const maximum = canonicalizeTradeAmount(listing.maximumTrade);
  if (!available) return maximum ?? "0";
  if (!maximum || isTradeAmountLessThan(available, maximum)) return available;
  return maximum;
}
