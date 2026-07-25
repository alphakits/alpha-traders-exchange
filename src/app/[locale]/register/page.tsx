import { buildPageMetadata } from "@/lib/seo";
import { RegisterForm } from "@/components/auth/register-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "إنشاء حساب" : "Register",
    description: locale === "ar" ? "أنشئ حساب Alpha Exchange جديد وابدأ كمشتري." : "Create a new Alpha Exchange account and start as a Buyer.",
    path: "/register",
  });
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <RegisterForm locale={locale as "ar" | "en"} />;
}
