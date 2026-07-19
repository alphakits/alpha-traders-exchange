import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default async function PendingListingsPage() {
  const user = await getCurrentSessionUser();

  if (!user || user.role !== "admin" || !isAlphaExchangeOwnerEmail(user.email)) {
    return (
      <section className="section-container page-shell py-16">
        <Card className="mx-auto max-w-2xl border-red-500/25 bg-[#0B0B0B]/95">
          <CardHeader>
            <CardTitle>403 - Access Denied</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
            <p>This page is restricted to the Owner account.</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return <OwnerPendingListingsDashboard />;
}
