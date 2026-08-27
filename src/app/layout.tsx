import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getLocale } from "next-intl/server";
import { GlobalBlockchainBackground } from "@/components/layout/global-blockchain-background";
import { localeDirection, type AppLocale } from "@/i18n/routing";
import { buildLocalizedSiteMetadata } from "@/lib/site-metadata";

export const viewport: Viewport = {
  themeColor: "#C9A227",
  width: "device-width",
  initialScale: 1,
};

async function getRequestLocale(): Promise<AppLocale> {
  try {
    return (await getLocale()) === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
}

export async function generateMetadata(): Promise<Metadata> {
  return buildLocalizedSiteMetadata(await getRequestLocale());
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read locale from next-intl middleware context so we can set lang/dir server-side.
  // Falls back to "ar" (the default locale) for non-locale routes like /api/*.
  const locale = await getRequestLocale();
  const dir = localeDirection[locale] ?? "rtl";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="relative bg-background text-foreground antialiased" suppressHydrationWarning>
        <GlobalBlockchainBackground />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
