"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, BellOff, CalendarDays, Folder, RefreshCw } from "lucide-react";
import { brandText } from "@/components/ui/currency-text";
import { Button } from "@/components/ui/button";
import type { NewsLocale } from "@/lib/economic-news/model";

export function TradingViewNewsPage({ locale, eventId }: { locale: NewsLocale; eventId?: string }) {
  const isAr = locale === "ar";
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [surface, setSurface] = useState<"checking" | "browser" | "native">("checking");
  const calendarUrl = isAr ? "https://ar.tradingview.com/economic-calendar/" : "https://www.tradingview.com/economic-calendar/";
  // This cross-origin frame is produced by TradingView's official generator.
  // Its browser APIs work without vendor scripts accessing our account page.
  const widgetConfig = {
    colorTheme: "dark", isTransparent: false, countryFilter: "us",
    importanceFilter: "0,1", width: "100%", height: "100%",
    utm_source: "www.alphatraders.co.il", utm_medium: "widget_new", utm_campaign: "events",
  };
  const widgetSrc = `https://www.tradingview-widget.com/embed-widget/events/?locale=${isAr ? "ar_AE" : "en"}#${encodeURIComponent(JSON.stringify(widgetConfig))}`;

  useEffect(() => {
    // Existing app builds intentionally block third-party subframe navigation.
    // Detect the shell before creating a frame to avoid an unsolicited browser
    // launch by the native origin whitelist. The user opens it explicitly.
    setSurface(typeof window.ReactNativeWebView?.postMessage === "function" ? "native" : "browser");
  }, []);

  useEffect(() => {
    setLoaded(false);
    setDelayed(false);
    if (surface !== "browser") return;
    const timer = setTimeout(() => setDelayed(true), 20_000);
    return () => clearTimeout(timer);
  }, [locale, attempt, surface]);

  return (
    <div className="section-container py-6 sm:py-9" dir={isAr ? "rtl" : "ltr"}>
      <div className="mx-auto min-w-0 max-w-5xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D4AF37]">{brandText("ALPHA TRADERS")}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{isAr ? "أخبار الدولار" : "USD news"}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#9CA3AF]">{isAr ? "تابع مواعيد الأخبار الاقتصادية الأمريكية المهمة، والتوقعات والنتائج عند نشرها." : "Follow key US economic releases, forecasts and results as they are published."}</p>
          </div>
          {surface !== "native" ? <Button variant="secondary" size="icon" aria-label={isAr ? "إعادة تحميل التقويم" : "Reload calendar"} onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button> : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-3 text-xs">
          <span className="inline-flex items-center gap-2 text-red-300"><Folder className="h-4 w-4 fill-red-400/20" aria-hidden="true" />USD · {isAr ? "أهمية عالية" : "High importance"}</span>
          <span className="text-[#BAC2CF]">{isAr ? "المصدر والتصنيف: TradingView" : "Source and importance ratings: TradingView"}</span>
        </div>

        {eventId ? <p role="status" className="mt-4 text-sm text-[#BAC2CF]">{isAr ? "الخبر المرتبط غير متاح في هذا العرض. يمكنك متابعة الأحداث في التقويم أدناه." : "The linked event is unavailable in this view. Browse the calendar below."}</p> : null}
        {surface !== "native" && !loaded ? <p role="status" className="mt-4 text-sm text-[#BAC2CF]">{delayed ? (isAr ? "تحميل التقويم يستغرق وقتًا أطول. جرّب إعادة التحميل أو افتحه لدى TradingView." : "The calendar is taking longer to load. Try reloading or open it on TradingView.") : (isAr ? "جارٍ تحميل التقويم…" : "Loading calendar…")}</p> : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#131722]">
          {surface === "native" ? <div className="px-5 py-8 text-center sm:py-10">
            <CalendarDays className="mx-auto h-8 w-8 text-[#D4AF37]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-white">{isAr ? "تقويم أخبار الدولار" : "USD economic calendar"}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#BAC2CF]">{isAr ? "يفتح التقويم في متصفحك مع اختيار الأخبار الأمريكية عالية الأهمية." : "The calendar opens in your browser with high-importance US events selected."}</p>
            <a href={widgetSrc} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{isAr ? "فتح تقويم الأخبار" : "Open news calendar"}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>
          </div> : surface === "browser" ? <iframe
            key={`${locale}-${attempt}`}
            title={isAr ? "تقويم أخبار الدولار من TradingView" : "TradingView USD economic calendar"}
            src={widgetSrc}
            className="block h-[640px] w-full border-0 sm:h-[720px]"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="origin"
            onLoad={() => setLoaded(true)}
            onError={() => { setLoaded(false); setDelayed(true); }}
          /> : <div className="h-[640px] sm:h-[720px]" aria-hidden="true" />}
          <div className="tradingview-widget-copyright py-2 text-center text-xs text-[#9CA3AF]" dir="ltr"><a href={calendarUrl} target="_blank" rel="noopener nofollow" className="text-[#90BFF9] underline-offset-4 hover:underline">{isAr ? "التقويم الاقتصادي" : "Economic Calendar"}</a><span> by TradingView</span></div>
        </div>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 text-xs leading-relaxed text-[#9CA3AF]">
          <p className="max-w-xl">{isAr ? "تحقق من المنطقة الزمنية لموعد الحدث. يمكنك تغيير الفلاتر داخل التقويم. بعض أسماء المؤشرات متاحة بالإنجليزية فقط." : "Check each event’s timezone. You can adjust the filters inside the calendar."}</p>
          <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[#D4AF37] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">{isAr ? "فتح في TradingView" : "Open on TradingView"}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></a>
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5" aria-label={isAr ? "حالة إشعارات الأخبار" : "News alert status"}>
          <div className="flex items-center gap-2"><BellOff className="h-4 w-4 text-[#D4AF37]" aria-hidden="true" /><h2 className="font-semibold text-white">{brandText(isAr ? "إشعارات أخبار Alpha Traders" : "Alpha Traders news alerts")}</h2></div>
          <p className="mt-2 text-sm leading-relaxed text-[#BAC2CF]">{isAr ? "التقويم متاح للمتابعة هنا. إشعارات نتائج الأخبار عبر جرس التطبيق والبريد الإلكتروني غير مفعّلة حاليًا." : "Follow the calendar here. News-result notifications through the app bell and email are not active yet."}</p>
        </section>
        <p className="mt-5 text-xs leading-relaxed text-[#8F96A3]">{isAr ? "قد تتغير مواعيد الإصدار وتتأخر البيانات. النتائج معلومات اقتصادية ولا تضمن اتجاه حركة السوق." : "Release times may change and data may be delayed. Results are economic information and do not guarantee a market direction."}</p>
      </div>
    </div>
  );
}
