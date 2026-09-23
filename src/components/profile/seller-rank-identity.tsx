import { Crown, LockKeyhole } from "lucide-react";
import { RankEmblem } from "@/components/ui/rank-badge";
import { rankIdentityLabel, rankVisualKey } from "@/lib/rank-identity";
import { normalizeSellerLevel, SELLER_LEVELS } from "@/types/alpha-exchange";

/** Presentation only. The supplied rank is earned and resolved by the existing API. */
export function SellerRankIdentity({ rank, locale, owner = false }: {
  rank: string; locale: "en" | "ar"; owner?: boolean;
}) {
  return (
    <div className="seller-prestige-identity" data-profile-rank={owner ? "owner" : rankVisualKey(rank)}>
      <div className="seller-prestige-medallion" aria-hidden="true">
        {owner ? <Crown strokeWidth={1.3} /> : <RankEmblem rank={rank} />}
      </div>
      <div className="min-w-0">
        <p className="seller-prestige-eyebrow">{locale === "ar" ? "هوية البائع" : "Seller identity"}</p>
        <p className="seller-prestige-title">{owner ? (locale === "ar" ? "مالك Alpha Exchange" : "Alpha Exchange Owner") : rankIdentityLabel(rank, locale, "seller")}</p>
        <p className="seller-prestige-caption">{locale === "ar" ? "رتبة تعكس رحلتك" : "A rank that tells your story"}</p>
      </div>
    </div>
  );
}

export function SellerRankCollection({ rank, locale }: { rank: string; locale: "en" | "ar" }) {
  const current = SELLER_LEVELS.indexOf(normalizeSellerLevel(rank) ?? "bronze");
  return (
    <ol className="seller-rank-collection" aria-label={locale === "ar" ? "رحلة رتب البائع" : "Seller rank journey"}>
      {SELLER_LEVELS.map((level, index) => (
        <li key={level} className={index > current ? "is-locked" : "is-earned"} aria-current={index === current ? "step" : undefined}>
          <RankEmblem rank={level} />
          <span>{rankIdentityLabel(level, locale)}</span>
          {index > current ? <LockKeyhole className="seller-rank-lock" aria-label={locale === "ar" ? "لم يتم الوصول بعد" : "Not reached yet"} /> : <span className="seller-rank-step-dot" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}
