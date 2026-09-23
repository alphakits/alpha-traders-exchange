import { PrivateProfileHeader } from "./private-profile-header";
import { SellerRankCard } from "@/components/ui/seller-rank-card";
import { RoleBadge } from "@/components/ui/role-badge";
import { RankBadge } from "@/components/ui/rank-badge";
import { PremiumSellerProfilePage } from "@/components/sections/seller/premium-seller-profile-page";
import { normalizeSellerLevel, SELLER_LEVELS, type PremiumSellerProfileData } from "@/types/alpha-exchange";
import { rankIdentityLabel } from "@/lib/rank-identity";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/** Only rendered by the existing non-production design preview route. No real account data. */
export function SellerDesignPreview({ locale, rank = "bronze", publicView = false }: { locale: "en" | "ar"; rank?: string; publicView?: boolean }) {
  const owner = rank === "owner";
  const level = normalizeSellerLevel(rank) ?? "bronze";
  const index = SELLER_LEVELS.indexOf(level);
  const next = SELLER_LEVELS[index + 1];
  const isAr = locale === "ar";
  const profile: PremiumSellerProfileData = {
    sellerId: "sample-seller", sellerLevel: level, nextRank: next, publicVolumeRange: "",
    profile: { sellerId: "sample-seller", sellerName: owner ? "Alpha Traders" : "AT-SAMPLE", profilePhotoUrl: "", memberSince: "2025-04-01", languages: ["English", "Arabic"], preferredNetworks: ["TRC20"], bio: isAr ? "معاينة تصميم ببيانات توضيحية." : "Design preview with sample data.", onlineStatus: "offline", availabilityStatus: "available", isOwner: owner, isEmailVerified: true },
    trustScore: 96, completedTrades: 28, averageRating: 0, responseTimeMinutes: 4, completionRate: 98,
    repeatBuyersPercent: 30, totalReviews: 0, yearsOnPlatform: 1.5, badges: ["trusted_seller", "fast_responder"], promotionHistory: [], achievements: [], prestigeVolumePublicLabel: "", hallOfFameEligible: false, latestReviews: [], recentActivity: [],
  };
  return <div dir={isAr ? "rtl" : "ltr"}>
    <div className="section-container py-5">
      <p className="text-sm text-slate-400">{isAr ? "معاينة التصميم · بيانات توضيحية فقط" : "Design preview · sample data only"}</p>
      <nav className="mt-3 flex flex-wrap gap-3" aria-label="Preview ranks">{[...SELLER_LEVELS,"owner"].map(tier => <Link className="text-sm text-slate-300 underline" key={tier} href={`/welcome-preview?view=${publicView ? "seller-public" : "seller-design"}&rank=${tier}`}>{tier === "owner" ? "Owner" : rankIdentityLabel(tier, locale)}</Link>)}</nav>
    </div>
    {publicView ? <PremiumSellerProfilePage locale={locale} data={{profile, sellerListings: [], similarSellers: []}} /> : <section className="seller-prestige-page section-container pb-8" data-profile-rank={owner ? "owner" : level}>
      <div className="seller-prestige-account-hero seller-rank-profile-shell overflow-hidden border">
        <PrivateProfileHeader locale={locale} fullName={owner ? "Alex Morgan" : (isAr ? "مايا" : "Maya")} publicId="AT-SAMPLE" publicOwner={owner} sellerRank={level} avatarClassName="seller-rank-avatar-frame" nameClassName="seller-prestige-name" coverActions={<Button size="sm" variant="secondary" disabled>{isAr ? "تحديث الغلاف" : "Update cover"}</Button>} photoActions={<Button size="sm" variant="secondary" disabled>{isAr ? "تغيير الصورة" : "Update photo"}</Button>}>
          <div className="mt-4 flex flex-wrap gap-2"><RoleBadge locale={locale} variant={owner ? "owner" : "approved_seller"} /><RankBadge rank={level} locale={locale} audience="seller" /></div>
        </PrivateProfileHeader>
        <div className="seller-prestige-account-progress px-5 pb-5 md:px-8">
          <SellerRankCard locale={locale} owner={owner} summary={{sellerLevel: level, nextLevel: next, progressToNextLevelPercent: 63, lifetimeCompletedVolumeUsdt: 9450, amountToNextLevelUsdt: next ? 5550 : 0}} />
          <div className="seller-prestige-quick-stats"><div><span>{isAr ? "الصفقات المكتملة" : "Completed trades"}</span><strong>28</strong></div><div><span>{isAr ? "التقييم" : "Rating"}</span><strong>4.96 ★</strong></div><div><span>{isAr ? "العروض النشطة" : "Active listings"}</span><strong>2</strong></div></div>
        </div>
        <details className="seller-account-details px-5 pb-5 md:px-8"><summary className="py-3">{isAr ? "تفاصيل الحساب" : "Account details"}</summary><p className="text-sm text-slate-400">{isAr ? "حساب توضيحي" : "Sample account"}</p></details>
      </div>
    </section>}
  </div>;
}
