import "./globals.css";
import type { Metadata, Viewport } from "next";
import { GlobalBlockchainBackground } from "@/components/layout/global-blockchain-background";
import { getSiteUrlObject, getSiteUrl } from "@/lib/site-url";

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

// Root layout provides <html> and <body> so Next.js injects <head> metadata correctly.
// The locale layout uses suppressHydrationWarning and sets lang/dir client-side.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body className="relative bg-background text-foreground antialiased" suppressHydrationWarning>
        <GlobalBlockchainBackground />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
