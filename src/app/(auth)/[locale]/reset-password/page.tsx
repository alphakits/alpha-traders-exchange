import { buildPageMetadata } from "@/lib/seo";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "إعادة تعيين كلمة المرور" : "Reset Password",
    description: locale === "ar" ? "أعد تعيين كلمة المرور لحساب Alpha Traders." : "Reset the password for your Alpha Traders account.",
    path: "/reset-password",
  });
}

export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ResetPasswordForm locale={locale as "ar" | "en"} />;
}
