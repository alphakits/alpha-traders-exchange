"use client";

import { useEffect, useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { BookOpen, Compass, Crown, Gem, Target, TrendingUp } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { courseSource } from "@/data/course-source";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const VIDEO_URL = "/files/founder/alpha-traders-founder-introduction.mp4";

const highlights = [
  { titleAr: "من أنا؟", title: "Who am I?", icon: Crown },
  { titleAr: "كيف بدأت في التداول؟", title: "How I started trading", icon: TrendingUp },
  { titleAr: "لماذا أنشأت Alpha Traders؟", title: "Why I built Alpha Traders", icon: Compass },
  { titleAr: "لماذا المحتوى مجاني؟", title: "Why the content is free", icon: Gem },
  { titleAr: "ماذا أتوقع منك كطالب؟", title: "What I expect from you", icon: Target },
];

const timeline = [
  { titleAr: "بداية رحلتي", title: "Journey Began" },
  { titleAr: "تعلم التداول", title: "Learning Trading" },
  { titleAr: "بناء الخبرة", title: "Building Experience" },
  { titleAr: "إنشاء Alpha Traders", title: "Creating Alpha Traders" },
  { titleAr: "إطلاق الأكاديمية المجانية", title: "Launching the Free Academy" },
];

export function FounderPage() {
  const locale = useLocale();
  const isAr = locale === "ar";
  const { scrollYProgress } = useScroll();
  const timelineProgress = useTransform(scrollYProgress, [0.2, 0.8], [0, 1]);
  const videoSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const focusFounderVideo = () => {
      if (window.location.hash !== "#founder-video" || !videoSectionRef.current) {
        return;
      }

      window.requestAnimationFrame(() => {
        videoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => videoSectionRef.current?.focus(), 350);
      });
    };

    focusFounderVideo();
    window.addEventListener("hashchange", focusFounderVideo);
    return () => window.removeEventListener("hashchange", focusFounderVideo);
  }, []);

  return (
    <div className="section-container page-shell space-y-14">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 md:p-12">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(circle_at_20%_20%,#C9A227_0,transparent_40%)]" />
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: "easeOut" }} className="relative max-w-4xl">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs tracking-[0.2em] text-[#C9A227]">
            <BookOpen className="h-3.5 w-3.5" />
            {isAr ? "Founder Introduction" : "Founder Introduction"}
          </p>
          <h1 className="text-4xl font-semibold leading-tight md:text-6xl">{isAr ? "تعرف على مؤسس Alpha Traders" : "Meet the Founder of Alpha Traders"}</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#9CA3AF] md:text-lg">
            {isAr
              ? "قبل أن تبدأ رحلتك التعليمية، أود أن أشاركك قصتي، ولماذا أنشأت Alpha Traders، ولماذا قررت أن أجعل هذا المحتوى مجاناً للجميع."
              : "Before your learning journey starts, I want to share my story, why Alpha Traders was built, and why this content is free for everyone."}
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[#D1D5DB]">{isAr ? courseSource.founder.philosophyAr : courseSource.founder.philosophy}</p>
        </motion.div>
      </section>

      <section id="founder-video" ref={videoSectionRef} tabIndex={-1} className="scroll-mt-24 space-y-4 outline-none">
        <Card className="mx-auto max-w-5xl overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video w-full">
              <video
                src={VIDEO_URL}
                title="Founder introduction video"
                className="h-full w-full bg-black"
                controls
                preload="metadata"
                playsInline
              >
                <track kind="captions" />
                {isAr
                  ? "متصفحك لا يدعم تشغيل الفيديو."
                  : "Your browser does not support the founder introduction video."}
              </video>
            </div>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-[#C9A227]">9:02</p>
      </section>

      <section>
        <div className="mb-5">
          <h2 className="text-3xl font-semibold">{isAr ? "ماذا ستتعلم في هذا الفيديو؟" : "What will you learn in this video?"}</h2>
          <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "نقاط أساسية قبل دخولك المسار التعليمي." : "Key points before entering the learning path."}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {highlights.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.div key={item.titleAr} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.45, delay: index * 0.06 }}>
                <Card className="h-full">
                  <CardHeader>
                    <CardDescription className="inline-flex items-center gap-2 text-[#C9A227]">
                      <Icon className="h-4 w-4" />
                      {isAr ? "محور" : "Topic"}
                    </CardDescription>
                    <CardTitle>{isAr ? item.titleAr : item.title}</CardTitle>
                  </CardHeader>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-black/25 p-8 text-center md:p-12">
        <p className="text-2xl font-medium leading-relaxed text-white md:text-4xl">
          {isAr
            ? "رسالتي ليست بيع الأحلام...\nرسالتي هي تعليم التداول بطريقة صحيحة ومنظمة لكل شخص يريد أن يتعلم."
            : "My mission is not selling dreams...\nMy mission is teaching trading correctly and systematically to anyone serious about learning."}
        </p>
        <p className="mx-auto mt-5 max-w-3xl text-sm leading-7 text-[#9CA3AF]">{isAr ? courseSource.founder.freeAr : courseSource.founder.free}</p>
      </section>

      <section>
        <h2 className="text-3xl font-semibold">{isAr ? "رحلتي" : "My Journey"}</h2>
        <div className="relative mt-8 ps-6">
          <motion.div style={{ scaleY: timelineProgress }} className="absolute inset-y-0 start-1.5 w-px origin-top bg-[#C9A227]" />
          <div className="space-y-5">
            {timeline.map((step, index) => (
              <motion.div
                key={step.titleAr}
                initial={{ opacity: 0, x: isAr ? 16 : -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={{ duration: 0.45, delay: index * 0.05 }}
                className="relative"
              >
                <span className="absolute -start-[1.05rem] top-5 h-3 w-3 rounded-full border border-[#C9A227] bg-[#050505]" />
                <Card>
                  <CardContent className="pt-6">
                    <p className="font-medium">{isAr ? step.titleAr : step.title}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-5">
          <h2 className="text-3xl font-semibold">{isAr ? "ماذا أتوقع منك كطالب" : "What I Expect From You as a Student"}</h2>
          <p className="mt-2 text-sm text-[#9CA3AF]">
            {isAr ? "هذه التوقعات نابعة من طريقة بناء الدورة نفسها: ترتيب، تطبيق، وانضباط." : "These expectations come directly from how the course itself is built: sequence, application, and discipline."}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {(isAr ? courseSource.founder.expectationsAr : courseSource.founder.expectations).map((item) => (
            <Card key={item}>
              <CardContent className="pt-6 text-sm text-[#D1D5DB]">{item}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#090909] p-8 text-center md:p-12">
        <h3 className="text-3xl font-semibold md:text-4xl">{isAr ? "هل أنت مستعد لبدء رحلتك؟" : "Ready to Start?"}</h3>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/academy">
            <Button>{isAr ? "ابدأ التعلم" : "Start Learning"}</Button>
          </Link>
          <Link href="/">
            <Button variant="secondary">{isAr ? "العودة للرئيسية" : "Back to Home"}</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
