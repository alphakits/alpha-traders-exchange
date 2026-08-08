import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { buildPageMetadata } from "@/lib/seo";
import { MarketplaceCompliancePaymentPage } from "@/components/sections/seller/marketplace-compliance-payment-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "دفع رسوم امتثال السوق" : "Marketplace Compliance Payment",
    description: locale === "ar" ? "دفع رسوم استرداد امتثال السوق والتحقق منها." : "Pay and verify Marketplace Recovery Fees for Marketplace Compliance.",
    path: "/dashboard/seller/compliance-payment",
  });
}

export default async function SellerCompliancePaymentRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/dashboard/seller/compliance-payment`);
  }

  if (hasRole(user, "owner") || hasRole(user, "admin")) {
    redirect(`/${locale}/admin/alpha-exchange?section=marketplace-enforcement`);
  }

  if (!hasRole(user, "approved_seller")) {
    redirect(`/${locale}/dashboard`);
  }

  return (
    <main className="section-container page-shell min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-4xl py-8">
        <MarketplaceCompliancePaymentPage locale={locale as "ar" | "en"} />
      </div>
    </main>
  );
}
