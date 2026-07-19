import { buildPageMetadata } from "@/lib/seo";
import { StudentDashboard } from "@/components/dashboard/student-dashboard";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "لوحة الطالب" : "Student Dashboard",
    description: locale === "ar" ? "متابعة تقدمك، الدروس المكتملة، والنشاط الأخير." : "Track progress, completed lessons, and recent activity.",
    path: "/academy/dashboard",
  });
}

export default async function AcademyDashboardPage() {
  return <StudentDashboard />;
}
