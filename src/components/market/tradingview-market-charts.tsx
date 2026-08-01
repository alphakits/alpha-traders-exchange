"use client";

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

function TradingViewFrame({ title, symbol, locale }: { title: string; symbol: string; locale: Locale }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <div className="border-b border-white/10 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{title}</div>
      <iframe
        title={title}
        src={tradingViewUrl(symbol, locale)}
        loading="lazy"
        className="h-[320px] w-full border-0"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    </div>
  );
}

export function TradingViewMarketCharts({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"usdIls" | "btcUsdt">("usdIls");
  const tabs = useMemo(() => ([
    { key: "usdIls", label: "USD/ILS", symbol: "FX_IDC:USDILS" },
    { key: "btcUsdt", label: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
  ] as const), []);

  const active = tabs.find((item) => item.key === tab) ?? tabs[0];

  return (
    <div className="space-y-3">
      <div className="hidden gap-4 md:grid md:grid-cols-2">
        {tabs.map((item) => (
          <TradingViewFrame key={item.key} title={item.label} symbol={item.symbol} locale={locale} />
        ))}
      </div>
      <div className="md:hidden">
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
              {item.label}
            </button>
          ))}
        </div>
        <TradingViewFrame title={active.label} symbol={active.symbol} locale={locale} />
      </div>
    </div>
  );
}
