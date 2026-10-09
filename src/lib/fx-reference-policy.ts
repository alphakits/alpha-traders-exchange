import type { MarketSnapshot } from "@/types/market";
import { isFxPairUsable } from "@alpha-traders/contracts";
export { USD_ILS_REFERENCE_SYMBOL, FX_MAX_QUOTE_AGE_MS, FX_MAX_CLOSED_AGE_MS, MAX_ILS_PRICE_OVER_MARKET, isFxPairUsable, maximumIlsListingPrice } from "@alpha-traders/contracts";

export const FX_UNAVAILABLE_MESSAGE = "The USD/ILS reference is unavailable or out of date. Please wait for a fresh quote before publishing, changing prices, renewing or resuming a listing.";

export class FxReferenceUnavailableError extends Error {
  constructor() { super(FX_UNAVAILABLE_MESSAGE); this.name = "FxReferenceUnavailableError"; }
}

export function isFxReferenceUsable(snapshot: MarketSnapshot | null, now = Date.now()) {
  return Boolean(snapshot && !snapshot.unavailablePairs.includes("usdtIls") && isFxPairUsable(snapshot.pairs.usdtIls, now));
}
