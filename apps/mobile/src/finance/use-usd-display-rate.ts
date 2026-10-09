import { useQuery } from "@tanstack/react-query";
import { isFxPairUsable } from "@alpha-traders/contracts";
import { getPublicMarketSnapshot } from "../api/mobile-api";
import { useLocale } from "../i18n/locale-context";
import { DEFAULT_USD_ILS_DISPLAY_RATE, financialNumber } from "./financial-display";

export function useUsdDisplayReference() {
  const { locale } = useLocale();
  const query = useQuery({
    queryKey: ["public-market-center", locale],
    queryFn: ({ signal }) => getPublicMarketSnapshot(locale, signal),
    refetchInterval: 5_000,
    staleTime: 5_000,
  });
  const rate = financialNumber(query.data?.snapshot.pairs.usdtIls.price);
  const pair = query.data?.snapshot.pairs.usdtIls;
  const available = Boolean(!query.error && pair
    && !query.data?.snapshot.unavailablePairs.includes("usdtIls")
    && isFxPairUsable(pair));
  // Legacy display conversion is retained for existing history screens only.
  // New/edited listings use `available` and never submit against this fallback.
  return { rate: rate >= 2 && rate <= 10 ? rate : DEFAULT_USD_ILS_DISPLAY_RATE, available, quote: pair };
}

export function useUsdDisplayRate() {
  return useUsdDisplayReference().rate;
}
