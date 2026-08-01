import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
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
}: {
  params: Promise<{ locale: string; requestId: string }>;
}) {
  const { locale, requestId } = await params;
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/trade-room/${requestId}`);
  }

  return (
    <TradeRoomPage
      locale={locale as "ar" | "en"}
      requestId={requestId}
      actor={{ id: user.id, role: user.role, fullName: user.fullName }}
    />
  );
}
