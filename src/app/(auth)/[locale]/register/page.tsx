import { buildPageMetadata } from "@/lib/seo";
import { RegisterForm } from "@/components/auth/register-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "إنشاء حساب" : "Register",
    description: locale === "ar" ? "أنشئ حساب Alpha Traders الجديد وتحقق من بريدك الإلكتروني لتفعيل الحساب." : "Create your Alpha Traders account. Verify your email to activate your account.",
    path: "/register",
  });
}

export default async function RegisterPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ intent?: string }>;
}) {
  const { locale } = await params;
  const { intent } = await searchParams;
  return <RegisterForm locale={locale as "ar" | "en"} learningIntent={intent === "learn"} />;
}
