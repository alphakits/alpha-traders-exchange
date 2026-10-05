"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
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
  const [disclosure, setDisclosure] = useState({ pathname, expanded: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const triggerId = useId();
  const authorized = user?.id === actorId && isPublicOwnerIdentity(user) && !isRestoring;
  const isAr = locale === "ar";
  // A route change must never carry an open panel into the next trade room.
  if (disclosure.pathname !== pathname || (disclosure.expanded && (!authorized || forbidden || !trades.length))) {
    setDisclosure({ pathname, expanded: false });
  }
  const expanded = disclosure.pathname === pathname && disclosure.expanded && authorized && !forbidden && trades.length > 0;
  const close = () => setDisclosure({ pathname, expanded: false });

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setDisclosure({ pathname, expanded: false });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded, pathname]);

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
    <div ref={containerRef} className="relative" onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
    }} onKeyDown={event => {
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    }}>
      <button ref={triggerRef} id={triggerId} type="button" aria-expanded={expanded} aria-controls={panelId}
        aria-label={`${isAr ? "الصفقات النشطة" : "Active trades"} (${trades.length})`}
        onClick={() => setDisclosure({ pathname, expanded: !expanded })}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 text-sm text-emerald-100 transition hover:bg-emerald-500/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          {isAr ? "الصفقات النشطة" : "Active trades"}
          <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-xs tabular-nums text-emerald-300">{trades.length}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-200/80" aria-hidden="true">
          {expanded ? (isAr ? "إخفاء" : "Hide") : (isAr ? "عرض" : "View")}
          <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>
      {failed ? <p role="status" className="mt-1 text-xs text-amber-200">{isAr ? "تعذّر تحديث الصفقات، جارٍ إعادة المحاولة…" : "Trade updates unavailable. Retrying…"}</p> : null}
      <div id={panelId} role="region" aria-labelledby={triggerId} hidden={!expanded}
        className="absolute inset-x-0 top-full z-50 mt-2 max-h-[min(60dvh,calc(100dvh-12rem))] overflow-y-auto overscroll-contain rounded-2xl border border-emerald-400/25 bg-[#081411] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.65)] sm:inset-x-auto sm:end-0 sm:w-[min(40rem,100%)]">
        <ul className="space-y-2" aria-label={isAr ? "قائمة الصفقات النشطة" : "Active trade list"}>
          {trades.map(trade => {
            const reference = formatTradeId(trade.displayNumber, trade.tradeId ?? trade.id);
            const destination = `/trade-room/${trade.id}`;
            const current = normalizedPath === destination;
            return <li key={trade.id} className="rounded-xl border border-emerald-400/15 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100" data-trade-id={trade.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-emerald-300"><bdi dir="ltr" className="[overflow-wrap:anywhere]">{reference}</bdi></p>
                  <p className="mt-0.5 text-xs text-emerald-100/70">{currencyText(statusLabels[trade.status]?.[isAr ? 1 : 0] ?? trade.status)}</p>
                </div>
                {current ? <span className="inline-flex min-h-11 shrink-0 items-center text-xs font-medium text-emerald-300" aria-current="page">{isAr ? "مفتوحة الآن" : "Viewing"}</span> :
                  <Link href={destination} locale={locale} prefetch={false} onClick={close} aria-label={`${isAr ? "استئناف الصفقة" : "Resume Trade"} ${reference}`} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 text-xs font-semibold transition hover:bg-emerald-300/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
                    {isAr ? "فتح" : "Open"}<ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 rtl:-scale-x-100" />
                  </Link>}
              </div>
              <div className="mt-2 grid min-w-0 gap-1 text-xs sm:grid-cols-2 sm:gap-x-4">
                <p className="min-w-0 [overflow-wrap:anywhere]"><span className="text-emerald-100/70">{isAr ? "البائع" : "Seller"}: </span><bdi className="font-medium text-white">{trade.sellerName}</bdi></p>
                <p className="min-w-0 [overflow-wrap:anywhere]"><span className="text-emerald-100/70">{isAr ? "المشتري" : "Buyer"}: </span><bdi className="font-medium text-white">{trade.buyerName}</bdi></p>
              </div>
              <div className="mt-2 border-t border-emerald-400/10 pt-2">
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <bdi dir="ltr" className="font-semibold text-emerald-300">{currencyText(`${trade.usdtAmount} USDT · ${trade.fiatAmount} ${trade.currency}`)}</bdi>
                  <span className="text-emerald-100/80">{marketplacePaymentMethodLabelForLocale(trade.paymentMethod, locale)}</span>
                </p>
              </div>
            </li>;
          })}
        </ul>
      </div>
    </div>
  </section>;
}
