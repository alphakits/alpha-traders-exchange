import { canonicalizeTradeAmount, isTradeAmountLessThan } from "@/lib/trade-amount";

/** A limit covering the entire balance follows replenishment; a lower seller cap stays explicit.
 * Preserve empty input while editing so clearing and retyping a quantity retains that relationship.
 */
export function listingMaximumAfterAmountEdit(current: {
  availableAmount?: string | null;
  maximumTrade?: string | null;
}, nextAvailableAmount: string): string {
  const previousAvailable = canonicalizeTradeAmount(current.availableAmount);
  const previousMaximum = canonicalizeTradeAmount(current.maximumTrade);
  const followsBalance = !previousMaximum || previousAvailable === previousMaximum;
  return followsBalance ? nextAvailableAmount : current.maximumTrade ?? "";
}

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
