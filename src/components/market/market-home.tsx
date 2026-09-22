"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Handshake, Store } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { useMarketFeed } from "./use-market-feed";
import { MarketStrip } from "./market-strip";
import { NetworkGlobe } from "./network-globe";
import { RankGuide } from "./rank-guide";
import type { PurchaseRequest } from "@/types/alpha-exchange";

export function MarketHome({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const { user } = useCanonicalSession();
  const userId = user?.id;
  const { snapshot } = useMarketFeed();
  const [listings, setListings] = useState<number | null>(null);
  const [activeTrades, setActiveTrades] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (document.hidden) return;
      void fetch("/api/alpha-exchange/listings", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data.listings)) setListings(data.listings.length);
      }).catch(() => undefined);
      if (userId) void fetch("/api/alpha-exchange/purchase-requests", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { requests: PurchaseRequest[] };
        setActiveTrades(data.requests.filter((trade) => (trade.buyerId === userId || trade.sellerId === userId) && !["completed", "review_open", "locked", "declined", "cancelled"].includes(trade.status)).length);
      }).catch(() => undefined);
    };
    setActiveTrades(null);
    load();
    const interval = window.setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", load); };
  }, [userId]);
  return <section className="section-container py-5 sm:py-8">
    <div className="relative rounded-3xl border border-[#D4AF37]/20 bg-[#0b1018] p-5 sm:p-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl"><NetworkGlobe /></div>
      <div className="absolute right-4 top-4"><RankGuide locale={locale} /></div>
      <div className="relative max-w-xl pr-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#D4AF37]">ALPHA MARKET</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">{user ? (isAr ? `أهلًا، ${user.fullName.split(" ")[0]}` : `Welcome, ${user.fullName.split(" ")[0]}`) : (isAr ? "سوقك. خطوتك التالية." : "Your market. Your next move.")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">{isAr ? "أسعار السوق وبائعون معتمدون، في مكان واحد." : "Market prices and approved sellers, all in one place."}</p>
        <Link href="/trade" locale={locale} className="mt-5 inline-flex min-h-11 items-center gap-3 rounded-xl bg-[#D4AF37] px-5 text-sm font-semibold text-black transition hover:bg-[#ebce73]">{isAr ? "تصفّح البائعين" : "Browse sellers"}<ArrowUpRight size={17} /></Link>
      </div>
    </div>
    <div className="my-4 grid grid-cols-2 gap-3">
      {[{ href: "/trade", label: isAr ? "العروض المباشرة" : "Live listings", value: listings, icon: Store }, { href: user ? "/trade?section=trade-history" : "/login?redirectTo=/trade", label: isAr ? "صفقاتك النشطة" : "Your active trades", value: activeTrades, icon: Handshake }].map((item) => <Link key={item.href} href={item.href} locale={locale} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0d1118] p-4 transition hover:border-[#D4AF37]/40">
        <div><p className="text-xs text-slate-400">{item.label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{item.value ?? "—"}</p></div><item.icon className="h-5 w-5 text-[#D4AF37]" />
      </Link>)}
    </div>
    <MarketStrip locale={locale} snapshot={snapshot} />
    <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-400">
      <Link href="/academy" locale={locale} className="hover:text-white">{isAr ? "الأكاديمية" : "Academy"}</Link>
      <Link href="/help-center" locale={locale} className="hover:text-white">{isAr ? "مركز المساعدة" : "Help center"}</Link>
    </div>
  </section>;
}
