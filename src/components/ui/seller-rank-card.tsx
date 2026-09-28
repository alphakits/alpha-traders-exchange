import { RankBadge, RankEmblem } from "@/components/ui/rank-badge";
import { currencyText } from "@/components/ui/currency-text";
import { rankIdentityLabel } from "@/lib/rank-identity";
import type { SellerAccountStats } from "@/lib/alpha-exchange-store";
import { SellerRankCollection } from "@/components/profile/seller-rank-identity";
import { rankVisualKey } from "@/lib/rank-identity";

export type SellerRankSummary = Pick<SellerAccountStats,
  "sellerLevel" | "nextLevel" | "progressToNextLevelPercent" | "amountToNextLevelUsdt" | "lifetimeCompletedVolumeUsdt"
>;

export function SellerRankCard({ summary, error = false, locale, owner = false }: {
  summary?: SellerRankSummary | null;
  error?: boolean;
  locale: "en" | "ar";
  owner?: boolean;
}) {
  const isAr = locale === "ar";
  if (!summary) {
    return <div className="seller-rank-hero-card mt-5" role="status" aria-busy={!error}>
      <p className="text-sm text-[#F8DFA0]">{isAr ? "تقدم رتبة البائع" : "Seller rank progress"}</p>
      <p className="mt-2 text-xs text-[#D1D5DB]">{error
        ? (isAr ? "تعذر تحميل تقدم المبيعات. أعد تحميل الصفحة للمحاولة مجدداً." : "Sales progress could not be loaded. Refresh the page to try again.")
        : (isAr ? "جارٍ تحميل إجمالي مبيعاتك ورتبتك…" : "Loading your sales total and rank…")}</p>
    </div>;
  }
  const progress = summary.nextLevel ? Math.max(0, Math.min(100, summary.progressToNextLevelPercent)) : 100;
  const displayedProgress = summary.nextLevel && summary.amountToNextLevelUsdt > 0 ? Math.min(99, Math.round(progress)) : Math.round(progress);
  const formatAmount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return (
    <div className="seller-rank-hero-card seller-prestige-progress mt-5" data-profile-rank={owner ? "owner" : rankVisualKey(summary.sellerLevel)}>
      <div className="flex items-center gap-3">
        <RankEmblem rank={summary.sellerLevel} className="seller-rank-hero-emblem" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[#F4D675]">{isAr ? "هوية البائع" : "Seller identity"}</p>
          <h2 className="mt-1 text-xl font-semibold text-[#FFF1BE]">{rankIdentityLabel(summary.sellerLevel, locale, "seller")}</h2>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[#D1D5DB]">{isAr ? "مبيعاتك المكتملة تبني رتبتك. إجمالي مبيعاتك ظاهر لك فقط." : "Your completed sales build your rank. Your sales total is visible only to you."}</p>
      <SellerRankCollection rank={summary.sellerLevel} locale={locale} />
      <div className="seller-prestige-progress-body mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em] text-[#D9C99B]">
          <span>{summary.nextLevel ? (isAr ? "التقدم نحو الرتبة التالية" : "Progress to next rank") : (isAr ? "وصلت إلى أعلى رتبة" : "Top tier reached")}</span><span>{displayedProgress}%</span>
        </div>
        <div role="progressbar" aria-label={isAr ? "تقدم رتبة البائع" : "Seller rank progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayedProgress} className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
          <div className="seller-prestige-progress-fill h-full rounded-full transition-[width] duration-700" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div><p className="text-[10px] uppercase tracking-wider text-[#BDB49C]">{isAr ? "إجمالي المبيعات" : "Total sold"}</p><p className="mt-1 text-sm font-semibold"><bdi dir="ltr">{currencyText(`${formatAmount(summary.lifetimeCompletedVolumeUsdt)} USDT`)}</bdi></p></div>
          <div><p className="text-[10px] uppercase tracking-wider text-[#BDB49C]">{isAr ? "المتبقي" : "Remaining"}</p><p className="mt-1 text-sm font-semibold"><bdi dir="ltr">{currencyText(`${formatAmount(summary.amountToNextLevelUsdt)} USDT`)}</bdi></p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-xs text-[#BDB49C]">{summary.nextLevel ? (isAr ? "الرتبة التالية" : "Next rank") : (isAr ? "أعلى رتبة" : "Top tier")}</span>
          <RankBadge rank={summary.nextLevel ?? summary.sellerLevel} locale={locale} audience="seller" />
        </div>
      </div>
      {error ? <p role="status" className="mt-3 text-xs text-amber-200">{isAr ? "تعذر التحديث. تظهر آخر بيانات تم تحميلها." : "Could not refresh. Showing your last loaded progress."}</p> : null}
    </div>
  );
}
