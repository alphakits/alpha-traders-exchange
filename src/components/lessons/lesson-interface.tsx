"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Bookmark, CheckCircle2, Clock3, FileText, PlayCircle, Sparkles } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Lesson } from "@/types/academy";
import { lessonNarratives } from "@/data/course-source";
import { getLessonsByCourse } from "@/lib/content";
import {
  addStudyMinutes,
  getCourseProgressPercent,
  getLessonProgressState,
  isQuizPassed,
  markLessonAsCurrent,
  updateLessonProgress,
} from "@/lib/learning-progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { VideoPlayer } from "./video-player";
import { PdfViewer } from "./pdf-viewer";
import { LessonQuiz } from "./lesson-quiz";

const SECTION_IDS = {
  overview: "lesson-overview",
  video: "lesson-video",
  summary: "lesson-summary",
  objectives: "lesson-objectives",
  workbook: "lesson-workbook",
  notes: "lesson-notes",
  concepts: "lesson-concepts",
  visuals: "lesson-visuals",
  mistakes: "lesson-mistakes",
  quiz: "lesson-quiz",
  navigation: "lesson-navigation",
} as const;

type SyncState = "idle" | "saving" | "saved";

export function LessonInterface({
  lesson,
  previousSlug,
  nextSlug,
}: {
  lesson: Lesson;
  previousSlug?: string;
  nextSlug?: string;
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const [progressState, setProgressState] = useState(() => getLessonProgressState(lesson.id, lesson.courseId, lesson.slug));
  const [notesDraft, setNotesDraft] = useState(progressState.notes);
  const [notesSyncState, setNotesSyncState] = useState<SyncState>("idle");
  const [showCelebration, setShowCelebration] = useState(false);

  const courseLessons = useMemo(() => getLessonsByCourse(lesson.courseId), [lesson.courseId]);
  const courseProgress = getCourseProgressPercent(
    lesson.courseId,
    courseLessons.map((entry) => entry.id),
  );

  const completionChecks = {
    video: progressState.videoWatched,
    pdf: progressState.pdfOpened,
    quiz: isQuizPassed(progressState.quizScore),
  };
  const completionEligible = completionChecks.video && completionChecks.pdf && completionChecks.quiz;
  const completionPercent = Math.round((Number(completionChecks.video) + Number(completionChecks.pdf) + Number(completionChecks.quiz)) * (100 / 3));
  const shouldShowResume = progressState.videoPositionSeconds > 0 || progressState.pdfReadProgress > 0 || progressState.notes.length > 0;
  const isEmbeddedFallbackProvider = lesson.assets.videoProvider !== "self-hosted";
  const lessonDuration = lesson.estimatedDurationMinutes || lesson.durationMinutes;
  const narrative = lessonNarratives[lesson.slug];

  useEffect(() => {
    markLessonAsCurrent(lesson);
    const timer = window.setInterval(() => addStudyMinutes(1), 60000);
    return () => window.clearInterval(timer);
  }, [lesson]);

  useEffect(() => {
    setNotesDraft(progressState.notes);
  }, [progressState.notes]);

  useEffect(() => {
    if (progressState.lessonCompleted) {
      setShowCelebration(true);
    }
  }, [progressState.lessonCompleted]);

  const updateProgress = useCallback(
    async (
      eventType: Parameters<typeof updateLessonProgress>[0]["eventType"],
      updater: Parameters<typeof updateLessonProgress>[0]["updater"],
    ) => {
      const next = await updateLessonProgress({
        lessonId: lesson.id,
        courseId: lesson.courseId,
        lessonSlug: lesson.slug,
        eventType,
        updater,
      });
      setProgressState(next);
    },
    [lesson.courseId, lesson.id, lesson.slug],
  );

  useEffect(() => {
    if (notesDraft === progressState.notes) return;
    setNotesSyncState("saving");
    const timer = window.setTimeout(() => {
      void updateProgress("notes_updated", (current) => ({
        ...current,
        notes: notesDraft,
        notesSavedAt: new Date().toISOString(),
      }));
      setNotesSyncState("saved");
      window.setTimeout(() => setNotesSyncState("idle"), 1400);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [notesDraft, progressState.notes, updateProgress]);

  return (
    <div className="section-container page-shell">
      <div className="sticky top-20 z-20 mb-4 rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{isAr ? lesson.titleAr : lesson.title}</p>
            <p className="text-xs text-[#9CA3AF]">
              {isAr ? "تقدم الدورة" : "Course Progress"} {courseProgress}%
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {previousSlug ? (
              <Link href={`/lessons/${previousSlug}`}>
                <Button variant="secondary" size="sm">
                  {isAr ? "السابق" : "Previous"}
                </Button>
              </Link>
            ) : null}
            {nextSlug ? (
              <Link href={`/lessons/${nextSlug}`}>
                <Button variant="secondary" size="sm">
                  {isAr ? "التالي" : "Next"}
                </Button>
              </Link>
            ) : null}
            <Button
              size="sm"
              disabled={!completionEligible}
              onClick={() =>
                void updateProgress("lesson_completed", (current) => ({
                  ...current,
                  videoWatched: true,
                  pdfOpened: true,
                  quizScore: current.quizScore ?? 100,
                }))
              }
            >
              {progressState.lessonCompleted ? (isAr ? "مكتمل" : "Completed") : isAr ? "إكمال الدرس" : "Mark Complete"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-4">
          {shouldShowResume ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div>
                  <p className="text-sm font-medium">{isAr ? "تابع من حيث توقفت" : "Continue where you left off"}</p>
                  <p className="text-xs text-[#9CA3AF]">
                    {isAr ? "الفيديو" : "Video"} {Math.floor(progressState.videoPositionSeconds / 60)}:
                    {`${Math.floor(progressState.videoPositionSeconds % 60)}`.padStart(2, "0")} · {isAr ? "القراءة" : "Reading"} {progressState.pdfReadProgress}%
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                  {isAr ? "متابعة الآن" : "Resume Now"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card id={SECTION_IDS.overview}>
            <CardHeader>
              <CardDescription>{isAr ? lesson.moduleAr : lesson.module}</CardDescription>
              <CardTitle className="text-2xl md:text-3xl">{isAr ? lesson.titleAr : lesson.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-7 text-[#9CA3AF]">{isAr ? lesson.descriptionAr : lesson.description}</p>
              {narrative ? (
                <p className="rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/[0.04] p-4 text-sm leading-7 text-[#E5E7EB]">
                  {isAr ? narrative.introAr : narrative.intro}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 text-xs text-[#D1D5DB]">
                <span className="rounded-full border border-white/10 px-3 py-1">{lesson.lessonNumber || lesson.order}. {isAr ? "الدرس" : "Lesson"}</span>
                <span className="rounded-full border border-white/10 px-3 py-1">{lessonDuration} {isAr ? "دقيقة" : "minutes"}</span>
                <span className="rounded-full border border-white/10 px-3 py-1">{lesson.difficulty || "medium"}</span>
                {lesson.instructor ? <span className="rounded-full border border-white/10 px-3 py-1">{lesson.instructor}</span> : null}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
                  <span>{isAr ? "التقدم داخل الدرس" : "Lesson Progress"}</span>
                  <span>{completionPercent}%</span>
                </div>
                <Progress value={completionPercent} />
              </div>
            </CardContent>
          </Card>

          <Card id={SECTION_IDS.video}>
            <CardHeader>
              <CardTitle>{isAr ? "الفيديو" : "Lesson Video"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <VideoPlayer
                  asset={lesson.assets}
                  title={isAr ? lesson.titleAr : lesson.title}
                  initialTimeSeconds={progressState.videoPositionSeconds}
                  onVideoPlay={() => undefined}
                  onVideoComplete={() => {
                    void updateProgress("video_watched", (current) => ({
                      ...current,
                      videoWatched: true,
                      videoPositionSeconds: 0,
                    }));
                  }}
                  onVideoTimeUpdate={(seconds) => {
                    void updateProgress("video_position_updated", (current) => ({
                      ...current,
                      videoPositionSeconds: seconds,
                    }));
                  }}
                />
              </div>
              {lesson.assets.videoChapters.length ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {lesson.assets.videoChapters.map((chapter) => (
                    <div key={chapter.id} className="rounded-xl border border-white/10 p-3 text-sm">
                      <p className="text-xs text-[#9CA3AF]">
                        {Math.floor(chapter.timeSeconds / 60)}:{`${chapter.timeSeconds % 60}`.padStart(2, "0")}
                      </p>
                      <p className="mt-1">{isAr ? chapter.titleAr : chapter.title}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {isEmbeddedFallbackProvider ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void updateProgress("video_watched", (current) => ({
                      ...current,
                      videoWatched: true,
                    }))
                  }
                >
                  {isAr ? "تأكيد مشاهدة الفيديو" : "Mark Video as Watched"}
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card id={SECTION_IDS.summary}>
            <CardHeader>
              <CardTitle>{isAr ? "ملخص الدرس" : "Lesson Summary"}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-[#9CA3AF]">{isAr ? lesson.summaryAr : lesson.summary}</p>
            </CardContent>
          </Card>

          {narrative ? (
            <Card id={SECTION_IDS.concepts}>
              <CardHeader>
                <CardTitle>{isAr ? "المفاهيم الأساسية" : "Key Concepts"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(isAr ? narrative.keyConceptsAr : narrative.keyConcepts).map((concept, index) => (
                  <div key={`${concept}-${index}`} className="flex items-start gap-2 rounded-xl border border-white/10 p-3 text-sm text-[#D1D5DB]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A227]" />
                    <span>{concept}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card id={SECTION_IDS.objectives}>
            <CardHeader>
              <CardTitle>{isAr ? "أهداف التعلم" : "Learning Objectives"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(isAr ? lesson.objectivesAr : lesson.objectives).map((objective, index) => (
                <div key={`${objective}-${index}`} className="flex items-start gap-2 rounded-xl border border-white/10 p-3 text-sm text-[#D1D5DB]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A227]" />
                  <span>{objective}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card id={SECTION_IDS.workbook}>
            <CardHeader>
              <CardTitle>{isAr ? "ملف العمل / PDF" : "Workbook / PDF"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {narrative ? (
                <p className="text-sm leading-7 text-[#9CA3AF]">{isAr ? narrative.workbookIntroAr : narrative.workbookIntro}</p>
              ) : null}
              <PdfViewer
                asset={lesson.assets}
                title={isAr ? lesson.titleAr : lesson.title}
                initialProgress={progressState.pdfReadProgress}
                onOpen={() => {
                  void updateProgress("pdf_opened", (current) => ({ ...current, pdfOpened: true }));
                }}
                onProgress={(value) => {
                  void updateProgress("pdf_progress", (current) => ({
                    ...current,
                    pdfOpened: true,
                    pdfReadProgress: value,
                  }));
                }}
              />

              {lesson.assets.resources.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {lesson.assets.resources.map((resource) => (
                    <a
                      key={resource.id}
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="premium-card flex items-center gap-2 rounded-xl p-3 text-sm hover:-translate-y-0.5"
                    >
                      <FileText className="h-4 w-4 text-[#C9A227]" />
                      <span>{isAr ? resource.labelAr : resource.label}</span>
                    </a>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card id={SECTION_IDS.notes}>
            <CardHeader>
              <CardTitle>{isAr ? "ملاحظات الدرس" : "Lesson Notes"}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-[#9CA3AF]">{isAr ? lesson.assets.notesAr : lesson.assets.notes}</p>
            </CardContent>
          </Card>

          {narrative?.visuals.length ? (
            <Card id={SECTION_IDS.visuals}>
              <CardHeader>
                <CardTitle>{isAr ? "الرسوم والأمثلة من الدورة" : "Charts & Examples From the Course"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {narrative.visuals.map((visual) => (
                  <div key={visual.src} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <div className="relative aspect-[4/3]">
                      <Image
                        src={visual.src}
                        alt={isAr ? visual.titleAr : visual.title}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-contain"
                      />
                    </div>
                    <div className="border-t border-white/10 p-3 text-sm text-[#D1D5DB]">{isAr ? visual.titleAr : visual.title}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {narrative ? (
            <Card id={SECTION_IDS.mistakes}>
              <CardHeader>
                <CardTitle>{isAr ? "أخطاء المبتدئين" : "Common Beginner Mistakes"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(isAr ? narrative.beginnerMistakesAr : narrative.beginnerMistakes).map((mistake, index) => (
                  <div key={`${mistake}-${index}`} className="flex items-start gap-2 rounded-xl border border-white/10 p-3 text-sm text-[#D1D5DB]">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>{mistake}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card id={SECTION_IDS.quiz}>
            <CardHeader>
              <CardTitle>{isAr ? "اختبار الدرس" : "Lesson Quiz"}</CardTitle>
              <CardDescription>{isAr ? "أكمل الاختبار لتأكيد استيعابك قبل الانتقال للدرس التالي." : "Complete the quiz to confirm understanding before moving to the next lesson."}</CardDescription>
            </CardHeader>
            <CardContent>
              {narrative ? <p className="mb-4 text-sm leading-7 text-[#9CA3AF]">{isAr ? narrative.quizContextAr : narrative.quizContext}</p> : null}
              <LessonQuiz
                questions={lesson.quiz}
                onCompleted={(score) => {
                  void updateProgress("quiz_completed", (current) => ({
                    ...current,
                    quizScore: score,
                  }));
                }}
              />
            </CardContent>
          </Card>

          <Card id={SECTION_IDS.navigation}>
            <CardHeader>
              <CardTitle>{isAr ? "التنقل بين الدروس" : "Lesson Navigation"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {previousSlug ? (
                <Link href={`/lessons/${previousSlug}`}>
                  <Button variant="secondary" className="w-full justify-start">
                    {isAr ? "الدرس السابق" : "Previous Lesson"}
                  </Button>
                </Link>
              ) : (
                <div className="rounded-full border border-white/10 px-4 py-3 text-sm text-[#6B7280]">{isAr ? "هذا أول درس" : "This is the first lesson"}</div>
              )}
              {nextSlug ? (
                <Link href={`/lessons/${nextSlug}`}>
                  <Button className="w-full justify-start">{isAr ? "الدرس التالي" : "Next Lesson"}</Button>
                </Link>
              ) : (
                <div className="rounded-full border border-white/10 px-4 py-3 text-sm text-[#6B7280]">{isAr ? "هذا آخر درس" : "This is the final lesson"}</div>
              )}
            </CardContent>
          </Card>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-40 xl:self-start">
          <Card>
            <CardHeader>
              <CardDescription>{isAr ? "تنقل الدورة" : "Course Navigation"}</CardDescription>
              <CardTitle className="text-lg">{isAr ? lesson.moduleAr : lesson.module}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {courseLessons.map((entry) => (
                <Link
                  key={entry.id}
                  href={`/lessons/${entry.slug}`}
                  className={`block rounded-lg px-3 py-2 text-sm ${
                    lesson.slug === entry.slug ? "bg-[#C9A227]/20 text-[#C9A227]" : "text-[#9CA3AF] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className="block truncate">
                    {(entry.lessonNumber || entry.order).toString().padStart(2, "0")} · {locale === "ar" ? entry.titleAr : entry.title}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>{isAr ? "تقدم الطالب" : "Student Progress"}</CardDescription>
              <CardTitle className="text-lg">{courseProgress}%</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={courseProgress} />
              <div className="rounded-xl border border-white/10 p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-[#9CA3AF]">
                  <span>{isAr ? "جاهزية الإكمال" : "Completion Readiness"}</span>
                  <span>{completionPercent}%</span>
                </div>
                <Progress value={completionPercent} />
              </div>
              <div className="space-y-2 text-sm text-[#9CA3AF]">
                <div className="flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-[#C9A227]" />
                  {completionChecks.video ? (isAr ? "تمت مشاهدة الفيديو" : "Video completed") : isAr ? "الفيديو غير مكتمل" : "Video pending"}
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#C9A227]" />
                  {completionChecks.pdf ? (isAr ? "تم فتح الملف" : "Workbook opened") : isAr ? "ملف العمل غير مكتمل" : "Workbook pending"}
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#C9A227]" />
                  {completionChecks.quiz
                    ? `${isAr ? "تم الاختبار" : "Quiz passed"} ${progressState.quizScore ?? 0}%`
                    : isAr
                      ? "الاختبار غير مكتمل"
                      : "Quiz pending"}
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-[#C9A227]" />
                  {isAr ? "المدة" : "Duration"}: {lessonDuration} {isAr ? "دقيقة" : "minutes"}
                </div>
              </div>
            </CardContent>
          </Card>

          {narrative ? (
            <Card>
              <CardHeader>
                <CardDescription>{isAr ? "أمثلة عملية" : "Practical Examples"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(isAr ? narrative.practicalExamplesAr : narrative.practicalExamples).map((item, index) => (
                  <p key={`${item}-${index}`} className="rounded-xl border border-white/10 p-3 text-sm text-[#D1D5DB]">
                    {item}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardDescription>{isAr ? "ملاحظاتك" : "Your Notes"}</CardDescription>
              <CardTitle className="text-base">{isAr ? "تُحفظ تلقائياً" : "Auto-saved"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <textarea
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                rows={7}
                className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm outline-none transition focus:border-[#C9A227]/60"
                placeholder={isAr ? "اكتب ملاحظاتك..." : "Write your notes..."}
                aria-label={isAr ? "ملاحظات الدرس" : "Lesson notes"}
              />
              <p className="text-xs text-[#9CA3AF]">
                {notesSyncState === "saving" ? (isAr ? "جاري الحفظ..." : "Saving...") : notesSyncState === "saved" ? "✓ Saved" : " "}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <button
                type="button"
                onClick={() =>
                  void updateProgress("bookmark_toggled", (current) => ({
                    ...current,
                    bookmarked: !current.bookmarked,
                  }))
                }
                className="flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm"
              >
                <Bookmark className="h-4 w-4 text-[#C9A227]" />
                {progressState.bookmarked ? (isAr ? "تم حفظ الدرس" : "Bookmarked") : isAr ? "حفظ الدرس" : "Bookmark Lesson"}
              </button>
            </CardContent>
          </Card>
        </aside>
      </div>

      <AnimatePresence>
        {showCelebration && progressState.lessonCompleted ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              className="w-full max-w-xl rounded-3xl border border-[#C9A227]/40 bg-[#0B0B0B] p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
            >
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-[#C9A227]" />
              <p className="text-sm uppercase tracking-[0.2em] text-[#C9A227]">{isAr ? "ممتاز" : "Excellent work"}</p>
              <h3 className="mt-2 text-2xl font-semibold">{isAr ? `أكملت درس ${lesson.titleAr}` : `You've completed ${lesson.title}`}</h3>
              <p className="mt-3 text-sm text-[#9CA3AF]">{isAr ? "نقاط الخبرة" : "XP Progress"} +{lesson.xpReward ?? 120}</p>
              <div className="mx-auto mt-3 max-w-sm">
                <Progress value={Math.min(100, courseProgress + 8)} />
              </div>
              <div className="mt-5 flex justify-center gap-2">
                {nextSlug ? (
                  <Link href={`/lessons/${nextSlug}`}>
                    <Button>{isAr ? "متابعة التعلم" : "Continue Learning"}</Button>
                  </Link>
                ) : null}
                <Button variant="secondary" onClick={() => setShowCelebration(false)}>
                  {isAr ? "إغلاق" : "Close"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
