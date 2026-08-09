import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { getFirstActiveTradeForUser } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "غرفة التداول" : "Trade Room",
    description: locale === "ar" ? "متابعة صفقاتك النشطة في غرفة التداول." : "Access your active trade room.",
    path: "/trade-room",
  });
}

export default async function TradeRoomLandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/trade-room`);
  }
  const activeTrade = await getFirstActiveTradeForUser(user.id, user.role);
  if (activeTrade) {
    redirect(`/${locale}/trade-room/${activeTrade.id}`);
  }

  // Redirect directly to the final role destination when no active trade exists.
  // This avoids a visible route bounce (trade-room -> dashboard -> role page).
  if (hasRole(user, "owner") || hasRole(user, "admin")) {
    redirect(`/${locale}/admin/alpha-exchange?section=purchase-requests`);
  }
  if (hasRole(user, "approved_seller")) {
    redirect(`/${locale}/dashboard/seller`);
  }
  redirect(`/${locale}/usdt-exchange#my-trade-requests-section`);
}
