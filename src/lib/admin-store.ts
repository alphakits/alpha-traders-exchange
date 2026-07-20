import path from "path";
import { randomUUID } from "crypto";
import { getAdminContentRepository } from "@/lib/admin-content-repository";
import { createSupabaseAdminClient, getAdminMediaBucket } from "@/lib/supabase-admin";
import type { Lesson, LessonCategory, LessonStatus, QuizQuestion } from "@/types/academy";
import type { AdminAnalytics, LessonVersion, MediaItem, MediaProvider, MediaType } from "@/types/admin";

type LessonUpdate = Partial<Lesson> & Pick<Lesson, "id">;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function normalizeCategory(category: string | undefined, courseId: string): LessonCategory {
  if (category === "beginner" || category === "intermediate" || category === "advanced") return category;
  if (courseId === "c1") return "beginner";
  if (courseId === "c2") return "intermediate";
  return "advanced";
}

function normalizeStatus(status: string | undefined): LessonStatus {
  return status === "draft" ? "draft" : "published";
}

function normalizeQuestions(quiz: QuizQuestion[] | undefined): QuizQuestion[] {
  return (quiz ?? []).map((item) => ({
    ...item,
    type: item.type === "true-false" ? "true-false" : "multiple-choice",
  }));
}

function normalizeLesson(lesson: Lesson): Lesson {
  return {
    ...lesson,
    slug: slugify(lesson.slug || lesson.title || lesson.id),
    category: normalizeCategory(lesson.category, lesson.courseId),
    status: normalizeStatus(lesson.status),
    difficulty: lesson.difficulty ?? "medium",
    xpReward: lesson.xpReward ?? 100,
    lessonNumber: lesson.lessonNumber ?? lesson.order,
    estimatedDurationMinutes: lesson.estimatedDurationMinutes ?? lesson.durationMinutes,
    instructor: lesson.instructor ?? "",
    thumbnail: lesson.thumbnail ?? "",
    updatedAt: lesson.updatedAt ?? new Date().toISOString(),
    assets: {
      ...lesson.assets,
      videoId: lesson.assets.videoId ?? "",
      pdfFileId: lesson.assets.pdfFileId ?? "",
    },
    quiz: normalizeQuestions(lesson.quiz),
    quizSettings: lesson.quizSettings ?? {
      passingScore: 70,
      randomizedOrder: false,
      instantFeedback: true,
    },
  };
}

function normalizeMediaItem(item: MediaItem): MediaItem {
  return {
    ...item,
    usedByLessonIds: Array.isArray(item.usedByLessonIds) ? item.usedByLessonIds.filter(Boolean) : [],
  };
}

export async function readLessons(): Promise<Lesson[]> {
  const repository = await getAdminContentRepository();
  const lessons = await repository.loadLessons();
  return lessons.map(normalizeLesson).sort((a, b) => a.order - b.order);
}

export async function writeLessons(lessons: Lesson[]) {
  const repository = await getAdminContentRepository();
  const normalized = lessons.map(normalizeLesson).sort((a, b) => a.order - b.order);
  await repository.saveLessons(normalized);
}

export async function readVersions() {
  const repository = await getAdminContentRepository();
  const versions = await repository.loadVersions();
  return versions.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
}

