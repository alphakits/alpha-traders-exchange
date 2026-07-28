import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { AlphaExchangeAdminDashboard } from "@/components/admin/alpha-exchange-admin-dashboard";

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

export default async function AlphaExchangeAdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/admin/alpha-exchange`);
  }
  if (!hasRole(user, "owner")) {
    redirect(`/${locale}/usdt-exchange`);
  }

  return <AlphaExchangeAdminDashboard />;
}
