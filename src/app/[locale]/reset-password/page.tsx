import { buildPageMetadata } from "@/lib/seo";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "إعادة تعيين كلمة المرور" : "Reset Password",
    description: locale === "ar" ? "حدّث كلمة المرور لحساب Alpha Traders بأمان." : "Securely update your Alpha Traders account password.",
    path: "/reset-password",
  });
}

export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ResetPasswordForm locale={locale as "ar" | "en"} />;
}
