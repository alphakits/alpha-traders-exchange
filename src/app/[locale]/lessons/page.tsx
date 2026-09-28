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

export default async function LessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  await getLocale();
  const user = await getCurrentSessionUser();
  if (!user) {
    const lessonsTarget = new URL(`/${locale}/lessons`, "http://localhost");
    if (typeof q === "string" && q.trim()) {
      lessonsTarget.searchParams.set("q", q.trim());
    }
    redirect(`/${locale}/login?redirectTo=${encodeURIComponent(`${lessonsTarget.pathname}${lessonsTarget.search}`)}`);
  }
  return <LessonsBrowser initialQuery={typeof q === "string" ? q : ""} />;
}
