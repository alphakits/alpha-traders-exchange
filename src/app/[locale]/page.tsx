import { getLocale, getTranslations } from "next-intl/server";
import { HomePage } from "@/components/sections/home/home-page";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";

export async function generateMetadata() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "home" });
  const base = buildPageMetadata({
    locale: locale as "ar" | "en",
    title: "Alpha Traders | Free Arabic Trading Academy",
    description: t("subheadline"),
    path: "",
  });
  // Use absolute title so it doesn't get the root layout template applied twice
  return { ...base, title: { absolute: "Alpha Traders | Free Arabic Trading Academy" } };
}

export default async function LocalizedHomePage() {
  const user = await getCurrentSessionUser();
  return <HomePage isAuthenticated={Boolean(user)} />;
}
