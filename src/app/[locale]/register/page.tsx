import { buildPageMetadata } from "@/lib/seo";
import { RegisterForm } from "@/components/auth/register-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "إنشاء حساب" : "Register",
    description: locale === "ar" ? "إنشاء حساب جديد في Alpha Exchange عبر كود دعوة للنسخة التجريبية الخاصة." : "Create a new Alpha Exchange account with a private beta invite code.",
    path: "/register",
  });
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <RegisterForm locale={locale as "ar" | "en"} />;
}
