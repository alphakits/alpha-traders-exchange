import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";

const siteUrl = "https://alphatraders.academy";

export function buildPageMetadata({
  locale,
  title,
  description,
  path,
}: {
  locale: AppLocale;
  title: string;
  description: string;
  path: string;
}): Metadata {
  const canonical = `${siteUrl}/${locale}${path}`;
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
      locale: locale === "ar" ? "ar_SA" : "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
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
