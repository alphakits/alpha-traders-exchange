import { RankBadge, RankEmblem } from "@/components/ui/rank-badge";
import { currencyText } from "@/components/ui/currency-text";
import type { BuyerRankSummary } from "@/lib/buyer-rank";

export function BuyerRankCard({ summary, error = false, locale }: { summary?: BuyerRankSummary | null; error?: boolean; locale: "en" | "ar" }) {
  const isAr = locale === "ar";
  if (!summary) {
    return <div className="buyer-rank-hero-card mt-5" role="status" aria-busy={!error}>
      <p className="text-sm text-[#E0EDFF]">{isAr ? "تقدم رتبة المشتري" : "Buyer rank progress"}</p>
      <p className="mt-2 text-xs text-[#C6CEDB]">{error
        ? (isAr ? "تعذر تحميل تقدم المشتريات. أعد تحميل الصفحة للمحاولة مجدداً." : "Purchase progress could not be loaded. Refresh the page to try again.")
        : (isAr ? "جارٍ تحميل إجمالي مشترياتك ورتبتك…" : "Loading your purchase total and rank…")}</p>
    </div>;
  }
  const rank = summary;
  const displayedProgress = rank.nextRank && rank.remainingVolumeUsdt > 0 ? Math.min(99, Math.round(rank.progressPercent)) : Math.round(rank.progressPercent);
  return (
    <div className="buyer-rank-hero-card mt-5" data-profile-rank={rank.key}>
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
          <span>{isAr ? "التقدم نحو الرتبة التالية" : "Progress to next rank"}</span><span>{displayedProgress}%</span>
        </div>
        <div role="progressbar" aria-label={isAr ? "تقدم رتبة المشتري" : "Buyer rank progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayedProgress} className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
          <div className={`buyer-rank-progress buyer-rank-progress--${rank.key} h-full rounded-full transition-[width] duration-700`} style={{ width: `${rank.progressPercent}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div><p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">{isAr ? "تم شراؤه" : "Purchased"}</p><p className="mt-1 text-sm font-semibold"><bdi dir="ltr">{currencyText(`${rank.lifetimeCompletedVolumeUsdt.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT`)}</bdi></p></div>
          <div><p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">{isAr ? "المتبقي" : "Remaining"}</p><p className="mt-1 text-sm font-semibold"><bdi dir="ltr">{currencyText(`${rank.remainingVolumeUsdt.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT`)}</bdi></p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-xs text-[#94A3B8]">{rank.nextRank ? (isAr ? "الرتبة التالية" : "Next rank") : (isAr ? "أعلى رتبة" : "Top tier")}</span>
          <RankBadge rank={rank.nextRank ?? rank.key} locale={locale} audience="buyer" />
        </div>
      </div>
      {error ? <p role="status" className="mt-3 text-xs text-amber-200">{isAr ? "تعذر التحديث. تظهر آخر بيانات تم تحميلها." : "Could not refresh. Showing your last loaded progress."}</p> : null}
    </div>
  );
}
