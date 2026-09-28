import { redirect } from "next/navigation";

import { DiscordManagementDashboard } from "@/components/admin/discord-management-dashboard";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "إدارة ديسكورد" : "Discord Management",
    description:
      locale === "ar"
        ? "لوحة تشغيل داخلية وآمنة لتكامل ديسكورد."
        : "Private, safe operations dashboard for the Discord integration.",
    path: "/admin/discord",
  });
}

export default async function DiscordManagementPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/admin/discord`);
  }
  if (!hasRole(user, "admin")) {
    redirect(`/${locale}/usdt-exchange`);
  }
  return <DiscordManagementDashboard locale={locale === "ar" ? "ar" : "en"} />;
}
