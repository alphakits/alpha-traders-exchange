import type { ReactNode } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { routing, localeDirection, type AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { BRAND_NAME } from "@/lib/brand";

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
  preload: false,
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
        className={`${inter.variable} ${plexArabic.variable} flex min-h-screen flex-col bg-[#050505] text-white ${
          appLocale === "ar" ? "font-[var(--font-plex-arabic)]" : "font-[var(--font-inter)]"
        }`}
      >
        <header className="relative z-10 flex justify-center px-4 pt-5 sm:pt-7">
          <Link href="/" locale={appLocale} className="inline-flex items-center gap-3 rounded-2xl border border-[#C9A227]/30 bg-black/45 px-3 py-2 shadow-[0_12px_36px_rgba(0,0,0,0.45)] backdrop-blur">
            <Image
              src="/images/brand/alpha-traders-logo.webp"
              alt={`${BRAND_NAME} logo`}
              width={64}
              height={64}
              priority
              className="h-14 w-14 rounded-xl border border-[#C9A227]/45 object-cover sm:h-16 sm:w-16"
            />
            <span className="text-start">
              <span className="block text-base font-semibold tracking-wide text-[#E5C85C]">Alpha Traders</span>
              <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-[#D4AF37]">Academy &amp; Exchange</span>
            </span>
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-7 sm:px-6 sm:py-9 lg:px-8">{children}</main>
      </div>
    </NextIntlClientProvider>
  );
}
