import type {
  MobileAcademyCatalogResponse,
  MobileAcademyCourse,
  MobileAcademyLesson,
  MobileAcademyLessonResponse,
  MobileAcademyLessonSummary,
  MobileLessonDifficulty,
} from "@alpha-traders/contracts";
import { courseSource, lessonNarratives } from "@/data/course-source";
import {
  courses,
  getCourseById,
  getLessonBySlug,
  getLessonsByCourse,
  getNextLesson,
  getPreviousLesson,
  lessons,
} from "@/lib/content";
import { resolveLessonPdfSource } from "@/lib/lesson-pdf";
import { resolveLessonResourceUrl, resolveLessonVideoUrl } from "@/lib/lesson-video";
import type { Course, Lesson } from "@/types/academy";

const PUBLIC_SITE_ORIGIN = "https://www.alphatraders.co.il";
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

export const MOBILE_ACADEMY_CONTENT_REVISION = [
  lessons.length,
  ...lessons.map((lesson) => lesson.updatedAt ?? `${lesson.id}:${lesson.order}`),
].join("|");

export function isMobileAcademySlug(value: string) {
  return SLUG_PATTERN.test(value);
}

function absoluteHttpsUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, PUBLIC_SITE_ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function lessonDifficulty(lesson: Lesson): MobileLessonDifficulty {
  const difficulty = lesson.difficulty ?? "medium";
  return difficulty === "easy" || difficulty === "hard" || difficulty === "expert"
    ? difficulty
    : "medium";
}

function lessonMedia(lesson: Lesson) {
  const videoUrl = absoluteHttpsUrl(resolveLessonVideoUrl(lesson.assets.videoUrl));
  const workbookUrl = absoluteHttpsUrl(resolveLessonPdfSource(lesson.assets).openUrl);
  const presentationUrl = absoluteHttpsUrl(lesson.assets.presentationUrl);
  return { videoUrl, workbookUrl, presentationUrl };
}

export function toMobileAcademyLessonSummary(lesson: Lesson): MobileAcademyLessonSummary {
  const media = lessonMedia(lesson);
  return {
    id: lesson.id,
    slug: lesson.slug,
    title: lesson.title,
    titleAr: lesson.titleAr,
    module: lesson.module,
    moduleAr: lesson.moduleAr,
    description: lesson.description,
    descriptionAr: lesson.descriptionAr,
    durationMinutes: lesson.estimatedDurationMinutes ?? lesson.durationMinutes,
    order: lesson.order,
    lessonNumber: lesson.lessonNumber ?? lesson.order,
    difficulty: lessonDifficulty(lesson),
    hasVideo: Boolean(media.videoUrl),
    hasWorkbook: Boolean(media.workbookUrl),
    quizQuestionCount: lesson.quiz.length,
  };
}

export function toMobileAcademyCourse(course: Course): MobileAcademyCourse {
  const narrative = courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug];
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    titleAr: course.titleAr,
    summary: course.summary,
    summaryAr: course.summaryAr,
    level: course.level,
    order: course.order,
    thumbnailUrl: absoluteHttpsUrl(course.thumbnail),
    learningPoints: narrative ? [...narrative.value] : [],
    learningPointsAr: narrative ? [...narrative.valueAr] : [],
    whyStart: narrative?.startWhy ?? "",
    whyStartAr: narrative?.startWhyAr ?? "",
    lessons: getLessonsByCourse(course.id).map(toMobileAcademyLessonSummary),
  };
}

function toMobileAcademyLesson(lesson: Lesson): MobileAcademyLesson {
  const media = lessonMedia(lesson);
  const narrative = lessonNarratives[lesson.slug];
  const reservedUrls = new Set([media.videoUrl, media.workbookUrl, media.presentationUrl].filter(Boolean));
  const seenResourceUrls = new Set<string>();
  const resources = lesson.assets.resources.flatMap((resource) => {
    const url = absoluteHttpsUrl(resolveLessonResourceUrl(resource.url));
    if (!url || reservedUrls.has(url) || seenResourceUrls.has(url)) return [];
    seenResourceUrls.add(url);
    return [{
      id: resource.id,
      label: resource.label,
      labelAr: resource.labelAr,
      type: resource.type,
      url,
    }];
  });

  return {
    ...toMobileAcademyLessonSummary(lesson),
    courseId: lesson.courseId,
    summary: lesson.summary,
    summaryAr: lesson.summaryAr,
    objectives: [...lesson.objectives],
    objectivesAr: [...lesson.objectivesAr],
    takeaways: [...lesson.takeaways],
    takeawaysAr: [...lesson.takeawaysAr],
    notes: lesson.assets.notes,
    notesAr: lesson.assets.notesAr,
    videoUrl: media.videoUrl,
    workbookUrl: media.workbookUrl,
    presentationUrl: media.presentationUrl,
    videoChapters: lesson.assets.videoChapters.map((chapter) => ({ ...chapter })),
    resources,
    quiz: lesson.quiz.map((question) => ({
      id: question.id,
      type: question.type ?? "multiple-choice",
      question: question.question,
      questionAr: question.questionAr,
      options: [...question.options],
      optionsAr: [...question.optionsAr],
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      explanationAr: question.explanationAr,
    })),
    quizPassingScore: lesson.quizSettings?.passingScore ?? 70,
    narrative: narrative
      ? {
          intro: narrative.intro,
          introAr: narrative.introAr,
          keyConcepts: [...narrative.keyConcepts],
          keyConceptsAr: [...narrative.keyConceptsAr],
          practicalExamples: [...narrative.practicalExamples],
          practicalExamplesAr: [...narrative.practicalExamplesAr],
          beginnerMistakes: [...narrative.beginnerMistakes],
          beginnerMistakesAr: [...narrative.beginnerMistakesAr],
          workbookIntro: narrative.workbookIntro,
          workbookIntroAr: narrative.workbookIntroAr,
          quizContext: narrative.quizContext,
          quizContextAr: narrative.quizContextAr,
          visuals: narrative.visuals.flatMap((visual) => {
            const url = absoluteHttpsUrl(visual.src);
            return url ? [{ url, title: visual.title, titleAr: visual.titleAr }] : [];
          }),
        }
      : null,
  };
}

export function getMobileAcademyCatalog(): Omit<MobileAcademyCatalogResponse, "requestId"> {
  return {
    courses: courses.map(toMobileAcademyCourse),
    contentRevision: MOBILE_ACADEMY_CONTENT_REVISION,
  };
}

export function getMobileAcademyLesson(
  slug: string,
): Omit<MobileAcademyLessonResponse, "requestId"> | null {
  const lesson = getLessonBySlug(slug);
  if (!lesson) return null;
  const course = getCourseById(lesson.courseId);
  if (!course) return null;
  const previousLesson = getPreviousLesson(lesson);
  const nextLesson = getNextLesson(lesson);
  return {
    lesson: toMobileAcademyLesson(lesson),
    course: toMobileAcademyCourse(course),
    previousLesson: previousLesson ? toMobileAcademyLessonSummary(previousLesson) : null,
    nextLesson: nextLesson ? toMobileAcademyLessonSummary(nextLesson) : null,
    contentRevision: MOBILE_ACADEMY_CONTENT_REVISION,
  };
}
