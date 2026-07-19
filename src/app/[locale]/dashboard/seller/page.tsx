import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "لوحة البائع" : "Seller Dashboard",
    description: locale === "ar" ? "لوحة البائع المعتمد في Alpha Exchange." : "Approved seller workspace for Alpha Exchange.",
    path: "/dashboard/seller",
  });
}

export default async function SellerDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/dashboard/seller`);
  }

  if (user.role === "admin" && isAlphaExchangeOwnerEmail(user.email)) {
    redirect(`/${locale}/admin/alpha-exchange`);
  }

  if (user.role === "admin" || user.sellerStatus !== "approved_seller") {
    redirect(`/${locale}/dashboard`);
  }

  return <UsdtExchangePage locale={locale as "ar" | "en"} />;
}
