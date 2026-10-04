import { redirect } from "next/navigation";
import { GuestOnboarding } from "@/components/auth/guest-onboarding";
import { getPhoneVerificationChannels } from "@/lib/phone-verification-delivery";
import { getCurrentSessionUser } from "@/lib/auth";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { buildPageMetadata } from "@/lib/seo";
import { getInterfaceAccess } from "@alpha-traders/contracts";
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
  const access = getInterfaceAccess(user);
  const shouldShowOnboarding = !hasSelectedRole && !access.trading && !access.student;
  if (access.administration || (!shouldShowOnboarding && !manageMode)) {
    redirect(`/${locale}${access.dashboardHref}`);
  }

  return (
    <GuestOnboarding
      locale={locale as "ar" | "en"}
      isBuyer={access.buyer}
      isStudent={access.student}
      sellerStatus={user.sellerStatus}
      sellerApprovalVerified={isOwnerApprovedSeller(user)}
      phoneVerificationEnabled={isMarketplacePhoneVerificationEnabled()}
      phoneVerificationChannels={getPhoneVerificationChannels()}
    />
  );
}
