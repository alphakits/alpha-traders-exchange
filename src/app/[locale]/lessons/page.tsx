import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
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

export default async function LessonsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getLocale();
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/lessons`);
  }
  return <LessonsBrowser />;
}
