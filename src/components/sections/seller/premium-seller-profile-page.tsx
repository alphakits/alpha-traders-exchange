import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { ArrowRight, BadgeCheck, HandCoins, MessageCircle, Network, Settings, ShieldCheck, Sparkles, Star, TrendingUp, WalletCards, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RoleBadge } from "@/components/ui/role-badge";
import { UsdtIcon } from "@/components/ui/usdt-icon";
import { MarketplaceEnforcementOwnerPanel } from "@/components/sections/seller/marketplace-enforcement-owner-panel";
import { buildSellerReviewStats, getVisibleSellerReviews } from "@/lib/reviews";
import { deriveSellerPresence } from "@/lib/seller-presence";
import { cn } from "@/lib/utils";
import type { PremiumSellerProfileData, SellerBadge, SellerLevel } from "@/types/alpha-exchange";

function formatSellerLevelLabel(level?: SellerLevel) {
  if (level === "elite") return "Alpha Elite Seller";
  if (level === "diamond") return "Alpha Diamond Seller";
  if (level === "gold") return "Alpha Gold Seller";
  if (level === "silver") return "Alpha Silver Seller";
  return "Alpha Bronze Seller";
}

function formatSellerBadgeLabel(badge: string) {
  if (badge === "elite_seller") return "Elite Seller";
  if (badge === "top_rated") return "Top Rated";
  if (badge === "fast_responder") return "Fast Responder";
  if (badge === "trusted_seller") return "Trusted Seller";
  if (badge === "most_active") return "Most Active";
  if (badge === "platinum_seller") return "Platinum Seller";
  return "1000+ Trades";
}

function sellerRankTheme(level?: SellerLevel) {
  if (level === "elite") return "from-[#F8E7A0] via-white to-[#C9A227] text-transparent bg-clip-text";
  if (level === "diamond") return "text-[#7CC9FF]";
  if (level === "gold") return "text-[#E8C547]";
  if (level === "silver") return "text-[#C9CED9]";
  return "text-[#B8824B]";
}

function sellerLevelToneKey(level?: SellerLevel) {
  if (level === "elite") return "legendary";
  if (level === "diamond") return "diamond";
  if (level === "gold") return "gold";
  if (level === "silver") return "silver";
  return "bronze";
}

function heroRankLabel(level?: SellerLevel, isOwner = false) {
  if (isOwner) return "OWNER";
  if (level === "elite") return "ELITE SELLER";
  if (level === "diamond") return "DIAMOND SELLER";
  if (level === "gold") return "GOLD SELLER";
  if (level === "silver") return "SILVER SELLER";
  return "BRONZE SELLER";
}

function badgeLabel(badge: SellerBadge) {
  return formatSellerBadgeLabel(badge);
}

