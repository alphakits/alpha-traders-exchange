import { getLocale, getTranslations } from "next-intl/server";
import { HomePage } from "@/components/sections/home/home-page";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";

export async function generateMetadata() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "home" });
  const base = buildPageMetadata({
    locale: locale as "ar" | "en",
    title: `${BRAND_NAME} | Trading Education & USDT Marketplace`,
    description: t("subheadline"),
    path: "",
  });
  // Use absolute title so it doesn't get the root layout template applied twice
  return { ...base, title: { absolute: `${BRAND_NAME} | Trading Education & USDT Marketplace` } };
}

export default async function LocalizedHomePage() {
  const user = await getCurrentSessionUser();
  return <HomePage isAuthenticated={Boolean(user)} />;
}
