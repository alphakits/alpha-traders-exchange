import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { buildPageMetadata } from "@/lib/seo";
import { AccountSettingsPanel } from "@/components/settings/account-settings-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الإعدادات" : "Settings",
    description:
      locale === "ar"
        ? "إعدادات الحساب في Alpha Traders."
        : "Account settings for Alpha Traders.",
    path: "/settings",
  });
}

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params;
  const query = await searchParams;
  const user = await getCurrentSessionUser();
  if (!user) redirect(`/${locale}/login?redirectTo=/${locale}/settings`);
  return (
    <AccountSettingsPanel
      locale={locale === "ar" ? "ar" : "en"}
      phoneVerificationEnabled={isMarketplacePhoneVerificationEnabled()}
      initialTab={query.tab === "account"
        || user.sellerStatus === "approved_seller"
        || user.role === "approved_seller"
        || user.role === "admin"
        || user.role === "owner"
        ? "account"
        : undefined}
      initialSellerBankAccess={user.sellerStatus === "approved_seller" || user.role === "approved_seller" || user.role === "admin" || user.role === "owner"}
    />
  );
}
