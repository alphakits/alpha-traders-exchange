import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { LessonManagementDashboard } from "@/components/admin/lesson-management-dashboard";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "لوحة الإدارة" : "Admin Dashboard",
    description: locale === "ar" ? "إدارة كاملة للدروس والوسائط والاختبارات." : "Complete lesson, media, and quiz management dashboard.",
    path: "/admin",
  });
}

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getLocale();
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/admin`);
  }
  if (!hasRole(user, "owner")) {
    redirect(`/${locale}/usdt-exchange`);
  }
  return <LessonManagementDashboard />;
}
