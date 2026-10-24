import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PublicAccountId } from "@/components/ui/public-account-id";
import { RankBadge } from "@/components/ui/rank-badge";
import { RoleBadge } from "@/components/ui/role-badge";
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
  const showPurchases = audience === "buyer" && completed !== null && Number.isSafeInteger(completed) && completed >= 0;
  // Public profile routes are server-resolved opaque account keys. Never treat a
  // returned name or arbitrary URL as a destination, and never invent a link.
  const profileHref = identity.profileHref && /^\/u\/[A-Za-z0-9_-]+$/.test(identity.profileHref) ? identity.profileHref : null;
  const identityLabel = distinctName ? `${name}${accountId ? ` (${accountId})` : ""}` : accountId ?? name;

  return <div data-testid="request-counterparty-identity" className="min-w-0 max-w-full space-y-2">
    <div className="min-w-0 space-y-1">
      {distinctName ? <p className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]"><bdi dir="auto">{name}</bdi></p> : null}
      {accountId ? <PublicAccountId value={accountId} audience={rank ? "seller" : "buyer"} rank={rank ?? undefined} /> : null}
      {profileHref ? <Link
        href={profileHref}
        locale={locale}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ar ? `عرض الملف: ${identityLabel} (يفتح في علامة تبويب جديدة)` : `View profile: ${identityLabel} (opens in a new tab)`}
        className="inline-flex min-h-11 max-w-full touch-manipulation items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-[#90C2FF] underline-offset-4 hover:text-[#BADBFF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6CAEFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111827]"
      >
        {ar ? "عرض الملف" : "View profile"}
        <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">{ar ? "يفتح في علامة تبويب جديدة" : "Opens in a new tab"}</span>
      </Link> : null}
    </div>
    {identity.approvedSeller || showPurchases ? <div className="flex min-w-0 flex-wrap items-center gap-2">
      {identity.approvedSeller ? <RoleBadge variant="approved_seller" locale={locale} /> : null}
      {rank ? <RankBadge rank={rank} locale={locale} audience="seller" /> : null}
      {showPurchases ? <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 text-xs font-medium text-sky-200">
        <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span><bdi dir="ltr" className="tabular-nums">{formatUsdt(String(completed))}</bdi> {ar ? "عملية شراء مكتملة" : completed === 1 ? "completed purchase" : "completed purchases"}</span>
      </span> : null}
    </div> : null}
  </div>;
}
