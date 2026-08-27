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
import { normalizeMarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import { cn } from "@/lib/utils";
import type { PremiumSellerProfileData, SellerBadge, SellerLevel } from "@/types/alpha-exchange";

function formatSellerLevelLabel(level: SellerLevel | undefined, isAr: boolean) {
  if (level === "elite") return isAr ? "بائع ألفا النخبة" : "Alpha Elite Seller";
  if (level === "diamond") return isAr ? "بائع ألفا الماسي" : "Alpha Diamond Seller";
  if (level === "gold") return isAr ? "بائع ألفا الذهبي" : "Alpha Gold Seller";
  if (level === "silver") return isAr ? "بائع ألفا الفضي" : "Alpha Silver Seller";
  return isAr ? "بائع ألفا البرونزي" : "Alpha Bronze Seller";
}

function formatSellerBadgeLabel(badge: string, isAr: boolean) {
  if (badge === "elite_seller") return isAr ? "بائع نخبة" : "Elite Seller";
  if (badge === "top_rated") return isAr ? "الأعلى تقييماً" : "Top Rated";
  if (badge === "fast_responder") return isAr ? "سريع الرد" : "Fast Responder";
  if (badge === "trusted_seller") return isAr ? "بائع موثوق" : "Trusted Seller";
  if (badge === "most_active") return isAr ? "الأكثر نشاطاً" : "Most Active";
  if (badge === "platinum_seller") return isAr ? "بائع بلاتيني" : "Platinum Seller";
  if (badge === "trades_1000_plus" || badge === "thousand_trades") return isAr ? "+1000 صفقة" : "1000+ Trades";
  return isAr ? "إنجاز للبائع" : badge.replaceAll("_", " ");
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

function heroRankLabel(level: SellerLevel | undefined, isOwner = false, isAr = false) {
  if (isOwner) return isAr ? "المالك" : "OWNER";
  if (level === "elite") return isAr ? "بائع نخبة" : "ELITE SELLER";
  if (level === "diamond") return isAr ? "بائع ماسي" : "DIAMOND SELLER";
  if (level === "gold") return isAr ? "بائع ذهبي" : "GOLD SELLER";
  if (level === "silver") return isAr ? "بائع فضي" : "SILVER SELLER";
  return isAr ? "بائع برونزي" : "BRONZE SELLER";
}

function badgeLabel(badge: SellerBadge, isAr: boolean) {
  return formatSellerBadgeLabel(badge, isAr);
}

function containsArabic(value: string) {
  return /[\u0600-\u06FF]/.test(value);
}

function languageLabel(language: string, isAr: boolean) {
  const value = language.trim();
  const normalized = value.toLowerCase();
  const labels: Record<string, { ar: string; en: string }> = {
    ar: { ar: "العربية", en: "Arabic" },
    arabic: { ar: "العربية", en: "Arabic" },
    العربية: { ar: "العربية", en: "Arabic" },
    en: { ar: "الإنجليزية", en: "English" },
    english: { ar: "الإنجليزية", en: "English" },
    الإنجليزية: { ar: "الإنجليزية", en: "English" },
    he: { ar: "العبرية", en: "Hebrew" },
    hebrew: { ar: "العبرية", en: "Hebrew" },
    العبرية: { ar: "العبرية", en: "Hebrew" },
    עברית: { ar: "العبرية", en: "Hebrew" },
  };
  const known = labels[normalized];
  if (known) return isAr ? known.ar : known.en;
  if (isAr) return containsArabic(value) ? value : "لغة أخرى";
  return containsArabic(value) ? "Other language" : value;
}

function paymentMethodLabel(method: string, isAr: boolean) {
  const methodToken = method.trim().toLowerCase().replace(/\s+/g, " ");
  const normalized = normalizeMarketplacePaymentMethod(method)
    ?? (methodToken === "cardless withdrawal" ? "Cardless ATM Withdrawal" : null);
  if (!isAr) return normalized ?? method;
  if (normalized === "Bank Transfer") return "تحويل بنكي";
  if (normalized === "Cardless ATM Withdrawal") return "سحب من الصراف دون بطاقة";
  if (normalized === "Face-to-Face (Meet in Person)") return "لقاء مباشر وجهًا لوجه";
  return containsArabic(method) ? method : "طريقة دفع أخرى";
}

const COUNTRY_LABELS: Record<string, { ar: string; en: string }> = {
  il: { ar: "إسرائيل", en: "Israel" }, israel: { ar: "إسرائيل", en: "Israel" },
  ps: { ar: "فلسطين", en: "Palestine" }, palestine: { ar: "فلسطين", en: "Palestine" }, "palestinian territories": { ar: "فلسطين", en: "Palestine" },
  jo: { ar: "الأردن", en: "Jordan" }, jordan: { ar: "الأردن", en: "Jordan" },
  eg: { ar: "مصر", en: "Egypt" }, egypt: { ar: "مصر", en: "Egypt" },
  lb: { ar: "لبنان", en: "Lebanon" }, lebanon: { ar: "لبنان", en: "Lebanon" },
  sy: { ar: "سوريا", en: "Syria" }, syria: { ar: "سوريا", en: "Syria" },
  iq: { ar: "العراق", en: "Iraq" }, iraq: { ar: "العراق", en: "Iraq" },
  sa: { ar: "السعودية", en: "Saudi Arabia" }, "saudi arabia": { ar: "السعودية", en: "Saudi Arabia" },
  ae: { ar: "الإمارات العربية المتحدة", en: "United Arab Emirates" }, uae: { ar: "الإمارات العربية المتحدة", en: "United Arab Emirates" }, "united arab emirates": { ar: "الإمارات العربية المتحدة", en: "United Arab Emirates" },
  qa: { ar: "قطر", en: "Qatar" }, qatar: { ar: "قطر", en: "Qatar" },
  kw: { ar: "الكويت", en: "Kuwait" }, kuwait: { ar: "الكويت", en: "Kuwait" },
  bh: { ar: "البحرين", en: "Bahrain" }, bahrain: { ar: "البحرين", en: "Bahrain" },
  om: { ar: "عُمان", en: "Oman" }, oman: { ar: "عُمان", en: "Oman" },
  tr: { ar: "تركيا", en: "Turkey" }, turkey: { ar: "تركيا", en: "Turkey" },
  cy: { ar: "قبرص", en: "Cyprus" }, cyprus: { ar: "قبرص", en: "Cyprus" },
  us: { ar: "الولايات المتحدة", en: "United States" }, usa: { ar: "الولايات المتحدة", en: "United States" }, "united states": { ar: "الولايات المتحدة", en: "United States" },
  gb: { ar: "المملكة المتحدة", en: "United Kingdom" }, uk: { ar: "المملكة المتحدة", en: "United Kingdom" }, "united kingdom": { ar: "المملكة المتحدة", en: "United Kingdom" },
  ca: { ar: "كندا", en: "Canada" }, canada: { ar: "كندا", en: "Canada" },
  de: { ar: "ألمانيا", en: "Germany" }, germany: { ar: "ألمانيا", en: "Germany" },
  fr: { ar: "فرنسا", en: "France" }, france: { ar: "فرنسا", en: "France" },
};

const ARABIC_COUNTRY_ALIASES: Record<string, string> = {
  إسرائيل: "Israel", فلسطين: "Palestine", الأردن: "Jordan", مصر: "Egypt", لبنان: "Lebanon", سوريا: "Syria", العراق: "Iraq",
  السعودية: "Saudi Arabia", "الإمارات العربية المتحدة": "United Arab Emirates", قطر: "Qatar", الكويت: "Kuwait", البحرين: "Bahrain",
  عُمان: "Oman", عمان: "Oman", تركيا: "Turkey", قبرص: "Cyprus", "الولايات المتحدة": "United States", "المملكة المتحدة": "United Kingdom",
  كندا: "Canada", ألمانيا: "Germany", فرنسا: "France",
};

function countryLabel(country: string | undefined, isAr: boolean) {
  const value = country?.trim();
  if (!value || /^(unknown|not specified|n\/?a|null|undefined|-+)$/i.test(value)) return isAr ? "غير محددة" : "Not specified";
  const known = COUNTRY_LABELS[value.toLowerCase()];
  if (known) return isAr ? known.ar : known.en;
  if (isAr) return containsArabic(value) ? value : "دولة أخرى";
  return ARABIC_COUNTRY_ALIASES[value] ?? (containsArabic(value) ? "Other country" : value);
}

function publicVolumeLabel(value: string, isAr: boolean) {
  const trimmed = value.trim();
  if (!isAr || !trimmed) return trimmed || "0+";
  if (containsArabic(trimmed)) return trimmed;
  const match = trimmed.match(/^([\d,.]+)\s*([KMB])?\s*(\+)?(?:\s+(USDT))?$/i);
  if (!match) return "حجم موثّق";
  const [, amount, unit, plus, currency] = match;
  const unitLabel = unit ? ({ K: "ألف", M: "مليون", B: "مليار" } as const)[unit.toUpperCase() as "K" | "M" | "B"] : "";
  return `${plus ? "+" : ""}${amount}${unitLabel ? ` ${unitLabel}` : ""}${currency ? " USDT" : ""}`;
}

function StatCard({ label, value, accent = false, isUsdt = false }: { label: string; value: string; accent?: boolean; isUsdt?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/20 p-4 ${accent ? "border-[#C9A227]/25 bg-[#C9A227]/10" : ""}`}>
      <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">
        {isUsdt ? <UsdtIcon /> : null}
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-white"><bdi dir="ltr">{value}</bdi></p>
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
  const listSeparator = isAr ? "، " : ", ";
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
    seller.isFeaturedSeller ? (isAr ? "بائع مميز" : "Featured Seller") : null,
    seller.isFoundingSeller ? (isAr ? "بائع مؤسس" : "Founding Seller") : null,
    ...profile.badges.slice(0, 2).map((badge) => badgeLabel(badge, isAr)),
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
      value: `${profile.responseTimeMinutes.toFixed(0)} ${isAr ? "دقيقة" : "min"}`,
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
    { label: isAr ? "المشترون المتكرّرون" : "Repeat buyers", value: `${profile.repeatBuyersPercent.toFixed(1)}${isAr ? "٪" : "%"}` },
    { label: isAr ? "معدل الإكمال" : "Completion rate", value: `${profile.completionRate.toFixed(1)}${isAr ? "٪" : "%"}` },
    { label: isAr ? "متوسط سرعة الرد" : "Avg response", value: `${profile.responseTimeMinutes.toFixed(0)} ${isAr ? "دقيقة" : "min"}` },
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
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">{isAr ? "الملف الرسمي لمالك Alpha Exchange" : "Official Alpha Exchange Profile"}</span>
              <span className="ms-auto text-[11px] text-red-400/70">{isAr ? "هوية المالك موثّقة" : "Verified owner identity"}</span>
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
                        <h1 className={cn("seller-listing-seller-name text-3xl font-extrabold md:text-[2.35rem]", isOwnerSeller ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${sellerRankKey}`)}><bdi dir="auto">{seller.sellerName}</bdi></h1>
                        <BadgeCheck className={cn("h-5 w-5", isOwnerSeller ? "text-red-300" : "text-[#C9A227]")} />
                      </div>
                      <p className="seller-listing-seller-subtitle mt-2 text-[12px] uppercase tracking-[0.16em] text-[#9CA3AF]">
                        <span className={cn("seller-listing-rank-label", `seller-listing-rank-label--${sellerRankKey}`)}>
                          {heroRankLabel(profile.sellerLevel, isOwnerSeller, isAr)}
                        </span>
                        <span className="seller-listing-status-separator"> • </span>
                        <span className="text-[#D1D5DB]">{seller.onlineStatus === "online" ? (isAr ? "متصل" : "ONLINE") : (isAr ? "غير متصل" : "OFFLINE")}</span>
                      </p>
                      <div className={cn("mt-3 flex flex-wrap gap-2", isAr ? "justify-end" : "")}>
                        {isOwnerSeller ? <RoleBadge variant="owner" locale={locale} /> : null}
                        <RoleBadge variant="approved_seller" locale={locale} className={cn("seller-rank-badge", `seller-rank-badge--${sellerRankKey}`)} />
                        <span className={cn("seller-rank-pill", `seller-rank-pill--${sellerRankKey}`)}>{formatSellerLevelLabel(profile.sellerLevel, isAr)}</span>
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
                      <p className={cn("mt-1 text-2xl font-semibold", isOwnerSeller ? "text-red-200" : `seller-listing-rank-label seller-listing-rank-label--${sellerRankKey}`)}><bdi dir="ltr">{profile.trustScore.toFixed(1)}/100</bdi></p>
                      <p className="mt-1 text-[#D1D5DB]">{isAr ? "المستوى" : "Level"}: {formatSellerLevelLabel(profile.sellerLevel, isAr)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={cn("seller-listing-availability", `seller-listing-availability--${sellerRankKey}`)}>{availabilityLabel}</span>
                      <span className="rounded-full border border-[#B91C1C]/20 bg-[#B91C1C]/10 px-3 py-1 text-xs font-medium text-[#FCA5A5]">{isAr ? "مسار صفقة منظّم" : "Structured trade flow"}</span>
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
                      <p className="mt-2 text-sm font-semibold text-white md:text-base"><bdi dir="ltr">{stat.value}</bdi></p>
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
                  <p className="mt-2 font-medium text-white">{countryLabel(seller.country, isAr)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "اللغات" : "Languages"}</p>
                  <p className="mt-2 font-medium text-white">{seller.languages.length ? seller.languages.map((language) => languageLabel(language, isAr)).join(listSeparator) : (isAr ? "غير محددة" : "Not specified")}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "وقت الرد" : "Response time"}</p>
                  <p className="mt-2 font-medium text-white">{profile.responseTimeMinutes.toFixed(0)} {isAr ? "دقيقة" : "min"}</p>
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
                <p className={`mt-3 text-sm leading-7 text-[#D1D5DB] ${isAr ? "text-right" : ""}`}><bdi dir="auto">{seller.bio || (isAr ? "بائع موثوق في Alpha Exchange." : "A trusted seller on Alpha Exchange.")}</bdi></p>
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
                    <bdi dir="ltr" className="text-white">{profile.progressToNextRankPercent.toFixed(0)}{isAr ? "٪" : "%"}</bdi>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#C9A227] via-[#FDE68A] to-[#C9A227]" style={{ width: `${Math.min(100, profile.progressToNextRankPercent)}%` }} />
                  </div>
                </div>
                <div className={`mt-4 grid gap-3 text-sm ${isAr ? "text-right" : ""}`}>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "الرتبة الحالية" : "Current rank"}</p>
                    <p className={`mt-1 font-semibold capitalize text-white ${sellerRankTheme(profile.sellerLevel)}`}>{formatSellerLevelLabel(profile.sellerLevel, isAr)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "الرتبة التالية" : "Next rank"}</p>
                    <p className="mt-1 font-semibold text-[#C9A227]">{profile.nextRank ? formatSellerLevelLabel(profile.nextRank, isAr) : (isAr ? "أعلى مستوى" : "Top tier reached")}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "المتبقي إلى الترقية" : "Remaining volume"}</p>
                    <p className="mt-1 font-semibold text-white"><bdi dir="ltr">{profile.amountToNextRankUsdt.toLocaleString("en-IL")} USDT</bdi></p>
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
                    <p className="mt-1 font-medium text-white">{paymentMethods.length ? paymentMethods.map((method) => paymentMethodLabel(method, isAr)).join(listSeparator) : (isAr ? "غير محددة" : "Not specified")}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "الشبكات المدعومة" : "Supported networks"}</p>
                    <p className="mt-1 font-medium text-white">{supportedNetworks.length ? <bdi dir="ltr">{supportedNetworks.join(", ")}</bdi> : (isAr ? "غير محددة" : "Not specified")}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[#9CA3AF]">{isAr ? "USDT المتاح" : "Available USDT"}</p>
                    <p className="mt-1 font-medium text-white">{availableUsdt > 0 ? <bdi dir="ltr">{availableUsdt.toLocaleString("en-IL", { maximumFractionDigits: 2 })} USDT</bdi> : (isAr ? "غير متاح" : "Not available")}</p>
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
                <span key={badge} className="rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 px-3 py-2 text-sm text-[#FDE68A]">{badgeLabel(badge, isAr)}</span>
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
                        <p className="font-medium text-white"><bdi dir="auto">{seller.sellerName}</bdi></p>
                        <p className="text-xs text-[#9CA3AF]">{new Date(review.createdAt).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL")}</p>
                      </div>
                    </div>
                    <div className="text-sm text-[#FDE68A]">{Array.from({ length: review.rating }).map((_, index) => <span key={`${review.id}-${index}`}>★</span>)}</div>
                  </div>
                  <p className={`mt-3 text-sm leading-7 text-[#D1D5DB] ${isAr ? "text-right" : ""}`}><bdi dir="auto">{review.comment}</bdi></p>
                  <div className={`mt-3 flex flex-wrap items-center gap-3 text-xs text-[#9CA3AF] ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="inline-flex items-center gap-1.5"><UsdtIcon />{isAr ? "المبلغ" : "Trade amount"}: <bdi dir="ltr">{review.tradeAmount} USDT</bdi></span>
                    <span>{isAr ? "التاريخ" : "Trade date"}: {new Date(review.createdAt).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL")}</span>
                    <bdi dir="ltr">{review.network}</bdi>
                  </div>
                  {review.sellerReply ? <div className="mt-3 rounded-xl border border-[#22C55E]/20 bg-[#22C55E]/10 p-3 text-sm text-[#86EFAC]"><bdi dir="auto">{review.sellerReply}</bdi></div> : null}
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
                      <p className="text-lg font-semibold text-white"><bdi dir="ltr">{listing.price} ILS / USDT</bdi></p>
                      <p className="inline-flex items-center gap-1.5 text-sm text-[#9CA3AF]"><UsdtIcon />{isAr ? "المتاح" : "Available"}: <bdi dir="ltr">{listing.availableAmount} USDT</bdi></p>
                    </div>
                    <span className="rounded-full border border-[#C9A227]/20 bg-[#C9A227]/10 px-3 py-1 text-xs text-[#FDE68A]"><bdi dir="ltr">{listing.network}</bdi></span>
                  </div>
                  <div className={`mt-3 flex flex-wrap items-center gap-2 text-sm text-[#D1D5DB] ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"><WalletCards className="h-4 w-4 text-[#C9A227]" />{paymentMethodLabel(listing.paymentMethod, isAr)}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"><Network className="h-4 w-4 text-[#C9A227]" /><bdi dir="ltr">{listing.network}</bdi></span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#B91C1C]/20 bg-[#B91C1C]/10 px-2.5 py-1 text-[#FCA5A5]"><ShieldCheck className="h-4 w-4" />{isAr ? "مسار صفقة مسجّل عبر Alpha Traders" : "Trade flow recorded by Alpha Traders"}</span>
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
                    <p className="font-medium text-white"><bdi dir="auto">{sellerItem.sellerName}</bdi></p>
                    <p className="inline-flex items-center gap-1 text-xs text-[#9CA3AF]"><UsdtIcon /><bdi dir="auto">{publicVolumeLabel(sellerItem.publicVolumeRange, isAr)}</bdi></p>
                  </div>
                </div>
                <div className={`mt-3 flex items-center justify-between text-sm ${isAr ? "flex-row-reverse" : ""}`}>
                  <span className="text-[#9CA3AF]">{sellerItem.trustScore.toFixed(1)}/100</span>
                  <span className="text-[#C9A227] capitalize">{formatSellerLevelLabel(sellerItem.sellerLevel, isAr)}</span>
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
