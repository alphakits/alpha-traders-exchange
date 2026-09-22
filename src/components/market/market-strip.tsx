"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { MarketSnapshot } from "@/types/market";
import { FX_CURRENCIES, type FxCurrency, type FxReference } from "@/lib/fx-reference";

export function MarketStrip({ locale, snapshot, compact = false }: { locale: "ar" | "en"; snapshot: MarketSnapshot | null; compact?: boolean }) {
  const isAr = locale === "ar";
  const [fx, setFx] = useState<FxReference | null>(null);
  const [failed, setFailed] = useState(false);
  const [currency, setCurrency] = useState<FxCurrency>("EUR");
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("alpha-display-currency") as FxCurrency;
      if (FX_CURRENCIES.includes(stored)) setCurrency(stored);
    } catch { /* Optional local preference. */ }
    const controller = new AbortController();
    void fetch("/api/market/fx", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("FX unavailable");
      const data = await response.json() as FxReference;
      if (!data?.rates || !Array.isArray(data.history) || !data.date) throw new Error("Invalid FX reference");
      setFx(data);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  const pairs = snapshot ? [snapshot.pairs.btcUsdt, snapshot.pairs.ethUsdt] : [];
  const points = fx?.history ?? [];
  const min = Math.min(...points.map((point) => point.rate));
  const max = Math.max(...points.map((point) => point.rate));
  const range = max - min || 1;
  const path = points.map((point, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(1, points.length - 1)) * 280},${42 - ((point.rate - min) / range) * 34}`).join(" ");
  const price = (value?: number) => value === undefined ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return <div className={`market-strip overflow-hidden rounded-2xl border border-white/10 bg-[#0d1118]/90 ${compact ? "market-strip--compact" : ""}`}>
    <div className="flex h-9 items-center border-b border-white/10" dir="ltr">
      <span className="shrink-0 border-r border-white/10 px-3 text-[10px] font-semibold tracking-widest text-[#D4AF37]">{isAr ? "السوق" : "MARKET"}</span>
      <div className="min-w-0 flex-1 overflow-hidden" aria-label={isAr ? "أسعار الأصول" : "Asset prices"}>
        <div className={`market-ticker flex w-max gap-10 px-4 text-xs ${paused ? "market-ticker--paused" : ""}`}>
          {[0, 1].map((copy) => <div key={copy} className="flex gap-10" aria-hidden={copy === 1 ? true : undefined}>
            {pairs.length ? pairs.map((pair) => <span key={pair.key} className="whitespace-nowrap text-slate-400">
              {pair.label} <b className="ml-2 tabular-nums text-white">{pair.source?.startsWith("fallback:") || snapshot?.unavailablePairs?.includes(pair.key) ? "—" : `$${price(pair.price)}`}</b>
            </span>) : <span className="text-slate-400">BTC / USDT — &nbsp; ETH / USDT —</span>}
          </div>)}
        </div>
      </div>
      <button type="button" onClick={() => setPaused((value) => !value)} className="flex h-9 w-10 shrink-0 items-center justify-center text-slate-400" aria-label={paused ? (isAr ? "تشغيل شريط الأسعار" : "Play price ticker") : (isAr ? "إيقاف شريط الأسعار" : "Pause price ticker")}>{paused ? <Play size={12} /> : <Pause size={12} />}</button>
    </div>
    <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-2 ${compact ? "px-3 py-2" : "p-5"}`}>
      <div>
        <p className="text-[10px] font-medium tracking-wider text-slate-400" dir="ltr">USD / ILS</p>
        <p className={`${compact ? "text-xl" : "text-3xl"} font-semibold tabular-nums text-white`}><bdi>₪{price(fx?.rates.ILS)}</bdi></p>
      </div>
      {points.length > 1 ? <svg viewBox="0 0 280 48" className={compact ? "h-9 w-16 min-[360px]:w-24 sm:w-40" : "h-16 w-36 sm:w-64"} role="img" aria-label={isAr ? "أسعار الدولار مقابل الشيكل خلال 30 يومًا" : "USD/ILS daily reference rates over 30 days"}><path d={path} fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" /></svg> : null}
      <div className="flex items-center gap-2 text-xs" dir="ltr"><span className={compact ? "hidden text-slate-400 sm:inline" : "text-slate-400"}>1 USD =</span><strong className="tabular-nums">{price(fx?.rates[currency])}</strong>
        <select aria-label={isAr ? "عملة العرض" : "Display currency"} value={currency} onChange={(event) => {
          const value = event.target.value as FxCurrency;
          setCurrency(value);
          try { localStorage.setItem("alpha-display-currency", value); } catch { /* Optional local preference. */ }
        }} className="h-9 rounded-lg border border-white/15 bg-[#171d28] px-2 text-xs text-white">{FX_CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select>
      </div>
    </div>
    <p className={`text-[10px] text-slate-500 ${compact ? "px-3 pb-2" : "px-5 pb-4"}`}>
      {fx ? `${isAr ? "أسعار مرجعية يومية" : "Daily reference rates"} · ${fx.date} · Frankfurter` : failed ? (isAr ? "الأسعار المرجعية غير متاحة مؤقتًا" : "Reference rates temporarily unavailable") : (isAr ? "جاري تحميل الأسعار المرجعية…" : "Loading reference rates…")}
    </p>
  </div>;
}
