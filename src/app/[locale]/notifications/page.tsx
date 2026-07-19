import { redirect } from "next/navigation";
import { NotificationsPage } from "@/components/notifications/notifications-page";
import { getCurrentSessionUser } from "@/lib/auth";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale === "ar" ? "ar" : "en",
    title: locale === "ar" ? "الإشعارات" : "Notifications",
    description: locale === "ar" ? "سجل إشعارات Alpha Exchange الخاص بك." : "Your Alpha Exchange notification history.",
    path: "/notifications",
  });
}

export default async function NotificationsRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login`);
  }

  return <NotificationsPage locale={locale === "ar" ? "ar" : "en"} />;
}
