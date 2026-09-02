import { getLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getLessonBySlug, getLessonsByCourse, getNextLesson, getPreviousLesson } from "@/lib/content";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { LessonInterface } from "@/components/lessons/lesson-interface";
import { lessonNarratives } from "@/data/course-source";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const lesson = getLessonBySlug(slug);
  if (!lesson) return {};
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? lesson.titleAr : lesson.title,
    description: locale === "ar" ? lesson.descriptionAr : lesson.description,
    path: `/lessons/${lesson.slug}`,
  });
}

export default async function LessonPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  await getLocale();
  const { slug, locale } = await params;
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/lessons/${slug}`);
  }
  const lesson = getLessonBySlug(slug);
  if (!lesson) notFound();

  const previous = getPreviousLesson(lesson);
  const next = getNextLesson(lesson);
  const courseLessons = getLessonsByCourse(lesson.courseId).map((entry) => ({
    id: entry.id,
    slug: entry.slug,
    title: entry.title,
    titleAr: entry.titleAr,
    lessonNumber: entry.lessonNumber,
    order: entry.order,
  }));

  return (
    <LessonInterface
      lesson={lesson}
      courseLessons={courseLessons}
      lessonNarrative={lessonNarratives[lesson.slug] ?? null}
      previousSlug={previous?.slug}
      nextSlug={next?.slug}
    />
  );
}
