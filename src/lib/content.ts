import coursesData from "@/data/courses.json";
import lessonsData from "@/data/lessons.json";
import coursesProvidedData from "@/data/courses-provided.json";
import lessonsProvidedData from "@/data/lessons-provided.json";
import analysisData from "@/data/market-analysis.json";
import faqData from "@/data/faq.json";
import statsData from "@/data/stats.json";
import type { AppLocale } from "@/i18n/routing";
import type { Course, Lesson, MarketAnalysis } from "@/types/academy";

const allCourses = [...(coursesData as Course[]), ...(coursesProvidedData as Course[])];
const allLessons = [...(lessonsData as Lesson[]), ...(lessonsProvidedData as Lesson[])];

export const lessons = allLessons
  .filter((lesson) => (lesson.status ?? "published") === "published")
  .sort((a, b) => {
    if (a.courseId !== b.courseId) {
      return a.courseId.localeCompare(b.courseId);
    }
    return a.order - b.order;
  });

export const courses = allCourses
  .filter((course) => lessons.some((lesson) => lesson.courseId === course.id))
  .sort((a, b) => a.order - b.order);
export const analyses = analysisData as MarketAnalysis[];

export const faqs = faqData as Array<{
  id: string;
  question: string;
  questionAr: string;
  answer: string;
  answerAr: string;
}>;

export const stats = statsData as Array<{
  id: string;
  label: string;
  labelAr: string;
  value: string;
}>;

export function getLessonsByCourse(courseId: string) {
  return lessons.filter((lesson) => lesson.courseId === courseId).sort((a, b) => a.order - b.order);
}

export function getLessonBySlug(slug: string) {
  return lessons.find((lesson) => lesson.slug === slug);
}

export function getCourseById(courseId: string) {
  return courses.find((course) => course.id === courseId);
}

export function getCourseBySlug(slug: string) {
  return courses.find((course) => course.slug === slug);
}

export function getNextLesson(current: Lesson) {
  const sequence = getLessonsByCourse(current.courseId);
  const index = sequence.findIndex((entry) => entry.id === current.id);
  return index >= 0 ? sequence[index + 1] : undefined;
}

export function getPreviousLesson(current: Lesson) {
  const sequence = getLessonsByCourse(current.courseId);
  const index = sequence.findIndex((entry) => entry.id === current.id);
  return index > 0 ? sequence[index - 1] : undefined;
}

export function getRelatedLessons(current: Lesson, limit = 3) {
  return lessons
    .filter((lesson) => lesson.id !== current.id)
    .map((lesson) => {
      const sharedTags = lesson.tags.filter((tag) => current.tags.includes(tag)).length;
      const sameCourse = lesson.courseId === current.courseId ? 1 : 0;
      return { lesson, score: sharedTags + sameCourse };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.lesson);
}

export function searchAcademyLessons(query: string, locale: AppLocale) {
  const term = query.trim().toLowerCase();
  if (!term) return lessons;

  return lessons.filter((lesson) => {
    const resources = lesson.assets.resources.map((resource) => (locale === "ar" ? resource.labelAr : resource.label));
    const searchable = [
      locale === "ar" ? lesson.titleAr : lesson.title,
      locale === "ar" ? lesson.descriptionAr : lesson.description,
      locale === "ar" ? lesson.summaryAr : lesson.summary,
      ...(locale === "ar" ? lesson.keywordsAr : lesson.keywords),
      ...(locale === "ar" ? lesson.tagsAr : lesson.tags),
      ...resources,
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(term);
  });
}
