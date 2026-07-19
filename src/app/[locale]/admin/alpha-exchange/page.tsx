import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { AlphaExchangeAdminDashboard } from "@/components/admin/alpha-exchange-admin-dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "لوحة إدارة Alpha Exchange" : "Alpha Exchange Admin Dashboard",
    description: locale === "ar" ? "لوحة إدارة داخلية خاصة بـ Alpha Exchange." : "Private internal dashboard for Alpha Exchange administration.",
    path: "/admin/alpha-exchange",
  });
}

export default async function AlphaExchangeAdminPage() {
  const user = await getCurrentSessionUser();

  if (!user || user.role !== "admin" || !isAlphaExchangeOwnerEmail(user.email)) {
    return (
      <section className="section-container page-shell py-16">
        <Card className="mx-auto max-w-2xl border-red-500/25 bg-[#0B0B0B]/95">
          <CardHeader>
            <CardTitle>403 - Access Denied</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
            <p>This dashboard is restricted to Alpha Exchange administrators.</p>
            <p>If you believe this is an error, contact the platform administrator.</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return <AlphaExchangeAdminDashboard />;
}
