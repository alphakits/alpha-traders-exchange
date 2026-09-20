import { redirect } from "next/navigation";
import { GuestOnboarding } from "@/components/auth/guest-onboarding";
import { getCurrentSessionUser } from "@/lib/auth";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { buildPageMetadata } from "@/lib/seo";
import { hasRole } from "@/lib/roles";
import { isOwnerApprovedSeller } from "@/lib/seller-approval";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "البدء في Alpha Traders" : "Get Started on Alpha Traders",
    description: locale === "ar" ? "اختر طريقة استخدام حسابك في Alpha Traders." : "Choose how you want to use your Alpha Traders account.",
    path: "/onboarding",
  });
}

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { locale } = await params;
  const { mode } = await searchParams;
  const manageMode = Array.isArray(mode) ? mode.includes("manage") : mode === "manage";
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/onboarding`);
  }
  const hasSelectedRole = Boolean(user.onboardingSelection || user.onboardingCompletedAt);
  const isVerifiedApprovedSeller = user.sellerStatus === "approved_seller"
    && isOwnerApprovedSeller(user);
  const canManageRoles = !hasRole(user, "owner") && !hasRole(user, "admin");
  const shouldShowOnboarding = !hasSelectedRole && hasRole(user, "guest");
  if (!canManageRoles) {
    if (hasRole(user, "admin") || hasRole(user, "owner")) redirect(`/${locale}/admin/alpha-exchange`);
    if (isVerifiedApprovedSeller) redirect(`/${locale}/dashboard/seller`);
    redirect(`/${locale}/usdt-exchange`);
  }
  if (!shouldShowOnboarding && !manageMode) {
    if (isVerifiedApprovedSeller) redirect(`/${locale}/dashboard/seller`);
    redirect(`/${locale}/usdt-exchange`);
  }

  return (
    <GuestOnboarding
      locale={locale as "ar" | "en"}
      isBuyer={hasRole(user, "buyer")}
      sellerStatus={user.sellerStatus}
      sellerApprovalVerified={isOwnerApprovedSeller(user)}
      phoneVerificationEnabled={isMarketplacePhoneVerificationEnabled()}
    />
  );
}
