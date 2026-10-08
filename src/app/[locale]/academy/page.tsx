import { lessonNarratives } from "@/data/course-source";
import { AcademyStudentHub } from "@/components/academy/academy-student-hub";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { courses, getLessonsByCourse } from "@/lib/content";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";

export async function generateMetadata() {
  const locale = await getLocale();
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الأكاديمية" : "Academy",
    description: locale === "ar" ? "مسارات تعليمية منظمة حسب المستوى." : "Structured academy tracks by level.",
    path: "/academy",
  });
}

export default async function AcademyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getLocale();
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/academy`);
  }
  return <AcademyStudentHub courses={courses.map((course) => ({
    id: course.id, title: course.title, titleAr: course.titleAr,
    lessons: getLessonsByCourse(course.id).map(({ id, courseId, slug, title, titleAr, description, descriptionAr, durationMinutes, thumbnail, order }) => ({
      id, courseId, slug, title, titleAr, description, descriptionAr, durationMinutes, thumbnail: lessonNarratives[slug]?.visuals[0]?.src ?? "/images/brand/alpha-traders-logo.webp", order,
    })),
  }))} />;
}
