/** One identified USD/ILS benchmark for the website, native app and listing limits. */
export const USD_ILS_REFERENCE_SYMBOL = "WISE:USDILS";
// Wise publishes the rate timestamp separately from quote creation. Allow two
// minutes for its minute-scale rate updates; never turn receipt time into a tick.
export const FX_MAX_QUOTE_AGE_MS = 120_000;
export const FX_MAX_CLOSED_AGE_MS = 96 * 60 * 60 * 1000;
export const MAX_ILS_PRICE_OVER_MARKET = 0.35;

type FxReferenceQuote = {
  price: number;
  source: string;
  quotedAt?: string;
  validUntil?: string;
  quoteStatus?: string;
};

/** Web, native and server must agree on source, age and the listing ceiling. */
export function isFxPairUsable(pair: FxReferenceQuote | undefined, now = Date.now()) {
  if (!pair || pair.source !== USD_ILS_REFERENCE_SYMBOL || !Number.isFinite(pair.price) || pair.price < 2 || pair.price > 10) return false;
  const quotedAt = Date.parse(pair.quotedAt ?? "");
  const validUntil = Date.parse(pair.validUntil ?? "");
  if (!Number.isFinite(quotedAt) || !Number.isFinite(validUntil) || quotedAt > now + 5_000 || validUntil <= now) return false;
  if (pair.quoteStatus === "live") return now - quotedAt <= FX_MAX_QUOTE_AGE_MS && validUntil <= quotedAt + FX_MAX_QUOTE_AGE_MS;
  return pair.quoteStatus === "closed" && now - quotedAt <= FX_MAX_CLOSED_AGE_MS && validUntil <= quotedAt + FX_MAX_CLOSED_AGE_MS;
}

/** Whole-cent settlement prices strictly inside the unrounded reference band. */
export function getIlsReferencePriceBounds(rate: number) {
  if (!Number.isFinite(rate) || rate < 2 || rate > 10) return null;
  // Treat the provider's decimal quote exactly. Rounding the reference first
  // can permit a cent outside the band; floating-point epsilon can do so too.
  const [whole, fraction = ""] = String(rate).split(".");
  const scale = BigInt(10) ** BigInt(fraction.length);
  const reference = (BigInt(whole!) * scale + BigInt(fraction || "0")) * BigInt(100);
  const variance = BigInt(Math.round(MAX_ILS_PRICE_OVER_MARKET * 100)) * scale;
  const minimumCents = (reference - variance + scale - BigInt(1)) / scale;
  const maximumCents = (reference + variance) / scale;
  return { minimumPrice: (Number(minimumCents) / 100).toFixed(2), maximumPrice: (Number(maximumCents) / 100).toFixed(2) };
}

/** Settlement is in cents. Never round the permitted ceiling upward. */
export function maximumIlsListingPrice(rate: number) {
  return Number(getIlsReferencePriceBounds(rate)?.maximumPrice ?? 0);
}
