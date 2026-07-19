import { getLocale } from "next-intl/server";
import { buildPageMetadata } from "@/lib/seo";
import { LessonsBrowser } from "@/components/lessons/lessons-browser";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الدروس" : "Lessons",
    description: locale === "ar" ? "جميع الدروس التعليمية." : "All educational lessons.",
    path: "/lessons",
  });
}

export default async function LessonsPage() {
  await getLocale();
  return <LessonsBrowser />;
}
