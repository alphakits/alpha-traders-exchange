"use client";

import type { Lesson } from "@/types/academy";
import { createClient } from "@/lib/supabase/client";

const LEARNER_KEY_STORAGE = "alpha-traders:learner-key";
const PROGRESS_STORAGE = "alpha-traders:lesson-progress";
const LEARNING_META_STORAGE = "alpha-traders:learning-meta";
const QUIZ_PASS_PERCENT = 70;

export type LearningEventType =
  | "video_watched"
  | "pdf_opened"
  | "pdf_progress"
  | "quiz_completed"
  | "lesson_completed"
  | "bookmark_toggled"
  | "notes_updated"
  | "video_position_updated";

export type LessonProgressState = {
  lessonId: string;
  courseId: string;
  lessonSlug: string;
  videoWatched: boolean;
  pdfOpened: boolean;
  quizCompleted: boolean;
  lessonCompleted: boolean;
  bookmarked: boolean;
  quizScore: number | null;
  notes: string;
  notesSavedAt: string | null;
  pdfReadProgress: number;
  videoPositionSeconds: number;
  updatedAt: string;
};

type LearningMeta = {
  lastLessonId: string | null;
  lastLessonSlug: string | null;
  lastCourseId: string | null;
  lastActivityAt: string | null;
  totalStudyMinutes: number;
};

function defaultState(lessonId: string, courseId: string, lessonSlug: string): LessonProgressState {
  return {
    lessonId,
    courseId,
    lessonSlug,
    videoWatched: false,
    pdfOpened: false,
    quizCompleted: false,
    lessonCompleted: false,
    bookmarked: false,
    quizScore: null,
    notes: "",
    notesSavedAt: null,
    pdfReadProgress: 0,
    videoPositionSeconds: 0,
    updatedAt: new Date().toISOString(),
  };
}

function defaultMeta(): LearningMeta {
  return {
    lastLessonId: null,
    lastLessonSlug: null,
    lastCourseId: null,
    lastActivityAt: null,
    totalStudyMinutes: 0,
  };
}

export function getLearnerKey() {
  if (typeof window === "undefined") return "server-render";
  const existing = window.localStorage.getItem(LEARNER_KEY_STORAGE);
  if (existing) return existing;
  const generated = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `anon-${Date.now()}`;
  window.localStorage.setItem(LEARNER_KEY_STORAGE, generated);
  return generated;
}

function readAllProgress() {
  if (typeof window === "undefined") return {} as Record<string, LessonProgressState>;
  const raw = window.localStorage.getItem(PROGRESS_STORAGE);
  if (!raw) return {} as Record<string, LessonProgressState>;
  try {
    return JSON.parse(raw) as Record<string, LessonProgressState>;
  } catch {
    return {} as Record<string, LessonProgressState>;
  }
}

function writeAllProgress(value: Record<string, LessonProgressState>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROGRESS_STORAGE, JSON.stringify(value));
}

function readLearningMeta() {
  if (typeof window === "undefined") return defaultMeta();
  const raw = window.localStorage.getItem(LEARNING_META_STORAGE);
  if (!raw) return defaultMeta();
  try {
    return { ...defaultMeta(), ...(JSON.parse(raw) as LearningMeta) };
  } catch {
    return defaultMeta();
  }
}

function writeLearningMeta(meta: LearningMeta) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LEARNING_META_STORAGE, JSON.stringify(meta));
}

export function getLessonProgressState(lessonId: string, courseId: string, lessonSlug: string) {
  const all = readAllProgress();
  return all[lessonId] ?? defaultState(lessonId, courseId, lessonSlug);
}

export function getCourseProgressPercent(_courseId: string, courseLessonIds: string[]) {
  if (!courseLessonIds.length) return 0;
  const all = readAllProgress();
  const completed = courseLessonIds.filter((lessonId) => all[lessonId]?.lessonCompleted).length;
  return Math.round((completed / courseLessonIds.length) * 100);
}

export function isQuizPassed(score: number | null) {
  if (score === null) return false;
  return score >= QUIZ_PASS_PERCENT;
}

export function markLessonAsCurrent(lesson: Lesson) {
  const meta = readLearningMeta();
  writeLearningMeta({
    ...meta,
    lastLessonId: lesson.id,
    lastLessonSlug: lesson.slug,
    lastCourseId: lesson.courseId,
    lastActivityAt: new Date().toISOString(),
  });
}

