"use client";

import { currencyText } from "@/components/ui/currency-text";
import { useMemo, useState } from "react";

type Locale = "ar" | "en";

function tradingViewUrl(symbol: string, locale: Locale) {
  const params = new URLSearchParams({
    symbol,
    interval: "60",
    theme: "dark",
    style: "1",
    locale: locale === "ar" ? "ar_AE" : "en",
    hide_top_toolbar: "1",
    hide_legend: "1",
    saveimage: "0",
    withdateranges: "1",
    range: "1D",
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

function TradingViewFrame({ title, symbol, locale, isNativeApp }: { title: string; symbol: string; locale: Locale; isNativeApp: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <div className="border-b border-white/10 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{currencyText(title)}</div>
      {isNativeApp ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-[#B9C0CD]">
            {locale === "ar" ? "افتح مخطط TradingView التفاعلي في المتصفح." : "Open the interactive TradingView chart in your browser."}
          </p>
          <a
            href={tradingViewUrl(symbol, locale)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#C9A227]/50 bg-[#C9A227]/10 px-5 py-2 text-sm font-semibold text-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"
          >
            {locale === "ar" ? "فتح المخطط في المتصفح" : "Open chart in browser"}
          </a>
        </div>
      ) : <iframe
        title={title}
        src={tradingViewUrl(symbol, locale)}
        loading="lazy"
        inert
        tabIndex={-1}
        className="pointer-events-none h-[320px] w-full border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C9A227]"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />}
    </div>
  );
}

export function TradingViewMarketCharts({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"ethUsdt" | "btcUsdt">("ethUsdt");
  // This component is loaded with ssr:false. Avoid iframe requests even in
  // older installed shells that hand third-party frames straight to Safari.
  const [isNativeApp] = useState(() => typeof window !== "undefined"
    && typeof window.ReactNativeWebView?.postMessage === "function");
  const tabs = useMemo(() => ([
    { key: "ethUsdt", label: "ETH/USDT", symbol: "BINANCE:ETHUSDT" },
    { key: "btcUsdt", label: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
  ] as const), []);

  const active = tabs.find((item) => item.key === tab) ?? tabs[0];

  return (
    <div className="space-y-3">
      <div className="mb-3 flex gap-2 rounded-2xl border border-white/10 bg-[#0A0A0A]/90 p-1">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              tab === item.key
                ? "bg-[#C9A227]/15 text-[#D4AF37]"
                : "text-[#9CA3AF] hover:bg-white/5 hover:text-white"
            }`}
            onClick={() => setTab(item.key)}
          >
            {currencyText(item.label)}
          </button>
        ))}
      </div>
      <TradingViewFrame title={active.label} symbol={active.symbol} locale={locale} isNativeApp={isNativeApp} />
    </div>
  );
}
