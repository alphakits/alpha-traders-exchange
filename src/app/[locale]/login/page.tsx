import { buildPageMetadata } from "@/lib/seo";
import { LoginForm } from "@/components/auth/login-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "تسجيل الدخول" : "Login",
    description: locale === "ar" ? "تسجيل الدخول إلى Alpha Exchange." : "Login to Alpha Exchange.",
    path: "/login",
  });
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LoginForm locale={locale as "ar" | "en"} />;
}
