import { getCurrentSessionUser } from "@/lib/auth";
import { toClientSessionUser } from "@/lib/client-session-user";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({ locale: locale === "ar" ? "ar" : "en", title: locale === "ar" ? "التداول" : "Trade", description: locale === "ar" ? "تصفّح البائعين وتابع صفقاتك." : "Browse sellers and manage your trades.", path: "/trade" });
}
export default async function TradePage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, user] = await Promise.all([params, getCurrentSessionUser()]);
  return <UsdtExchangePage locale={locale === "ar" ? "ar" : "en"} initialSessionUser={toClientSessionUser(user)} />;
}
