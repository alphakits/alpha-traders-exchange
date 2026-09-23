import { notFound } from "next/navigation";
import { AccountWelcome } from "@/components/ui/account-welcome";
import { SellerRankCard } from "@/components/ui/seller-rank-card";
import { BuyerRankCard } from "@/components/ui/buyer-rank-card";
import { RankBadge } from "@/components/ui/rank-badge";
import { currencyText } from "@/components/ui/currency-text";
import { Button, buttonVariants } from "@/components/ui/button";
import { PrivateProfileHeader } from "@/components/profile/private-profile-header";
import { RoleBadge } from "@/components/ui/role-badge";
import { Link } from "@/i18n/navigation";
import { RANK_VISUAL_KEYS } from "@/lib/rank-identity";
import { deriveBuyerRankSummary } from "@/lib/buyer-rank";
import { TradeRequestGroups } from "@/components/sections/trades-workspace";
import type { PurchaseRequest } from "@/types/alpha-exchange";

export const metadata = { title: "Welcome design preview", robots: { index: false, follow: false } };

/** Non-production component review: no account access, permissions or live data. */
export default async function WelcomePreview({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const locale = (await params).locale === "ar" ? "ar" : "en";
  const isAr = locale === "ar";
  const view = (await searchParams).view;
  if (view === "profile") {
    const profiles = [
      { role: "owner" as const, name: "Alex Morgan", id: "#S-001247", tone: "owner", cover: "from-[#1B0E0E] via-[#220f0f] to-[#090909]", frame: "border-[#F87171]/45 shadow-[0_0_36px_rgba(248,113,113,0.18)]" },
      { role: "approved_seller" as const, name: "Maya Chen", id: "#S-027419", tone: "seller", cover: "from-[#1A1204] via-[#251903] to-[#090909]", frame: "border-[#D4AF37]/50 shadow-[0_0_40px_rgba(212,175,55,0.2)]" },
      { role: "buyer" as const, name: "Amir Hassan", id: "#B-084321", tone: "buyer", cover: "from-[#0A101D] via-[#0F1626] to-[#090909]", frame: "border-[#6CAEFF]/40 shadow-[0_0_30px_rgba(108,174,255,0.15)]" },
    ];
    return (
      <main className="section-container py-8">
        <p className="mb-6 text-sm text-[#9CA3AF]">{isAr ? "معاينة الملف الخاص · أسماء ومعرّفات توضيحية" : "Private profile preview · sample names and IDs"}</p>
        <div className="grid items-start gap-5 lg:grid-cols-3">
          {profiles.map(profile => (
            <div key={profile.role} className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-[#0B0B0B]/95">
              <PrivateProfileHeader
                locale={locale}
                fullName={profile.name}
                publicId={profile.id}
                coverClassName={profile.cover}
                avatarClassName={profile.frame}
                nameClassName={`profile-identity-name--${profile.tone}`}
                coverActions={<Button variant="secondary" size="sm" disabled>{isAr ? "تحديث الغلاف" : "Update cover"}</Button>}
                photoActions={<Button variant="secondary" size="sm" disabled>{isAr ? "تغيير الصورة" : "Update photo"}</Button>}
              >
                {profile.role === "owner" ? <div className="mt-3"><p className="text-sm font-semibold text-[#F87171]">{isAr ? "مالك Alpha Exchange" : "Alpha Exchange Owner"}</p><p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "وصول كامل للمنصة • جميع الصلاحيات" : "Full platform access • All permissions"}</p></div> : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <RoleBadge variant={profile.role} locale={locale} />
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#D1D5DB]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{isAr ? "متصل الآن" : "Online now"}</span>
                  {profile.role === "approved_seller" ? <RankBadge rank="silver" locale={locale} audience="seller" /> : null}
                  {profile.role === "buyer" ? <RankBadge rank="bronze" locale={locale} audience="buyer" /> : null}
                </div>
              </PrivateProfileHeader>
            </div>
          ))}
        </div>
      </main>
    );
  }
  if (view === "trades") {
    const requests = [
      { id: "preview-new", tradeId: "#TR-004216", status: "pending", usdtAmount: "1250", createdAt: "2026-09-23T10:30:00Z" },
      { id: "preview-done", tradeId: "#TR-004102", status: "completed", usdtAmount: "2400", createdAt: "2026-09-20T10:30:00Z", completedAt: "2026-09-20T11:00:00Z" },
    ].map(request => ({ ...request, buyerId: "preview-buyer", sellerId: "preview-seller", buyerName: "#B-084321", updatedAt: request.createdAt })) as PurchaseRequest[];
    return <main className="section-container py-8"><p className="mb-6 text-sm text-[#9CA3AF]">{isAr ? "معاينة الصفقات · بيانات توضيحية" : "Trades preview · sample data"}</p><div className="grid gap-8 lg:grid-cols-2">{(["buyer", "seller"] as const).map(side => <div key={side} className="rounded-3xl border border-white/10 bg-black/40 p-5"><h1 className="mb-6 text-2xl font-semibold">{side === "buyer" ? (isAr ? "المشتري" : "Buyer") : (isAr ? "البائع المعتمد" : "Approved seller")}</h1><TradeRequestGroups requests={requests} userId={`preview-${side}`} side={side} locale={locale} /></div>)}</div></main>;
  }
  const buyer = deriveBuyerRankSummary({ lifetimeCompletedVolumeUsdt: 11_126, completedTrades: 0, reviewsGiven: 0, activeTrades: 0 });
  return (
    <main className="section-container py-8">
      <p className="mb-6 text-xs uppercase tracking-widest text-[#9CA3AF]">{isAr ? "معاينة الترحيب الخاص · أسماء وأرقام توضيحية · هوية التداول العامة هي معرّف AT" : "Private welcome preview · sample names and figures · public trading identity uses AT ID"}</p>
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <AccountWelcome role="owner" locale={locale} name="Alex Morgan" description={isAr ? "نظرة شاملة على Alpha Traders جاهزة لك." : "Your Alpha Traders overview is ready."}>
          <div className="account-welcome__actions"><Link href="/admin/alpha-exchange" className={buttonVariants()}>{isAr ? "لوحة المالك" : "Owner Dashboard"}</Link><Link href="/trades" className={buttonVariants({ variant: "secondary" })}>{isAr ? "الصفقات النشطة" : "Active Trades"}</Link></div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "سوق اليوم" : "Today’s market"}</p><p className="mt-2 text-lg font-semibold">{currencyText("USDT / ILS ₪3.01")}</p></div>
        </AccountWelcome>
        <AccountWelcome role="approved_seller" locale={locale} name="Maya Chen" description={isAr ? "عروضك وصفقاتك وتنبيهاتك جاهزة." : "Your listings, trades, and alerts are ready."}>
          <div className="account-welcome__actions"><Link href="/usdt-exchange#create-listing" className={buttonVariants()}>{isAr ? "إنشاء عرض" : "Create Listing"}</Link><Link href="/trades" className={buttonVariants({ variant: "secondary" })}>{isAr ? "الصفقات النشطة" : "Active Trades"}</Link></div>
          <SellerRankCard locale={locale} summary={{ sellerLevel: "silver", nextLevel: "gold", lifetimeCompletedVolumeUsdt: 38_000, amountToNextLevelUsdt: 12_000, progressToNextLevelPercent: 65.71 }} />
        </AccountWelcome>
        <AccountWelcome role="buyer" locale={locale} name="Amir Hassan" description={isAr ? "مساحة عملك جاهزة. اكتشف فرصتك التالية في السوق." : "Your workspace is ready. Find your next trade."}>
          <div className="account-welcome__actions"><Link href="/usdt-exchange#marketplace" className={buttonVariants()}>{isAr ? "تصفح السوق" : "Browse Marketplace"}</Link><Link href="/trades" className={buttonVariants({ variant: "secondary" })}>{isAr ? "صفقاتي" : "My Trades"}</Link></div>
          <BuyerRankCard summary={buyer} locale={locale} />
        </AccountWelcome>
      </div>
      <div className="mt-8 grid gap-4 rounded-3xl border border-white/10 bg-black/50 p-5">
        {(["seller", "buyer"] as const).map((audience) => <div key={audience} className="flex flex-wrap gap-3">{RANK_VISUAL_KEYS.map(rank => <RankBadge key={rank} rank={rank} audience={audience} locale={locale} />)}</div>)}
      </div>
    </main>
  );
}