function StatCard({ label, value, accent = false, isUsdt = false }: { label: string; value: string; accent?: boolean; isUsdt?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/20 p-4 ${accent ? "border-[#C9A227]/25 bg-[#C9A227]/10" : ""}`}>
      <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">
        {isUsdt ? <UsdtIcon /> : null}
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

type PremiumSellerProfilePageProps = {
  locale: "ar" | "en";
  viewerOwnsProfile?: boolean;
  data: {
    profile: PremiumSellerProfileData | null;
    sellerListings: Array<{
      id: string;
      sellerId: string;
      sellerDisplayName: string;
      price: string;
      availableAmount: string;
      network: string;
      paymentMethod: string;
      sellerProfile?: { profilePhotoUrl?: string };
      sellerReputation?: { level?: SellerLevel; trustScore?: number; publicVolumeRange?: string };
    }>;
    similarSellers: Array<{
      sellerUsername: string;
      sellerName: string;
      sellerLevel: SellerLevel;
      trustScore: number;
      profilePhotoUrl: string;
      publicVolumeRange: string;
    }>;
  };
};

export function PremiumSellerProfilePage({ locale, viewerOwnsProfile = false, data }: PremiumSellerProfilePageProps) {
  const isAr = locale === "ar";
  const profile = data.profile;
  const seller = profile?.profile;
  const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!profile || !seller) {
    return null;
  }

  const visibleReviews = getVisibleSellerReviews(profile.latestReviews as never[]);
  const reviewStats = buildSellerReviewStats(visibleReviews as never[]);
  const paymentMethods = seller.preferredPaymentMethods?.length
    ? seller.preferredPaymentMethods
    : Array.from(new Set(data.sellerListings.map((listing) => listing.paymentMethod).filter(Boolean)));
  const supportedNetworks = seller.preferredNetworks?.length
    ? seller.preferredNetworks
    : Array.from(new Set(data.sellerListings.map((listing) => listing.network).filter(Boolean)));
  const availableUsdt = data.sellerListings.reduce((sum, listing) => {
    const value = Number.parseFloat(String(listing.availableAmount).replace(/,/g, ""));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const isOwnerSeller = seller.isOwner === true;
  const sellerRankKey = isOwnerSeller ? "legendary" : sellerLevelToneKey(profile.sellerLevel);
  const presence = deriveSellerPresence({ onlineStatus: seller.onlineStatus, lastActiveAt: seller.lastActiveAt });
  const heroBadgeItems = [
    seller.isFeaturedSeller ? "Featured Seller" : null,
    seller.isFoundingSeller ? "Founding Seller" : null,
    ...profile.badges.slice(0, 2).map((badge) => badgeLabel(badge)),
  ].filter(Boolean) as string[];
  const heroStats = [
    {
      label: isAr ? "التقييم" : "Rating",
      value: `${reviewStats.averageRating.toFixed(2)}★`,
      icon: <Star className="h-3.5 w-3.5" />,
    },
    {
      label: isAr ? "الصفقات" : "Completed Trades",
      value: profile.completedTrades.toLocaleString("en-IL"),
      icon: <HandCoins className="h-3.5 w-3.5" />,
    },
    {
      label: isAr ? "الحجم" : "Trade Volume",
      value: `${(profile.tradeVolume ?? profile.lifetimeCompletedVolumeUsdt).toLocaleString("en-IL")} USDT`,
      icon: <WalletCards className="h-3.5 w-3.5" />,
    },
    {
      label: isAr ? "الاستجابة" : "Response Time",
      value: `${profile.responseTimeMinutes.toFixed(0)} min`,
      icon: <Zap className="h-3.5 w-3.5" />,
    },
  ];
  const availabilityLabel = seller.availabilityStatus === "available"
    ? (isAr ? "متاح" : "Available")
    : seller.availabilityStatus === "away"
      ? (isAr ? "مشغول" : "Away")
      : (isAr ? "إجازة" : "Vacation");
  const stats: Array<{ label: string; value: string; isUsdt?: boolean }> = [
    { label: isAr ? "صفقات مكتملة" : "Completed trades", value: profile.completedTrades.toString() },
    { label: isAr ? "حجم التداول" : "Trade volume", value: `${profile.tradeVolume?.toLocaleString("en-IL") ?? profile.lifetimeCompletedVolumeUsdt.toLocaleString("en-IL")} USDT`, isUsdt: true },
    { label: isAr ? "التقييم المتوسط" : "Average rating", value: `${reviewStats.averageRating.toFixed(2)}★` },
    { label: isAr ? "المشترون المتكرّرون" : "Repeat buyers", value: `${profile.repeatBuyersPercent.toFixed(1)}%` },
    { label: isAr ? "معدل الإكمال" : "Completion rate", value: `${profile.completionRate.toFixed(1)}%` },
    { label: isAr ? "متوسط سرعة الرد" : "Avg response", value: `${profile.responseTimeMinutes.toFixed(0)} min` },
    { label: isAr ? "العروض النشطة" : "Active listings", value: data.sellerListings.length.toString(), isUsdt: true },
    { label: isAr ? "سنوات على المنصة" : "Years on platform", value: `${profile.yearsOnPlatform.toFixed(1)}` },
  ];

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="section-container page-shell flex flex-col gap-8">
        <Card
          className={cn(
            "seller-listing-shell overflow-hidden border-white/10 bg-[#0B0B0B]/95",
            isOwnerSeller
              ? "owner-legendary-surface"
              : `seller-rank-surface seller-rank-surface--${sellerRankKey} seller-rank-card seller-rank-card--${sellerRankKey}`,
          )}
        >
          {isOwnerSeller ? (
            <div className="flex items-center gap-2 rounded-t-xl border-b border-red-500/20 bg-gradient-to-r from-red-950/60 via-red-900/30 to-transparent px-4 py-2">
              <Sparkles className="h-3.5 w-3.5 text-red-300" />
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">Official Alpha Exchange Profile</span>
              <span className="ml-auto text-[11px] text-red-400/70">Verified owner identity</span>
            </div>
          ) : null}
          <div
            className="relative h-[19rem] md:h-[22rem]"
            style={{
              backgroundImage: seller.coverBannerUrl
                ? `linear-gradient(180deg, rgba(5,5,5,0.16), rgba(5,5,5,0.86)), url(${seller.coverBannerUrl})`
                : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className={cn("seller-profile-hero-material absolute inset-0", isOwnerSeller ? "seller-profile-hero-material--owner" : `seller-profile-hero-material--${sellerRankKey}`)} />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-black/85" />
            <div className={cn("absolute inset-0 opacity-95", !seller.coverBannerUrl && (isOwnerSeller ? "owner-legendary-surface" : `seller-rank-surface seller-rank-surface--${sellerRankKey}`))} />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.1),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.05),transparent_30%)]" />
            <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
              <div className={cn(
                "rounded-[1.6rem] border border-white/10 bg-black/35 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl md:p-6",
                isOwnerSeller ? "border-red-500/25" : `seller-rank-accent seller-rank-accent--${sellerRankKey}`,
              )}>
                <div className={cn("flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", isAr ? "lg:flex-row-reverse" : "")}>
                  <div className={cn("flex items-end gap-4", isAr ? "flex-row-reverse" : "")}>
                    <div className={cn("relative seller-avatar-ring", `seller-avatar-ring--${sellerRankKey}`)}>
                      {seller.profilePhotoUrl ? (
                        <Image src={seller.profilePhotoUrl} alt={seller.sellerName} width={128} height={128} unoptimized className="h-24 w-24 rounded-full border border-transparent object-cover md:h-28 md:w-28" />
                      ) : (
                        <div className={cn("flex h-24 w-24 items-center justify-center rounded-full border border-transparent text-2xl font-semibold md:h-28 md:w-28", isOwnerSeller ? "bg-red-950/60 text-red-200" : "bg-white/[0.04] text-[#F5E7C1]")}>
                          {seller.sellerName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className={cn("absolute bottom-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-[0_10px_20px_rgba(0,0,0,0.25)]", isAr ? "left-1" : "right-1", presence.tone === "online" ? "bg-emerald-500/90 text-white" : presence.tone === "recent" ? "bg-amber-500/90 text-black" : "bg-white/20 text-white")}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", presence.tone === "online" ? "bg-white" : presence.tone === "recent" ? "bg-black/70" : "bg-[#D1D5DB]")} />
                        {isAr ? presence.labelAr : presence.label}
                      </span>
                    </div>
                    <div className={isAr ? "text-right" : ""}>
                      <div className={cn("flex items-center gap-2", isAr ? "flex-row-reverse" : "")}>
                        <h1 className={cn("seller-listing-seller-name text-3xl font-extrabold md:text-[2.35rem]", isOwnerSeller ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${sellerRankKey}`)}>{seller.sellerName}</h1>
                        <BadgeCheck className={cn("h-5 w-5", isOwnerSeller ? "text-red-300" : "text-[#C9A227]")} />
                      </div>
                      <p className="seller-listing-seller-subtitle mt-2 text-[12px] uppercase tracking-[0.16em] text-[#9CA3AF]">
                        <span className={cn("seller-listing-rank-label", `seller-listing-rank-label--${sellerRankKey}`)}>
                          {heroRankLabel(profile.sellerLevel, isOwnerSeller)}
                        </span>
                        <span className="seller-listing-status-separator"> • </span>
                        <span className="text-[#D1D5DB]">{seller.onlineStatus === "online" ? "ONLINE" : "OFFLINE"}</span>
                      </p>
                      <div className={cn("mt-3 flex flex-wrap gap-2", isAr ? "justify-end" : "")}>
                        {isOwnerSeller ? <RoleBadge variant="owner" /> : null}
                        <RoleBadge variant="approved_seller" className={cn("seller-rank-badge", `seller-rank-badge--${sellerRankKey}`)} />
                        <span className={cn("seller-rank-pill", `seller-rank-pill--${sellerRankKey}`)}>{formatSellerLevelLabel(profile.sellerLevel)}</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-[#E5E7EB]">{isAr ? "بائع موثّق" : "Verified Seller"}</span>
                        {seller.isEmailVerified ? <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-200">{isAr ? "بريد إلكتروني موثّق" : "Verified Email"}</span> : null}
                        {heroBadgeItems.map((badge) => (
                          <span key={badge} className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-[#D1D5DB]">{badge}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={cn("grid gap-3 lg:min-w-[260px]", isAr ? "text-right" : "")}>
                    <div className={cn("rounded-2xl border bg-black/35 px-4 py-3 text-sm backdrop-blur-md", isOwnerSeller ? "border-red-500/25" : `seller-rank-card seller-rank-card--${sellerRankKey}`)}>
                      <p className="text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust Score"}</p>
                      <p className={cn("mt-1 text-2xl font-semibold", isOwnerSeller ? "text-red-200" : `seller-listing-rank-label seller-listing-rank-label--${sellerRankKey}`)}>{profile.trustScore.toFixed(1)}/100</p>
                      <p className="mt-1 text-[#D1D5DB]">{isAr ? "المستوى" : "Level"}: {formatSellerLevelLabel(profile.sellerLevel)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={cn("seller-listing-availability", `seller-listing-availability--${sellerRankKey}`)}>{availabilityLabel}</span>
                      <span className="rounded-full border border-[#B91C1C]/20 bg-[#B91C1C]/10 px-3 py-1 text-xs font-medium text-[#FCA5A5]">{isAr ? "ضمان Alpha Traders" : "Escrow protected"}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                      {viewerOwnsProfile ? (
                        <>
                          <Link href="/settings" locale={locale} className={cn("seller-marketplace-action seller-marketplace-action--profile", isOwnerSeller ? "owner-cta-premium" : `seller-rank-cta seller-rank-cta--${sellerRankKey}`)}>
                            <span className="inline-flex items-center gap-2">
                              <Settings className="h-4 w-4" />
                              {isAr ? "تعديل الملف" : "Edit Profile"}
                            </span>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                          <Link href="/dashboard/seller" locale={locale} className="seller-marketplace-action seller-marketplace-action--profile border border-white/15 bg-black/25 text-white hover:border-[#C9A227] hover:bg-black/35">
                            <span className="inline-flex items-center gap-2">
                              <WalletCards className="h-4 w-4" />
                              {isAr ? "إدارة العروض" : "Manage Listings"}
                            </span>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </>
                      ) : (
                        <>
                          <a href="#seller-active-listings" className={cn("seller-marketplace-action seller-marketplace-action--profile", isOwnerSeller ? "owner-cta-premium" : `seller-rank-cta seller-rank-cta--${sellerRankKey}`)}>
                            <span className="inline-flex items-center gap-2">
                              <Zap className="h-4 w-4" />
                              {isAr ? "ابدأ الصفقة" : "Start Trade"}
                            </span>
                            <ArrowRight className="h-4 w-4" />
                          </a>
                          <a href="#seller-public-account" className="seller-marketplace-action seller-marketplace-action--profile border border-white/15 bg-black/25 text-white hover:border-[#C9A227] hover:bg-black/35">
                            <span className="inline-flex items-center gap-2">
                              <MessageCircle className="h-4 w-4" />
                              {isAr ? "راسل البائع" : "Message Seller"}
                            </span>
                            <ArrowRight className="h-4 w-4" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {heroStats.map((stat) => (
                    <div key={stat.label} className={cn("seller-hero-stat rounded-2xl border px-4 py-3", isOwnerSeller ? "border-red-500/20 bg-red-950/10" : `seller-rank-microcard seller-rank-microcard--${sellerRankKey}`)}>
                      <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                        <span className={cn("seller-listing-rank-label", `seller-listing-rank-label--${sellerRankKey}`)}>{stat.icon}</span>
                        {stat.label}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white md:text-base">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <CardContent className="grid gap-6 p-6 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className={`grid gap-3 sm:grid-cols-2 ${isAr ? "text-right" : ""}`}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "عضو منذ" : "Member since"}</p>
                  <p className="mt-2 font-medium text-white">{new Date(seller.memberSince).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL", { year: "numeric", month: "long" })}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "البلد" : "Country"}</p>
                  <p className="mt-2 font-medium text-white">{seller.country || "—"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "اللغات" : "Languages"}</p>
                  <p className="mt-2 font-medium text-white">{seller.languages.join(", ") || "English"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "وقت الرد" : "Response time"}</p>
                  <p className="mt-2 font-medium text-white">{profile.responseTimeMinutes.toFixed(0)} min</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "التوفر" : "Availability"}</p>
                  <p className="mt-2 font-medium text-white">{availabilityLabel}</p>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0B0B0B] to-[#111111] p-5">
                <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "ملف الثقة" : "Trust snapshot"}</p>
                    <h2 className="mt-1 text-xl font-semibold text-white">{isAr ? "الخلفية المهنية" : "Professional credibility"}</h2>
                  </div>
                  <div className="rounded-full border border-[#C9A227]/20 bg-[#C9A227]/10 p-2 text-[#C9A227]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                </div>
                <p className={`mt-3 text-sm leading-7 text-[#D1D5DB] ${isAr ? "text-right" : ""}`}>{seller.bio || (isAr ? "بائع موثوق في Alpha Exchange." : "A trusted seller on Alpha Exchange.")}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0F0F0F] to-[#151515] p-5">
                <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                  <TrendingUp className="h-5 w-5 text-[#C9A227]" />
                  <h2 className="text-lg font-semibold text-white">{isAr ? "السمعة" : "Prestige"}</h2>
                </div>
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-sm text-[#D1D5DB]">
                    <span>{isAr ? "التقدم إلى المستوى التالي" : "Progress to next rank"}</span>
                    <span className="text-white">{profile.progressToNextRankPercent.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#C9A227] via-[#FDE68A] to-[#C9A227]" style={{ width: `${Math.min(100, profile.progressToNextRankPercent)}%` }} />
                  </div>
                </div>
                <div className={`mt-4 grid gap-3 text-sm ${isAr ? "text-right" : ""}`}>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "الرتبة الحالية" : "Current rank"}</p>
                    <p className={`mt-1 font-semibold capitalize text-white ${sellerRankTheme(profile.sellerLevel)}`}>{profile.sellerLevel}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "الرتبة التالية" : "Next rank"}</p>
                    <p className="mt-1 font-semibold text-[#C9A227]">{profile.nextRank ? profile.nextRank : (isAr ? "أعلى مستوى" : "Top tier reached")}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "المتبقي إلى الترقية" : "Remaining volume"}</p>
                    <p className="mt-1 font-semibold text-white">{profile.amountToNextRankUsdt.toLocaleString("en-IL")} USDT</p>
                  </div>
                </div>
              </div>

              <div id="seller-public-account" className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0B0B0B] to-[#141414] p-5">
                <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                  <WalletCards className="h-5 w-5 text-[#C9A227]" />
                  <h2 className="text-lg font-semibold text-white">{isAr ? "ملف الحساب العام" : "Public account profile"}</h2>
                </div>
                <div className={`mt-4 grid gap-3 text-sm ${isAr ? "text-right" : ""}`}>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "طرق الدفع" : "Payment methods"}</p>
                    <p className="mt-1 font-medium text-white">{paymentMethods.length ? paymentMethods.join(", ") : "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "الشبكات المدعومة" : "Supported networks"}</p>
                    <p className="mt-1 font-medium text-white">{supportedNetworks.length ? supportedNetworks.join(", ") : "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "USDT المتاح" : "Available USDT"}</p>
                    <p className="mt-1 font-medium text-white">{availableUsdt > 0 ? `${availableUsdt.toLocaleString("en-IL", { maximumFractionDigits: 2 })} USDT` : "—"}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-6 text-[#9CA3AF]">{isAr ? "يتم التواصل مع البائع بشكل آمن داخل Alpha Traders أثناء الصفقة فقط." : "Seller contact stays private and is handled securely inside Alpha Traders trade flow only."}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card id="seller-active-listings" className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "إحصائيات الثقة" : "Trust statistics"}</CardTitle>
              <CardDescription>{isAr ? "مقاييس الأداء التي تعكس موثوقية البائع." : "Performance metrics that frame the seller's reliability."}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {stats.map((stat) => (
                <StatCard key={stat.label} label={stat.label} value={stat.value} accent={stat.label.includes("Completed") || stat.label.includes("Completed trades") || stat.label.includes("trade") || stat.label.includes("حجم") || stat.label.includes("صفقات")} isUsdt={Boolean(stat.isUsdt)} />
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "الشارات" : "Badges"}</CardTitle>
              <CardDescription>{isAr ? "أوسمة الثقة والاحتراف." : "Recognition earned through trust and consistency."}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {profile.badges.length ? profile.badges.map((badge) => (
                <span key={badge} className="rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 px-3 py-2 text-sm text-[#FDE68A]">{badgeLabel(badge)}</span>
              )) : <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد شارات بعد." : "No badges yet."}</p>}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "التقييمات" : "Reviews"}</CardTitle>
              <CardDescription>{isAr ? "مراجعات موثقة من المشترين." : "Verified feedback from buyers."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/10 p-4">
                <div className="rounded-full bg-[#C9A227]/20 p-2 text-[#C9A227]">
                  <Star className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-[#D1D5DB]">{isAr ? "متوسط التقييم" : "Average rating"}</p>
                  <p className="text-xl font-semibold text-white">{reviewStats.averageRating.toFixed(2)}★</p>
                  <p className="text-xs text-[#9CA3AF]">{reviewStats.reviewCount} {isAr ? "تقييم" : "reviews"}</p>
                </div>
              </div>
              {visibleReviews.length ? visibleReviews.slice(0, 4).map((review) => (
                <div key={review.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
                    <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#C9A227]/20 text-sm font-semibold text-[#FDE68A]">{seller.sellerName.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <p className="font-medium text-white">{seller.sellerName}</p>
                        <p className="text-xs text-[#9CA3AF]">{new Date(review.createdAt).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL")}</p>
                      </div>
                    </div>
                    <div className="text-sm text-[#FDE68A]">{Array.from({ length: review.rating }).map((_, index) => <span key={`${review.id}-${index}`}>★</span>)}</div>
                  </div>
                  <p className={`mt-3 text-sm leading-7 text-[#D1D5DB] ${isAr ? "text-right" : ""}`}>{review.comment}</p>
                  <div className={`mt-3 flex flex-wrap items-center gap-3 text-xs text-[#9CA3AF] ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="inline-flex items-center gap-1.5"><UsdtIcon />{isAr ? "المبلغ" : "Trade amount"}: {review.tradeAmount} USDT</span>
                    <span>{isAr ? "التاريخ" : "Trade date"}: {new Date(review.createdAt).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL")}</span>
                    <span>{review.network}</span>
                  </div>
                  {review.sellerReply ? <div className="mt-3 rounded-xl border border-[#22C55E]/20 bg-[#22C55E]/10 p-3 text-sm text-[#86EFAC]">{review.sellerReply}</div> : null}
                </div>
              )) : <p className="empty-state-panel">{isAr ? "لا توجد مراجعات بعد." : "No reviews yet."}</p>}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "العروض النشطة" : "Active listings"}</CardTitle>
              <CardDescription>{isAr ? "الصفقات المفتوحة المعروضة حاليًا." : "Open offers currently advertised by the seller."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.sellerListings.length ? data.sellerListings.map((listing) => (
                <div key={listing.id} className="surface-panel-subtle p-4 transition duration-300 hover:-translate-y-0.5 hover:border-[#C9A227]/25">
                  <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
                    <div>
                      <p className="text-lg font-semibold text-white">{listing.price} ILS / USDT</p>
                      <p className="inline-flex items-center gap-1.5 text-sm text-[#9CA3AF]"><UsdtIcon />{isAr ? "المتاح" : "Available"}: {listing.availableAmount}</p>
                    </div>
                    <span className="rounded-full border border-[#C9A227]/20 bg-[#C9A227]/10 px-3 py-1 text-xs text-[#FDE68A]">{listing.network}</span>
                  </div>
                  <div className={`mt-3 flex flex-wrap items-center gap-2 text-sm text-[#D1D5DB] ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"><WalletCards className="h-4 w-4 text-[#C9A227]" />{listing.paymentMethod}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"><Network className="h-4 w-4 text-[#C9A227]" />{listing.network}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#B91C1C]/20 bg-[#B91C1C]/10 px-2.5 py-1 text-[#FCA5A5]"><ShieldCheck className="h-4 w-4" />{isAr ? "ضمان Alpha Traders" : "Escrow protected by Alpha Traders"}</span>
                  </div>
                  <Button className="mt-4 w-full">{isAr ? "شراء" : "Buy"}</Button>
                </div>
              )) : <p className="empty-state-panel">{isAr ? "لا توجد عروض نشطة حاليًا." : "No active listings right now."}</p>}
            </CardContent>
          </Card>
        </div>

        {profile.ownerTools?.marketplaceEnforcement ? (
          <MarketplaceEnforcementOwnerPanel
            locale={locale}
            sellerId={profile.sellerId}
            initialStatus={profile.ownerTools.marketplaceEnforcement}
          />
        ) : null}

        <Card className="border-white/10 bg-[#0B0B0B]/95">
          <CardHeader>
            <CardTitle>{isAr ? "بائعون مشابهون" : "Similar sellers"}</CardTitle>
            <CardDescription>{isAr ? "مقترحات من بائعين موثّقين." : "Recommended verified sellers for comparison."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.similarSellers.length ? data.similarSellers.map((sellerItem) => (
              <div key={`${sellerItem.sellerUsername}-${sellerItem.sellerName}`} className="surface-panel-subtle p-4 transition duration-300 hover:-translate-y-0.5 hover:border-[#C9A227]/25">
                <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#C9A227]/20 text-sm font-semibold text-[#FDE68A]">{sellerItem.sellerName.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <p className="font-medium text-white">{sellerItem.sellerName}</p>
                    <p className="inline-flex items-center gap-1 text-xs text-[#9CA3AF]"><UsdtIcon />{sellerItem.publicVolumeRange}</p>
                  </div>
                </div>
                <div className={`mt-3 flex items-center justify-between text-sm ${isAr ? "flex-row-reverse" : ""}`}>
                  <span className="text-[#9CA3AF]">{sellerItem.trustScore.toFixed(1)}/100</span>
                  <span className="text-[#C9A227] capitalize">{sellerItem.sellerLevel}</span>
                </div>
                <Link href={`/exchange/seller/${sellerItem.sellerUsername || slugify(sellerItem.sellerName)}`} className="mt-4 inline-flex text-sm text-[#C9A227] hover:underline">{isAr ? "عرض الملف" : "View profile"}</Link>
              </div>
            )) : <p className="empty-state-panel">{isAr ? "لا توجد توصيات متاحة." : "No similar sellers available."}</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
