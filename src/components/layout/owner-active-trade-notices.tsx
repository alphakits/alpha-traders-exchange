"use client";

import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { currencyText } from "@/components/ui/currency-text";
import { fetchClientJson } from "@/lib/client-request-deadline";
import { formatTradeId } from "@/lib/format-id";
import { marketplacePaymentMethodLabelForLocale } from "@/lib/marketplace-display-localization";
import { isPublicOwnerIdentity } from "@/lib/public-account-identity";
import type { OwnerActiveTradeSummary } from "@/lib/owner-active-trades";

const statusLabels: Record<string, [string, string]> = {
  accepted: ["Accepted", "مقبولة"],
  payment_sent: ["Payment sent", "تم إرسال الدفع"],
  funds_received: ["Funds received", "تم استلام الأموال"],
  usdt_release_pending: ["Awaiting USDT", "بانتظار إرسال USDT"],
  usdt_sent: ["USDT sent", "تم إرسال USDT"],
};

export function OwnerActiveTradeNotices({ locale, actorId, initialTrades }: {
  locale: AppLocale;
  actorId: string;
  initialTrades: OwnerActiveTradeSummary[];
}) {
  const { user, isRestoring } = useCanonicalSession();
  const pathname = usePathname();
  const [trades, setTrades] = useState(initialTrades);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const authorized = user?.id === actorId && isPublicOwnerIdentity(user) && !isRestoring;
  const isAr = locale === "ar";

  useEffect(() => {
    if (!authorized || forbidden) return;
    let stopped = false;
    let inFlight = false;
    let denied = false;
    let controller: AbortController | undefined;
    const visible = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
    const refresh = async () => {
      if (stopped || denied || inFlight || !visible()) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const { response, payload } = await fetchClientJson<{ actorId: string; trades: OwnerActiveTradeSummary[] }>(
          "/api/alpha-exchange/owner/active-trades",
          { cache: "no-store", credentials: "same-origin", signal: controller.signal },
          10_000,
        );
        if (stopped || denied || controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403 || (response.ok && payload.actorId !== actorId)) {
          denied = true;
          setForbidden(true);
          setTrades([]);
          return;
        }
        if (!response.ok || !Array.isArray(payload.trades)) throw new Error("Trade list unavailable");
        setTrades(payload.trades);
        setFailed(false);
      } catch {
        if (!stopped && !denied) setFailed(true);
      } finally {
        inFlight = false;
      }
    };
    const resume = () => { void refresh(); };
    const signOut = () => {
      denied = true;
      controller?.abort();
      setForbidden(true);
      setTrades([]);
    };
    resume();
    const timer = window.setInterval(resume, 15_000);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("alpha-auth-signed-out", signOut);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("alpha-auth-signed-out", signOut);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [actorId, authorized, forbidden, pathname]);

  if (!authorized || forbidden || (!trades.length && !failed)) return null;
  const normalizedPath = pathname.replace(/^\/(en|ar)(?=\/)/, "").replace(/\/$/, "");
  return <section className="section-container pb-2" dir={isAr ? "rtl" : "ltr"} aria-label={isAr ? "الصفقات النشطة للمالك" : "Owner active trades"} data-testid="owner-active-trades">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
      <h2 className="font-semibold text-emerald-200">{isAr ? "الصفقات النشطة" : "Active trades"} ({trades.length})</h2>
      {failed ? <p role="status" className="text-amber-200">{isAr ? "تعذّر تحديث الصفقات، جارٍ إعادة المحاولة…" : "Trade updates unavailable. Retrying…"}</p> : null}
    </div>
    <ul className="max-h-[44dvh] space-y-2 overflow-y-auto overscroll-contain pe-1" tabIndex={0} aria-label={isAr ? "قائمة الصفقات النشطة" : "Active trade list"}>
      {trades.map(trade => {
        const reference = formatTradeId(trade.displayNumber, trade.tradeId ?? trade.id);
        const destination = `/trade-room/${trade.id}`;
        const current = normalizedPath === destination;
        return <li key={trade.id} className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100" data-trade-id={trade.id}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="flex min-w-0 items-center gap-2 font-semibold text-emerald-300"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />{isAr ? "صفقة" : "Trade"} <bdi dir="ltr" className="[overflow-wrap:anywhere]">{reference}</bdi></p>
            <span className="rounded-full border border-emerald-400/20 px-2 py-0.5 text-xs">{currencyText(statusLabels[trade.status]?.[isAr ? 1 : 0] ?? trade.status)}</span>
          </div>
          <div className="mt-1.5 grid min-w-0 gap-1 text-sm sm:grid-cols-2 sm:gap-x-4">
            <p className="min-w-0 [overflow-wrap:anywhere]"><span className="text-emerald-100/70">{isAr ? "البائع" : "Seller"}: </span><bdi className="font-medium text-white">{trade.sellerName}</bdi></p>
            <p className="min-w-0 [overflow-wrap:anywhere]"><span className="text-emerald-100/70">{isAr ? "المشتري" : "Buyer"}: </span><bdi className="font-medium text-white">{trade.buyerName}</bdi></p>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <bdi dir="ltr" className="font-semibold text-emerald-300">{currencyText(`${trade.usdtAmount} USDT · ${trade.fiatAmount} ${trade.currency}`)}</bdi>
              <span className="text-emerald-100/80">{marketplacePaymentMethodLabelForLocale(trade.paymentMethod, locale)}</span>
            </p>
            {current ? <span className="inline-flex min-h-11 shrink-0 items-center justify-center px-4 font-semibold text-emerald-300" aria-current="page">{isAr ? "تشاهد هذه الصفقة" : "Viewing this trade"}</span> :
              <Link href={destination} locale={locale} prefetch={false} aria-label={`${isAr ? "استئناف الصفقة" : "Resume Trade"} ${reference}`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-emerald-200/30 bg-emerald-100/10 px-4 py-2 text-center font-semibold transition hover:bg-emerald-100/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
                {isAr ? "استئناف الصفقة" : "Resume Trade"}
              </Link>}
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
