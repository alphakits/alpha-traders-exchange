import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { localeDirection, routing, type AppLocale } from "@/i18n/routing";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MobileBottomNavigation } from "@/components/layout/mobile-bottom-navigation";
import { HtmlAttributesSetter } from "@/components/layout/html-attributes-setter";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { PwaInstallPrompt } from "@/components/pwa/pwa-install-prompt";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";
import { getCurrentSessionUser } from "@/lib/auth";
import { toClientSessionUser } from "@/lib/client-session-user";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
  // Suppress "preloaded but not used" DevTools warning on non-Arabic pages.
  // The font still loads via CSS font-face on Arabic pages; only the <link rel="preload">
  // is omitted to avoid unnecessary browser warnings.
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const appLocale = locale as AppLocale;
  const sessionUser = await getCurrentSessionUser();

  return (
    <NextIntlClientProvider messages={messages}>
      <HtmlAttributesSetter lang={appLocale} dir={localeDirection[appLocale]} />
      <OfflineBanner locale={appLocale} />
      <PwaInstallPrompt locale={appLocale} />
      <div
        className={`${inter.variable} ${plexArabic.variable} min-h-screen text-white ${
          appLocale === "ar" ? "font-[var(--font-plex-arabic)]" : "font-[var(--font-inter)]"
        }`}
      >
        <CanonicalSessionProvider initialSessionUser={toClientSessionUser(sessionUser)} locale={appLocale}>
          <SiteHeader locale={appLocale} sessionUser={sessionUser} />
          <main className="min-h-[calc(100vh-9rem)]">{children}</main>
          <SiteFooter locale={appLocale} />
          <MobileBottomNavigation locale={appLocale} />
        </CanonicalSessionProvider>
      </div>
    </NextIntlClientProvider>
  );
}
