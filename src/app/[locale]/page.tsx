import { getLocale, getTranslations } from "next-intl/server";
import { MarketHome } from "@/components/market/market-home";
import { buildPageMetadata } from "@/lib/seo";
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
  const locale = await getLocale();
  return <MarketHome locale={locale === "ar" ? "ar" : "en"} />;
}
