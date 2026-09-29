import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";
import { PRIVATE_SEARCH_ROUTE_NAMES } from "@/lib/seo-indexing";

const PRIVATE_PATHS = [
  "/api/",
  ...(["en", "ar"] as const).flatMap((locale) =>
    PRIVATE_SEARCH_ROUTE_NAMES.map((route) => `/${locale}/${route}`),
  ),
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      {
        userAgent: "OAI-SearchBot",
        allow: ["/", "/en/start", "/ar/start", "/en/learn-trading-free", "/ar/learn-trading-free", "/en/buy-usdt-israel", "/ar/buy-usdt-israel", "/llms.txt", "/sitemap.xml", "/.well-known/security.txt"],
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
    host: getSiteUrl(),
  };
}
