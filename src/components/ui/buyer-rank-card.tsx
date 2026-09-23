import { RankBadge, RankEmblem } from "@/components/ui/rank-badge";
import { currencyText } from "@/components/ui/currency-text";
import { deriveBuyerRankSummary, type BuyerRankSummary } from "@/lib/buyer-rank";

const initialRank = deriveBuyerRankSummary({ lifetimeCompletedVolumeUsdt: 0, completedTrades: 0, reviewsGiven: 0, activeTrades: 0 });

export function BuyerRankCard({ summary, locale }: { summary?: BuyerRankSummary | null; locale: "en" | "ar" }) {
  const rank = summary ?? initialRank;
  const isAr = locale === "ar";
  return (
    <div className="buyer-rank-hero-card mt-5">
      <div className="flex items-center gap-3">
        <RankEmblem rank={rank.key} className="buyer-rank-hero-emblem" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[#93C5FD]">{isAr ? "هوية المشتري" : "Buyer identity"}</p>
          <h2 className="mt-1 text-xl font-semibold text-[#E0EDFF]">{isAr ? rank.labelAr : rank.label}</h2>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[#C6CEDB]">{currencyText(isAr ? rank.descriptionAr : rank.description)}</p>
      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em] text-[#B5C3D9]">
          <span>{isAr ? "التقدم نحو الرتبة التالية" : "Progress to next rank"}</span><span>{Math.round(rank.progressPercent)}%</span>
        </div>
        <div role="progressbar" aria-label={isAr ? "تقدم رتبة المشتري" : "Buyer rank progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rank.progressPercent)} className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
          <div className={`buyer-rank-progress buyer-rank-progress--${rank.key} h-full rounded-full transition-[width] duration-700`} style={{ width: `${rank.progressPercent}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div><p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">{isAr ? "تم شراؤه" : "Purchased"}</p><p className="mt-1 text-sm font-semibold"><bdi dir="ltr">{currencyText(`${rank.lifetimeCompletedVolumeUsdt.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDT`)}</bdi></p></div>
          <div><p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">{isAr ? "المتبقي" : "Remaining"}</p><p className="mt-1 text-sm font-semibold"><bdi dir="ltr">{currencyText(`${rank.remainingVolumeUsdt.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDT`)}</bdi></p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-xs text-[#94A3B8]">{rank.nextRank ? (isAr ? "الرتبة التالية" : "Next rank") : (isAr ? "أعلى رتبة" : "Top tier")}</span>
          <RankBadge rank={rank.nextRank ?? rank.key} locale={locale} audience="buyer" />
        </div>
      </div>
    </div>
  );
}
