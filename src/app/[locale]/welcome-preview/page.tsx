import { notFound } from "next/navigation";
import { AccountWelcome } from "@/components/ui/account-welcome";
import { BuyerRankCard } from "@/components/ui/buyer-rank-card";
import { RankBadge } from "@/components/ui/rank-badge";
import { currencyText } from "@/components/ui/currency-text";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { RANK_VISUAL_KEYS } from "@/lib/rank-identity";
import { deriveBuyerRankSummary } from "@/lib/buyer-rank";

export const metadata = { title: "Welcome design preview", robots: { index: false, follow: false } };

/** Non-production component review: no account access, permissions or live data. */
export default async function WelcomePreview({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const locale = (await params).locale === "ar" ? "ar" : "en";
  const isAr = locale === "ar";
  const buyer = deriveBuyerRankSummary({ lifetimeCompletedVolumeUsdt: 11_126, completedTrades: 0, reviewsGiven: 0, activeTrades: 0 });
  return (
    <main className="section-container py-8">
      <p className="mb-6 text-xs uppercase tracking-widest text-[#9CA3AF]">{isAr ? "معاينة التصميم · أرقام توضيحية" : "Design preview · sample figures"}</p>
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <AccountWelcome role="owner" locale={locale} name="Mark" description={isAr ? "نظرة شاملة على Alpha Traders جاهزة لك." : "Your Alpha Traders overview is ready."}>
          <div className="account-welcome__actions"><Link href="/admin/alpha-exchange" className={buttonVariants()}>{isAr ? "لوحة المالك" : "Owner Dashboard"}</Link><Link href="/trade-room" className={buttonVariants({ variant: "secondary" })}>{isAr ? "الصفقات النشطة" : "Active Trades"}</Link></div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs text-[#9CA3AF]">{isAr ? "سوق اليوم" : "Today’s market"}</p><p className="mt-2 text-lg font-semibold">{currencyText("USDT / ILS ₪3.01")}</p></div>
        </AccountWelcome>
        <AccountWelcome role="approved_seller" locale={locale} name="Alex" description={isAr ? "عروضك وصفقاتك وتنبيهاتك جاهزة." : "Your listings, trades, and alerts are ready."}>
          <div className="account-welcome__actions"><Link href="/usdt-exchange#create-listing" className={buttonVariants()}>{isAr ? "إنشاء عرض" : "Create Listing"}</Link><Link href="/trade-room" className={buttonVariants({ variant: "secondary" })}>{isAr ? "الصفقات النشطة" : "Active Trades"}</Link></div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4"><p className="mb-3 text-xs text-[#9CA3AF]">{isAr ? "مستوى البائع" : "Seller rank"}</p><RankBadge rank="diamond" audience="seller" locale={locale} /></div>
        </AccountWelcome>
        <AccountWelcome role="buyer" locale={locale} name="Alpha" description={isAr ? "مساحة عملك جاهزة. اكتشف فرصتك التالية في السوق." : "Your workspace is ready. Find your next trade."}>
          <div className="account-welcome__actions"><Link href="/usdt-exchange#marketplace" className={buttonVariants()}>{isAr ? "تصفح السوق" : "Browse Marketplace"}</Link><Link href="/trade-room" className={buttonVariants({ variant: "secondary" })}>{isAr ? "صفقاتي" : "My Trades"}</Link></div>
          <BuyerRankCard summary={buyer} locale={locale} />
        </AccountWelcome>
      </div>
      <div className="mt-8 grid gap-4 rounded-3xl border border-white/10 bg-black/50 p-5">
        {(["seller", "buyer"] as const).map((audience) => <div key={audience} className="flex flex-wrap gap-3">{RANK_VISUAL_KEYS.map(rank => <RankBadge key={rank} rank={rank} audience={audience} locale={locale} />)}</div>)}
      </div>
    </main>
  );
}
