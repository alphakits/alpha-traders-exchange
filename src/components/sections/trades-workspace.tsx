"use client";

import { useEffect, useId, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { currencyText } from "@/components/ui/currency-text";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { groupOwnTrades, type TradeWorkspaceSide } from "@/lib/trades-workspace";
import { buildTradeRoomDestination } from "@/lib/trade-room-destination";
import { getTradeStatusDisplayLabel } from "@/lib/trade-workflow";
import type { PurchaseRequest } from "@/types/alpha-exchange";

export function TradeRequestGroups({ requests, userId, side, locale }: {
  requests: readonly PurchaseRequest[]; userId: string; side: TradeWorkspaceSide; locale: "en" | "ar";
}) {
  const isAr = locale === "ar";
  const groups = groupOwnTrades(requests, userId, side);
  const id = useId();
  function tradeCard(request: PurchaseRequest, completed = false) {
    const amount = Number(request.usdtAmount);
    const date = new Date(completed ? request.completedAt ?? request.updatedAt : request.createdAt);
    return <article key={request.id} className="min-w-0 rounded-2xl border border-white/10 bg-[#111318] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[#9CA3AF]"><bdi dir="ltr">{request.tradeId || (request.displayNumber ? `#${request.displayNumber}` : `#${request.id.slice(-8)}`)}</bdi></p>
          <p className="mt-1 text-xl font-semibold"><bdi dir="ltr">{currencyText(`${Number.isFinite(amount) ? amount.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"} USDT`)}</bdi></p>
          {side === "seller" && request.buyerName ? <p className="mt-1 break-words text-sm text-[#D1D5DB]"><bdi dir="auto">{currencyText(request.buyerName)}</bdi></p> : null}
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${completed ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-[#C9A227]/30 bg-[#C9A227]/10 text-[#F4D87A]"}`}>
          {currencyText(completed ? (isAr ? "مكتملة" : "Completed") : request.status === "payment_sent" ? (isAr ? "بانتظار تأكيد البائع" : "Waiting for seller confirmation") : getTradeStatusDisplayLabel(request.status, isAr))}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
        <time dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()} className="text-xs text-[#9CA3AF]">{Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(isAr ? "ar-IL-u-nu-latn" : "en-IL", { dateStyle: "medium", timeStyle: "short" })}</time>
        <Link href={buildTradeRoomDestination(request, userId)} className={buttonVariants({ variant: completed ? "secondary" : "default", size: "sm", className: "min-h-11" })}>
          {completed ? (isAr ? "عرض الصفقة" : "View trade") : request.status === "pending" && side === "seller" ? (isAr ? "مراجعة الطلب" : "Review request") : (isAr ? "فتح الصفقة" : "Open trade")}
          <ArrowRight className={`ms-2 h-4 w-4 ${isAr ? "rotate-180" : ""}`} aria-hidden="true" />
        </Link>
      </div>
    </article>;
  }
  return <div className="space-y-8">
    <section aria-labelledby={`${id}-active-trades`}>
      <h2 id={`${id}-active-trades`} className="mb-4 text-xl font-semibold">{side === "seller" ? (isAr ? "طلبات المشترين الجديدة والنشطة" : "New and active buyer requests") : (isAr ? "طلبات الشراء الجديدة والنشطة" : "Your new and active requests")} <span className="text-[#F4D87A]">({groups.active.length})</span></h2>
      {groups.active.length ? <div className="grid gap-3 md:grid-cols-2">{groups.active.map(request => tradeCard(request))}</div> : <p className="rounded-2xl border border-white/10 p-5 text-sm text-[#9CA3AF]">{isAr ? "لا توجد طلبات نشطة حالياً." : "No active requests right now."}</p>}
    </section>
    <section aria-labelledby={`${id}-completed-trades`}>
      <h2 id={`${id}-completed-trades`} className="mb-4 text-xl font-semibold">{side === "seller" ? (isAr ? "مبيعاتك المكتملة" : "Your completed sales") : (isAr ? "مشترياتك المكتملة" : "Your completed purchases")} <span className="text-[#9CA3AF]">({groups.completed.length})</span></h2>
      {groups.completed.length ? <div className="grid gap-3 md:grid-cols-2">{groups.completed.map(request => tradeCard(request, true))}</div> : <p className="rounded-2xl border border-white/10 p-5 text-sm text-[#9CA3AF]">{isAr ? "ستظهر صفقاتك المكتملة هنا." : "Your completed trades will appear here."}</p>}
    </section>
    {groups.closed.length ? <details className="rounded-2xl border border-white/10 p-4"><summary className="cursor-pointer py-2 text-sm text-[#9CA3AF]">{isAr ? "الطلبات الملغاة والمرفوضة" : "Cancelled and declined requests"} ({groups.closed.length})</summary><div className="mt-4 grid gap-3 md:grid-cols-2">{groups.closed.map(request => tradeCard(request))}</div></details> : null}
  </div>;
}

export function TradesWorkspace({ userId, sellerAccess, locale }: { userId: string; sellerAccess: boolean; locale: "en" | "ar" }) {
  const isAr = locale === "ar";
  const canonicalSession = useOptionalCanonicalSession();
  const activeUserId = canonicalSession ? canonicalSession.user?.id : userId;
  const [side, setSide] = useState<TradeWorkspaceSide>(sellerAccess ? "seller" : "buyer");
  const [data, setData] = useState<{ userId: string; requests: PurchaseRequest[] } | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    if (activeUserId !== userId) return;
    const controller = new AbortController();
    let inFlight = false;
    async function refresh() {
      if (controller.signal.aborted || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      setRefreshing(true);
      try {
        const response = await fetch("/api/alpha-exchange/purchase-requests", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Trade requests unavailable");
        const payload = await response.json() as { requests?: PurchaseRequest[] };
        if (!Array.isArray(payload.requests)) throw new Error("Invalid trade response");
        if (controller.signal.aborted) return;
        setData({ userId, requests: payload.requests.filter(request => request.buyerId === userId || request.sellerId === userId) });
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }
    const resume = () => { void refresh(); };
    resume();
    const timer = window.setInterval(resume, 12_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [activeUserId, userId, refreshVersion]);
  const ownRequests = activeUserId === userId && data?.userId === userId ? data.requests : null;
  return <section className="section-container page-shell pb-8">
    <div className="mb-6 flex items-center justify-between gap-4">
      <div><h1 className="text-3xl font-semibold">{isAr ? "صفقاتي" : "My trades"}</h1><p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "طلباتك الأحدث أولاً، ثم سجل الصفقات المكتملة." : "Your latest requests first, then your completed trade history."}</p></div>
      <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={() => setRefreshVersion(value => value + 1)} aria-label={isAr ? "تحديث الصفقات" : "Refresh trades"}><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" /></Button>
    </div>
    {sellerAccess ? <div className="mb-6 flex gap-2" role="group" aria-label={isAr ? "نوع الصفقات" : "Trade side"}>
      <Button type="button" variant={side === "seller" ? "default" : "secondary"} aria-pressed={side === "seller"} onClick={() => setSide("seller")}>{isAr ? "مبيعاتي" : "My sales"}</Button>
      <Button type="button" variant={side === "buyer" ? "default" : "secondary"} aria-pressed={side === "buyer"} onClick={() => setSide("buyer")}>{isAr ? "مشترياتي" : "My purchases"}</Button>
    </div> : null}
    {error ? <p role="status" className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">{ownRequests ? (isAr ? "تعذر التحديث. تظهر آخر صفقات تم تحميلها؛ اضغط تحديث للمحاولة مجدداً." : "Could not refresh. Your last loaded trades are shown; use Refresh to retry.") : (isAr ? "تعذر تحميل الصفقات. اضغط تحديث للمحاولة مجدداً." : "Could not load trades. Use Refresh to retry.")}</p> : null}
    {ownRequests ? <TradeRequestGroups requests={ownRequests} userId={userId} side={sellerAccess ? side : "buyer"} locale={locale} /> : !error ? <p role="status" className="rounded-2xl border border-white/10 p-6 text-[#9CA3AF]">{isAr ? "جارٍ تحميل طلباتك…" : "Loading your requests…"}</p> : null}
  </section>;
}
