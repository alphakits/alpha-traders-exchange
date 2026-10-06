"use client";

import type { AppLocale } from "@/i18n/routing";
import type { OwnerActiveTradeSummary } from "@/lib/owner-active-trades";
import { ActiveTradeNotices } from "./active-trade-notices";

export function OwnerActiveTradeNotices(props: { locale: AppLocale; actorId: string; initialTrades: OwnerActiveTradeSummary[] }) {
  return <ActiveTradeNotices {...props} audience="owner" />;
}
