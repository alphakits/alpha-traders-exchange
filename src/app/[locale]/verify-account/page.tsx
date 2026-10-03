import { redirect } from "next/navigation";
import { AccountVerificationGate } from "@/components/auth/account-verification-gate";
import { getCurrentSessionUser } from "@/lib/auth";
import { isMarketplacePhoneVerificationEnabled, needsMarketplacePhoneVerification } from "@/lib/phone-verification";
import { buildPageMetadata } from "@/lib/seo";
import { getPhoneVerificationChannels } from "@/lib/phone-verification-delivery";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: isAr ? "تأكيد الحساب" : "Verify your account",
    description: isAr
      ? "أكمل خطوات التحقق المطلوبة للوصول إلى Alpha Exchange."
      : "Complete the required verification steps to access Alpha Exchange.",
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
      initialPhone={user.whatsappNumber}
      phoneVerificationEnabled={isMarketplacePhoneVerificationEnabled()}
      phoneVerificationChannels={getPhoneVerificationChannels()}
      phoneVerificationRequired={needsMarketplacePhoneVerification(user)}
    />
  );
}
