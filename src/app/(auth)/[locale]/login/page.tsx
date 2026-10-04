import { buildPageMetadata } from "@/lib/seo";
import { LoginForm } from "@/components/auth/login-form";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";
import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { signedInEntryDestination } from "@/lib/signed-in-entry-destination";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "تسجيل الدخول" : "Login",
    description: locale === "ar" ? "تسجيل الدخول إلى Alpha Exchange." : "Login to Alpha Exchange.",
    path: "/login",
  });
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ redirectTo?: string | string[]; reset?: string | string[]; sessionExpired?: string | string[] }>;
}) {
  const { locale } = await params;
  const { redirectTo, reset, sessionExpired } = await searchParams;
  const user = await getCurrentSessionUser();
  if (user) redirect(signedInEntryDestination(locale === "ar" ? "ar" : "en", user, typeof redirectTo === "string" ? redirectTo : undefined));
  return (
    <CanonicalSessionProvider initialSessionUser={null}>
    <LoginForm
      locale={locale as "ar" | "en"}
      redirectTo={typeof redirectTo === "string" ? redirectTo : undefined}
      passwordResetSuccess={typeof reset === "string" && reset === "success"}
      sessionExpired={typeof sessionExpired === "string" && sessionExpired === "1"}
    />
    </CanonicalSessionProvider>
  );
}
