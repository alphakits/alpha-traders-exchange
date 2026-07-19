import { getLocale, getTranslations } from "next-intl/server";
import { HomePage } from "@/components/sections/home/home-page";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "home" });
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: "Alpha Traders",
    description: t("subheadline"),
    path: "",
  });
}

export default function LocalizedHomePage() {
  return <HomePage />;
}
