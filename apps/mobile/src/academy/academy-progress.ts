import type { MobileAcademyLesson, MobileAcademyQuizQuestion } from "@alpha-traders/contracts";

export const MAX_ACADEMY_NOTE_LENGTH = 2_000;

export type AcademyLessonProgress = {
  lessonId: string;
  courseId: string;
  lessonSlug: string;
  videoWatched: boolean;
  workbookOpened: boolean;
  quizScore: number | null;
  bookmarked: boolean;
  notes: string;
  lessonCompleted: boolean;
  completedAt: string | null;
  lastOpenedAt: string;
  updatedAt: string;
};

export type AcademyProgressMap = Record<string, AcademyLessonProgress>;

export type AcademyProgressPatch = Partial<Pick<
  AcademyLessonProgress,
  "videoWatched" | "workbookOpened" | "quizScore" | "bookmarked" | "notes" | "lastOpenedAt"
>>;

export type AcademyLessonRequirements = Pick<
  MobileAcademyLesson,
  "hasVideo" | "hasWorkbook" | "quizQuestionCount" | "quizPassingScore"
>;

export function emptyAcademyLessonProgress(
  lessonId: string,
  courseId: string,
  lessonSlug: string,
  now = new Date().toISOString(),
): AcademyLessonProgress {
  return {
    lessonId,
    courseId,
    lessonSlug,
    videoWatched: false,
    workbookOpened: false,
    quizScore: null,
    bookmarked: false,
    notes: "",
    lessonCompleted: false,
    completedAt: null,
    lastOpenedAt: now,
    updatedAt: now,
  };
}

function boundedQuizScore(score: number | null) {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function academyCompletionSteps(
  progress: AcademyLessonProgress,
  requirements: AcademyLessonRequirements,
) {
  return [
    ...(requirements.hasVideo ? [progress.videoWatched] : []),
    ...(requirements.hasWorkbook ? [progress.workbookOpened] : []),
    ...(requirements.quizQuestionCount > 0
      ? [progress.quizScore !== null && progress.quizScore >= requirements.quizPassingScore]
      : []),
  ];
}

export function academyLessonProgressPercent(
  progress: AcademyLessonProgress,
  requirements: AcademyLessonRequirements,
) {
  const steps = academyCompletionSteps(progress, requirements);
  if (!steps.length) return 0;
  return Math.round((steps.filter(Boolean).length / steps.length) * 100);
}

export function applyAcademyProgressPatch(
  current: AcademyLessonProgress,
  requirements: AcademyLessonRequirements,
  patch: AcademyProgressPatch,
  now = new Date().toISOString(),
) {
  const next: AcademyLessonProgress = {
    ...current,
    ...patch,
    quizScore: patch.quizScore === undefined ? current.quizScore : boundedQuizScore(patch.quizScore),
    notes: patch.notes === undefined ? current.notes : patch.notes.slice(0, MAX_ACADEMY_NOTE_LENGTH),
    updatedAt: now,
  };
  const steps = academyCompletionSteps(next, requirements);
  next.lessonCompleted = steps.length > 0 && steps.every(Boolean);
  next.completedAt = next.lessonCompleted ? (current.completedAt ?? now) : null;
  return next;
}

export function academyCourseProgressPercent(
  lessonIds: string[],
  progress: AcademyProgressMap,
) {
  if (!lessonIds.length) return 0;
  const completed = lessonIds.filter((lessonId) => progress[lessonId]?.lessonCompleted).length;
  return Math.round((completed / lessonIds.length) * 100);
}

export function latestAcademyProgress(progress: AcademyProgressMap) {
  return Object.values(progress).sort(
    (left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt),
  )[0] ?? null;
}

export function gradeAcademyQuiz(
  questions: Array<Pick<MobileAcademyQuizQuestion, "id" | "correctIndex">>,
  selected: Record<string, number>,
) {
  if (!questions.length) return 100;
  const correct = questions.filter((question) => selected[question.id] === question.correctIndex).length;
  return Math.round((correct / questions.length) * 100);
}
