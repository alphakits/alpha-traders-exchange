import { lessonNarratives } from "@/data/course-source";
import { AcademyStudentHub } from "@/components/academy/academy-student-hub";
import { notFound, redirect } from "next/navigation";
import { getCourseBySlug, getLessonsByCourse } from "@/lib/content";
import { buildCourseSchema, buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; course: string }> }) {
  const { locale, course: slug } = await params;
  const course = getCourseBySlug(slug);
  if (!course) return {};
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? course.titleAr : course.title,
    description: locale === "ar" ? course.summaryAr : course.summary,
    path: `/academy/${course.slug}`,
  });
}

export default async function CoursePage({ params }: { params: Promise<{ locale: string; course: string }> }) {
  const { locale, course: slug } = await params;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/academy/${slug}`);
  }
  const isAr = locale === "ar";
  const course = getCourseBySlug(slug);
  if (!course) notFound();

  const lessons = getLessonsByCourse(course.id);
  const schema = buildCourseSchema({
    title: isAr ? course.titleAr : course.title,
    description: isAr ? course.summaryAr : course.summary,
    locale: locale as "ar" | "en",
  });

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    <AcademyStudentHub courses={[{ id: course.id, title: course.title, titleAr: course.titleAr,
      lessons: lessons.map(({ id, courseId, slug, title, titleAr, description, descriptionAr, durationMinutes, thumbnail, order }) => ({
        id, courseId, slug, title, titleAr, description, descriptionAr, durationMinutes, thumbnail: lessonNarratives[slug]?.visuals[0]?.src ?? "/images/brand/alpha-traders-logo.webp", order,
      })),
    }]} />
  </>;
}
