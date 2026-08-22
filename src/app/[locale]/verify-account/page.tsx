import { redirect } from "next/navigation";
import { AccountVerificationGate } from "@/components/auth/account-verification-gate";
import { getCurrentSessionUser } from "@/lib/auth";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: isAr ? "تأكيد الحساب" : "Verify your account",
    description: isAr
      ? "أكمل التحقق من البريد الإلكتروني للوصول إلى Alpha Exchange. التحقق من الهاتف اختياري."
      : "Complete email verification to access Alpha Exchange. Phone verification is optional.",
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
