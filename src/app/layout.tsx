import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getLocale } from "next-intl/server";
import { GlobalBlockchainBackground } from "@/components/layout/global-blockchain-background";
import { BrowserPushPrompt } from "@/components/notifications/browser-push-prompt";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { PwaInstallPrompt } from "@/components/pwa/pwa-install-prompt";
import { getSiteUrlObject, getSiteUrl } from "@/lib/site-url";
import { localeDirection, type AppLocale } from "@/i18n/routing";

const siteUrl = getSiteUrl();
const OG_IMAGE = `${siteUrl}/images/hero/hero-trading-office.png`;

export const viewport: Viewport = {
  themeColor: "#C9A227",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: getSiteUrlObject(),
  title: {
    default: "Alpha Traders | Free Arabic Trading Academy",
    template: "%s | Alpha Traders",
  },
  description:
    "Premium free Arabic trading academy with structured lessons, analysis, and student dashboard. Buy and sell USDT securely on Alpha Exchange.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Alpha Traders",
  },
  openGraph: {
    title: "Alpha Traders | Free Arabic Trading Academy",
    description:
      "Premium Arabic trading academy & USDT exchange. Learn trading with structured lessons and buy/sell USDT with verified sellers.",
    type: "website",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Alpha Traders trading academy workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Alpha Traders | Free Arabic Trading Academy",
    description: "Premium Arabic trading academy & USDT exchange.",
    images: [OG_IMAGE],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read locale from next-intl middleware context so we can set lang/dir server-side.
  // Falls back to "ar" (the default locale) for non-locale routes like /api/*.
  let locale: AppLocale = "ar";
  try {
    locale = (await getLocale()) as AppLocale;
  } catch {
    // getLocale() may throw for API routes that bypass next-intl middleware
  }
  const dir = localeDirection[locale] ?? "rtl";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="relative bg-background text-foreground antialiased" suppressHydrationWarning>
        <GlobalBlockchainBackground />
        <OfflineBanner />
        <BrowserPushPrompt />
        <PwaInstallPrompt />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
