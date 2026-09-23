import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { allowsRuntimeDiagnostics } from "@/lib/runtime-safety";
import { TradeRoomPage } from "@/components/sections/trade-room/trade-room-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; requestId: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "غرفة الصفقة" : "Trade Room",
    description: locale === "ar" ? "غرفة صفقة مباشرة مع تحديثات لحظية للمشتري والبائع." : "Live Trade Room with guided buyer and seller workflow.",
    path: "/trade-room",
  });
}

export default async function TradeRoomRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; requestId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ locale, requestId }, query] = await Promise.all([params, searchParams]);
  const returnTo = `/${locale}/trade-room/${encodeURIComponent(requestId)}${query.view === "history" ? "?view=history" : ""}`;
  const user = await getCurrentSessionUser();
  if (allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1") console.log("[trade-room-open] route entry", {
    locale,
    requestId,
    userId: user?.id ?? null,
    role: user?.role ?? null,
    authenticated: Boolean(user),
  });

  if (!user) {
    if (allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1") console.log("[trade-room-open] route redirect unauthenticated", {
      locale,
      requestId,
      destination: `/${locale}/login?redirectTo=${encodeURIComponent(returnTo)}`,
    });
    redirect(`/${locale}/login?redirectTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <TradeRoomPage
      locale={locale as "ar" | "en"}
      requestId={requestId}
      actor={{ id: user.id, role: user.role, fullName: user.fullName }}
    />
  );
}
