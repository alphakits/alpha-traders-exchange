"use client";

import { useMemo } from "react";
import { CheckCircle2, Circle, Lock, PlayCircle } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { courses, getLessonsByCourse } from "@/lib/content";
import { getAllLessonProgress, getCourseProgressPercent } from "@/lib/learning-progress";
import type { AcademyLevel } from "@/types/academy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const ROADMAP_SETTINGS = {
  lockLessons: true,
};

type RoadmapSection = "beginner" | "intermediate" | "advanced";

function resolveRoadmapSection(level: AcademyLevel): RoadmapSection {
  if (level === "beginner") return "beginner";
  if (level === "intermediate" || level === "risk-management") return "intermediate";
  return "advanced";
}

export function AcademyRoadmap() {
  const locale = useLocale();
  const isAr = locale === "ar";

  const progressMap = useMemo(() => {
    const allProgress = getAllLessonProgress();
    return new Map(allProgress.map((entry) => [entry.lessonId, entry.lessonCompleted]));
  }, []);

  const sections = useMemo(() => {
    const grouped = {
      beginner: [] as typeof courses,
      intermediate: [] as typeof courses,
      advanced: [] as typeof courses,
    };

    courses.forEach((course) => {
      grouped[resolveRoadmapSection(course.level)].push(course);
    });

    return grouped;
  }, []);

  return (
    <div className="space-y-6">
      {(Object.keys(sections) as RoadmapSection[]).map((sectionKey) => (
        <div key={sectionKey} className="space-y-3">
          <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-[#C9A227]">
            {sectionKey === "beginner" ? (isAr ? "المبتدئ" : "Beginner") : sectionKey === "intermediate" ? (isAr ? "المتوسط" : "Intermediate") : isAr ? "المتقدم" : "Advanced"}
          </h3>
          <div className="space-y-4">
            {sections[sectionKey].map((course) => {
              const courseLessons = getLessonsByCourse(course.id);
              const percent = getCourseProgressPercent(
                course.id,
                courseLessons.map((lesson) => lesson.id),
              );

              return (
                <Card key={course.id} className="relative overflow-hidden">
                  <CardHeader>
                    <CardDescription>{course.level.toUpperCase()}</CardDescription>
                    <CardTitle>{isAr ? course.titleAr : course.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-[#9CA3AF]">{isAr ? course.summaryAr : course.summary}</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
                        <span>{isAr ? "تقدم المسار" : "Track Progress"}</span>
                        <span>{percent}%</span>
                      </div>
                      <Progress value={percent} />
                    </div>
                    <div className="space-y-1">
                      {courseLessons.map((lesson, index) => {
                        const isCompleted = Boolean(progressMap.get(lesson.id));
                        const previousLessonId = courseLessons[index - 1]?.id;
                        const isLocked = ROADMAP_SETTINGS.lockLessons && index > 0 && previousLessonId ? !progressMap.get(previousLessonId) : false;

                        return (
                          <div
                            key={lesson.id}
                            className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${
                              isLocked ? "blur-[1px] opacity-60" : "text-[#D1D5DB]"
                            }`}
                            aria-disabled={isLocked}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                            ) : isLocked ? (
                              <Lock className="h-4 w-4 text-[#9CA3AF]" />
                            ) : (
                              <Circle className="h-4 w-4 text-[#9CA3AF]" />
                            )}
                            <span>{isAr ? lesson.titleAr : lesson.title}</span>
                          </div>
                        );
                      })}
                    </div>
                    <Link href={`/academy/${course.slug}`} className="inline-flex items-center gap-2 text-sm text-[#C9A227] hover:underline">
                      <PlayCircle className="h-4 w-4" />
                      {isAr ? "الدخول للمسار" : "Open Track"}
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