export async function appendVersion(entry: Omit<LessonVersion, "id" | "timestamp">) {
  const repository = await getAdminContentRepository();
  const current = await repository.loadVersions();
  const next: LessonVersion = {
    ...entry,
    id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  await repository.saveVersions([next, ...current].slice(0, 500));
}

export async function readMediaLibrary() {
  const repository = await getAdminContentRepository();
  const items = await repository.loadMedia();
  return items
    .map(normalizeMediaItem)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

export async function writeMediaLibrary(items: MediaItem[]) {
  const repository = await getAdminContentRepository();
  await repository.saveMedia(items.map(normalizeMediaItem));
}

function ensureUniqueSlug(lessons: Lesson[], proposedSlug: string, exceptId?: string) {
  const base = slugify(proposedSlug);
  let slug = base || `lesson-${Date.now()}`;
  let counter = 2;
  while (lessons.some((lesson) => lesson.slug === slug && lesson.id !== exceptId)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

export function validateLessonPayload(lesson: Lesson, existing: Lesson[], mode: "create" | "update") {
  if (!lesson.title.trim()) throw new Error("Lesson title is required.");
  if (!lesson.description.trim()) throw new Error("Lesson description is required.");
  if (!lesson.summary.trim()) throw new Error("Lesson summary is required.");
  if (!lesson.courseId.trim()) throw new Error("Course category is required.");
  if (lesson.durationMinutes <= 0) throw new Error("Estimated duration must be positive.");
  if (lesson.xpReward !== undefined && lesson.xpReward < 0) throw new Error("XP reward cannot be negative.");
  if (mode === "create" && existing.some((item) => item.id === lesson.id)) throw new Error("Duplicate lesson ID.");
  if (existing.some((item) => item.slug === lesson.slug && item.id !== lesson.id)) throw new Error("Duplicate lesson slug.");
}

export async function createLesson(input: Partial<Lesson>, role: LessonVersion["role"]) {
  const lessons = await readLessons();
  const nextOrder = lessons.length ? Math.max(...lessons.map((item) => item.order)) + 1 : 1;
  const id = input.id?.trim() || `l-${Date.now()}`;
  const lesson: Lesson = normalizeLesson({
    id,
    courseId: input.courseId || "c1",
    module: input.module || "Module",
    moduleAr: input.moduleAr || "الوحدة",
    slug: ensureUniqueSlug(lessons, input.slug || input.title || id),
    title: input.title || "",
    titleAr: input.titleAr || input.title || "",
    description: input.description || "",
    descriptionAr: input.descriptionAr || input.description || "",
    summary: input.summary || "",
    summaryAr: input.summaryAr || input.summary || "",
    objectives: input.objectives || [],
    objectivesAr: input.objectivesAr || [],
    takeaways: input.takeaways || [],
    takeawaysAr: input.takeawaysAr || [],
    keywords: input.keywords || [],
    keywordsAr: input.keywordsAr || [],
    durationMinutes: input.durationMinutes || 1,
    order: input.order || nextOrder,
    tags: input.tags || [],
    tagsAr: input.tagsAr || [],
    assets: input.assets || {
      videoProvider: "self-hosted",
      videoId: "",
      videoUrl: "",
      videoChapters: [],
      pdfProvider: "google-drive",
      pdfFileId: "",
      pdfUrl: "",
      presentationUrl: "",
      notes: "",
      notesAr: "",
      resources: [],
    },
    quiz: normalizeQuestions(input.quiz),
    category: normalizeCategory(input.category, input.courseId || "c1"),
    status: normalizeStatus(input.status),
    lessonNumber: input.lessonNumber || nextOrder,
    estimatedDurationMinutes: input.estimatedDurationMinutes || input.durationMinutes || 1,
    difficulty: input.difficulty || "medium",
    xpReward: input.xpReward ?? 100,
    thumbnail: input.thumbnail || "",
    instructor: input.instructor || "",
    quizSettings: input.quizSettings || {
      passingScore: 70,
      randomizedOrder: false,
      instantFeedback: true,
    },
  });

  validateLessonPayload(lesson, lessons, "create");
  const merged = [...lessons, lesson].sort((a, b) => a.order - b.order);
  await writeLessons(merged);
  await appendVersion({ lessonId: lesson.id, action: "created", role, snapshot: lesson });
  return lesson;
}

export async function updateLesson(input: LessonUpdate, role: LessonVersion["role"]) {
  const lessons = await readLessons();
  const index = lessons.findIndex((item) => item.id === input.id);
  if (index === -1) throw new Error("Lesson not found.");

  const current = lessons[index];
  const merged = normalizeLesson({
    ...current,
    ...input,
    slug: ensureUniqueSlug(lessons, input.slug || current.slug, current.id),
    assets: {
      ...current.assets,
      ...(input.assets || {}),
      videoId: input.assets?.videoId ?? current.assets.videoId ?? "",
      pdfFileId: input.assets?.pdfFileId ?? current.assets.pdfFileId ?? "",
    },
    quiz: normalizeQuestions(input.quiz ?? current.quiz),
  });

  validateLessonPayload(merged, lessons, "update");
  lessons[index] = merged;
  await writeLessons(lessons);
  await appendVersion({ lessonId: merged.id, action: "updated", role, snapshot: merged });
  return merged;
}

export async function deleteLesson(lessonId: string, role: LessonVersion["role"]) {
  const lessons = await readLessons();
  const target = lessons.find((item) => item.id === lessonId);
  if (!target) throw new Error("Lesson not found.");
  const next = lessons.filter((item) => item.id !== lessonId);
  await writeLessons(next.map((lesson, idx) => ({ ...lesson, order: idx + 1, lessonNumber: lesson.lessonNumber ?? idx + 1 })));
  await appendVersion({ lessonId, action: "deleted", role, snapshot: target });
}

export async function duplicateLesson(lessonId: string, role: LessonVersion["role"]) {
  const lessons = await readLessons();
  const source = lessons.find((item) => item.id === lessonId);
  if (!source) throw new Error("Lesson not found.");
  const duplicate = normalizeLesson({
    ...source,
    id: `l-${Date.now()}`,
    slug: ensureUniqueSlug(lessons, `${source.slug}-copy`),
    title: `${source.title} (Copy)`,
    titleAr: `${source.titleAr} (نسخة)`,
    status: "draft",
    order: lessons.length + 1,
    lessonNumber: lessons.length + 1,
    updatedAt: new Date().toISOString(),
  });
  const next = [...lessons, duplicate];
  await writeLessons(next);
  await appendVersion({ lessonId: duplicate.id, action: "duplicated", role, snapshot: duplicate });
  return duplicate;
}

export async function reorderLessons(input: Array<{ id: string; order: number; category?: LessonCategory; courseId?: string }>, role: LessonVersion["role"]) {
  const map = new Map(input.map((item) => [item.id, item]));
  const lessons = await readLessons();
  const next = lessons
    .map((lesson) => {
      const patch = map.get(lesson.id);
      if (!patch) return lesson;
      return normalizeLesson({
        ...lesson,
        order: patch.order,
        lessonNumber: patch.order,
        category: patch.category ?? lesson.category,
        courseId: patch.courseId ?? lesson.courseId,
      });
    })
    .sort((a, b) => a.order - b.order);

  await writeLessons(next);
  await appendVersion({ lessonId: "bulk", action: "reordered", role, snapshot: null });
  return next;
}

export async function setLessonStatus(lessonId: string, status: LessonStatus, role: LessonVersion["role"]) {
  const lesson = await updateLesson({ id: lessonId, status }, role);
  await appendVersion({
    lessonId,
    action: status === "published" ? "published" : "unpublished",
    role,
    snapshot: lesson,
  });
  return lesson;
}

export function searchLessons(lessons: Lesson[], query: {
  term?: string;
  category?: LessonCategory | "all";
  lessonNumber?: number;
  status?: LessonStatus | "all";
}) {
  const term = query.term?.trim().toLowerCase() ?? "";
  return lessons.filter((lesson) => {
    if (query.category && query.category !== "all" && lesson.category !== query.category) return false;
    if (query.status && query.status !== "all" && lesson.status !== query.status) return false;
    if (query.lessonNumber && lesson.lessonNumber !== query.lessonNumber) return false;
    if (!term) return true;
    const haystack = [
      lesson.title,
      lesson.titleAr,
      lesson.slug,
      lesson.description,
      lesson.summary,
      lesson.instructor || "",
      lesson.category || "",
      lesson.status || "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

export async function addMediaItem(input: {
  type: MediaType;
  provider: MediaProvider;
  name: string;
  url: string;
  storageBucket?: string;
  storageKey?: string;
  mimeType?: string;
  size?: number;
  lessonId?: string;
}) {
  const items = await readMediaLibrary();
  const now = new Date().toISOString();
  const existing = items.find((item) => item.url === input.url);
  if (existing) {
    if (input.lessonId && !existing.usedByLessonIds.includes(input.lessonId)) {
      existing.usedByLessonIds.push(input.lessonId);
      existing.updatedAt = now;
      existing.storageBucket = input.storageBucket ?? existing.storageBucket;
      existing.storageKey = input.storageKey ?? existing.storageKey;
      await writeMediaLibrary(items);
    }
    return existing;
  }

  const item: MediaItem = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    provider: input.provider,
    name: input.name,
    url: input.url,
    storageBucket: input.storageBucket,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    size: input.size,
    createdAt: now,
    updatedAt: now,
    usedByLessonIds: input.lessonId ? [input.lessonId] : [],
  };
  await writeMediaLibrary([item, ...items]);
  return item;
}

export async function removeMediaItem(mediaId: string) {
  const items = await readMediaLibrary();
  const target = items.find((item) => item.id === mediaId);
  if (!target) {
    return;
  }

  if (target.storageKey) {
    const client = createSupabaseAdminClient();
    const bucket = target.storageBucket || getAdminMediaBucket();
    const { error } = await client.storage.from(bucket).remove([target.storageKey]);
    if (error) {
      throw new Error(`Failed to remove media from storage: ${error.message}`);
    }
  }

  await writeMediaLibrary(items.filter((item) => item.id !== mediaId));
}

export function inferMediaType(fileName: string): MediaType {
  const ext = path.extname(fileName).toLowerCase();
  if ([".mp4", ".webm", ".mov", ".mkv", ".m4v"].includes(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) return "image";
  return "other";
}

export async function saveUploadedFile(file: File, fileName: string) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const ext = path.extname(fileName).toLowerCase();
  const stem = slugify(path.basename(fileName, ext)) || "asset";
  const safeName = `${stem}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  const bucket = getAdminMediaBucket();
  const storageKey = `academy/${new Date().getUTCFullYear()}/${safeName}`;
  const client = createSupabaseAdminClient();
  const { error } = await client.storage.from(bucket).upload(storageKey, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    throw new Error(`Failed to upload media: ${error.message}`);
  }
  const { data } = client.storage.from(bucket).getPublicUrl(storageKey);
  return {
    publicUrl: data.publicUrl,
    storageBucket: bucket,
    storageKey,
  };
}

export function validateUpload(fileName: string, size: number) {
  if (size > 150 * 1024 * 1024) {
    throw new Error("Upload exceeds maximum allowed size (150MB).");
  }
  const ext = path.extname(fileName).toLowerCase();
  const allowed = [".mp4", ".webm", ".mov", ".mkv", ".m4v", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".json", ".csv"];
  if (!allowed.includes(ext)) {
    throw new Error("Unsupported file type.");
  }
}

export function toCsv(lessons: Lesson[]) {
  const header = ["id", "title", "slug", "category", "status", "lessonNumber", "difficulty", "durationMinutes", "xpReward", "videoProvider", "videoId", "videoUrl", "pdfProvider", "pdfFileId", "pdfUrl"];
  const rows = lessons.map((lesson) => [
    lesson.id,
    lesson.title,
    lesson.slug,
    lesson.category || "",
    lesson.status || "",
    lesson.lessonNumber || lesson.order,
    lesson.difficulty || "",
    lesson.durationMinutes,
    lesson.xpReward || "",
    lesson.assets.videoProvider,
    lesson.assets.videoId || "",
    lesson.assets.videoUrl,
    lesson.assets.pdfProvider,
    lesson.assets.pdfFileId || "",
    lesson.assets.pdfUrl,
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function buildAnalytics(lessons: Lesson[]): AdminAnalytics {
  const totalLessons = lessons.length;
  const publishedLessons = lessons.filter((lesson) => lesson.status !== "draft").length;
  const draftLessons = totalLessons - publishedLessons;
  return {
    totalLessons,
    publishedLessons,
    draftLessons,
    students: 0,
    completedLessons: 0,
    averageProgress: 0,
    averageQuizScore: 0,
  };
}
