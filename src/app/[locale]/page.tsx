import { getLocale, getTranslations } from "next-intl/server";
import { HomePage } from "@/components/sections/home/home-page";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";

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

export default async function LocalizedHomePage() {
  const user = await getCurrentSessionUser();
  return <HomePage isAuthenticated={Boolean(user)} />;
}
