import type { MarketPair, MarketSnapshot } from "@/types/market";

export const FX_MAX_QUOTE_AGE_MS = 60_000;
export const FX_MAX_CLOSED_AGE_MS = 96 * 60 * 60 * 1000;
export const FX_UNAVAILABLE_MESSAGE = "The USD/ILS reference is unavailable or out of date. Please wait for a fresh quote before publishing, changing prices, renewing or resuming a listing.";
export const MAX_ILS_PRICE_OVER_MARKET = 0.35;

export class FxReferenceUnavailableError extends Error {
  constructor() { super(FX_UNAVAILABLE_MESSAGE); this.name = "FxReferenceUnavailableError"; }
}

/** The same source time and expiry govern both the UI and server mutations. */
export function isFxPairUsable(pair: MarketPair | undefined, now = Date.now()) {
  if (!pair || !Number.isFinite(pair.price) || pair.price < 2 || pair.price > 10) return false;
  const quotedAt = Date.parse(pair.quotedAt ?? "");
  const validUntil = Date.parse(pair.validUntil ?? "");
  if (!Number.isFinite(quotedAt) || !Number.isFinite(validUntil) || quotedAt > now + 5_000 || validUntil <= now) return false;
  if (pair.quoteStatus === "live") return now - quotedAt <= FX_MAX_QUOTE_AGE_MS;
  return pair.quoteStatus === "closed" && now - quotedAt <= FX_MAX_CLOSED_AGE_MS;
}

export function isFxReferenceUsable(snapshot: MarketSnapshot | null, now = Date.now()) {
  return Boolean(snapshot && !snapshot.unavailablePairs.includes("usdtIls") && isFxPairUsable(snapshot.pairs.usdtIls, now));
}

/** Listing prices settle in cents. Never round the ceiling up above the rule. */
export function maximumIlsListingPrice(rate: number) {
  if (!Number.isFinite(rate) || rate < 2 || rate > 10) return 0;
  return Math.floor((rate + MAX_ILS_PRICE_OVER_MARKET + Number.EPSILON * 4) * 100) / 100;
}
