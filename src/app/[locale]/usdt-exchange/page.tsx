import { buildPageMetadata } from "@/lib/seo";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";
import { toClientSessionUser } from "@/lib/client-session-user";
import { getCurrentSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: isAr ? "Alpha Exchange" : "Alpha Exchange",
    description: isAr
      ? "سوق Alpha Exchange يربط بين البائعين والمشترين لتبادل USDT عبر تنسيق احترافي ورسوم خدمة شفافة 1%."
      : "Alpha Exchange is a premium USDT marketplace connecting buyers and sellers through transparent, professional coordination with a 1% service fee.",
    path: "/usdt-exchange",
  });
}

export default async function UsdtExchangeRoute({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, user] = await Promise.all([
    params,
    getCurrentSessionUser(),
  ]);
  // Middleware only knows whether a cookie exists. Resolve it on the server
  // before rendering anything from the exchange, including on native resume.
  if (!user) redirect("/en");
  return <UsdtExchangePage locale={locale as "ar" | "en"} initialSessionUser={toClientSessionUser(user)} />;
}
