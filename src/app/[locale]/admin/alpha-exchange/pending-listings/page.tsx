import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { buildPageMetadata } from "@/lib/seo";
import { OwnerPendingListingsDashboard } from "@/components/admin/owner-pending-listings-dashboard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "العروض المعلقة للمراجعة" : "Pending Listings Review",
    description: locale === "ar" ? "مراجعة المالك لجميع عروض Alpha Exchange المعلقة قبل النشر." : "Owner-only review queue for pending Alpha Exchange listings before publication.",
    path: "/admin/alpha-exchange/pending-listings",
  });
}

export default async function PendingListingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/admin/alpha-exchange/pending-listings`);
  }
  if (user.role !== "admin" || !isAlphaExchangeOwnerEmail(user.email)) {
    redirect(`/${locale}/usdt-exchange`);
  }

  return <OwnerPendingListingsDashboard />;
}
