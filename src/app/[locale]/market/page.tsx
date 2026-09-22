import { MarketHome } from "@/components/market/market-home";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale === "ar" ? "ar" : "en",
    title: locale === "ar" ? "سوق Alpha Exchange" : "Alpha Exchange Market",
    description: locale === "ar" ? "أسعار السوق والعروض وصفقاتك في Alpha Exchange." : "Market prices, live listings and your Alpha Exchange trades.",
    path: "/market",
  });
}

export default async function MarketPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MarketHome locale={locale === "ar" ? "ar" : "en"} />;
}
