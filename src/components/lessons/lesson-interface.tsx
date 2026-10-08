"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bookmark, CheckCircle2, ChevronLeft, ChevronDown, FileText, PlayCircle, Sparkles } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Lesson } from "@/types/academy";
import type { LessonNarrative } from "@/data/course-source";
import { resolveLessonPdfSource } from "@/lib/lesson-pdf";
import { resolveLessonResourceUrl } from "@/lib/lesson-video";
import {
  addStudyMinutes,
  createDefaultLessonProgress,
  getCourseProgressPercent,
  getLessonProgressState,
  isCourseComplete,
  isQuizPassed,
  markLessonAsCurrent,
  updateLessonProgress,
} from "@/lib/learning-progress";
import { Button, buttonVariants } from "@/components/ui/button";
import { academyLessonTitle } from "@/lib/academy-journey";
import styles from "@/components/academy/academy-experience.module.css";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LearningNextStep } from "@/components/academy/learning-next-step";
import { VideoPlayer } from "./video-player";
import dynamic from "next/dynamic";

function PdfViewerLoading() {
  const isAr = useLocale() === "ar";
  return <div className="flex h-48 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-sm text-[#9CA3AF]">{isAr ? "جاري تحميل عارض PDF…" : "Loading PDF viewer…"}</div>;
}

function QuizLoading() {
  const isAr = useLocale() === "ar";
  return <div className="flex h-24 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-sm text-[#9CA3AF]">{isAr ? "جاري تحميل الاختبار…" : "Loading quiz…"}</div>;
}

const PdfViewer = dynamic(() => import("./pdf-viewer").then((m) => ({ default: m.PdfViewer })), {
  loading: PdfViewerLoading,
  ssr: false,
});
const LessonQuiz = dynamic(() => import("./lesson-quiz").then((m) => ({ default: m.LessonQuiz })), {
  loading: QuizLoading,
  ssr: false,
});

