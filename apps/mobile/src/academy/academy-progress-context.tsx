import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { MobileAcademyLesson } from "@alpha-traders/contracts";
import { useAuth } from "../auth/auth-context";
import {
  applyAcademyProgressPatch,
  emptyAcademyLessonProgress,
  type AcademyLessonProgress,
  type AcademyProgressMap,
  type AcademyProgressPatch,
} from "./academy-progress";

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = "alpha-traders:academy-progress";
const EMPTY_PROGRESS: AcademyProgressMap = {};

type AcademyProgressContextValue = {
  isReady: boolean;
  progress: AcademyProgressMap;
  updateLesson: (
    lesson: MobileAcademyLesson,
    patch: AcademyProgressPatch,
  ) => Promise<AcademyLessonProgress | null>;
};

const AcademyProgressContext = createContext<AcademyProgressContextValue | null>(null);

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${STORAGE_VERSION}:${userId}`;
}

function isStoredProgress(value: unknown): value is AcademyProgressMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    const item = record as Partial<AcademyLessonProgress>;
    return typeof item.lessonId === "string"
      && typeof item.courseId === "string"
      && typeof item.lessonSlug === "string"
      && typeof item.videoWatched === "boolean"
      && typeof item.workbookOpened === "boolean"
      && (item.quizScore === null || typeof item.quizScore === "number")
      && typeof item.bookmarked === "boolean"
      && typeof item.notes === "string"
      && typeof item.lessonCompleted === "boolean"
      && (item.completedAt === null || typeof item.completedAt === "string")
      && typeof item.lastOpenedAt === "string"
      && typeof item.updatedAt === "string";
  });
}

async function readProgress(userId: string) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { version?: number; progress?: unknown };
    return parsed.version === STORAGE_VERSION && isStoredProgress(parsed.progress)
      ? parsed.progress
      : {};
  } catch {
    return {};
  }
}

async function writeProgress(userId: string, progress: AcademyProgressMap) {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify({
    version: STORAGE_VERSION,
    progress,
  }));
}

export function AcademyProgressProvider({ children }: PropsWithChildren) {
  const { status, user } = useAuth();
  const userId = status === "authenticated" ? user?.id ?? null : null;
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [progress, setProgress] = useState<AcademyProgressMap>({});
  const progressRef = useRef<AcademyProgressMap>({});
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    progressRef.current = {};
    setProgress({});
    setLoadedUserId(null);
    if (!userId) return () => { active = false; };
    void readProgress(userId).then((stored) => {
      if (!active) return;
      progressRef.current = stored;
      setProgress(stored);
      setLoadedUserId(userId);
    });
    return () => { active = false; };
  }, [userId]);

  const isReady = !userId || loadedUserId === userId;
  const visibleProgress = userId && loadedUserId === userId ? progress : EMPTY_PROGRESS;

  const updateLesson = useCallback(async (
    lesson: MobileAcademyLesson,
    patch: AcademyProgressPatch,
  ) => {
    if (!userId || loadedUserId !== userId) return null;
    const now = new Date().toISOString();
    const current = progressRef.current[lesson.id]
      ?? emptyAcademyLessonProgress(lesson.id, lesson.courseId, lesson.slug, now);
    const next = applyAcademyProgressPatch(current, lesson, patch, now);
    const nextProgress = { ...progressRef.current, [lesson.id]: next };
    progressRef.current = nextProgress;
    setProgress(nextProgress);
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(() => writeProgress(userId, nextProgress));
    try {
      await writeQueueRef.current;
    } catch {
      // The in-memory progress stays useful for this session if storage is unavailable.
    }
    return next;
  }, [loadedUserId, userId]);

  const value = useMemo(
    () => ({ isReady, progress: visibleProgress, updateLesson }),
    [isReady, updateLesson, visibleProgress],
  );
  return <AcademyProgressContext.Provider value={value}>{children}</AcademyProgressContext.Provider>;
}

export function useAcademyProgress() {
  const context = useContext(AcademyProgressContext);
  if (!context) throw new Error("useAcademyProgress must be used inside AcademyProgressProvider");
  return context;
}
