import type { MetadataRoute } from "next";
import { courses, lessons } from "@/lib/content";

const base = "https://alphatraders.academy";
const locales = ["ar", "en"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ["", "/academy", "/about-founder", "/founder", "/community", "/contact", "/usdt-exchange", "/login", "/register", "/dashboard", "/admin"];

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const route of staticRoutes) {
      entries.push({
        url: `${base}/${locale}${route}`,
        changeFrequency: "weekly",
        priority: route === "" ? 1 : 0.8,
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
