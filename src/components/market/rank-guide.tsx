"use client";

import { Info } from "lucide-react";
import { BUYER_PRESTIGE_TIERS } from "@/lib/buyer-rank";
import { profileRankLabel } from "@/lib/profile-presets";

export function RankGuide({ locale, align = "right" }: { locale: "ar" | "en"; align?: "left" | "right" }) {
  const isAr = locale === "ar";
  return <details className="group relative z-20">
    <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-white/15 text-[#D4AF37] focus-visible:outline-2 focus-visible:outline-[#D4AF37]">
      <Info className="h-4 w-4" /><span className="sr-only">{isAr ? "جميع الرتب" : "All rank tiers"}</span>
    </summary>
    <div className={`absolute ${align === "left" ? "left-0" : "right-0"} top-12 w-64 rounded-2xl border border-[#D4AF37]/25 bg-[#11151c] p-4 shadow-2xl`} dir={isAr ? "rtl" : "ltr"}>
      <p className="mb-3 text-sm font-semibold">{isAr ? "الرتب وأغلفة الحساب" : "Ranks & profile covers"}</p>
      <p className="mb-3 text-xs leading-5 text-slate-400">{isAr ? "أكمل الصفقات لفتح أغلفة جديدة. يُحسب الشراء والبيع بشكل منفصل." : "Complete trades to unlock new covers. Buying and selling progress separately."}</p>
      {BUYER_PRESTIGE_TIERS.map((tier) => <div key={tier.rank} className="flex justify-between border-t border-white/10 py-2 text-xs">
        <span>{profileRankLabel(tier.rank, isAr)}</span><bdi>{tier.minVolumeUsdt.toLocaleString("en-US")}+ USDT</bdi>
      </div>)}
    </div>
  </details>;
}
