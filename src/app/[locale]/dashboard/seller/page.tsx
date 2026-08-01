import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";
import { getFirstActiveTradeForUser } from "@/lib/alpha-exchange-store";

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

  if (hasRole(user, "owner") || hasRole(user, "admin")) {
    redirect(`/${locale}/admin/alpha-exchange`);
  }

  if (!hasRole(user, "approved_seller")) {
    redirect(`/${locale}/dashboard`);
  }

  const activeTrade = await getFirstActiveTradeForUser(user.id, user.role);
  if (activeTrade) {
    redirect(`/${locale}/trade-room/${activeTrade.id}`);
  }

  return <UsdtExchangePage locale={locale as "ar" | "en"} />;
}
