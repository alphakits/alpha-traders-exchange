import type { AppLocale } from "@/i18n/routing";
import type { AcademyLevel } from "@/types/academy";

const LEVEL_LABELS: Record<AcademyLevel, Record<AppLocale, string>> = {
  beginner: { en: "Beginner", ar: "مبتدئ" },
  intermediate: { en: "Intermediate", ar: "متوسط" },
  advanced: { en: "Advanced", ar: "متقدم" },
  ict: { en: "ICT", ar: "مفاهيم ICT" },
  "risk-management": { en: "Risk Management", ar: "إدارة المخاطر" },
  psychology: { en: "Trading Psychology", ar: "علم نفس التداول" },
};

const DIFFICULTY_LABELS: Record<string, Record<AppLocale, string>> = {
  easy: { en: "Easy", ar: "سهل" },
  medium: { en: "Medium", ar: "متوسط" },
  hard: { en: "Hard", ar: "صعب" },
  advanced: { en: "Advanced", ar: "متقدم" },
  expert: { en: "Expert", ar: "خبير" },
};

export function formatAcademyLevel(level: AcademyLevel, locale: AppLocale) {
  return LEVEL_LABELS[level]?.[locale] ?? (locale === "ar" ? "مسار تعليمي" : "Learning Track");
}

export function formatLessonDifficulty(difficulty: string | undefined, locale: AppLocale) {
  const normalized = difficulty?.trim().toLowerCase() || "medium";
  return DIFFICULTY_LABELS[normalized]?.[locale] ?? (locale === "ar" ? "متوسط" : normalized);
}
