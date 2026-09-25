import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

const PRIVATE_ROUTE_NAMES = [
  "admin",
  "academy",
  "dashboard",
  "lessons",
  "profile",
  "settings",
  "notifications",
  "trade-room",
  "trades",
  "usdt-exchange",
  "seller",
  "onboarding",
  "login",
  "register",
  "verify-account",
  "verify-email",
  "forgot-password",
  "reset-password",
] as const;

const PRIVATE_PATHS = [
  "/api/",
  ...(["en", "ar"] as const).flatMap((locale) =>
    PRIVATE_ROUTE_NAMES.map((route) => `/${locale}/${route}`),
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
