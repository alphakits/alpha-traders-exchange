import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getLocale } from "next-intl/server";
import { GlobalBlockchainBackground } from "@/components/layout/global-blockchain-background";
import { PublicSpeedInsights } from "@/components/layout/public-speed-insights";
import { localeDirection, routing, type AppLocale } from "@/i18n/routing";
import { buildLocalizedSiteMetadata } from "@/lib/site-metadata";
import { buildSiteIdentitySchemas, serializeJsonLd } from "@/lib/seo";

export const viewport: Viewport = {
  themeColor: "#C9A227",
  width: "device-width",
  initialScale: 1,
};

async function getRequestLocale(): Promise<AppLocale> {
  try {
    return (await getLocale()) === "ar" ? "ar" : routing.defaultLocale;
  } catch {
    return routing.defaultLocale;
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
  // Falls back to the English site default when no locale context is available.
  const locale = await getRequestLocale();
  const dir = localeDirection[locale];
  const siteIdentitySchemas = buildSiteIdentitySchemas();

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="relative bg-background text-foreground antialiased" suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteIdentitySchemas) }}
        />
        <GlobalBlockchainBackground />
        <div className="relative z-10">{children}</div>
        {process.env.VERCEL === "1" ? <PublicSpeedInsights /> : null}
      </body>
    </html>
  );
}
