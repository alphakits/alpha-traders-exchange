"use client";

import type { AppLocale } from "@/i18n/routing";
import type { SellerActiveTradeSummary } from "@/lib/seller-active-trades";
import { ActiveTradeNotices } from "./active-trade-notices";

export function SellerActiveTradeNotices(props: { locale: AppLocale; actorId: string; initialTrades: SellerActiveTradeSummary[] }) {
  return <ActiveTradeNotices {...props} audience="seller" />;
}
