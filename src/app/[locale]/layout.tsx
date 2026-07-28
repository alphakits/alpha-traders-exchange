import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { routing, localeDirection, type AppLocale } from "@/i18n/routing";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

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

  return (
    <NextIntlClientProvider messages={messages}>
      <div
        dir={localeDirection[appLocale]}
        className={`${inter.variable} ${plexArabic.variable} relative z-10 min-h-screen text-white ${
          appLocale === "ar" ? "font-[var(--font-plex-arabic)]" : "font-[var(--font-inter)]"
        }`}
      >
        <SiteHeader locale={appLocale} />
        <main className="min-h-[calc(100vh-9rem)]">{children}</main>
        <SiteFooter locale={appLocale} />
      </div>
    </NextIntlClientProvider>
  );
}
