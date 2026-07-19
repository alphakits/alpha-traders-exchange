import { buildPageMetadata } from "@/lib/seo";
import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "لوحة الحساب" : "Account Dashboard",
    description: locale === "ar" ? "لوحة الحساب الرئيسية لـ Alpha Traders." : "Main Alpha Traders account dashboard.",
    path: "/dashboard",
  });
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/dashboard`);
  }

  if (user.role === "admin" && isAlphaExchangeOwnerEmail(user.email)) {
    redirect(`/${locale}/admin/alpha-exchange`);
  }

  if (user.role !== "admin" && user.sellerStatus === "approved_seller") {
    redirect(`/${locale}/dashboard/seller`);
  }

  return <UsdtExchangePage locale={locale as "ar" | "en"} />;
}
