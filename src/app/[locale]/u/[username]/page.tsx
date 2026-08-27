import Image from "next/image";
import { notFound } from "next/navigation";
import { Award, CheckCircle2, ShieldCheck, Sparkles, Star, UserRound } from "lucide-react";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { getPremiumSellerProfile, getPublicUserProfileRouteData } from "@/lib/alpha-exchange-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; username: string }> }) {
  const { locale, username } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? `البائع • ${username}` : `Seller • ${username}`,
    description: locale === "ar" ? "ملف بائع عام في Alpha Traders." : "Public seller profile for Alpha Traders.",
    path: `/seller/${username}`,
  });
}

function isSellerRole(role: string, sellerStatus: string) {
  return role === "approved_seller" || sellerStatus === "approved_seller" || sellerStatus === "suspended";
}

function sellerTierLabel(level: string, isAr: boolean) {
  const normalized = level.toLowerCase();
  if (normalized === "bronze") return isAr ? "برونزي" : "Bronze";
  if (normalized === "silver") return isAr ? "فضي" : "Silver";
  if (normalized === "gold") return isAr ? "ذهبي" : "Gold";
  if (normalized === "platinum") return isAr ? "بلاتيني" : "Platinum";
  if (normalized === "diamond") return isAr ? "ألماسي" : "Diamond";
  if (normalized === "legendary") return isAr ? "أسطوري" : "Legendary";
  return level;
}

function sellerBadgeLabel(badge: string, isAr: boolean) {
  if (badge === "elite_seller") return isAr ? "بائع من النخبة" : "Elite Seller";
  if (badge === "top_rated") return isAr ? "الأعلى تقييمًا" : "Top Rated";
  if (badge === "fast_responder") return isAr ? "سريع الاستجابة" : "Fast Responder";
  if (badge === "trusted_seller") return isAr ? "بائع موثوق" : "Trusted Seller";
  if (badge === "most_active") return isAr ? "الأكثر نشاطًا" : "Most Active";
  if (badge === "platinum_seller") return isAr ? "بائع بلاتيني" : "Platinum Seller";
  if (badge === "trades_1000_plus" || badge === "thousand_trades") return isAr ? "+1000 صفقة" : "1000+ Trades";
  if (isAr) return "إنجاز للبائع";
  return badge.replaceAll("_", " ");
}

function sellerActivityLabel(activity: { type: string; message: string }, isAr: boolean) {
  if (!isAr) return activity.message;
  if (activity.type === "trade_completed") return "اكتملت صفقة بنجاح.";
  if (activity.type === "review_submitted") return "تم استلام تقييم موثّق جديد.";
  if (activity.type === "trust_score_updated") return "ارتفعت درجة الثقة.";
  if (activity.type === "achievement_earned") return "تم تفعيل إنجاز جديد.";
  return "تم تحديث نشاط البائع.";
}

