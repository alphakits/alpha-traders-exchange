import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/site-url";
import {
  BRAND_NAME,
  BRAND_OFFICIAL_SOCIALS,
  BRAND_PRIMARY_NAME,
  BRAND_SUPPORT_EMAIL,
} from "@/lib/brand";
import { getPublicTrustFaqs } from "@/lib/public-trust";

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

export function buildSiteIdentitySchemas() {
  const organizationId = `${siteUrl}/#organization`;
  const websiteId = `${siteUrl}/#website`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": organizationId,
      name: BRAND_NAME,
      alternateName: BRAND_PRIMARY_NAME,
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/images/brand/alpha-traders-logo-512.png`,
        width: 512,
        height: 512,
      },
      description:
        "Trading education and a structured peer-to-peer USDT marketplace workflow with manually approved sellers.",
      email: BRAND_SUPPORT_EMAIL,
      sameAs: [...BRAND_OFFICIAL_SOCIALS],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: BRAND_SUPPORT_EMAIL,
        availableLanguage: ["English", "Arabic"],
        url: `${siteUrl}/en/contact`,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": websiteId,
      name: BRAND_NAME,
      alternateName: BRAND_PRIMARY_NAME,
      url: siteUrl,
      inLanguage: ["en", "ar"],
      publisher: { "@id": organizationId },
    },
  ];
}

export function buildTrustFaqSchema(locale: AppLocale) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${siteUrl}/${locale}/safety-trust#faq`,
    inLanguage: locale,
    mainEntity: getPublicTrustFaqs(locale).map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
