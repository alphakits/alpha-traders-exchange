export type AcademyLevel = "beginner" | "intermediate" | "advanced" | "ict" | "psychology" | "risk-management";
export type LessonCategory = "beginner" | "intermediate" | "advanced";
export type LessonStatus = "draft" | "published";
export type LessonDifficulty = "easy" | "medium" | "hard" | "expert";
export type UserRole = "admin" | "editor" | "instructor" | "student";

export type Course = {
  id: string;
  slug: string;
  title: string;
  titleAr: string;
  level: AcademyLevel;
  summary: string;
  summaryAr: string;
  order: number;
  thumbnail: string;
};

export type VideoProvider = "youtube" | "vimeo" | "google-drive" | "self-hosted" | "supabase" | "bunny-stream" | "cloudflare-r2";
export type PdfProvider = "google-drive" | "supabase" | "bunny-stream" | "cloudflare-r2" | "custom-url";

export type LessonChapter = {
  id: string;
  title: string;
  titleAr: string;
  timeSeconds: number;
};

export type LessonResource = {
  id: string;
  label: string;
  labelAr: string;
  url: string;
  type: "link" | "pdf" | "slide" | "worksheet";
};

export type LessonAsset = {
  videoProvider: VideoProvider;
  videoId?: string;
  videoUrl: string;
  videoChapters: LessonChapter[];
  pdfProvider: PdfProvider;
  pdfFileId: string;
  pdfUrl: string;
  presentationUrl: string;
  notes: string;
  notesAr: string;
  resources: LessonResource[];
};

export type QuizQuestion = {
  id: string;
  type?: "multiple-choice" | "true-false";
  question: string;
  questionAr: string;
  options: string[];
  optionsAr: string[];
  correctIndex: number;
  explanation: string;
  explanationAr: string;
};

export type Lesson = {
  id: string;
  courseId: string;
  module: string;
  moduleAr: string;
  slug: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  summary: string;
  summaryAr: string;
  objectives: string[];
  objectivesAr: string[];
  takeaways: string[];
  takeawaysAr: string[];
  keywords: string[];
  keywordsAr: string[];
  durationMinutes: number;
  estimatedDurationMinutes?: number;
  order: number;
  lessonNumber?: number;
  status?: LessonStatus;
  category?: LessonCategory;
  difficulty?: LessonDifficulty;
  xpReward?: number;
  thumbnail?: string;
  instructor?: string;
  publishAt?: string | null;
  updatedAt?: string;
  tags: string[];
  tagsAr: string[];
  assets: LessonAsset;
  quiz: QuizQuestion[];
  quizSettings?: {
    passingScore: number;
    randomizedOrder: boolean;
    instantFeedback: boolean;
  };
};

export type MarketAnalysis = {
  id: string;
  title: string;
  titleAr: string;
  summary: string;
  summaryAr: string;
  publishedAt: string;
  tags: string[];
};
