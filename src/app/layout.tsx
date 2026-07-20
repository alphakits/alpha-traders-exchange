import "./globals.css";
import type { Metadata } from "next";
import { GlobalBlockchainBackground } from "@/components/layout/global-blockchain-background";
import { getSiteUrlObject } from "@/lib/site-url";

export const metadata: Metadata = {
  metadataBase: getSiteUrlObject(),
  title: {
    default: "Alpha Traders",
    template: "%s | Alpha Traders"
  },
  description: "Premium free Arabic trading academy with structured lessons, analysis, and student dashboard.",
  icons: {
    icon: "/images/brand/alpha-traders-logo.png",
    shortcut: "/images/brand/alpha-traders-logo.png",
    apple: "/images/brand/alpha-traders-logo.png",
  },
  openGraph: {
    title: "Alpha Traders",
    description: "Premium free Arabic trading academy",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Alpha Traders",
    description: "Premium free Arabic trading academy"
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body className="relative bg-background text-foreground antialiased">
        <GlobalBlockchainBackground />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