export default async function PublicUserProfilePage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}) {
  const { locale, username } = await params;
  const isAr = locale === "ar";
  const dateLocale = isAr ? "ar-IL" : "en-IL";
  const viewer = await getCurrentSessionUser();
  const data = await getPublicUserProfileRouteData({
    username,
    viewerUserId: viewer?.id,
    viewerRole: viewer?.role,
  });
  if (!data) notFound();

  const publicTradingName = data.profile.publicTradingName || (isAr ? "بائع موثق" : "Verified Seller");
  const initials = publicTradingName.trim().charAt(0).toUpperCase() || "?";
  const sellerIdentity = isSellerRole(data.profile.role, data.profile.sellerStatus)
    ? await getPremiumSellerProfile({
        sellerId: data.profile.id,
        viewerUserId: viewer?.id,
        viewerRole: viewer?.role,
        viewerEmail: viewer?.email,
      })
    : null;

  const progress = sellerIdentity
    ? Math.max(3, Math.min(100, sellerIdentity.progressToNextRankPercent))
    : 0;

  return (
    <section className="section-container page-shell">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="surface-panel overflow-hidden p-0">
          <div className="relative h-44 border-b border-white/10 bg-gradient-to-r from-[#161005] via-[#221803] to-[#090909] md:h-56">
            {data.profile.coverBannerUrl ? (
              <Image src={data.profile.coverBannerUrl} alt={publicTradingName} fill unoptimized className="object-cover opacity-90" />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/70" />
            <div className="absolute end-4 top-4 flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-xs text-[#D1D5DB] backdrop-blur-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
              {isAr ? "هوية موثقة" : "Identity verified"}
            </div>
          </div>

          <div className="px-6 pb-6 pt-0 md:px-8">
            <div className="-mt-14 flex flex-wrap items-end justify-between gap-4 md:-mt-16">
              <div className="flex items-end gap-4">
                <div className={isSellerRole(data.profile.role, data.profile.sellerStatus) ? "profile-seller-frame" : "profile-member-frame"}>
                  {data.profile.profilePhotoUrl ? (
                    <Image src={data.profile.profilePhotoUrl} alt={publicTradingName} width={112} height={112} unoptimized className="h-full w-full rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-2xl bg-black/70 text-2xl font-semibold text-[#F4D87A]">{initials}</div>
                  )}
                </div>
                <div className="pb-1">
                  <h1 className={isSellerRole(data.profile.role, data.profile.sellerStatus) ? "profile-identity-name profile-identity-name--seller" : "profile-identity-name"}>
                    {publicTradingName}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {isSellerRole(data.profile.role, data.profile.sellerStatus) ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2.5 py-1 font-semibold text-[#F4D87A]">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {isAr ? "بائع معتمد" : "Approved Seller"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 px-2.5 py-1 font-medium text-[#BFDBFE]">
                        <UserRound className="h-3.5 w-3.5" />
                        {isAr ? "عضو موثق" : "Verified Member"}
                      </span>
                    )}
                    {data.profile.isFoundingMember ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[#E5E7EB]">
                        <Sparkles className="h-3.5 w-3.5 text-[#C9A227]" />
                        {isAr ? "عضو مؤسس" : "Founding Member"}
                      </span>
                    ) : null}
                    {data.profile.isFeaturedSeller ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                        <Award className="h-3.5 w-3.5" />
                        {isAr ? "بائع مميز" : "Featured Seller"}
                      </span>
                    ) : null}
                    {data.profile.isEmailVerified ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-sky-200">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {isAr ? "بريد إلكتروني موثّق" : "Verified Email"}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs text-[#D1D5DB]">
                <p>{isAr ? "عضو منذ" : "Member since"}: <span className="text-white">{new Date(data.profile.memberSince).toLocaleDateString(dateLocale)}</span></p>
                {data.profile.lastActiveAt ? (
                  <p className="mt-1">{isAr ? "آخر نشاط" : "Last active"}: <span className="text-white">{new Date(data.profile.lastActiveAt).toLocaleString(dateLocale)}</span></p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الدور" : "Role"}</p>
                <p className="mt-2 text-sm font-semibold text-white">{isSellerRole(data.profile.role, data.profile.sellerStatus) ? (isAr ? "بائع معتمد" : "Approved Seller") : (isAr ? "مشتري" : "Buyer")}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الدولة" : "Country"}</p>
                <p className="mt-2 text-sm font-semibold text-white">{data.profile.country || "—"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "اللغات" : "Languages"}</p>
                <p className="mt-2 text-sm font-semibold text-white">{data.profile.languages.length ? data.profile.languages.join(", ") : "—"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الحالة" : "Status"}</p>
                <p className="mt-2 text-sm font-semibold text-white">{sellerIdentity?.profile.onlineStatus === "online" ? (isAr ? "متصل" : "Online") : (isAr ? "غير متصل" : "Offline")}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="border-white/10 bg-[#0B0B0B]/92 lg:col-span-2">
            <CardHeader>
              <CardTitle>{isAr ? "نبذة احترافية" : "Professional overview"}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-7 text-[#D1D5DB]">
              {data.profile.bio || (isAr ? "لا توجد نبذة منشورة بعد." : "No professional bio published yet.")}
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-[#0B0B0B]/92">
            <CardHeader>
              <CardTitle>{isAr ? "خصوصية التواصل" : "Contact privacy"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-[#9CA3AF]">{isAr ? "لا يتم عرض البريد الإلكتروني أو رقم الهاتف في الملف العام." : "Phone number and email are never shown on public profiles."}</p>
              <p className="pt-2 text-white">{isAr ? "ابدأ صفقة للتواصل الآمن داخل Alpha Traders." : "Start a trade for secure in-platform communication."}</p>
            </CardContent>
          </Card>
        </div>

        {sellerIdentity ? (
          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="border-white/10 bg-[#0B0B0B]/92 xl:col-span-2">
              <CardHeader>
                <CardTitle>{isAr ? "لوحة سمعة البائع" : "Seller reputation board"}</CardTitle>
                <CardDescription>{isAr ? "مؤشرات أداء حقيقية تعكس مستوى الثقة والاحتراف." : "Performance signals that help buyers decide with confidence."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10 p-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "المستوى الحالي" : "Current tier"}</p>
                      <p className="mt-2 text-xl font-semibold text-white">{sellerTierLabel(sellerIdentity.sellerLevel, isAr)}</p>
                    </div>
                    <p className="text-xs text-[#E5E7EB]">
                      {sellerIdentity.nextRank
                        ? `${isAr ? "التالي" : "Next"}: ${sellerTierLabel(sellerIdentity.nextRank, isAr)}`
                        : isAr
                          ? "أعلى مستوى"
                          : "Top tier"}
                    </p>
                  </div>
                  <div className="mt-3 h-2.5 rounded-full bg-black/35">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#C9A227] via-[#F4D87A] to-[#C9A227]" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-[#E5E7EB]">
                    {sellerIdentity.nextRank
                      ? `${sellerIdentity.amountToNextRankUsdt.toLocaleString("en-IL")} USDT ${isAr ? "للمستوى التالي" : "to the next tier"}`
                      : isAr
                        ? "تم الوصول لأعلى مستوى."
                        : "Highest tier achieved."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust score"}</p><p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.trustScore.toFixed(1)}/100</p></div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "تقييم البائع" : "Seller rating"}</p><p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.averageRating.toFixed(2)} ★</p></div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "معدل الإنجاز" : "Completion rate"}</p><p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.completionRate.toFixed(1)}%</p></div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "متوسط الاستجابة" : "Response time"}</p><p className="mt-1 text-lg font-semibold text-white">{Math.max(1, Math.round(sellerIdentity.responseTimeMinutes))} {isAr ? "دقيقة" : "min"}</p></div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "الحجم المنجز" : "Completed volume"}</p><p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.publicVolumeRange}</p></div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "الصفقات المكتملة" : "Completed trades"}</p><p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.completedTrades.toLocaleString("en-IL")}</p></div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الشارات والإنجازات" : "Badges & achievements"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(sellerIdentity.badges ?? []).slice(0, 6).map((badge) => (
                      <span key={badge} className="inline-flex items-center gap-1 rounded-full border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-2.5 py-1 text-[11px] text-[#BFDBFE]">
                        <Star className="h-3.5 w-3.5 text-[#93C5FD]" />
                        {sellerBadgeLabel(badge, isAr)}
                      </span>
                    ))}
                    {!sellerIdentity.badges.length ? (
                      <span className="text-xs text-[#9CA3AF]">{isAr ? "سيتم فتح الشارات مع التقدم." : "Badges unlock as the seller progresses."}</span>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "آخر التقييمات" : "Latest reviews"}</p>
                    <div className="mt-2 space-y-2">
                      {sellerIdentity.latestReviews.slice(0, 3).map((review) => (
                        <div key={review.id} className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">{review.buyerName} • {review.rating.toFixed(1)}★</p>
                          <p className="mt-1">{review.comment}</p>
                        </div>
                      ))}
                      {!sellerIdentity.latestReviews.length ? <p className="text-xs text-[#9CA3AF]">{isAr ? "لا توجد تقييمات منشورة بعد." : "No reviews published yet."}</p> : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "النشاط الأخير" : "Recent activity"}</p>
                    <div className="mt-2 space-y-2">
                      {sellerIdentity.recentActivity.slice(0, 4).map((activity) => (
                        <div key={activity.id} className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">{sellerActivityLabel(activity, isAr)}</p>
                          <p className="mt-1 text-[#9CA3AF]">{new Date(activity.createdAt).toLocaleString(dateLocale)}</p>
                        </div>
                      ))}
                      {!sellerIdentity.recentActivity.length ? <p className="text-xs text-[#9CA3AF]">{isAr ? "لا توجد تحديثات نشاط حالياً." : "No recent activity updates yet."}</p> : null}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0B0B0B]/92">
              <CardHeader>
                <CardTitle>{isAr ? "موثوق للمشترين" : "Buyer trust panel"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-[#D1D5DB]">
                <p className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {isAr ? "بائع موثق ومراجع" : "Reviewed and approved seller"}
                </p>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "حجم التداول" : "Trading footprint"}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.prestigeVolumePublicLabel}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "المشترون المتكررون" : "Repeat buyers"}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.repeatBuyersPercent.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "العمر على المنصة" : "Years on platform"}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{sellerIdentity.yearsOnPlatform.toFixed(1)}</p>
                </div>
                <p className="text-xs leading-6 text-[#9CA3AF]">
                  {isAr
                    ? "هذه الهوية تعكس أداءً موثقًا داخل Alpha Exchange، بما يشمل التقييمات، معدل الإنجاز، وسرعة الاستجابة."
                    : "This identity reflects verified marketplace performance across reviews, completion quality, and response consistency."}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-white/10 bg-[#0B0B0B]/92">
            <CardContent className="p-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "صفقات مكتملة" : "Completed trades"}</p>
                  <p className="mt-1 text-xl font-semibold text-white">{data.stats?.completedAsBuyer ?? 0}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "تقييمات مكتوبة" : "Reviews written"}</p>
                  <p className="mt-1 text-xl font-semibold text-white">{data.stats?.reviewsWritten ?? 0}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الهدف التالي" : "Next milestone"}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{isAr ? "ابدأ مسار البائع" : "Unlock seller progression"}</p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-4 text-sm text-[#D1D5DB]">
                <p className="font-medium text-white">{isAr ? "هل تريد هوية بائع مميزة؟" : "Want a premium seller identity?"}</p>
                <p className="mt-1 leading-6">
                  {isAr
                    ? "انطلق في مسار البيع لبناء تقييمات، إنجازات، وشارات موثقة تظهر للمشترين."
                    : "Start the seller path to unlock verified badges, richer performance cards, and stronger buyer trust."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {data.stats ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-white/10 bg-[#0B0B0B]/85"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "كمشتري" : "As buyer"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.completedAsBuyer}</p></CardContent></Card>
            <Card className="border-white/10 bg-[#0B0B0B]/85"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "كبائع" : "As seller"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.completedAsSeller}</p></CardContent></Card>
            <Card className="border-white/10 bg-[#0B0B0B]/85"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "تقييمات مستلمة" : "Reviews received"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.reviewsReceived}</p></CardContent></Card>
            <Card className="border-white/10 bg-[#0B0B0B]/85"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "العروض النشطة" : "Active listings"}</p><p className="mt-1 text-xl font-semibold text-white">{data.stats.activeListings}</p></CardContent></Card>
          </div>
        ) : null}
      </div>
    </section>
  );
}
