import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requestedLocale } = await params;
  const locale = requestedLocale === "ar" ? "ar" : "en";

  return {
    ...buildPageMetadata({
      locale,
      title: locale === "ar" ? "تأكيد البريد الإلكتروني" : "Verify Email",
      description: locale === "ar"
        ? "أكمل تأكيد بريدك الإلكتروني لتفعيل حساب Alpha Traders."
        : "Complete email verification to activate your Alpha Traders account.",
      path: "/verify-email",
    }),
    robots: { index: false, follow: false },
  };
}

export default function VerifyEmailLayout({ children }: { children: ReactNode }) {
  return children;
}
