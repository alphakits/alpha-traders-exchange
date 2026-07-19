"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { CalendarClock, CheckCircle2, Clock3, FileText, PlayCircle } from "lucide-react";
import { lessons } from "@/lib/content";
import { getDashboardSnapshot, getLearningMeta } from "@/lib/learning-progress";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function StudentDashboard() {
  const locale = useLocale();
  const isAr = locale === "ar";

  const snapshot = useMemo(() => getDashboardSnapshot(lessons), []);
  const meta = useMemo(() => getLearningMeta(), []);
  const overallProgress = lessons.length ? Math.round((snapshot.completedLessons / lessons.length) * 100) : 0;

  return (
    <section className="section-container page-shell">
      <h1 className="page-title">{isAr ? "لوحة الطالب" : "Student Dashboard"}</h1>
      <p className="page-subtitle">{isAr ? "تتبّع تقدمك ومتابعة الدرس التالي بسرعة." : "Track progress and continue from where you left off."}</p>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="h-full">
          <CardHeader>
            <CardDescription>{isAr ? "الدرس الحالي" : "Current Lesson"}</CardDescription>
            <CardTitle className="text-lg">
              {snapshot.currentLesson ? (isAr ? snapshot.currentLesson.titleAr : snapshot.currentLesson.title) : isAr ? "لا يوجد" : "No lesson"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot.currentLesson ? (
              <Link href={`/lessons/${snapshot.currentLesson.slug}`} className="inline-flex items-center gap-2 text-sm text-[#C9A227] hover:underline">
                <PlayCircle className="h-4 w-4" />
                {isAr ? "متابعة التعلم" : "Continue Learning"}
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardDescription>{isAr ? "تقدم الدورة" : "Course Progress"}</CardDescription>
            <CardTitle>{overallProgress}%</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={overallProgress} />
            <p className="text-sm text-[#9CA3AF]">
              {snapshot.completedLessons}/{lessons.length} {isAr ? "دروس مكتملة" : "lessons completed"}
            </p>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardDescription>{isAr ? "دروس مكتملة" : "Lessons Completed"}</CardDescription>
            <CardTitle>{snapshot.completedLessons}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-[#9CA3AF]">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#C9A227]" />
              {isAr ? "استمر بنفس الوتيرة الممتازة." : "Keep up the excellent pace."}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardDescription>{isAr ? "ساعات الدراسة" : "Hours Studied"}</CardDescription>
            <CardTitle>{snapshot.hoursStudied}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-[#9CA3AF]">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-[#C9A227]" />
              {isAr ? "إجمالي وقت التعلم التقديري." : "Estimated total learning time."}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardDescription>{isAr ? "آخر نشاط" : "Last Activity"}</CardDescription>
            <CardTitle className="text-base">
              {snapshot.lastActivityAt ? new Date(snapshot.lastActivityAt).toLocaleString(isAr ? "ar" : "en-US") : isAr ? "لا يوجد نشاط" : "No recent activity"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-[#9CA3AF]">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[#C9A227]" />
              {meta.lastLessonSlug ? (isAr ? `آخر درس: ${meta.lastLessonSlug}` : `Last lesson: ${meta.lastLessonSlug}`) : isAr ? "ابدأ أول درس الآن." : "Start your first lesson now."}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardDescription>{isAr ? "الملاحظات الأخيرة" : "Recent Notes"}</CardDescription>
            <CardTitle className="text-base">{isAr ? "ملاحظاتك المحفوظة" : "Saved Notes"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-[#9CA3AF]">
            {snapshot.recentNotes.length ? (
              snapshot.recentNotes.map((item) => (
                <Link key={item.lessonId} href={`/lessons/${item.lessonSlug}`} className="block rounded-lg border border-white/10 p-2 hover:border-[#C9A227]/40">
                  <div className="mb-1 flex items-center gap-1 text-xs text-[#C9A227]">
                    <FileText className="h-3.5 w-3.5" />
                    {new Date(item.updatedAt).toLocaleDateString(isAr ? "ar" : "en-US")}
                  </div>
                  <p className="line-clamp-2">{item.note}</p>
                </Link>
              ))
            ) : (
              <p>{isAr ? "لا توجد ملاحظات بعد." : "No notes yet."}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
