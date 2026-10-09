import { DEFAULT_USD_ILS_RATE, getUsdtIlsReferenceRate } from "@/lib/market-service";

import { FX_UNAVAILABLE_MESSAGE, maximumIlsListingPrice } from "@/lib/fx-reference-policy";
export { MAX_ILS_PRICE_OVER_MARKET } from "@/lib/fx-reference-policy";
export const DEFAULT_USD_ILS_MARKET_RATE = DEFAULT_USD_ILS_RATE;

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchUsdIlsMarketRate() {
  return getUsdtIlsReferenceRate();
}

/** Validate the actual stored terms, including owner publication and retry paths. */
export async function assertListingPriceAtCurrentReference(input: { price: string; currency?: string }) {
  if (String(input.currency ?? "ILS").trim().toUpperCase() !== "ILS") return;
  if (!input.price.trim()) throw new Error("Price must be a positive number.");
  const marketRate = await fetchUsdIlsMarketRate();
  const error = getListingPriceValidationError({ ...input, marketRate });
  if (error) throw new Error(error);
}

export function getListingPriceValidationError(input: { price: string | number; currency?: string; marketRate?: string | number | null }) {
  const currency = String(input.currency ?? "ILS").trim().toUpperCase();
  if (currency !== "ILS") return null;

  const price = toNumber(input.price);
  const marketRate = toNumber(input.marketRate);
  // Empty price is used by non-price updates (description/inventory only).
  if (input.price === "") return null;
  if (!Number.isFinite(price) || price <= 0) return "Price must be a positive number.";
  if (!maximumIlsListingPrice(marketRate)) return FX_UNAVAILABLE_MESSAGE;

  const maxAllowed = maximumIlsListingPrice(marketRate);
  if (price > maxAllowed) {
    return `Price cannot exceed the USD/ILS reference rate plus ₪0.35. Maximum allowed price: ₪${maxAllowed.toFixed(2)}.`;
  }

  return null;
}
