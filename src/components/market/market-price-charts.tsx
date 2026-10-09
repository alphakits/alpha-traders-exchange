"use client";

import { CryptoMarketCard } from "@/components/market/live-market-cards";

export function MarketPriceCharts({ locale }: { locale: "ar" | "en" }) {
  return <div className="grid min-w-0 gap-3 md:grid-cols-2" data-market-charts>
    <CryptoMarketCard symbol="BTCUSDT" locale={locale} />
    <CryptoMarketCard symbol="ETHUSDT" locale={locale} />
  </div>;
}
