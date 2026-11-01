import type { LessonProgressState } from "@/lib/learning-progress";
import type { Lesson } from "@/types/academy";

export type JourneyLesson = Pick<Lesson, "id" | "courseId" | "slug" | "title" | "titleAr" | "description" | "descriptionAr" | "durationMinutes" | "thumbnail" | "order">;

/** Only published lessons supplied by the catalog can affect the journey. */
export function getAcademyJourney(lessons: JourneyLesson[], progress: LessonProgressState[], lastLessonId: string | null) {
  const progressById = new Map(progress.map((entry) => [entry.lessonId, entry]));
  const isCompleted = (lesson: JourneyLesson) => {
    const entry = progressById.get(lesson.id);
    return entry?.courseId === lesson.courseId && entry.lessonCompleted === true;
  };
  const completed = lessons.filter(isCompleted).length;
  const lastLesson = lessons.find((lesson) => lesson.id === lastLessonId);
  const nextLesson = (lastLesson && !isCompleted(lastLesson) ? lastLesson : null)
    ?? lessons.find((lesson) => !isCompleted(lesson))
    ?? lessons[0]
    ?? null;
  return {
    nextLesson,
    completed,
    percent: lessons.length ? Math.round(completed / lessons.length * 100) : 0,
    allComplete: lessons.length > 0 && completed === lessons.length,
    isCompleted,
    progressById,
  };
}

export function academyLessonTitle(title: string) {
  return title.replace(/^Lesson\s+\d+\s*[-–:]\s*/i, "").replace(/^الدرس\s+\S+\s*[-–:]\s*/, "");
}
