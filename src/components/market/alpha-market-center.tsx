"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMarketFeed } from "@/components/market/use-market-feed";

const TradingViewMarketCharts = dynamic(
  () => import("@/components/market/tradingview-market-charts").then((module) => module.TradingViewMarketCharts),
  {
    ssr: false,
    loading: () => <div className="h-[320px] animate-pulse rounded-2xl border border-white/10 bg-white/5" />,
  }
);

type Locale = "ar" | "en";

function formatPrice(value: number, key: "ethUsdt" | "btcUsdt" | "usdtIls") {
  if (key === "btcUsdt" || key === "ethUsdt") return `$${value.toLocaleString("en-US", { maximumFractionDigits: key === "ethUsdt" ? 2 : 0 })}`;
  return `₪${value.toFixed(2)}`;
}

function formatChange(changePercent: number | null) {
  if (changePercent === null) return "—";
  const direction = changePercent >= 0 ? "▲" : "▼";
  return `${direction}${Math.abs(changePercent).toFixed(2)}%`;
}

function ageLabel(updatedAt: string, now: number) {
  const updatedMs = new Date(updatedAt).getTime();
  if (!updatedMs) return "Updated just now";
  const seconds = Math.max(0, Math.floor((now - updatedMs) / 1000));
  return `Updated ${seconds} sec ago`;
}

export function AlphaMarketCenter({ locale, showCta = false }: { locale: Locale; showCta?: boolean }) {
  const { snapshot, isLoading, error } = useMarketFeed({ refreshMs: 45_000 });
  const [now, setNow] = useState(() => Date.now());
  const isAr = locale === "ar";

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (isLoading && !snapshot) {
    return (
      <Card className="border-white/10 bg-[#0B0B0B]/90">
        <CardContent className="space-y-4 p-6">
          <div className="h-5 w-52 animate-pulse rounded bg-white/10" />
          <div className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`market-skeleton-${index}`} className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!snapshot) return null;
  const cards = [snapshot.pairs.ethUsdt, snapshot.pairs.btcUsdt, snapshot.pairs.usdtIls];

  return (
    <Card className="border-white/10 bg-[#0B0B0B]/90">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">{isAr ? "مركز ألفا للسوق" : "Alpha Market Center"}</CardTitle>
            <CardDescription className="mt-1">
              {isAr ? "بيانات السوق المباشرة لحركة التداول في Alpha Exchange." : "Live market data powering Alpha Exchange pricing."}
            </CardDescription>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            LIVE
          </div>
        </div>
        <p className="text-xs text-[#9CA3AF]">{ageLabel(snapshot.updatedAt, now)}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          {cards.map((pair) => {
            const positive = pair.changePercent !== null && pair.changePercent >= 0;
            return (
              <div key={pair.key} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{pair.label}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{formatPrice(pair.price, pair.key)}</p>
                <div className={`mt-2 inline-flex items-center gap-1 text-xs ${positive ? "text-emerald-300" : "text-rose-300"}`}>
                  <ArrowUpRight className={`h-3.5 w-3.5 ${positive ? "" : "rotate-90"}`} />
                  {formatChange(pair.changePercent)}
                </div>
                <p className="mt-2 text-xs text-[#9CA3AF]">{pair.reference ?? pair.source}</p>
              </div>
            );
          })}
        </div>

        <TradingViewMarketCharts locale={locale} />

        <div className="rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10 p-4 text-sm text-[#E5E7EB]">
          <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "كيف يعمل التسعير" : "How pricing works"}</p>
          <p className="mt-2 leading-6">
            {isAr
              ? "يتم تقييد أسعار البائعين مقارنةً بمرجع USD/ILS المباشر لضمان تسعير عادل. كل بائع معتمد يلتزم بنفس سياسة التسعير."
              : "Seller prices are capped relative to the live USD/ILS reference to protect buyers from unreasonable pricing. Every approved seller follows the same pricing policy."}
          </p>
        </div>

        {snapshot.status !== "live" || error ? (
          <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">{isAr ? "السوق غير متاح مؤقتًا" : "Market temporarily unavailable."}</p>
                <p className="text-xs text-amber-100/90">{isAr ? "يتم استخدام آخر سعر معروف حاليًا." : "Using last known price."}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {isAr ? "تحديث السوق نشط." : "Market feed is healthy."}
          </div>
        )}

        {showCta ? (
          <Link
            href="/usdt-exchange"
            className={cn(buttonVariants(), "w-full sm:w-auto")}
          >
            {isAr ? "استكشف Alpha Exchange" : "Explore Alpha Exchange"}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
