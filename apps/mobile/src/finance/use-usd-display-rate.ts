import { useQuery } from "@tanstack/react-query";
import { getPublicMarketSnapshot } from "../api/mobile-api";
import { useLocale } from "../i18n/locale-context";
import { DEFAULT_USD_ILS_DISPLAY_RATE, financialNumber } from "./financial-display";

export function useUsdDisplayRate() {
  const { locale } = useLocale();
  const query = useQuery({
    queryKey: ["public-market-center", locale],
    queryFn: ({ signal }) => getPublicMarketSnapshot(locale, signal),
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
  const rate = financialNumber(query.data?.snapshot.pairs.usdtIls.price);
  return rate >= 2 && rate <= 10 ? rate : DEFAULT_USD_ILS_DISPLAY_RATE;
}
