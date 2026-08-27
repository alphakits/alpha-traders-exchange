import type { MetadataRoute } from "next";
import { courses, lessons } from "@/lib/content";
import { getSiteUrl } from "@/lib/site-url";

const base = getSiteUrl();
const locales = ["ar", "en"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/academy",
    "/lessons",
    "/about-founder",
    "/founder",
    "/community",
    "/contact",
    "/usdt-exchange",
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
        priority: route === "" ? 1 : ["/usdt-exchange", "/safety-trust", "/terms", "/privacy-policy"].includes(route) ? 0.9 : 0.8,
      });
    }
    for (const course of courses) {
      entries.push({
        url: `${base}/${locale}/academy/${course.slug}`,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
    for (const lesson of lessons) {
      entries.push({
        url: `${base}/${locale}/lessons/${lesson.slug}`,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  return entries;
}
