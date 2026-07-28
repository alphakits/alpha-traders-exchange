import { notFound } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getSellerProfilePageData } from "@/lib/alpha-exchange-seller-profile";
import { PremiumSellerProfilePage } from "@/components/sections/seller/premium-seller-profile-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; username: string }> }) {
  const { locale, username } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: isAr ? `ملف البائع ${username}` : `Seller Profile • ${username}`,
    description: isAr
      ? "ملف بائع فاخر في Alpha Exchange يعرض الثقة، التقدير، التقييمات، والصفقات النشطة."
      : "A premium seller profile experience in Alpha Exchange with trust metrics, prestige, reviews, and active listings.",
    path: `/exchange/seller/${username}`,
  });
}

export default async function SellerProfileRoute({ params }: { params: Promise<{ locale: string; username: string }> }) {
  return SellerProfileRouteContent(params);
}

async function SellerProfileRouteContent(params: Promise<{ locale: string; username: string }>) {
  const { locale, username } = await params;
  const data = await getSellerProfilePageData({ username });
  if (!data?.profile) {
    notFound();
  }
  return <PremiumSellerProfilePage locale={locale as "ar" | "en"} data={data} />;
}
