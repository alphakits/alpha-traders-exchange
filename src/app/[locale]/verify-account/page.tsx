import { redirect } from "next/navigation";
import { AccountVerificationGate } from "@/components/auth/account-verification-gate";
import { getCurrentSessionUser } from "@/lib/auth";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  const phoneVerificationEnabled = isMarketplacePhoneVerificationEnabled();
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: isAr ? "تأكيد الحساب" : "Verify your account",
    description: isAr
      ? (phoneVerificationEnabled
        ? "أكمل التحقق من رقم الهاتف والبريد الإلكتروني للوصول إلى Alpha Exchange."
        : "أكمل التحقق من البريد الإلكتروني للوصول إلى Alpha Exchange بينما تفعيل التحقق عبر الهاتف قيد الإعداد.")
      : (phoneVerificationEnabled
        ? "Complete phone and email verification to access Alpha Exchange."
        : "Complete email verification to access Alpha Exchange while phone verification is temporarily unavailable."),
    path: "/verify-account",
  });
}

export default async function VerifyAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { locale } = await params;
  const { redirectTo } = await searchParams;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/verify-account`);
  }

  return (
    <AccountVerificationGate
      locale={locale as "ar" | "en"}
      redirectTo={typeof redirectTo === "string" ? redirectTo : undefined}
      initialEmail={user.email}
      initialName={user.fullName}
      phoneVerificationEnabled={isMarketplacePhoneVerificationEnabled()}
    />
  );
}
