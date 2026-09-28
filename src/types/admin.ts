import type { Lesson, UserRole } from "@/types/academy";

export type LessonVersion = {
  id: string;
  lessonId: string;
  action: "created" | "updated" | "deleted" | "duplicated" | "published" | "unpublished" | "reordered" | "imported";
  role: UserRole;
  timestamp: string;
  snapshot: Lesson | null;
};

export type MediaType = "video" | "pdf" | "image" | "thumbnail" | "logo" | "other";
export type MediaProvider = "local" | "google-drive" | "supabase" | "bunny-stream" | "cloudflare-r2" | "vimeo" | "self-hosted";

export type MediaItem = {
  id: string;
  type: MediaType;
  provider: MediaProvider;
  name: string;
  url: string;
  storageBucket?: string;
  storageKey?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  updatedAt: string;
  usedByLessonIds: string[];
};

export type AdminAnalytics = {
  totalLessons: number;
  publishedLessons: number;
  draftLessons: number;
  students: number;
  completedLessons: number;
  averageProgress: number;
  averageQuizScore: number;
};
