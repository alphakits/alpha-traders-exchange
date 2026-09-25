import { Link } from "@/i18n/navigation";
import { buildPageMetadata, buildCourseSchema, serializeJsonLd } from "@/lib/seo";
import { buttonVariants } from "@/components/ui/button";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: isAr ? "ar" : "en",
    title: isAr ? "تعلم التداول مجانًا | دورة Alpha Traders" : "Learn Trading for Free | Alpha Traders Course",
    description: isAr ? "ابدأ تعلم التداول مجانًا مع Alpha Traders: الشموع، النماذج، الدعم والمقاومة، الترندلاين، إدارة المخاطر وعلم النفس والتطبيق المنظم." : "Learn trading for free with Alpha Traders: candlesticks, chart patterns, support and resistance, trendlines, risk management, psychology and structured practice.",
    path: "/learn-trading-free",
  });
}

export default async function LearnTradingFreePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; const isAr = locale === "ar";
  const topics = isAr ? ["أساسيات الشموع وحركة السعر","النماذج الفنية","الدعم والمقاومة","الترندلاين وبنية السوق","إدارة المخاطر والانضباط","علم نفس التداول والتطبيق العملي"] : ["Candlestick and price-action foundations","Chart patterns","Support and resistance","Trendlines and market structure","Risk management and discipline","Trading psychology and practical application"];
  const schema=buildCourseSchema({title:isAr?"دورة Alpha Traders المجانية لتعلم التداول":"Alpha Traders Free Trading Course",description:isAr?"مسار مجاني ومنظم لتعلم أساسيات التداول وإدارة المخاطر.":"A free, structured path for learning trading foundations and risk management.",locale:isAr?"ar":"en"});
  return <section className="section-container page-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(schema)}} />
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-4">
        <p className="section-label">{isAr?"Alpha Traders Academy · مجاني":"Alpha Traders Academy · Free"}</p>
        <h1 className="page-title">{isAr?"تعلم التداول مجانًا خطوة بخطوة":"Learn Trading for Free, Step by Step"}</h1>
        <p className="page-subtitle">{isAr?"مسار Alpha Traders التعليمي مجاني ومصمم لبناء الأساس قبل الانتقال إلى التطبيق: افهم السوق أولًا، ثم تعلّم إدارة المخاطر والانضباط." : "Alpha Traders Academy is free and designed to build the foundation before execution: understand the market first, then develop risk management and discipline."}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{topics.map((topic,i)=><div key={topic} className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5"><p className="text-xs text-[#C9A227]">{isAr?`المرحلة ${i+1}`:`Stage ${i+1}`}</p><h2 className="mt-2 font-semibold">{topic}</h2></div>)}</div>
      <div className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
        <h2 className="text-xl font-semibold">{isAr?"مجاني لا يعني وعودًا بالربح":"Free does not mean promises of profit"}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr?"الهدف هو التعليم المنظم. التداول ينطوي على مخاطر ولا توجد دورة تستطيع ضمان الأرباح. ركّز على التعلم وإدارة المخاطر والتطبيق المنضبط." : "The goal is structured education. Trading involves risk and no course can guarantee profits. Focus on learning, risk management and disciplined practice."}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/academy" className={buttonVariants()}>{isAr?"ابدأ الدورة المجانية":"Start the Free Course"}</Link>
        <Link href="/about-founder" className={buttonVariants({variant:"secondary"})}>{isAr?"عن المؤسس والمنهج":"Founder & Method"}</Link>
        <Link href="/buy-usdt-israel" className={buttonVariants({variant:"secondary"})}>{isAr?"استكشف Alpha Exchange":"Explore Alpha Exchange"}</Link>
      </div>
    </div>
  </section>;
}
