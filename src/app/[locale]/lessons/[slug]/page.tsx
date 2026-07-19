import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getLessonBySlug, getNextLesson, getPreviousLesson } from "@/lib/content";
import { buildPageMetadata } from "@/lib/seo";
import { LessonInterface } from "@/components/lessons/lesson-interface";

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
  const { slug } = await params;
  const lesson = getLessonBySlug(slug);
  if (!lesson) notFound();

  const previous = getPreviousLesson(lesson);
  const next = getNextLesson(lesson);

  return <LessonInterface lesson={lesson} previousSlug={previous?.slug} nextSlug={next?.slug} />;
}
