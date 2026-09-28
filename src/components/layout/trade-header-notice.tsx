"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getLocalizedTradeReminderDisplay } from "@/lib/trade-reminder-localization";
import { getTradeHeaderReminderKind, isTradeHeaderActivityResolved, readTradeHeaderActivity, subscribeTradeHeaderActivity, type TradeHeaderActivity } from "@/lib/trade-header-activity";

const serverSnapshot = () => null;

export function TradeHeaderNotice({ locale, actorId, initialTrade, counterpartyName }: {
  locale: AppLocale;
  actorId: string;
  initialTrade: TradeHeaderActivity | null;
  counterpartyName: string | null;
}) {
  const pathname = usePathname();
  const getSnapshot = useCallback(() => readTradeHeaderActivity(actorId), [actorId]);
  const current = useSyncExternalStore(subscribeTradeHeaderActivity, getSnapshot, serverSnapshot);
  const trade = current && (!initialTrade || Date.parse(current.updatedAt) >= Date.parse(initialTrade.updatedAt)) ? current : initialTrade;
  if (!trade || isTradeHeaderActivityResolved(trade, actorId)) return null;
  const destination = `/trade-room/${trade.id}`;
  const normalizedPath = pathname.replace(/^\/(en|ar)(?=\/)/, "").replace(/\/$/, "");
  // The room already has the authoritative next action. A second sticky banner
  // both obscures that action and sends the user back to the page they are on.
  if (normalizedPath === destination) return null;
  const kind = getTradeHeaderReminderKind(trade, actorId);
  const reminder = kind ? getLocalizedTradeReminderDisplay({ kind, displayNumber: trade.displayNumber, tradeId: trade.tradeId ?? trade.id }, locale) : null;
  const counterpart = trade.id === initialTrade?.id && counterpartyName
    ? counterpartyName
    : trade.sellerId === actorId ? (locale === "ar" ? "المشتري" : "buyer") : (locale === "ar" ? "البائع" : "seller");

  return <div className="section-container pb-2" data-testid="trade-header-notice">
    <div className={`flex flex-col items-stretch justify-between gap-2 rounded-xl px-3 py-2 text-xs sm:flex-row sm:items-center ${reminder ? "border border-amber-400/35 bg-amber-500/10 text-amber-100" : "border border-emerald-400/35 bg-emerald-500/10 text-emerald-100"}`}>
      <p className="min-w-0 leading-5">{reminder ? <>
        🔔 <span className="font-semibold text-white">{reminder.title}</span> — {reminder.messageBeforeReference}{" "}
        <bdi dir="ltr" className="font-semibold text-white">{reminder.reference}</bdi>{" "}{reminder.messageAfterReference}
      </> : <>
        🟢 {locale === "ar" ? "صفقة نشطة" : "Active Trade"} — {locale === "ar" ? "تابع الصفقة مع" : "Continue trade with"}{" "}
        <span className="font-semibold text-white">{counterpart}</span>
      </>}</p>
      <Link href={destination} locale={locale} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-current/40 bg-white/10 px-4 py-2 text-center text-xs font-semibold transition hover:bg-white/15 sm:min-h-0 sm:py-1">
        {reminder?.actionLabel ?? (locale === "ar" ? "استئناف الصفقة" : "Resume Trade")}
      </Link>
    </div>
  </div>;
}
