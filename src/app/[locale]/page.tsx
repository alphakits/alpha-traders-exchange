import { getLocale, getTranslations } from "next-intl/server";
import { HomePage } from "@/components/sections/home/home-page";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";

export async function generateMetadata() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "home" });
  const title = locale === "ar"
    ? `${BRAND_NAME} | تعليم التداول وسوق USDT`
    : `${BRAND_NAME} | Trading Education & USDT Marketplace`;
  const base = buildPageMetadata({
    locale: locale as "ar" | "en",
    title,
    description: t("subheadline"),
    path: "",
  });
  // Use absolute title so it doesn't get the root layout template applied twice
  return { ...base, title: { absolute: title } };
}

export default async function LocalizedHomePage() {
  const [user, locale] = await Promise.all([
    getCurrentSessionUser(),
    getLocale(),
  ]);

  return <HomePage isAuthenticated={Boolean(user)} locale={locale as "ar" | "en"} />;
}
