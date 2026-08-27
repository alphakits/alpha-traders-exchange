import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { courseSource } from "@/data/course-source";
import { courses, getLessonsByCourse } from "@/lib/content";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { AcademyRoadmap } from "@/components/academy/academy-roadmap";
import { formatAcademyLevel } from "@/lib/academy-localization";

export async function generateMetadata() {
  const locale = await getLocale();
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الأكاديمية" : "Academy",
    description: locale === "ar" ? "مسارات تعليمية منظمة حسب المستوى." : "Structured academy tracks by level.",
    path: "/academy",
  });
}

export default async function AcademyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getLocale();
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/academy`);
  }
  const isAr = locale === "ar";

  return (
    <section className="section-container page-shell">
      <div className="mb-8">
        <h1 className="page-title">{isAr ? "الأكاديمية" : "Academy"}</h1>
        <p className="page-subtitle">
          {isAr
            ? "الأكاديمية مبنية من مواد الدورة نفسها: تبدأ بالشموع، ثم النماذج، ثم المستويات، ثم الترندلاين، ثم التطبيق الكامل."
            : "The academy is built from the course itself: candles first, then patterns, then levels, then trendline, then full strategy execution."}
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">{isAr ? "خارطة التعلم التفاعلية" : "Interactive Learning Roadmap"}</h2>
          <AcademyRoadmap />
          <Card className="border-[#6CAEFF]/30 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardDescription className="text-[#93C5FD]">{isAr ? "Alpha Exchange" : "Alpha Exchange"}</CardDescription>
              <CardTitle>{isAr ? "بعد التعلم: استخدم مسار السوق المنظم" : "After learning: use the structured marketplace flow"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[#9CA3AF]">
                {isAr
                  ? "عند إتقان أساسيات الأكاديمية، انتقل إلى Alpha Exchange لتطبيق منهجيتك مع بائعين موثوقين ونظام تقييم واضح."
                  : "Once you master academy fundamentals, move to Alpha Exchange to apply your strategy with approved sellers and a transparent trust system."}
              </p>
              <Link href="/usdt-exchange" className="text-sm text-[#6CAEFF] hover:underline">
                {isAr ? "الانتقال إلى Alpha Exchange" : "Go to Alpha Exchange"}
              </Link>
            </CardContent>
          </Card>
        </div>
        <div id="courses-overview" className="grid gap-4 scroll-mt-28">
          {!courses.length ? (
            <Card>
              <CardContent className="pt-6 text-sm text-[#9CA3AF]">
                {isAr ? "لا توجد مسارات متاحة حاليًا. تحقق مرة أخرى قريبًا." : "No learning tracks are available right now. Please check back soon."}
              </CardContent>
            </Card>
          ) : null}
          {courses.map((course) => {
            const lessonCount = getLessonsByCourse(course.id).length;
            return (
              <Card key={course.id} className="h-full hover:-translate-y-0.5">
                <CardHeader>
                  <CardDescription>{formatAcademyLevel(course.level, isAr ? "ar" : "en")}</CardDescription>
                  <CardTitle>{isAr ? course.titleAr : course.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-[#9CA3AF]">{isAr ? course.summaryAr : course.summary}</p>
                  {courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug] ? (
                    <div className="space-y-1 text-sm text-[#D1D5DB]">
                      {(isAr
                        ? courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug].valueAr
                        : courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug].value
                      ).slice(0, 4).map((item) => (
                        <p key={item}>• {item}</p>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-[#9CA3AF]">
                    {lessonCount} {isAr ? "درس" : "lessons"}
                  </p>
                  <Link href={`/academy/${course.slug}`} className="text-sm text-[#C9A227] hover:underline">
                    {isAr ? "الدخول إلى المسار" : "Open Track"}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
