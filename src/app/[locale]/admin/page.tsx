import { getLocale } from "next-intl/server";
import { buildPageMetadata } from "@/lib/seo";
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

export default async function AdminPage() {
  await getLocale();
  return <LessonManagementDashboard />;
}
