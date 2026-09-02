import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

const base = getSiteUrl();
const locales = ["ar", "en"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/about-founder",
    "/founder",
    "/community",
    "/contact",
    "/safety-trust",
    "/help-center",
    "/support",
    "/report-abuse",
    "/terms",
    "/privacy-policy",
    "/cookies",
  ];

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const route of staticRoutes) {
      entries.push({
        url: `${base}/${locale}${route}`,
        changeFrequency: "weekly",
        priority: route === "" ? 1 : ["/safety-trust", "/terms", "/privacy-policy"].includes(route) ? 0.9 : 0.8,
      });
    }
  }

  return entries;
}
