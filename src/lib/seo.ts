import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/site-url";

const siteUrl = getSiteUrl();
const DEFAULT_OG_IMAGE = `${siteUrl}/images/hero/hero-trading-office.png`;

export function buildPageMetadata({
  locale,
  title,
  description,
  path,
  ogImage,
}: {
  locale: AppLocale;
  title: string;
  description: string;
  path: string;
  ogImage?: string;
}): Metadata {
  const canonical = `${siteUrl}/${locale}${path}`;
  const image = ogImage ?? DEFAULT_OG_IMAGE;
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        ar: `${siteUrl}/ar${path}`,
        en: `${siteUrl}/en${path}`,
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Alpha Traders",
      locale: locale === "ar" ? "ar_IL" : "en_US",
      alternateLocale: locale === "ar" ? ["en_US"] : ["ar_IL"],
      type: "website",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export function buildCourseSchema({
  title,
  description,
  locale,
}: {
  title: string;
  description: string;
  locale: AppLocale;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: title,
    description,
    inLanguage: locale,
    provider: {
      "@type": "Organization",
      name: "Alpha Traders",
      url: siteUrl,
    },
  };
}
