import { notFound, redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { getSellerProfilePageData } from "@/lib/alpha-exchange-seller-profile";
import { PremiumSellerProfilePage } from "@/components/sections/seller/premium-seller-profile-page";

export const dynamic = "force-dynamic";

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

export default async function SellerProfileRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, username }, query] = await Promise.all([params, searchParams]);
  const legacySellerId = query.sellerId;
  const hasLegacySellerId = Array.isArray(legacySellerId) ? legacySellerId.some(Boolean) : Boolean(legacySellerId);
  if (hasLegacySellerId) {
    const preservedParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === "sellerId" || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) preservedParams.append(key, item);
      } else {
        preservedParams.set(key, value);
      }
    }
    const search = preservedParams.toString();
    redirect(`/${locale}/exchange/seller/${encodeURIComponent(username)}${search ? `?${search}` : ""}`);
  }

  return SellerProfileRouteContent({ locale, username });
}

async function SellerProfileRouteContent(
  input: { locale: string; username: string },
) {
  const { locale, username } = input;
  const viewer = await getCurrentSessionUser();
  const data = await getSellerProfilePageData({
    username,
    viewerUserId: viewer?.id,
    viewerRole: viewer?.role,
    viewerEmail: viewer?.email,
  });
  if (!data?.profile) {
    notFound();
  }
  return <PremiumSellerProfilePage locale={locale as "ar" | "en"} data={data} viewerOwnsProfile={viewer?.id === data.profile.sellerId} />;
}
