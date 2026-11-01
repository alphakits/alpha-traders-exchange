import { canonicalizeTradeAmount } from "./trade-amount";

export function listingMaximumTracksAvailableAmount(current: {
  availableAmount?: string | null;
  maximumTrade?: string | null;
}): boolean {
  const available = canonicalizeTradeAmount(current.availableAmount);
  const maximum = canonicalizeTradeAmount(current.maximumTrade);
  return !maximum || available === maximum;
}

/** A full-balance limit follows replenishment; a lower seller cap stays explicit. */
export function listingMaximumAfterAmountEdit(current: {
  availableAmount?: string | null;
  maximumTrade?: string | null;
}, nextAvailableAmount: string): string {
  return listingMaximumTracksAvailableAmount(current) ? nextAvailableAmount : current.maximumTrade ?? "";
}
