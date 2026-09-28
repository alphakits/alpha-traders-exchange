import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  MobileAcademyCatalogResponse,
  MobileAcademyLessonResponse,
} from "@alpha-traders/contracts";
import { MobileApiError } from "../api/mobile-api";

const CACHE_VERSION = 1;
const CACHE_PREFIX = "alpha-traders:academy-content";

type CachedPayload<T> = {
  version: number;
  cachedAt: string;
  data: T;
};

function catalogKey(userId: string) {
  return `${CACHE_PREFIX}:${CACHE_VERSION}:${userId}:catalog`;
}

function lessonKey(userId: string, slug: string) {
  return `${CACHE_PREFIX}:${CACHE_VERSION}:${userId}:lesson:${slug}`;
}

function canUseOfflineFallback(error: unknown) {
  return error instanceof MobileApiError
    && error.code === "SERVICE_UNAVAILABLE"
    && (error.status === 0 || error.status === 503);
}

async function readCached<T>(key: string, isValid: (value: unknown) => value is T) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPayload<unknown>>;
    if (parsed.version !== CACHE_VERSION || !isValid(parsed.data)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function offlineCacheMiss() {
  return new MobileApiError(
    "Previously loaded Academy content is not available on this device yet.",
    "SERVICE_UNAVAILABLE",
    0,
  );
}

async function writeCached<T>(key: string, data: T) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({
      version: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      data,
    } satisfies CachedPayload<T>));
  } catch {
    // A storage quota issue should never hide freshly loaded Academy content.
  }
}

function isCatalog(value: unknown): value is MobileAcademyCatalogResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileAcademyCatalogResponse>;
  return Array.isArray(candidate.courses)
    && candidate.courses.every((course) => (
      Boolean(course && typeof course.id === "string" && typeof course.slug === "string")
      && Array.isArray(course.lessons)
      && course.lessons.every((lesson) => Boolean(
        lesson
        && typeof lesson.id === "string"
        && typeof lesson.slug === "string"
        && typeof lesson.title === "string"
        && typeof lesson.titleAr === "string",
      ))
    ))
    && typeof candidate.contentRevision === "string";
}

function isLesson(value: unknown): value is MobileAcademyLessonResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileAcademyLessonResponse>;
  return Boolean(
    candidate.lesson
    && typeof candidate.lesson.id === "string"
    && typeof candidate.lesson.slug === "string"
    && Array.isArray(candidate.lesson.quiz)
    && Array.isArray(candidate.lesson.resources)
    && candidate.course
    && typeof candidate.course.id === "string"
    && Array.isArray(candidate.course.lessons)
    && typeof candidate.contentRevision === "string",
  );
}

async function loadWithFallback<T>({
  key,
  signal,
  load,
  validate,
}: {
  key: string;
  signal?: AbortSignal;
  load: () => Promise<T>;
  validate: (value: unknown) => value is T;
}) {
  try {
    const data = await load();
    await writeCached(key, data);
    return data;
  } catch (error) {
    if (signal?.aborted || !canUseOfflineFallback(error)) throw error;
    const cached = await readCached(key, validate);
    if (cached) return cached;
    throw error;
  }
}

export function loadAcademyCatalogWithFallback(
  userId: string,
  load: () => Promise<MobileAcademyCatalogResponse>,
  signal?: AbortSignal,
  isOnline: boolean | null = null,
) {
  if (isOnline === false) {
    return readCached(catalogKey(userId), isCatalog).then((cached) => cached ?? Promise.reject(offlineCacheMiss()));
  }
  return loadWithFallback({ key: catalogKey(userId), signal, load, validate: isCatalog });
}

export function loadAcademyLessonWithFallback(
  userId: string,
  slug: string,
  load: () => Promise<MobileAcademyLessonResponse>,
  signal?: AbortSignal,
  isOnline: boolean | null = null,
) {
  if (isOnline === false) {
    return readCached(lessonKey(userId, slug), isLesson).then((cached) => cached ?? Promise.reject(offlineCacheMiss()));
  }
  return loadWithFallback({ key: lessonKey(userId, slug), signal, load, validate: isLesson });
}
