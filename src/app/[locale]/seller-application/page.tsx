import { getCurrentSessionUser } from "@/lib/auth";
import { toClientSessionUser } from "@/lib/client-session-user";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";
export const dynamic = "force-dynamic";
export default async function SellerApplicationPage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, user] = await Promise.all([params, getCurrentSessionUser()]);
  return <UsdtExchangePage locale={locale === "ar" ? "ar" : "en"} initialSessionUser={toClientSessionUser(user)} applicationOnly />;
}
