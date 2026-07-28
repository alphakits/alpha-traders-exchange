import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { BadgeCheck, Network, ShieldCheck, Star, TrendingUp, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildSellerReviewStats, getVisibleSellerReviews } from "@/lib/reviews";
import type { PremiumSellerProfileData, SellerBadge, SellerLevel } from "@/types/alpha-exchange";

function formatSellerLevelLabel(level?: SellerLevel) {
  if (level === "legendary") return "Alpha Legendary Seller";
  if (level === "diamond") return "Alpha Diamond Seller";
  if (level === "platinum") return "Alpha Platinum Seller";
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
  if (level === "legendary") return "from-[#F8E7A0] via-white to-[#C9A227] text-transparent bg-clip-text";
  if (level === "diamond") return "text-[#7CC9FF]";
  if (level === "platinum") return "text-[#C8D1DF]";
  if (level === "gold") return "text-[#E8C547]";
  if (level === "silver") return "text-[#C9CED9]";
  return "text-[#B8824B]";
}

function badgeLabel(badge: SellerBadge) {
  return formatSellerBadgeLabel(badge);
}

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/20 p-4 ${accent ? "border-[#C9A227]/25 bg-[#C9A227]/10" : ""}`}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

type PremiumSellerProfilePageProps = {
  locale: "ar" | "en";
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
      sellerId: string;
      sellerName: string;
      sellerLevel: SellerLevel;
      trustScore: number;
      profilePhotoUrl: string;
      publicVolumeRange: string;
    }>;
  };
};

export function PremiumSellerProfilePage({ locale, data }: PremiumSellerProfilePageProps) {
  const isAr = locale === "ar";
  const profile = data.profile;
  const seller = profile?.profile;
  const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!profile || !seller) {
    return null;
  }

  const visibleReviews = getVisibleSellerReviews(profile.latestReviews as never[]);
  const reviewStats = buildSellerReviewStats(visibleReviews as never[]);
  const stats = [
    { label: isAr ? "صفقات مكتملة" : "Completed trades", value: profile.completedTrades.toString() },
    { label: isAr ? "حجم التداول" : "Trade volume", value: `${profile.tradeVolume?.toLocaleString("en-IL") ?? profile.lifetimeCompletedVolumeUsdt.toLocaleString("en-IL")} USDT` },
    { label: isAr ? "التقييم المتوسط" : "Average rating", value: `${reviewStats.averageRating.toFixed(2)}★` },
    { label: isAr ? "المشترون المتكرّرون" : "Repeat buyers", value: `${profile.repeatBuyersPercent.toFixed(1)}%` },
    { label: isAr ? "معدل الإكمال" : "Completion rate", value: `${profile.completionRate.toFixed(1)}%` },
    { label: isAr ? "متوسط سرعة الرد" : "Avg response", value: `${profile.responseTimeMinutes.toFixed(0)} min` },
    { label: isAr ? "العروض النشطة" : "Active listings", value: data.sellerListings.length.toString() },
    { label: isAr ? "سنوات على المنصة" : "Years on platform", value: `${profile.yearsOnPlatform.toFixed(1)}` },
  ];

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Card className="overflow-hidden border-white/10 bg-[#0B0B0B]/95">
          <div
            className="relative h-56 md:h-72"
            style={{
              backgroundImage: seller.coverBannerUrl
                ? `linear-gradient(180deg, rgba(5,5,5,0.2), rgba(5,5,5,0.85)), url(${seller.coverBannerUrl})`
                : "linear-gradient(135deg, rgba(201,162,39,0.28), rgba(0,0,0,0.92))",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(201,162,39,0.15),transparent_40%)]" />
            <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
              <div className={`flex items-end gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                <div className="relative">
                  {seller.profilePhotoUrl ? (
                    <Image src={seller.profilePhotoUrl} alt={seller.sellerName} width={110} height={110} unoptimized className="h-24 w-24 rounded-full border-4 border-[#050505] object-cover shadow-[0_0_0_1px_rgba(201,162,39,0.3)] md:h-28 md:w-28" />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-[#050505] bg-[#C9A227]/20 text-2xl font-semibold text-[#FDE68A] md:h-28 md:w-28">
                      {seller.sellerName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className={`absolute bottom-1 ${isAr ? "left-1" : "right-1"} h-4 w-4 rounded-full border-2 border-[#050505] ${seller.onlineStatus === "online" ? "bg-[#22C55E]" : "bg-[#9CA3AF]"}`} />
                </div>
                <div>
                  <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                    <h1 className={`text-2xl font-semibold text-white md:text-3xl ${isAr ? "text-right" : ""}`}>{seller.sellerName}</h1>
                    <BadgeCheck className="h-5 w-5 text-[#C9A227]" />
                  </div>
                  <div className={`mt-2 flex flex-wrap items-center gap-2 text-sm ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-3 py-1 text-[#FDE68A]">{formatSellerLevelLabel(profile.sellerLevel)}</span>
                    <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[#D1D5DB]">{isAr ? "بائع موثّق" : "Verified Seller"}</span>
                    <span className="rounded-full border border-[#22C55E]/20 bg-[#22C55E]/10 px-3 py-1 text-[#86EFAC]">{seller.onlineStatus === "online" ? (isAr ? "متصل الآن" : "Online now") : (isAr ? "غير متصل" : "Offline")}</span>
                  </div>
                </div>
              </div>

              <div className={`rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm backdrop-blur ${isAr ? "text-right" : ""}`}>
                <p className="text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust Score"}</p>
                <p className="mt-1 text-2xl font-semibold text-[#C9A227]">{profile.trustScore.toFixed(1)}/100</p>
                <p className="mt-1 text-[#D1D5DB]">{isAr ? "المستوى" : "Level"}: {profile.sellerLevel}</p>
              </div>
            </div>
          </div>

          <CardContent className="grid gap-6 p-6 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className={`grid gap-3 sm:grid-cols-2 ${isAr ? "text-right" : ""}`}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{isAr ? "عضو منذ" : "Member since"}</p>
                  <p className="mt-2 font-medium text-white">{new Date(seller.memberSince).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL")}</p>
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
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "إحصائيات الثقة" : "Trust statistics"}</CardTitle>
              <CardDescription>{isAr ? "مقاييس الأداء التي تعكس موثوقية البائع." : "Performance metrics that frame the seller's reliability."}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {stats.map((stat) => (
                <StatCard key={stat.label} label={stat.label} value={stat.value} accent={stat.label.includes("Completed") || stat.label.includes("Completed trades") || stat.label.includes("trade") || stat.label.includes("حجم") || stat.label.includes("صفقات") } />
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
                    <span>{isAr ? "المبلغ" : "Trade amount"}: {review.tradeAmount} USDT</span>
                    <span>{isAr ? "التاريخ" : "Trade date"}: {new Date(review.createdAt).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL")}</span>
                    <span>{review.network}</span>
                  </div>
                  {review.sellerReply ? <div className="mt-3 rounded-xl border border-[#22C55E]/20 bg-[#22C55E]/10 p-3 text-sm text-[#86EFAC]">{review.sellerReply}</div> : null}
                </div>
              )) : <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد مراجعات بعد." : "No reviews yet."}</p>}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "العروض النشطة" : "Active listings"}</CardTitle>
              <CardDescription>{isAr ? "الصفقات المفتوحة المعروضة حاليًا." : "Open offers currently advertised by the seller."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.sellerListings.length ? data.sellerListings.map((listing) => (
                <div key={listing.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
                    <div>
                      <p className="text-lg font-semibold text-white">{listing.price} USDT</p>
                      <p className="text-sm text-[#9CA3AF]">{isAr ? "المتاح" : "Available"}: {listing.availableAmount}</p>
                    </div>
                    <span className="rounded-full border border-[#C9A227]/20 bg-[#C9A227]/10 px-3 py-1 text-xs text-[#FDE68A]">{listing.network}</span>
                  </div>
                  <div className={`mt-3 flex flex-wrap items-center gap-2 text-sm text-[#D1D5DB] ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"><WalletCards className="h-4 w-4 text-[#C9A227]" />{listing.paymentMethod}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"><Network className="h-4 w-4 text-[#C9A227]" />{listing.network}</span>
                  </div>
                  <Button className="mt-4 w-full">{isAr ? "شراء" : "Buy"}</Button>
                </div>
              )) : <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد عروض نشطة حاليًا." : "No active listings right now."}</p>}
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-[#0B0B0B]/95">
          <CardHeader>
            <CardTitle>{isAr ? "بائعون مشابهون" : "Similar sellers"}</CardTitle>
            <CardDescription>{isAr ? "مقترحات من بائعين موثّقين." : "Recommended verified sellers for comparison."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.similarSellers.length ? data.similarSellers.map((sellerItem) => (
              <div key={sellerItem.sellerId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#C9A227]/20 text-sm font-semibold text-[#FDE68A]">{sellerItem.sellerName.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <p className="font-medium text-white">{sellerItem.sellerName}</p>
                    <p className="text-xs text-[#9CA3AF]">{sellerItem.publicVolumeRange}</p>
                  </div>
                </div>
                <div className={`mt-3 flex items-center justify-between text-sm ${isAr ? "flex-row-reverse" : ""}`}>
                  <span className="text-[#9CA3AF]">{sellerItem.trustScore.toFixed(1)}/100</span>
                  <span className="text-[#C9A227] capitalize">{sellerItem.sellerLevel}</span>
                </div>
                <Link href={`/exchange/seller/${slugify(sellerItem.sellerName)}`} className="mt-4 inline-flex text-sm text-[#C9A227] hover:underline">{isAr ? "عرض الملف" : "View profile"}</Link>
              </div>
            )) : <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد توصيات متاحة." : "No similar sellers available."}</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
