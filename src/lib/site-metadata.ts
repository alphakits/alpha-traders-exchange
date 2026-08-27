import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { BRAND_NAME, BRAND_PRIMARY_NAME } from "@/lib/brand";
import { getSiteUrl, getSiteUrlObject } from "@/lib/site-url";

const SITE_METADATA_COPY = {
  ar: {
    title: `${BRAND_NAME} | تعليم التداول وسوق USDT`,
    description: "أكاديمية عربية مجانية ومتميزة لتعليم التداول، مع دروس منظمة وتحليلات ولوحة طالب وسوق آمن لشراء وبيع USDT.",
    openGraphDescription: "أكاديمية Alpha Traders العربية لتعليم التداول وسوق موثوق لشراء وبيع USDT.",
    imageAlt: "منصة التداول والتعليم في Alpha Traders",
  },
  en: {
    title: `${BRAND_NAME} | Trading Education & USDT Marketplace`,
    description: "Premium free trading academy with structured lessons, analysis, a student dashboard, and a secure marketplace to buy and sell USDT.",
    openGraphDescription: "Alpha Traders trading academy and trusted marketplace for buying and selling USDT.",
    imageAlt: `${BRAND_PRIMARY_NAME} trading and learning workspace`,
  },
} as const;

export function buildLocalizedSiteMetadata(locale: AppLocale): Metadata {
  const copy = SITE_METADATA_COPY[locale];
  const siteUrl = getSiteUrl();
  const imageUrl = `${siteUrl}/images/hero/hero-trading-office.png`;

  return {
    metadataBase: getSiteUrlObject(),
    applicationName: BRAND_NAME,
    title: {
      default: copy.title,
      template: `%s | ${BRAND_NAME}`,
    },
    description: copy.description,
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
      title: BRAND_PRIMARY_NAME,
    },
    openGraph: {
      title: copy.title,
      description: copy.openGraphDescription,
      siteName: BRAND_NAME,
      type: "website",
      locale: locale === "ar" ? "ar_IL" : "en_US",
      alternateLocale: locale === "ar" ? ["en_US"] : ["ar_IL"],
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: copy.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.openGraphDescription,
      images: [imageUrl],
    },
  };
}
