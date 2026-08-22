import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { getSellerDashboardAccessState } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";
import { toClientSessionUser } from "@/lib/client-session-user";
import { SellerEnforcementRestrictionScreen } from "@/components/sections/seller/seller-enforcement-restriction-screen";

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

  const accessState = await getSellerDashboardAccessState(user.id);
  if (accessState?.enforcement.restricted && accessState.enforcement.blockReason) {
    return (
      <SellerEnforcementRestrictionScreen
        locale={locale as "ar" | "en"}
        sellerName={accessState.sellerName}
        activeRecord={accessState.enforcement.activeRecord}
        blockReason={accessState.enforcement.blockReason}
      />
    );
  }

  return <UsdtExchangePage locale={locale as "ar" | "en"} initialSessionUser={toClientSessionUser(user)} />;
}
