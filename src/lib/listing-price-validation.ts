const MAX_ILS_PRICE_OVER_MARKET = 0.35;
const DEFAULT_USD_ILS_MARKET_RATE = 39.2;

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchUsdIlsMarketRate() {
  const configured = process.env.ALPHA_EXCHANGE_USD_ILS_RATE;
  if (configured && configured.trim()) {
    const parsed = toNumber(configured);
    if (parsed > 0) return parsed;
  }

  if (typeof globalThis.fetch !== "function") return DEFAULT_USD_ILS_MARKET_RATE;

  const urls = [
    "https://api.exchangerate.host/latest?base=USD&symbols=ILS",
    "https://api.frankfurter.app/latest?from=USD&to=ILS",
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json() as { rates?: Record<string, number>; amount?: number; base?: string; quotes?: Record<string, number> };
      const rate = payload.rates?.ILS ?? payload.quotes?.USDILS ?? payload.quotes?.USDILS;
      if (rate && Number.isFinite(rate) && rate > 0) return Number(rate);
    } catch {
      continue;
    }
  }

  return DEFAULT_USD_ILS_MARKET_RATE;
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
