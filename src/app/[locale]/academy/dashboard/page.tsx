import { buildPageMetadata } from "@/lib/seo";
import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
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

export default async function AcademyDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/academy/dashboard`);
  }
  if (!hasRole(user, "student") && !hasRole(user, "admin") && !hasRole(user, "owner")) {
    redirect(`/${locale}/onboarding`);
  }
  return <StudentDashboard />;
}
