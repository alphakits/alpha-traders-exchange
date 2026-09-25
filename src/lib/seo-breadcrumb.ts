import "server-only";
import type { AppLocale } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/site-url";

const siteUrl = getSiteUrl();

export function buildBreadcrumbSchema({
  locale,
  items,
}: {
  locale: AppLocale;
  items: Array<{ name: string; path: string }>;
}) {
  const last = items[items.length - 1];

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": last
      ? siteUrl + "/" + locale + last.path + "#breadcrumb"
      : siteUrl + "/" + locale + "#breadcrumb",
    inLanguage: locale,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: siteUrl + "/" + locale + item.path,
    })),
  };
}
