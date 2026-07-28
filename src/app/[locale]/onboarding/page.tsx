import { redirect } from "next/navigation";
import { GuestOnboarding } from "@/components/auth/guest-onboarding";
import { getCurrentSessionUser } from "@/lib/auth";
import { buildPageMetadata } from "@/lib/seo";
import { hasRole } from "@/lib/roles";

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
  const canManageRoles = !hasRole(user, "owner") && !hasRole(user, "admin");
  const shouldShowOnboarding = !hasSelectedRole && hasRole(user, "guest");
  if (!canManageRoles) {
    if (hasRole(user, "admin") || hasRole(user, "owner")) redirect(`/${locale}/admin/alpha-exchange`);
    if (hasRole(user, "approved_seller")) redirect(`/${locale}/dashboard/seller`);
    redirect(`/${locale}/usdt-exchange`);
  }
  if (!shouldShowOnboarding && !manageMode) {
    if (hasRole(user, "approved_seller")) redirect(`/${locale}/dashboard/seller`);
    redirect(`/${locale}/usdt-exchange`);
  }

  return <GuestOnboarding locale={locale as "ar" | "en"} />;
}