const SECTION_IDS = {
  overview: "lesson-overview",
  video: "lesson-video",
  summary: "lesson-summary",
  takeaways: "lesson-takeaways",
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
  courseLessons,
  lessonNarrative,
  previousSlug,
  nextSlug,
}: {
  lesson: Lesson;
  courseLessons: Array<Pick<Lesson, "id" | "slug" | "title" | "titleAr" | "lessonNumber" | "order">>;
  lessonNarrative?: LessonNarrative | null;
  previousSlug?: string;
  nextSlug?: string;
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  // Match the server snapshot before restoring browser-only saved progress.
  const [progressState, setProgressState] = useState(() => createDefaultLessonProgress(lesson.id, lesson.courseId, lesson.slug));
  const [courseProgress, setCourseProgress] = useState(0);
  const [courseComplete, setCourseComplete] = useState(false);
  const [notesDraft, setNotesDraft] = useState(progressState.notes);
  const [notesSyncState, setNotesSyncState] = useState<SyncState>("idle");
  const [showCelebration, setShowCelebration] = useState(false);
  const [activePanel, setActivePanel] = useState("summary");
  const [visitedPanels, setVisitedPanels] = useState(() => new Set(["summary"]));
  const [selfHostedVideoErrored, setSelfHostedVideoErrored] = useState(false);

  useEffect(() => {
    setVisitedPanels(current => current.has(activePanel) ? current : new Set([...current, activePanel]));
  }, [activePanel]);

  const refreshCourseProgress = useCallback(() => {
    setCourseProgress(getCourseProgressPercent(lesson.courseId, courseLessons.map((entry) => entry.id)));
    setCourseComplete(isCourseComplete(lesson.courseId, courseLessons.map((entry) => entry.id)));
  }, [courseLessons, lesson.courseId]);

  useEffect(() => {
    const saved = getLessonProgressState(lesson.id, lesson.courseId, lesson.slug);
    setProgressState(saved);
    setNotesDraft(saved.notes);
    refreshCourseProgress();
  }, [lesson.courseId, lesson.id, lesson.slug, refreshCourseProgress]);

  // Determine which completion checks are applicable for this lesson
  const hasQuiz = lesson.quiz.length > 0;
  const hasPdf = Boolean(resolveLessonPdfSource(lesson.assets).embedUrl?.trim());

  const completionChecks = {
    video: progressState.videoWatched,
    pdf: hasPdf ? progressState.pdfOpened : true,
    quiz: hasQuiz ? isQuizPassed(progressState.quizScore) : true,
  };

  const activeCheckValues = [completionChecks.video, completionChecks.pdf, ...(hasQuiz ? [completionChecks.quiz] : [])];
  const completionPercent = Math.round((activeCheckValues.filter(Boolean).length / activeCheckValues.length) * 100);
  const isEmbeddedFallbackProvider = lesson.assets.videoProvider !== "self-hosted";
  const lessonDuration = lesson.estimatedDurationMinutes || lesson.durationMinutes;
  const narrative = lessonNarrative ?? undefined;

  useEffect(() => {
    markLessonAsCurrent(lesson);
    const timer = window.setInterval(() => addStudyMinutes(1), 60000);
    return () => window.clearInterval(timer);
  }, [lesson]);

  useEffect(() => {
    setNotesDraft(progressState.notes);
  }, [progressState.notes]);

  useEffect(() => {
    if (!showCelebration) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCelebration(false);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [showCelebration]);

  const updateProgress = useCallback(
    async (
      eventType: Parameters<typeof updateLessonProgress>[0]["eventType"],
      updater: Parameters<typeof updateLessonProgress>[0]["updater"],
    ) => {
      const wasCompleted = getLessonProgressState(lesson.id, lesson.courseId, lesson.slug).lessonCompleted;
      const next = await updateLessonProgress({
        lessonId: lesson.id,
        courseId: lesson.courseId,
        lessonSlug: lesson.slug,
        eventType,
        updater,
      });
      setProgressState(next);
      if (next.lessonCompleted && !wasCompleted) setShowCelebration(true);
      refreshCourseProgress();
    },
    [lesson.courseId, lesson.id, lesson.slug, refreshCourseProgress],
  );

  useEffect(() => {
    if (notesDraft === progressState.notes) return;
    setNotesSyncState("saving");
    let idleTimer: number;
    const timer = window.setTimeout(() => {
      void updateProgress("notes_updated", (current) => ({
        ...current,
        notes: notesDraft,
        notesSavedAt: new Date().toISOString(),
      }));
      setNotesSyncState("saved");
      idleTimer = window.setTimeout(() => setNotesSyncState("idle"), 1400);
    }, 500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(idleTimer);
    };
  }, [notesDraft, progressState.notes, updateProgress]);

  const panels = [
    { id: "summary", label: isAr ? "الملخّص" : "Overview" },
    { id: "practice", label: isAr ? "التطبيق" : "Practice" },
    { id: "resources", label: isAr ? "الملفات" : "Workbook" },
    { id: "notes", label: isAr ? "ملاحظاتي" : "My notes" },
    { id: "quiz", label: isAr ? "الاختبار" : "Quiz" },
  ];
  const nextTaskLabel = !completionChecks.video ? (isAr ? "شاهد الفيديو" : "Watch the video")
    : !completionChecks.pdf ? (isAr ? "افتح ملف العمل" : "Open the workbook")
    : !completionChecks.quiz ? (isAr ? "اختبر فهمك" : "Try the quiz")
    : (isAr ? "إكمال الدرس" : "Complete lesson");

  function openNextTask() {
    if (!completionChecks.video) {
      document.getElementById(SECTION_IDS.video)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      return;
    }
    if (!completionChecks.pdf) { setActivePanel("resources"); return; }
    if (!completionChecks.quiz) { setActivePanel("quiz"); return; }
    void updateProgress("lesson_completed", (current) => ({ ...current, videoWatched: true, pdfOpened: true, quizScore: current.quizScore ?? 100 }));
  }

  return (
    <div className={`section-container page-shell ${styles.studyShell}`} dir={isAr ? "rtl" : "ltr"}>
      <Link href="/academy" className={styles.backLink}><ChevronLeft size={15} className={styles.directional} />{isAr ? "مساري التعليمي" : "My learning path"}</Link>
      <header className={styles.studyHeading}>
        <div><span className={styles.eyebrow}>{isAr ? `الدرس ${lesson.lessonNumber || lesson.order}` : `LESSON ${lesson.lessonNumber || lesson.order}`} · {isAr ? "مع مارك" : "WITH MARK"}</span><h1>{academyLessonTitle(isAr ? lesson.titleAr : lesson.title)}</h1><p>{lessonDuration} {isAr ? "دقيقة" : "min"} · {isAr ? "تعلّم على راحتك" : "Go at your own pace"}</p></div>
        <button type="button" className={styles.bookmarkButton} aria-pressed={progressState.bookmarked} aria-label={isAr ? "حفظ الدرس" : "Bookmark lesson"} onClick={()=>void updateProgress("bookmark_toggled", current=>({...current, bookmarked: !current.bookmarked}))}><Bookmark size={16} fill={progressState.bookmarked ? "currentColor" : "none"} /><span>{progressState.bookmarked ? (isAr ? "محفوظ" : "Saved") : (isAr ? "حفظ" : "Save")}</span></button>
      </header>
      <div className={styles.studyGrid}>
        <main className={styles.studyMain}>
          <Card id={SECTION_IDS.video} className="scroll-mt-28 overflow-hidden">
            <CardContent className="space-y-4 p-0">
              <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <VideoPlayer
                  asset={lesson.assets}
                  title={isAr ? lesson.titleAr : lesson.title}
                  poster={narrative?.visuals[0]?.src}
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
                  onVideoError={() => setSelfHostedVideoErrored(true)}
                />
              </div>
              {lesson.assets.videoChapters.length ? (
                <details className="mx-4 mb-4 rounded-xl border border-white/10"><summary className="cursor-pointer p-3 text-xs text-[#dcca8e]">{isAr ? "مواضيع الفيديو" : "Video topics"}</summary><div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {lesson.assets.videoChapters.map((chapter) => (
                    <div key={chapter.id} className="rounded-xl border border-white/10 p-3 text-sm">
                      <p className="text-xs text-[#9CA3AF]">
                        {Math.floor(chapter.timeSeconds / 60)}:{`${chapter.timeSeconds % 60}`.padStart(2, "0")}
                      </p>
                      <p className="mt-1">{isAr ? chapter.titleAr : chapter.title}</p>
                    </div>
                  ))}
                </div></details>
              ) : null}
              {(isEmbeddedFallbackProvider || selfHostedVideoErrored) && !progressState.videoWatched ? (
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


          <div className={styles.lessonChecklist} aria-label={isAr ? "خطوات الدرس" : "Lesson steps"}>
            <span data-done={completionChecks.video}>{completionChecks.video ? <CheckCircle2 size={14} /> : <PlayCircle size={14} />}{isAr ? "شاهد" : "Watch"}</span>
            {hasPdf ? <button type="button" data-done={completionChecks.pdf} onClick={()=>setActivePanel("resources")}><FileText size={14} />{isAr ? "طبّق" : "Workbook"}</button> : null}
            {hasQuiz ? <button type="button" data-done={completionChecks.quiz} onClick={()=>setActivePanel("quiz")}><CheckCircle2 size={14} />{isAr ? "اختبر فهمك" : "Check yourself"}</button> : null}
            <span>{completionPercent}%</span>
          </div>
          <div className={styles.studyTabs} role="tablist" aria-label={isAr ? "أدوات الدرس" : "Lesson tools"}>
            {panels.map((panel,index)=><button type="button" role="tab" id={`study-tab-${panel.id}`} key={panel.id} aria-controls={`study-panel-${panel.id}`} aria-selected={activePanel===panel.id} tabIndex={activePanel===panel.id ? 0 : -1} onClick={()=>setActivePanel(panel.id)} onKeyDown={event=>{
              let nextIndex=index;
              if(event.key==="Home") nextIndex=0;
              else if(event.key==="End") nextIndex=panels.length-1;
              else if(event.key==="ArrowRight") nextIndex=(index+(isAr ? -1 : 1)+panels.length)%panels.length;
              else if(event.key==="ArrowLeft") nextIndex=(index+(isAr ? 1 : -1)+panels.length)%panels.length;
              else return;
              event.preventDefault();setActivePanel(panels[nextIndex].id);
              document.getElementById(`study-tab-${panels[nextIndex].id}`)?.focus();
            }}>{panel.label}</button>)}
          </div>
          {panels.map(panel=><div role="tabpanel" id={`study-panel-${panel.id}`} key={panel.id} aria-labelledby={`study-tab-${panel.id}`} tabIndex={0} hidden={activePanel!==panel.id} className={activePanel===panel.id ? styles.studyPanel : undefined}>
            {activePanel===panel.id || visitedPanels.has(panel.id) ? <>
              {panel.id === "summary" ? <>
          <Card id={SECTION_IDS.summary}>
            <CardHeader>
              <CardTitle>{isAr ? "ملخص الدرس" : "Lesson Summary"}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-[#9CA3AF]">{isAr ? lesson.summaryAr : lesson.summary}</p>
            </CardContent>
          </Card>

          <Card id={SECTION_IDS.takeaways}>
            <CardHeader>
              <CardTitle>{isAr ? "أهم النقاط" : "Key Takeaways"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(isAr ? lesson.takeawaysAr : lesson.takeaways).map((takeaway, index) => (
                <div key={`${takeaway}-${index}`} className="flex items-start gap-2 rounded-xl border border-white/10 p-3 text-sm text-[#D1D5DB]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A227]" />
                  <span>{takeaway}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm text-[#d9c68b]">{isAr ? "تعمّق أكثر: المفاهيم والأهداف" : "Go deeper: concepts & objectives"}</summary>
            <div className="mt-4 space-y-4">
              {narrative ? <p className="text-sm leading-7 text-[#a4ab9b]">{isAr ? narrative.introAr : narrative.intro}</p> : null}
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


            </div>
          </details>
              </> : null}
              {panel.id === "practice" ? <>
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


                {narrative ? <Card><CardHeader><CardTitle>{isAr ? "جرّب بنفسك" : "Try it yourself"}</CardTitle></CardHeader><CardContent className="space-y-3">{(isAr ? narrative.practicalExamplesAr : narrative.practicalExamples).map(item=><p className="text-sm leading-7 text-[#aeb4a4]" key={item}>{item}</p>)}</CardContent></Card> : null}
              </> : null}
              {panel.id === "resources" ? <>
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
                      href={resolveLessonResourceUrl(resource.url)}
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


              </> : null}
              {panel.id === "notes" ? <>
          <Card>
            <CardHeader>
              <CardDescription>{isAr ? "ملاحظاتك" : "Your Notes"}</CardDescription>
              <CardTitle className="text-base">{isAr ? "محفوظة في هذا المتصفح" : "Saved in this browser"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <textarea
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                rows={9}
                className={styles.noteArea}
                placeholder={isAr ? "ما الفكرة التي تعلّمتها؟ كيف ستطبقها على الشارت؟" : "What did you learn? How will you apply it on a chart?"}
                aria-label={isAr ? "ملاحظات الدرس" : "Lesson notes"}
              />
              <p className="text-xs text-[#9CA3AF]">
                {notesSyncState === "saving" ? (isAr ? "جاري الحفظ..." : "Saving...") : notesSyncState === "saved" ? (isAr ? "✓ تم الحفظ" : "✓ Saved") : " "}
              </p>
            </CardContent>
          </Card>
              </> : null}
              {panel.id === "quiz" ? <>
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


              </> : null}
            </> : null}
          </div>)}
          <div className={styles.nextAction}>
            <p>{progressState.lessonCompleted ? (isAr ? "أحسنت! أنت جاهز للخطوة التالية." : "Well done. You’re ready for your next step.") : (isAr ? "خطوتك التالية" : "Your next step")}</p>
            {progressState.lessonCompleted ? <Link href={nextSlug ? `/lessons/${nextSlug}` : "/academy"} className={buttonVariants({size:"sm"})}>{nextSlug ? (isAr ? "الدرس التالي" : "Next lesson") : (isAr ? "العودة للمسار" : "Back to my path")}</Link> : <Button size="sm" onClick={openNextTask}>{nextTaskLabel}</Button>}
          </div>
          {courseComplete ? <div className="mt-5"><LearningNextStep locale={locale} completed /></div> : null}
          {previousSlug ? <Link href={`/lessons/${previousSlug}`} className={`${styles.backLink} mt-4`}>{isAr ? "الدرس السابق" : "Previous lesson"}</Link> : null}
        </main>
        <aside className={styles.studySidebar}>
          <details open>
            <summary>{isAr ? "في هذا المسار" : "In this learning path"}<ChevronDown size={15}/></summary>
            <div className="px-4 pb-4"><Progress value={courseProgress}/><p className="mt-2 text-xs text-[#969c8d]">{courseProgress}% {isAr ? "مكتمل" : "complete"}</p></div>
            {courseLessons.map((entry,index)=><Link key={entry.id} href={`/lessons/${entry.slug}`} aria-current={lesson.id===entry.id ? "page" : undefined} className={styles.sidebarLesson}><span>{String(index+1).padStart(2,"0")}</span><span>{academyLessonTitle(isAr ? entry.titleAr : entry.title)}</span></Link>)}
          </details>
          <div className={styles.quietCard}><Sparkles size={19}/><div><strong>{isAr ? "التطبيق يثبت المعلومة" : "Make this lesson count"}</strong><p>{isAr ? "جرّب فكرة واحدة على الشارت واكتب أهم ملاحظة تعلّمتها." : "Try one idea on a chart, then write down your main takeaway."}</p><button className="min-h-10 text-xs text-[#dcc681]" onClick={()=>{setActivePanel("notes");document.getElementById("study-tab-notes")?.scrollIntoView({block:"center"});}}>{isAr ? "افتح ملاحظاتي" : "Open my notes"}</button></div></div>
        </aside>
      </div>
      {showCelebration && progressState.lessonCompleted ? (
          <div className="alpha-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="lesson-completion-dialog-title"
              className="alpha-modal-panel modal-panel w-full max-w-xl border-[#C9A227]/40 p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
            >
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-[#C9A227]" />
              <p className="text-sm uppercase tracking-[0.2em] text-[#C9A227]">{isAr ? "ممتاز" : "Excellent work"}</p>
              <h3 id="lesson-completion-dialog-title" className="mt-2 text-2xl font-semibold">{isAr ? `أكملت درس ${lesson.titleAr}` : `You've completed ${lesson.title}`}</h3>
              <p className="mt-3 text-sm text-[#9CA3AF]">{isAr ? "نقاط الخبرة" : "XP Progress"} +{lesson.xpReward ?? 120}</p>
              <div className="mx-auto mt-3 max-w-sm">
                <Progress value={courseProgress} />
              </div>
              {courseComplete ? <p className="mt-4 text-sm leading-7 text-[#D1D5DB]">{isAr ? "أكملت دروس هذا المسار. يمكنك متابعة التعلّم المجاني أو استكشاف ICT Mentorship مع مارك، باختيارك." : "You’ve completed this track. Keep learning for free, or explore ICT Mentorship with Mark."}</p> : null}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {courseComplete ? <Link href="/learn-with-mark" className={buttonVariants({ variant: "secondary", className: "whitespace-normal text-center" })}>
                  {isAr ? "تعرّف على كورس ICT والمرافقة" : "Explore the ICT Course & Support"}
                </Link> : null}
                {nextSlug ? (
                  <Link href={`/lessons/${nextSlug}`} className={buttonVariants()}>
                    {isAr ? "متابعة التعلم" : "Continue Learning"}
                  </Link>
                ) : null}
                <Button variant="secondary" onClick={() => setShowCelebration(false)}>
                  {isAr ? "إغلاق" : "Close"}
                </Button>
              </div>
            </div>
          </div>
      ) : null}

    </div>
  );
}
