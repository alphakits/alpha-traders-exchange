"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ArrowUpRight, Bookmark, BookOpen, Check, ChevronRight, Clock3, Play, Search, Sparkles } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getAllLessonProgress, getLearningMeta, type LessonProgressState } from "@/lib/learning-progress";
import { academyLessonTitle, getAcademyJourney, type JourneyLesson } from "@/lib/academy-journey";
import styles from "./academy-experience.module.css";

type StudyCourse = { id: string; title: string; titleAr: string; lessons: JourneyLesson[] };

export function AcademyStudentHub({ courses }: { courses: StudyCourse[] }) {
  const isAr = useLocale() === "ar";
  const [progress, setProgress] = useState<LessonProgressState[]>([]);
  const [lastLessonId, setLastLessonId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "saved">("all");
  useEffect(() => {
    const refresh = () => {
      setProgress(getAllLessonProgress());
      try { setLastLessonId(getLearningMeta().lastLessonId); } catch { setLastLessonId(null); }
      setReady(true);
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("pageshow", refresh); };
  }, []);
  const lessons = courses.flatMap((course) => course.lessons);
  const journey = getAcademyJourney(lessons, progress, lastLessonId);
  const next = journey.nextLesson;
  const nextProgress = next ? journey.progressById.get(next.id) : undefined;
  const hasStarted = Boolean(lastLessonId || progress.length);
  const term = query.trim().toLocaleLowerCase();
  const visible = lessons.filter((lesson) =>
    (filter === "all" || journey.progressById.get(lesson.id)?.bookmarked) &&
    `${lesson.title} ${lesson.titleAr} ${lesson.description} ${lesson.descriptionAr}`.toLocaleLowerCase().includes(term));
  const totalMinutes = lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
  const title = (lesson: JourneyLesson) => academyLessonTitle(isAr ? lesson.titleAr : lesson.title);
  const action = journey.allComplete ? (isAr ? "راجع الدروس" : "Review lessons") : hasStarted ? (isAr ? "تابع تعلّمك" : "Continue learning") : (isAr ? "ابدأ التعلّم" : "Start learning");

  return <section data-testid="academy-student-hub" className={`section-container page-shell ${styles.hub}`} dir={isAr ? "rtl" : "ltr"}>
    <div className={styles.topline}>
      <p className={styles.eyebrow}><span className={styles.brand}>Alpha Traders</span> / {isAr ? "الأكاديمية" : "ACADEMY"}</p>
      <span className={styles.freeBadge}><span />{isAr ? "مجانية للجميع" : "Free for everyone"}</span>
    </div>
    <header className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>{isAr ? "تعلّم. طبّق. تقدّم." : "LEARN. PRACTISE. PROGRESS."}</p>
        <h1>{isAr ? <>خطوتك التالية.<br /><em>تبدأ من هنا.</em></> : <>Your next level.<br /><em>Starts here.</em></>}</h1>
        <p className={styles.lead}>{isAr ? "افهم الشارت، درسًا بعد درس. تعلّم مع مارك وطبّق على أمثلة حقيقية." : "Build your chart-reading skills, one lesson at a time. Learn with Mark. Practise with real examples."}</p>
        {next ? <Link href={`/lessons/${next.slug}`} className={styles.primary} aria-busy={!ready}><Play size={17} fill="currentColor" />{ready ? action : isAr ? "جاري التحميل…" : "Loading…"}<ChevronRight size={18} className={styles.directional} /></Link> : <p>{isAr ? "ستتوفر الدروس قريبًا." : "Lessons will be available soon."}</p>}
        <p className={styles.heroMeta}>{lessons.length} {isAr ? "دروس" : "lessons"}<span>·</span>{Math.floor(totalMinutes / 60)}{isAr ? "س" : "h"} {totalMinutes % 60}{isAr ? "د" : "m"}<span>·</span>{isAr ? "تعلّم على راحتك" : "At your own pace"}</p>
      </div>
      {next ? <Link href={`/lessons/${next.slug}`} className={styles.spotlight} aria-label={`${action}: ${title(next)}`}>
        <div className={styles.spotlightArt}>
          <Image src={next.thumbnail || "/images/course-market-structure.jpg"} alt="" fill sizes="(max-width: 800px) 100vw, 500px" className={styles.cover} priority />
          <span className={styles.artLabel}>{isAr ? "مع مارك" : "WITH MARK"}</span>
          <span className={styles.playCircle}><Play size={24} fill="currentColor" /></span>
          <span className={styles.duration}><Clock3 size={12} />{next.durationMinutes} {isAr ? "دقيقة" : "min"}</span>
        </div>
        <div className={styles.spotlightInfo}>
          <div><p className={styles.eyebrow}>{journey.allComplete ? (isAr ? "وقت المراجعة" : "KEEP IT SHARP") : hasStarted ? (isAr ? "تابع من حيث توقفت" : "PICK UP WHERE YOU LEFT OFF") : (isAr ? "ابدأ من هنا" : "YOUR STARTING POINT")}</p><h2>{title(next)}</h2></div>
          <ArrowUpRight size={22} />
        </div>
        {nextProgress?.videoPositionSeconds && !journey.allComplete ? <p className={styles.resumeTime}>{isAr ? "متابعة من" : "Resume at"} {Math.floor(nextProgress.videoPositionSeconds / 60)}:{String(Math.floor(nextProgress.videoPositionSeconds % 60)).padStart(2, "0")}</p> : null}
      </Link> : null}
    </header>
    <div className={styles.progressStrip}>
      <div className={styles.progressIcon}><BookOpen size={20} /></div>
      <div className={styles.progressCopy}><strong>{journey.allComplete ? (isAr ? "أكملت المسار. أحسنت!" : "Path complete. Well done!") : (isAr ? "كل درس خطوة للأمام" : "Every lesson is a step forward")}</strong><span>{journey.completed} / {lessons.length} {isAr ? "مكتمل" : "completed"} · {isAr ? "التقدم محفوظ في هذا المتصفح" : "Progress saved in this browser"}</span></div>
      <div className={styles.meter} role="progressbar" aria-label={isAr ? "تقدم التعلّم" : "Learning progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={journey.percent}><span style={{width:`${journey.percent}%`}} /></div><strong className={styles.percent}>{journey.percent}%</strong>
    </div>
    <div className={styles.bodyGrid}>
      <section className={styles.path} id="courses-overview" aria-labelledby="academy-path-title">
        <div className={styles.pathHeader}><div><p className={styles.eyebrow}>{isAr ? "خطوة بخطوة" : "ONE CLEAR PATH"}</p><h2 id="academy-path-title">{isAr ? "مسارك التعليمي" : "Your learning path"}</h2></div><span className={styles.pathCount}>{lessons.length} {isAr ? "دروس" : "lessons"}</span></div>
        <div className={styles.pathTools}>
          <label className={styles.search}><Search size={17} /><input value={query} onChange={e=>setQuery(e.target.value)} aria-label={isAr ? "ابحث في الدروس" : "Search lessons"} placeholder={isAr ? "ابحث عن موضوع…" : "Find a topic…"} /></label>
          <button className={styles.savedFilter} type="button" aria-pressed={filter === "saved"} onClick={()=>setFilter(filter === "all" ? "saved" : "all")}><Bookmark size={16} />{isAr ? "المحفوظة" : "Saved"}</button>
        </div>
        <ol className={styles.lessonList}>
          {visible.map(lesson => {
            const done=journey.isCompleted(lesson); const current=next?.id===lesson.id && !journey.allComplete;
            return <li key={lesson.id}><Link href={`/lessons/${lesson.slug}`} className={`${styles.lessonRow} ${current ? styles.currentLesson : ""}`}>
              <span className={`${styles.lessonNumber} ${done ? styles.completed : ""}`}>{done ? <Check size={18} /> : String(lessons.findIndex(item=>item.id===lesson.id)+1).padStart(2,"0")}</span>
              <div className={styles.lessonText}><div className={styles.lessonTitle}><h3>{title(lesson)}</h3>{current ? <span className={styles.currentBadge}>{hasStarted ? (isAr ? "التالي" : "Up next") : (isAr ? "ابدأ هنا" : "Start here")}</span> : null}</div><p>{isAr ? lesson.descriptionAr : lesson.description}</p><span className={styles.rowMeta}>{lesson.durationMinutes} {isAr ? "دقيقة" : "min"} · {done ? (isAr ? "مكتمل" : "Completed") : (isAr ? "فيديو · تطبيق · اختبار" : "Video · Practice · Quiz")}</span></div>
              <span className={styles.rowPlay}>{done ? <Check size={17} /> : <Play size={16} />}</span>
            </Link></li>;
          })}
        </ol>
        {!visible.length ? <div className={styles.empty}><Search size={25} /><h3>{isAr ? "لا توجد دروس هنا بعد" : "No lessons here yet"}</h3><p>{filter === "saved" ? (isAr ? "احفظ درسًا من صفحته للرجوع إليه بسهولة." : "Bookmark a lesson while watching to find it here.") : (isAr ? "جرّب موضوعًا آخر." : "Try another topic.")}</p><button onClick={()=>{setQuery("");setFilter("all");}} type="button">{isAr ? "عرض كل الدروس" : "Show all lessons"}</button></div> : null}
      </section>
      <aside className={styles.studyAside}>
        <section className={styles.studyCard}><span className={styles.goldIcon}><Sparkles size={21} /></span><p className={styles.eyebrow}>{isAr ? "جلسة بسيطة وفعّالة" : "MAKE IT A GOOD SESSION"}</p><h2>{isAr ? "شاهد. جرّب. ثبّت المعلومة." : "Watch. Try. Make it stick."}</h2><ol className={styles.sessionSteps}><li><span>01</span><div><strong>{isAr ? "شاهد فكرة واحدة" : "Watch one concept"}</strong><p>{isAr ? "خُذ وقتك. أوقف الفيديو عند الحاجة." : "Take your time. Pause when you need."}</p></div></li><li><span>02</span><div><strong>{isAr ? "طبّق على الشارت" : "Try it on a chart"}</strong><p>{isAr ? "استخدم أمثلة الدرس وملف العمل." : "Use the examples and workbook."}</p></div></li><li><span>03</span><div><strong>{isAr ? "دوّن ملاحظة واختبر فهمك" : "Write a note. Check yourself."}</strong><p>{isAr ? "احفظ ما تعلّمته واختبر فهمك." : "Save the takeaway and try the quiz."}</p></div></li></ol></section>
        <div className={styles.quietCard}><BookOpen size={19} /><div><strong>{isAr ? "مساحتك للتعلّم" : "Your space to learn"}</strong><p>{isAr ? "ملاحظاتك، دروسك المحفوظة وتقدمك، في مكان واحد." : "Your notes, saved lessons, and progress. All in one place."}</p><Link href="/academy/dashboard">{isAr ? "عرض تقدّمي" : "View my progress"}<ArrowUpRight size={14} /></Link></div></div>
      </aside>
    </div>
  </section>;
}
