"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowRight, Brain, CheckCircle2, Coins, Play, PlayCircle, ShieldCheck, Target } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { courseSource } from "@/data/course-source";
import { courses, lessons } from "@/lib/content";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage({ isAuthenticated }: { isAuthenticated: boolean }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const academyHref = isAuthenticated ? "/academy" : `/login?redirectTo=${encodeURIComponent(`/${locale}/academy`)}`;
  const exchangeHref = isAuthenticated ? "/usdt-exchange" : `/login?redirectTo=${encodeURIComponent(`/${locale}/usdt-exchange`)}`;
  const latestLessons = lessons.slice(0, 3);
  const featuredLessons = lessons.slice(0, 2);
  const primaryCourse = courses[0];
  const primaryCourseValue = primaryCourse ? courseSource.courseBySlug[primaryCourse.slug as keyof typeof courseSource.courseBySlug] : null;
  const learningCards = courseSource.homepage.learnCards;
  const visualShowcase = courseSource.homepage.visualShowcase;
  const { scrollY } = useScroll();
  const parallaxY = useTransform(scrollY, [0, 700], [0, 28]);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const getLessonIcon = (slug: string) => {
    if (slug.includes("support")) return <ShieldCheck className="h-4 w-4 text-[#C9A227]" />;
    if (slug.includes("chart-patterns")) return <Brain className="h-4 w-4 text-[#C9A227]" />;
    if (slug.includes("full-strategy")) return <Target className="h-4 w-4 text-[#C9A227]" />;
    if (slug.includes("trendline")) return <ArrowRight className="h-4 w-4 text-[#C9A227]" />;
    return <PlayCircle className="h-4 w-4 text-[#C9A227]" />;
  };

  return (
    <div className="space-y-16 py-10 md:space-y-20 md:py-14">
      <section className="section-container">
        <div className="relative min-h-[430px] overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a] md:min-h-[520px]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute inset-0"
            style={isDesktop ? { y: parallaxY } : undefined}
          >
            <Image
              src="/images/hero/hero-trading-office.png"
              alt="Alpha Traders cinematic workspace"
              fill
              priority
              quality={100}
              sizes="(min-width: 1280px) 1280px, 100vw"
              className="object-cover object-[30%_center] md:object-center"
            />
          </motion.div>
          <div className="pointer-events-none absolute inset-0 bg-[rgba(0,0,0,0.5)]" />
          <div className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_left_center,rgba(0,0,0,0.12),rgba(0,0,0,0.48),rgba(0,0,0,0.72))]" />
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.38)]" />
          <div className="pointer-events-none absolute inset-0 hidden md:block">
            {[12, 30, 48, 64, 80].map((left, index) => (
              <motion.span
                key={left}
                className="absolute h-1 w-1 rounded-full bg-[#d4af37]/40"
                style={{ left: `${left}%`, top: `${26 + index * 10}%` }}
                animate={{ opacity: [0.12, 0.35, 0.12], y: [0, -8, 0] }}
                transition={{ duration: 4 + index * 0.45, repeat: Infinity, ease: "easeInOut", delay: index * 0.3 }}
              />
            ))}
          </div>
          <div className="relative z-10 grid min-h-[430px] content-start gap-8 p-7 md:min-h-[520px] md:grid-cols-2 md:p-12">
            <div className="hidden md:block" />
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={`max-w-3xl self-start pt-4 md:pt-8 ${isRtl ? "md:ms-auto md:text-right" : "md:me-auto md:text-left"}`}
            >
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-[#C9A227]">
                <Image
                  src="/images/brand/alpha-traders-logo.png"
                  alt="Alpha Traders logo"
                  width={28}
                  height={28}
                  style={{ width: 28, height: 28 }}
                  className="rounded-md object-contain shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
                  priority
                />
                <span>{t("badge")}</span>
              </div>
              <h1 className="text-4xl font-semibold leading-tight md:text-6xl md:leading-[1.08]">
                {t("headlineLine1")}
                <br />
                {t("headlineLine2")}
              </h1>
              <p className={`mt-4 max-w-xl text-base leading-relaxed text-white/85 md:text-lg ${isRtl ? "md:ms-auto" : ""}`}>{t("subheadline")}</p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.45, delay: 0.2, ease: "easeOut" }}
                className={`mt-8 flex flex-wrap gap-3 ${isRtl ? "md:justify-end" : "md:justify-start"}`}
              >
                <Link href="/academy">
                  <Button className="gap-2">
                    {t("startLearning")}
                    {isRtl ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                  </Button>
                </Link>
                <Link
                  href="/founder#founder-video"
                  aria-label={isRtl ? "شاهد فيديو مؤسس Alpha Traders" : "Watch the Alpha Traders founder video"}
                  className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-gradient-to-b from-[#FF3B30] via-[#E53935] to-[#C62828] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(198,40,40,0.34)] transition-all duration-300 hover:-translate-y-0.5 hover:from-[#FF5247] hover:via-[#F0443E] hover:to-[#D32F2F] hover:shadow-[0_18px_34px_rgba(229,57,53,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 focus-visible:ring-offset-2 focus-visible:ring-offset-black md:min-h-[48px] md:px-6 md:text-base"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D32F2F] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_14px_rgba(0,0,0,0.26)]">
                    <Play className="ms-0.5 h-4.5 w-4.5 fill-white text-white" aria-hidden="true" />
                  </span>
                  <span>{t("watchIntro")}</span>
                </Link>
                <Link
                  href="/usdt-exchange"
                  className="group relative inline-flex h-11 items-center justify-center overflow-hidden rounded-full border border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 px-6 text-sm font-semibold text-white shadow-[0_10px_26px_rgba(36,121,255,0.34)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(36,121,255,0.5)]"
                >
                  <span className="relative z-10">{t("exploreExchange")}</span>
                  <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="section-container">
        <Card className="overflow-hidden border-white/10 bg-[#0A0A0A]/92">
          <CardContent className="p-6 md:p-8">
            <div className={`max-w-3xl ${isRtl ? "md:ms-auto md:text-right" : "md:text-left"}`}>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C9A227]">{isRtl ? "اختر المسار" : "Choose your path"}</p>
              <h2 className="mt-2 text-2xl font-semibold md:text-4xl">
                {isRtl ? "ما الذي تبحث عنه اليوم؟" : "What are you here for today?"}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#9CA3AF] md:text-base">
                {isRtl
                  ? "سواء كنت تريد تعلم التداول باحتراف أو شراء وبيع USDT بأمان، Alpha Traders يقدم لك المسار المناسب."
                  : "Whether you want to learn trading or buy and sell USDT safely, Alpha Traders gives you the right path."}
              </p>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.35, ease: "easeOut" }}>
                <Card className="h-full border-white/10 bg-[#0B0B0B]/95 transition duration-300 hover:-translate-y-1 hover:border-[#C9A227]/30 hover:shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
                  <CardHeader>
                    <CardDescription className="text-[#C9A227]">🎓 Alpha Academy</CardDescription>
                    <CardTitle>{isRtl ? "تعلّم قبل أن تتداول" : "Learn before you trade."}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm leading-7 text-[#9CA3AF]">
                      {isRtl
                        ? "أتقن التداول عبر دروس منظمة تغطي السيكولوجية، هيكل السوق، إدارة المخاطر، والتعليم العملي."
                        : "Master trading through structured lessons, psychology, market structure, risk management, and practical education."}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-[#D1D5DB]">
                      {["Beginner Friendly", "Advanced Lessons", "Community", "Professional Education"].map((item) => (
                        <span key={item} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                          {item}
                        </span>
                      ))}
                    </div>
                    <Link href={academyHref}>
                      <Button className="gap-2">
                        Start Learning
                        {isRtl ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.35, delay: 0.06, ease: "easeOut" }}>
                <Card className="h-full border-[#6CAEFF]/30 bg-[#0B0B0B]/95 transition duration-300 hover:-translate-y-1 hover:border-[#6CAEFF]/50 hover:shadow-[0_22px_60px_rgba(17,87,188,0.25)]">
                  <CardHeader>
                    <CardDescription className="text-[#93C5FD]">💵 Alpha Exchange</CardDescription>
                    <CardTitle>{isRtl ? "شراء وبيع USDT مع محترفين موثوقين" : "Buy and Sell USDT with Verified Professionals."}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm leading-7 text-[#9CA3AF]">
                      {isRtl
                        ? "تداول USDT من خلال بائعين موثوقين تمت مراجعتهم من Alpha Exchange."
                        : "Trade USDT through trusted sellers reviewed by Alpha Exchange."}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-[#D1D5DB]">
                      {["Verified Sellers", "Trust Score", "Reviews", "Fast Transactions", "Owner Approved Marketplace"].map((item) => (
                        <span key={item} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                          {item}
                        </span>
                      ))}
                    </div>
                    <Link href={exchangeHref}>
                      <Button className="group relative overflow-hidden border border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 font-semibold text-white shadow-[0_10px_26px_rgba(36,121,255,0.34)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(36,121,255,0.5)]">
                        <span className="relative z-10">Enter Exchange</span>
                        <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isRtl ? "مسار المشتري" : "Buyer Journey"}</p>
                <p className="mt-2 text-xs leading-6 text-[#D1D5DB]">
                  {isRtl
                    ? "تسجيل دخول ← مقارنة البائعين ← Trust Score + Reviews ← طلب الصفقة ← إكمال الصفقة ← تقييم"
                    : "Register/Login -> Compare sellers -> Trust Score + Reviews -> Submit trade request -> Trade lifecycle -> Leave review"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isRtl ? "مسار البائع" : "Seller Journey"}</p>
                <p className="mt-2 text-xs leading-6 text-[#D1D5DB]">
                  {isRtl
                    ? "تسجيل ← طلب اعتماد بائع ← موافقة المالك ← إنشاء عرض ← مراجعة المالك ← استقبال الطلبات ← نمو Trust Score"
                    : "Register -> Seller application -> Owner approval -> Create listing -> Owner review -> Receive requests -> Grow trust score"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isRtl ? "تشغيل المالك" : "Owner Operations"}</p>
                <p className="mt-2 text-xs leading-6 text-[#D1D5DB]">
                  {isRtl
                    ? "كل صفقة مكتملة تحدث تلقائيًا: الحجم، العمولة، إحصاءات البائع، Trust Score، والتحليلات."
                    : "Every completed trade automatically updates volume, commission, seller statistics, trust score, and marketplace analytics."}
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#C9A227]">
                  <Coins className="h-3.5 w-3.5" />
                  {isRtl ? "العمولة = قيمة الصفقة × نسبة العمولة" : "Commission = Trade Amount x Seller Commission %"}
                </p>
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-3 py-1 text-xs text-[#C9A227]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isRtl
                ? "تعلم أو تداول بأمان: Alpha Traders يغطي المسارين باحترافية."
                : "Learn or trade safely: Alpha Traders covers both experiences with premium clarity."}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="section-container">
        <div className={`mb-6 max-w-3xl ${isRtl ? "md:ms-auto md:text-right" : "md:text-left"}`}>
          <h2 className="text-2xl font-semibold md:text-3xl">
            {locale === "ar" ? courseSource.homepage.learnTitleAr : courseSource.homepage.learnTitle}
          </h2>
          <p className="mt-3 text-sm leading-7 text-[#9CA3AF] md:text-base">
            {locale === "ar" ? courseSource.homepage.learnSubtitleAr : courseSource.homepage.learnSubtitle}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {learningCards.map((card, index) => {
            const stageLabel = locale === "ar" ? `المرحلة ${["الأولى", "الثانية", "الثالثة", "الرابعة"][index]}` : `Stage ${index + 1}`;
            const icon =
              index === 1 ? (
                <ShieldCheck className="h-5 w-5" />
              ) : index === 2 ? (
                <Brain className="h-5 w-5" />
              ) : (
                <Target className="h-5 w-5" />
              );

            return (
              <div key={card.title} className="flex flex-col">
                <Link href={card.href} className="group h-full">
                  <Card className="h-full overflow-hidden border-white/10 bg-[#0B0B0B]/90 transition duration-300 group-hover:-translate-y-1 group-hover:border-[#C9A227]/30 group-hover:shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
                    {card.visualSrc ? (
                      <div className="relative aspect-[16/10] overflow-hidden border-b border-white/10 bg-black/30">
                        <Image
                          src={card.visualSrc}
                          alt={locale === "ar" ? card.visualTitleAr : card.visualTitle}
                          fill
                          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
                          className="object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/35 to-transparent" />
                      </div>
                    ) : (
                      <div className={`flex items-center justify-between border-b border-white/10 px-6 py-5 ${isRtl ? "flex-row-reverse" : ""}`}>
                        <span className="text-xs uppercase tracking-[0.24em] text-[#C9A227]">Alpha Traders</span>
                        <span className="rounded-full border border-[#C9A227]/20 bg-[#C9A227]/10 p-2 text-[#C9A227]">{icon}</span>
                      </div>
                    )}
                    <CardHeader className="space-y-3">
                      <CardDescription className="text-[#C9A227]">{stageLabel}</CardDescription>
                      <CardTitle className="text-xl">{locale === "ar" ? card.titleAr : card.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm leading-7 text-[#9CA3AF]">{locale === "ar" ? card.bodyAr : card.body}</p>
                      <div className="flex flex-wrap gap-2">
                        {(locale === "ar" ? card.topicsAr : card.topics).map((topic) => (
                          <span key={topic} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-[#D1D5DB]">
                            {topic}
                          </span>
                        ))}
                      </div>
                      <span className="inline-flex text-sm text-[#C9A227] transition group-hover:translate-x-0.5 group-hover:underline">
                        {locale === "ar" ? "استكشف هذا المسار" : "Explore this path"}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
                {index < learningCards.length - 1 ? (
                  <div className="flex justify-center py-3 text-[#C9A227]/70 xl:hidden">
                    <ArrowDown className="h-5 w-5" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className={`mt-8 flex flex-col items-start gap-4 rounded-3xl border border-white/10 bg-[#090909]/80 p-6 ${isRtl ? "md:items-end md:text-right" : "md:text-left"}`}>
          <p className="text-sm leading-7 text-[#D1D5DB]">
            {locale === "ar"
              ? "ابدأ رحلتك التعليمية خطوة بخطوة داخل Alpha Traders Academy"
              : "Start your learning journey step by step inside Alpha Traders Academy."}
          </p>
          <Link href="/academy">
            <Button>{locale === "ar" ? "ابدأ التعلم" : "Start Learning"}</Button>
          </Link>
        </div>
      </section>

      <section className="section-container">
        <div className={`mb-6 max-w-3xl ${isRtl ? "md:ms-auto md:text-right" : "md:text-left"}`}>
          <h2 className="text-2xl font-semibold md:text-3xl">
            {locale === "ar" ? courseSource.homepage.visualCurriculumTitleAr : courseSource.homepage.visualCurriculumTitle}
          </h2>
          <p className="mt-3 text-sm leading-7 text-[#9CA3AF] md:text-base">
            {locale === "ar" ? courseSource.homepage.visualCurriculumBodyAr : courseSource.homepage.visualCurriculumBody}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {visualShowcase.map((item, index) => (
            <motion.div
              key={item.src}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: index * 0.08, ease: "easeOut" }}
            >
              <Link href={item.href} className="group block h-full">
                <Card className="h-full overflow-hidden border-white/10 bg-[#0B0B0B]/90 transition duration-300 group-hover:-translate-y-1 group-hover:border-[#C9A227]/30 group-hover:shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
                  <div className="relative aspect-[16/10] overflow-hidden border-b border-white/10 bg-black/30">
                    <Image
                      src={item.src}
                      alt={locale === "ar" ? item.titleAr : item.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/30 to-transparent" />
                  </div>
                  <CardHeader>
                    <CardTitle>{locale === "ar" ? item.titleAr : item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-7 text-[#9CA3AF]">{locale === "ar" ? item.captionAr : item.caption}</p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="section-container">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold md:text-3xl">{locale === "ar" ? "أحدث الدروس" : "Latest Lessons"}</h2>
          <Link href="/academy" className="text-sm text-[#C9A227] hover:underline">
            {locale === "ar" ? "عرض جميع المسارات" : "View all tracks"}
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {latestLessons.map((lesson) => (
            <Card key={lesson.id} className="h-full">
              <CardHeader>
                <CardDescription>{lesson.durationMinutes} min</CardDescription>
                <CardTitle>
                  <span className={`inline-flex items-center gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
                    {getLessonIcon(lesson.slug)}
                    <span>{locale === "ar" ? lesson.titleAr : lesson.title}</span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#9CA3AF]">{locale === "ar" ? lesson.descriptionAr : lesson.description}</p>
                <Link href={`/lessons/${lesson.slug}`} className="mt-4 inline-flex text-sm text-[#C9A227] hover:underline">
                  {locale === "ar" ? "ابدأ الدرس" : "Start lesson"}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="section-container grid gap-4 md:grid-cols-2">
        {featuredLessons.map((lesson) => (
          <Card key={lesson.id} className="h-full">
            <CardHeader>
              <CardDescription>{locale === "ar" ? "درس مميز" : "Featured Lesson"}</CardDescription>
              <CardTitle>
                <span className={`inline-flex items-center gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
                  {getLessonIcon(lesson.slug)}
                  <span>{locale === "ar" ? lesson.titleAr : lesson.title}</span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[#9CA3AF]">{locale === "ar" ? lesson.summaryAr : lesson.summary}</p>
              <Link href={`/lessons/${lesson.slug}`} className="mt-3 inline-flex text-sm text-[#C9A227] hover:underline">
                {locale === "ar" ? "عرض الدرس" : "View lesson"}
              </Link>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="section-container">
        <Card className="p-2">
          <CardContent className="grid gap-6 p-6 md:grid-cols-2 md:items-center">
            <div>
              <h3 className="text-2xl font-semibold">{locale === "ar" ? "ابدأ بالمسار الحقيقي" : "Start With the Real Course Path"}</h3>
              <p className="mt-3 text-sm text-[#9CA3AF]">
                {primaryCourseValue
                  ? locale === "ar"
                    ? primaryCourseValue.startWhyAr
                    : primaryCourseValue.startWhy
                  : locale === "ar"
                    ? "المسار التعليمي مبني على التسلسل الحقيقي للدورة."
                    : "The learning path follows the real order of the course."}
              </p>
            </div>
            <div className="flex justify-start md:justify-end">
              <Link href={primaryCourse ? `/academy/${primaryCourse.slug}` : "/academy"}>
                <Button>{locale === "ar" ? "ابدأ المسار" : "Open the Track"}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="section-container grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {courses.map((course) => (
          <Card key={course.id} className="h-full">
            <CardHeader>
              <CardDescription>{course.level.toUpperCase()}</CardDescription>
              <CardTitle>{locale === "ar" ? course.titleAr : course.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[#9CA3AF]">{locale === "ar" ? course.summaryAr : course.summary}</p>
              {courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug] ? (
                <div className="space-y-1 text-xs text-[#D1D5DB]">
                  {(locale === "ar"
                    ? courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug].valueAr
                    : courseSource.courseBySlug[course.slug as keyof typeof courseSource.courseBySlug].value
                  ).slice(0, 3).map((item) => (
                    <p key={item}>• {item}</p>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
