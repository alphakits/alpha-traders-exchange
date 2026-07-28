import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { routing, localeDirection, type AppLocale } from "@/i18n/routing";

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

export default async function AuthLocaleLayout({
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

  const appLocale = locale as AppLocale;
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <div
        dir={localeDirection[appLocale]}
        className={`${inter.variable} ${plexArabic.variable} min-h-screen bg-[#050505] text-white ${
          appLocale === "ar" ? "font-[var(--font-plex-arabic)]" : "font-[var(--font-inter)]"
        }`}
      >
        <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-8">{children}</main>
      </div>
    </NextIntlClientProvider>
  );
}
