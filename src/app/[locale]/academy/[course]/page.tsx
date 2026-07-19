import { notFound } from "next/navigation";
import { courseSource } from "@/data/course-source";
import { getCourseBySlug, getLessonsByCourse } from "@/lib/content";
import { buildCourseSchema, buildPageMetadata } from "@/lib/seo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; course: string }> }) {
  const { locale, course: slug } = await params;
  const course = getCourseBySlug(slug);
  if (!course) return {};
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? course.titleAr : course.title,
    description: locale === "ar" ? course.summaryAr : course.summary,
    path: `/academy/${course.slug}`,
  });
}

export default async function CoursePage({ params }: { params: Promise<{ locale: string; course: string }> }) {
  const { locale, course: slug } = await params;
  const isAr = locale === "ar";
  const course = getCourseBySlug(slug);
  if (!course) notFound();

  const lessons = getLessonsByCourse(course.id);
  const courseNarrative = courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug];
  const schema = buildCourseSchema({
    title: isAr ? course.titleAr : course.title,
    description: isAr ? course.summaryAr : course.summary,
    locale: locale as "ar" | "en",
  });

  return (
    <section className="section-container page-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-[#C9A227]">{course.level.toUpperCase()}</p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-4xl">{isAr ? course.titleAr : course.title}</h1>
        <p className="mt-3 text-[#9CA3AF]">{isAr ? course.summaryAr : course.summary}</p>
        {courseNarrative ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription>{isAr ? "ماذا ستتعلم" : "What you will learn"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
                {(isAr ? courseNarrative.valueAr : courseNarrative.value).map((item) => (
                  <p key={item}>• {item}</p>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>{isAr ? "لماذا تبدأ بهذا المسار" : "Why begin with this track"}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-[#9CA3AF]">
                {isAr ? courseNarrative.startWhyAr : courseNarrative.startWhy}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
      <div className="space-y-4">
        {lessons.length ? (
          lessons.map((lesson) => (
            <Card key={lesson.id} className="hover:-translate-y-0.5">
              <CardHeader>
                <CardDescription>
                  {lesson.durationMinutes} {isAr ? "دقيقة" : "minutes"}
                </CardDescription>
                <CardTitle>{isAr ? lesson.titleAr : lesson.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#9CA3AF]">{isAr ? lesson.descriptionAr : lesson.description}</p>
                <Link href={`/lessons/${lesson.slug}`} className="mt-3 inline-flex text-sm text-[#C9A227] hover:underline">
                  {isAr ? "الدخول للدرس" : "Enter Lesson"}
                </Link>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-[#9CA3AF]">{isAr ? "لا توجد دروس منشورة لهذا المسار بعد." : "No published lessons for this track yet."}</CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
