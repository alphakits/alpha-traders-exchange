import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/site-url";
import { isPrivateSearchPath } from "@/lib/seo-indexing";
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
    // Supplemental indexing directives, never a replacement for account controls.
    ...(isPrivateSearchPath(path) ? {
      robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: { index: false, follow: false, noimageindex: true, nosnippet: true },
      },
    } : {}),
    alternates: {
      canonical,
      languages: {
        ar: `${siteUrl}/ar${path}`,
        en: `${siteUrl}/en${path}`,
        "x-default": `${siteUrl}/en${path}`,
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
      alternateName: [BRAND_PRIMARY_NAME, "Alpha Traders Academy & Exchange", "Alpha Exchange"],
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/images/brand/alpha-traders-logo-512.png`,
        width: 512,
        height: 512,
      },
      description:
        "Alpha Traders Academy & Exchange provides free structured trading education and a peer-to-peer USDT/ILS marketplace workflow with manually approved sellers.",
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
      alternateName: [BRAND_PRIMARY_NAME, "Alpha Traders Academy & Exchange"],
      url: siteUrl,
      inLanguage: ["en", "ar"],
      publisher: { "@id": organizationId },
    },
  ];
}


export function buildFaqSchema({
  locale,
  path,
  faqs,
}: {
  locale: AppLocale;
  path: string;
  faqs: Array<{ question: string; answer: string }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${siteUrl}/${locale}${path}#faq`,
    inLanguage: locale,
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
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
