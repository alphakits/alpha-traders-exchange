import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PublicAccountId } from "@/components/ui/public-account-id";
import { RankBadge } from "@/components/ui/rank-badge";
import { RoleBadge } from "@/components/ui/role-badge";
import { BUYER_PRESTIGE_TIERS, buyerRankLabel } from "@/lib/buyer-rank";
import { normalizePublicAccountId } from "@/lib/format-id";
import { formatUsdt } from "@/lib/usdt-demand-format";
import { isSellerLevel } from "@/types/alpha-exchange";
import type { DemandPublicIdentity } from "@/types/usdt-demand";

/** Render only the public identity and statistics explicitly projected by the server. */
export function RequestCounterpartyIdentity({ identity, locale, audience }: {
  identity: DemandPublicIdentity;
  locale: "en" | "ar";
  audience: "buyer" | "seller";
}) {
  const ar = locale === "ar";
  const accountId = normalizePublicAccountId(identity.accountId);
  const name = identity.displayName.trim();
  const distinctName = Boolean(name && name !== accountId);
  const rank = identity.approvedSeller && identity.sellerRank && isSellerLevel(identity.sellerRank) ? identity.sellerRank : null;
  const completed = identity.completedPurchases;
  const showPurchases = completed !== null && Number.isSafeInteger(completed) && completed >= 0;
  const suppliedProgress = identity.buyerProgress;
  const buyerProgress = showPurchases && suppliedProgress
    && BUYER_PRESTIGE_TIERS.some(tier => tier.rank === suppliedProgress.rank)
    && (suppliedProgress.nextRank === null || BUYER_PRESTIGE_TIERS.some(tier => tier.rank === suppliedProgress.nextRank))
    && Number.isFinite(suppliedProgress.progressPercent) && suppliedProgress.progressPercent >= 0 && suppliedProgress.progressPercent <= 100
    ? suppliedProgress : null;
  const nextBuyerRankLabel = buyerProgress?.nextRank ? buyerRankLabel(buyerProgress.nextRank, ar) : null;
  // Public profile routes are server-resolved opaque account keys. Never treat a
  // returned name or arbitrary URL as a destination, and never invent a link.
  const profileHref = identity.profileHref && /^\/u\/[A-Za-z0-9_-]+$/.test(identity.profileHref) ? identity.profileHref : null;
  const identityLabel = distinctName ? `${name}${accountId ? ` (${accountId})` : ""}` : accountId ?? name;

  return <div data-testid="request-counterparty-identity" data-request-role={audience} className="min-w-0 max-w-full space-y-2">
    <div className="min-w-0 space-y-1">
      {distinctName ? <p className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]"><bdi dir="auto">{name}</bdi></p> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {accountId ? <PublicAccountId value={accountId} audience={rank ? "seller" : "buyer"} rank={rank ?? undefined} /> : null}
        {profileHref ? <Link
          href={profileHref}
          locale={locale}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={ar ? `عرض الملف: ${identityLabel} (يفتح في علامة تبويب جديدة)` : `View profile: ${identityLabel} (opens in a new tab)`}
          className="inline-flex min-h-11 max-w-full touch-manipulation items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[#90C2FF] underline-offset-4 transition-colors hover:bg-blue-400/10 hover:text-[#BADBFF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6CAEFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111827]"
        >
          {ar ? "عرض الملف" : "View profile"}
          <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">{ar ? "يفتح في علامة تبويب جديدة" : "Opens in a new tab"}</span>
        </Link> : null}
      </div>
    </div>
    {identity.approvedSeller ? <div className="flex min-w-0 flex-wrap items-center gap-2">
      <RoleBadge variant="approved_seller" locale={locale} />
      {rank ? <RankBadge rank={rank} locale={locale} audience="seller" /> : null}
    </div> : null}
    {showPurchases ? <div className="min-w-0 max-w-sm space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        {buyerProgress ? <RankBadge rank={buyerProgress.rank} locale={locale} audience="buyer">{buyerRankLabel(buyerProgress.rank, ar)}</RankBadge> : null}
        <span className="inline-flex max-w-full items-center gap-1.5 text-xs font-medium leading-relaxed text-blue-200">
          <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]"><bdi dir="ltr" className="tabular-nums">{formatUsdt(String(completed))}</bdi> {ar ? "عملية شراء مكتملة" : completed === 1 ? "completed purchase" : "completed purchases"}</span>
        </span>
      </div>
      {buyerProgress ? <div className="min-w-0 space-y-1">
        <p className="text-xs leading-relaxed text-blue-200/90 [overflow-wrap:anywhere]">
          {nextBuyerRankLabel ? (ar ? `التالي: ${nextBuyerRankLabel}` : `Next: ${nextBuyerRankLabel}`) : (ar ? "تم بلوغ أعلى رتبة للمشترين" : "Highest buyer rank reached")}
        </p>
        <div
          role="progressbar"
          aria-label={ar ? "تقدم رتبة المشتري" : "Buyer rank progress"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={buyerProgress.progressPercent}
          aria-valuetext={nextBuyerRankLabel
            ? (ar ? `${buyerProgress.progressPercent}% نحو ${nextBuyerRankLabel}` : `${buyerProgress.progressPercent}% toward ${nextBuyerRankLabel}`)
            : (ar ? "تم بلوغ أعلى رتبة للمشترين" : "Highest buyer rank reached")}
          className="h-1.5 overflow-hidden rounded-full bg-blue-300/15"
        >
          <div className="h-full rounded-full bg-blue-400" style={{ width: `${buyerProgress.progressPercent}%` }} />
        </div>
      </div> : null}
    </div> : null}
  </div>;
}
