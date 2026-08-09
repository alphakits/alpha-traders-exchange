import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { getFirstActiveTradeForUser, getFirstActionableTradeForUser, resolveTradeRoomRequestForNotification } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { buildTradeRoomDestination } from "@/lib/trade-room-destination";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "غرفة التداول" : "Trade Room",
    description: locale === "ar" ? "متابعة صفقاتك النشطة في غرفة التداول." : "Access your active trade room.",
    path: "/trade-room",
  });
}

export default async function TradeRoomLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notificationId?: string | string[]; includePending?: string | string[] }>;
}) {
  const { locale } = await params;
  const { notificationId, includePending } = await searchParams;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/trade-room`);
  }

  const requestedNotificationId = typeof notificationId === "string" ? notificationId.trim() : "";
  const includePendingFallback = includePending === "1" || includePending === "true";
  if (requestedNotificationId) {
    const resolved = await resolveTradeRoomRequestForNotification({
      notificationId: requestedNotificationId,
      userId: user.id,
      role: user.role,
      includePendingFallback,
    });
    if (resolved.request) {
      redirect(`/${locale}${buildTradeRoomDestination(resolved.request, user.id)}`);
    }
  }


  if (includePendingFallback) {
    const actionableTrade = await getFirstActionableTradeForUser(user.id, user.role);
    if (actionableTrade) {
      redirect(`/${locale}${buildTradeRoomDestination(actionableTrade, user.id)}`);
    }
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
