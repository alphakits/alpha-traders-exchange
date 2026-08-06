import { DEFAULT_USD_ILS_RATE, getUsdtIlsReferenceRate } from "@/lib/market-service";

export const MAX_ILS_PRICE_OVER_MARKET = 0.35;
export const DEFAULT_USD_ILS_MARKET_RATE = DEFAULT_USD_ILS_RATE;

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchUsdIlsMarketRate() {
  return getUsdtIlsReferenceRate();
}

export function getListingPriceValidationError(input: { price: string | number; currency?: string; marketRate?: string | number | null }) {
  const currency = String(input.currency ?? "ILS").trim().toUpperCase();
  if (currency !== "ILS") return null;

  const price = toNumber(input.price);
  const marketRate = toNumber(input.marketRate);
  if (!price || !marketRate) return null;

  const maxAllowed = marketRate + MAX_ILS_PRICE_OVER_MARKET;
  if (price > maxAllowed) {
    return `Price cannot exceed the live USD/ILS rate plus ₪0.35. Maximum allowed price: ₪${maxAllowed.toFixed(2)}.`;
  }

  return null;
}
