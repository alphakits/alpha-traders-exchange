"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { lessons, searchAcademyLessons } from "@/lib/content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function LessonsBrowser({ initialQuery = "" }: { initialQuery?: string }) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const [query, setQuery] = useState(initialQuery);

  const filtered = useMemo(() => searchAcademyLessons(query, locale as "ar" | "en"), [locale, query]);

  return (
    <section className="section-container page-shell">
      <h1 className="page-title">{isAr ? "الدروس" : "Lessons"}</h1>
      <p className="page-subtitle">
        {isAr
          ? "بحث شامل في أسماء الدروس، الوصف، الكلمات المفتاحية، والموارد."
          : "Global search across lesson names, descriptions, keywords, and resources."}
      </p>
      <div className="relative mt-6 max-w-xl">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
        <Input
          className="ps-9"
          aria-label={isAr ? "بحث الدروس" : "Search lessons"}
          placeholder={isAr ? "ابحث: هيكل السوق، مخاطر، سيولة..." : "Search: market structure, risk, liquidity..."}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card id="beginner-guides" className="scroll-mt-28 border-white/10 bg-[#0B0B0B]/90">
          <CardHeader>
            <CardTitle>{isAr ? "أدلة المبتدئين" : "Beginner Guides"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#9CA3AF]">{isAr ? "ابدأ بالأساسيات لبناء فهم متين للسوق." : "Start with the foundations to build strong market understanding."}</p>
            <Link href={`/lessons/candles-foundation`} className="mt-3 inline-flex text-sm text-[#C9A227] hover:underline">
              {isAr ? "فتح درس المبتدئين" : "Open beginner lesson"}
            </Link>
          </CardContent>
        </Card>
        <Card id="advanced-strategies" className="scroll-mt-28 border-white/10 bg-[#0B0B0B]/90">
          <CardHeader>
            <CardTitle>{isAr ? "استراتيجيات متقدمة" : "Advanced Strategies"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#9CA3AF]">{isAr ? "توسّع في قراءة الاتجاهات والتخطيط متعدد الأطر الزمنية." : "Go deeper into trend structure and multi-timeframe planning."}</p>
            <Link href={`/lessons/full-strategy-time-frame-explained`} className="mt-3 inline-flex text-sm text-[#C9A227] hover:underline">
              {isAr ? "فتح درس متقدم" : "Open advanced lesson"}
            </Link>
          </CardContent>
        </Card>
        <Card id="risk-management" className="scroll-mt-28 border-white/10 bg-[#0B0B0B]/90">
          <CardHeader>
            <CardTitle>{isAr ? "إدارة المخاطر" : "Risk Management"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#9CA3AF]">{isAr ? "ضبط المخاطر والانضباط قبل تنفيذ أي صفقة." : "Control downside and execution discipline before every trade."}</p>
            <Link href={`/lessons/support-resistance-engine`} className="mt-3 inline-flex text-sm text-[#C9A227] hover:underline">
              {isAr ? "فتح درس إدارة المخاطر" : "Open risk management lesson"}
            </Link>
          </CardContent>
        </Card>
        <Card id="trading-psychology" className="scroll-mt-28 border-white/10 bg-[#0B0B0B]/90">
          <CardHeader>
            <CardTitle>{isAr ? "علم نفس التداول" : "Trading Psychology"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#9CA3AF]">{isAr ? "ابنِ عقلية تنفيذ مستقرة وتجنّب قرارات الانفعال." : "Build a consistent execution mindset and avoid emotional decisions."}</p>
            <Link href={`/lessons/chart-patterns-rsi-integration`} className="mt-3 inline-flex text-sm text-[#C9A227] hover:underline">
              {isAr ? "فتح درس علم النفس" : "Open psychology lesson"}
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((lesson) => (
          <Card key={lesson.id} className="h-full hover:-translate-y-0.5">
            <CardHeader>
              <CardDescription>{lesson.durationMinutes} min</CardDescription>
              <CardTitle>{isAr ? lesson.titleAr : lesson.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[#9CA3AF]">{isAr ? lesson.descriptionAr : lesson.description}</p>
              <p className="mt-3 text-xs text-[#9CA3AF]">{isAr ? lesson.moduleAr : lesson.module}</p>
              <Link href={`/lessons/${lesson.slug}`} className="mt-3 inline-flex text-sm text-[#C9A227] hover:underline">
                {isAr ? "فتح الدرس" : "Open lesson"}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {query && filtered.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="pt-6 text-sm text-[#9CA3AF]">{isAr ? "لا توجد نتائج مطابقة." : "No matching lessons found."}</CardContent>
        </Card>
      ) : null}

      {!query ? (
        <p className="mt-6 text-xs text-[#9CA3AF]">
          {isAr ? `${lessons.length} درس متاح` : `${lessons.length} lessons available`}
        </p>
      ) : null}
    </section>
  );
}
