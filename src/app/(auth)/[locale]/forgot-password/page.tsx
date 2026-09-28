import { buildPageMetadata } from "@/lib/seo";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "نسيت كلمة المرور" : "Forgot Password",
    description: locale === "ar" ? "اطلب رابط إعادة تعيين كلمة المرور لحساب Alpha Traders." : "Request a password reset link for your Alpha Traders account.",
    path: "/forgot-password",
  });
}

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ForgotPasswordForm locale={locale as "ar" | "en"} />;
}