export function addStudyMinutes(minutes: number) {
  const meta = readLearningMeta();
  writeLearningMeta({
    ...meta,
    totalStudyMinutes: Math.max(0, meta.totalStudyMinutes + minutes),
    lastActivityAt: new Date().toISOString(),
  });
}

export function getLearningMeta() {
  return readLearningMeta();
}

export function getAllLessonProgress() {
  return Object.values(readAllProgress());
}

export function getDashboardSnapshot(lessons: Lesson[]) {
  const progress = getAllLessonProgress();
  const meta = getLearningMeta();
  const completedLessons = progress.filter((item) => item.lessonCompleted).length;
  const hoursStudied = Number((meta.totalStudyMinutes / 60).toFixed(1));
  const currentLesson = lessons.find((lesson) => lesson.id === meta.lastLessonId) ?? lessons[0] ?? null;
  const recentNotes = progress
    .filter((item) => item.notes.trim().length > 0)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 3)
    .map((item) => ({
      lessonId: item.lessonId,
      lessonSlug: item.lessonSlug,
      note: item.notes,
      updatedAt: item.updatedAt,
    }));

  return {
    currentLesson,
    completedLessons,
    hoursStudied,
    lastActivityAt: meta.lastActivityAt,
    recentNotes,
  };
}

async function persistToSupabase(progress: LessonProgressState, eventType: LearningEventType) {
  const supabase = createClient();
  const learnerKey = getLearnerKey();

  const { error: eventError } = await supabase.from("lesson_progress_events").insert({
    learner_key: learnerKey,
    lesson_id: progress.lessonId,
    course_id: progress.courseId,
    event_type: eventType,
    payload: {
      lessonSlug: progress.lessonSlug,
      videoWatched: progress.videoWatched,
      pdfOpened: progress.pdfOpened,
      pdfReadProgress: progress.pdfReadProgress,
      quizCompleted: progress.quizCompleted,
      lessonCompleted: progress.lessonCompleted,
      bookmarked: progress.bookmarked,
      quizScore: progress.quizScore,
      notes: progress.notes,
      videoPositionSeconds: progress.videoPositionSeconds,
    },
  });

  if (eventError) {
    throw eventError;
  }

  const { error: stateError } = await supabase.from("lesson_progress_state").upsert(
    {
      learner_key: learnerKey,
      lesson_id: progress.lessonId,
      course_id: progress.courseId,
      video_watched: progress.videoWatched,
      pdf_opened: progress.pdfOpened,
      quiz_completed: progress.quizCompleted,
      lesson_completed: progress.lessonCompleted,
      bookmarked: progress.bookmarked,
      quiz_score: progress.quizScore,
      updated_at: progress.updatedAt,
    },
    { onConflict: "learner_key,lesson_id" },
  );

  if (stateError) {
    throw stateError;
  }
}

export async function updateLessonProgress({
  lessonId,
  courseId,
  lessonSlug,
  eventType,
  updater,
}: {
  lessonId: string;
  courseId: string;
  lessonSlug: string;
  eventType: LearningEventType;
  updater: (current: LessonProgressState) => LessonProgressState;
}) {
  const all = readAllProgress();
  const current = all[lessonId] ?? defaultState(lessonId, courseId, lessonSlug);
  const nextBase = updater(current);

  const next = {
    ...nextBase,
    lessonId,
    courseId,
    lessonSlug,
    quizCompleted: isQuizPassed(nextBase.quizScore),
    lessonCompleted: nextBase.videoWatched && nextBase.pdfOpened && isQuizPassed(nextBase.quizScore),
    updatedAt: new Date().toISOString(),
  };

  all[lessonId] = next;
  writeAllProgress(all);

  const meta = readLearningMeta();
  writeLearningMeta({
    ...meta,
    lastLessonId: lessonId,
    lastLessonSlug: lessonSlug,
    lastCourseId: courseId,
    lastActivityAt: next.updatedAt,
  });

  try {
    await persistToSupabase(next, eventType);
  } catch (error) {
    console.error("Failed to persist lesson progress to Supabase", error);
  }

  return next;
}
