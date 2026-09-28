import { LearningNextStep } from "@/components/academy/learning-next-step";
import { LearningShareActions } from "@/components/academy/learning-share-actions";
import { Link } from "@/i18n/navigation";
import { buildPageMetadata, buildCourseSchema, buildFaqSchema, serializeJsonLd } from "@/lib/seo";
import { buttonVariants } from "@/components/ui/button";
import { buildBreadcrumbSchema } from "@/lib/seo-breadcrumb";
import { PublicDiscoveryBreadcrumbs } from "@/components/seo/public-discovery-breadcrumbs";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: isAr ? "ar" : "en",
    title: isAr ? "دورة تداول مجانية للمبتدئين" : "Free Trading Course for Beginners",
    description: isAr ? "استكشف دورة Alpha Traders المجانية للمبتدئين: الشموع، النماذج، الدعم والمقاومة، إدارة المخاطر وعلم نفس التداول. الدخول إلى الدروس يتطلب حسابًا وبريدًا مؤكدًا." : "Explore Alpha Traders’ free beginner trading course: candlesticks, chart patterns, support and resistance, risk management and trading psychology. Verified email required for lessons.",
    path: "/learn-trading-free",
  });
}

export default async function LearnTradingFreePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; const isAr = locale === "ar";
  const topics = isAr ? [
    { title: "أساسيات الشموع وحركة السعر", description: "تعرّف على أسعار الافتتاح والإغلاق وأعلى وأدنى سعر في الشمعة، واقرأ حركة السعر ضمن سياقها بدل الاعتماد على شمعة واحدة." },
    { title: "النماذج الفنية", description: "تعلّم ملاحظة النماذج على الرسم البياني والتمييز بين احتمال تحرك السعر والنتيجة المؤكدة. ظهور نموذج لا يضمن اتجاه السوق." },
    { title: "الدعم والمقاومة", description: "تعرّف على المناطق التي سبق أن تفاعل معها السعر، ولماذا قد يخترق السوق هذه المناطق بدل الارتداد منها." },
    { title: "الترندلاين وبنية السوق", description: "افهم العلاقة بين القمم والقيعان وخطوط الاتجاه، وكيف تختلف قراءة سوق صاعد أو هابط عن سوق يتحرك ضمن نطاق." },
    { title: "إدارة المخاطر والانضباط", description: "ابدأ بالتفكير في الخسارة المحتملة وحدود المخاطرة قبل التفكير في الربح، وافهم أهمية حجم الصفقة والالتزام بالخطة." },
    { title: "علم نفس التداول والتطبيق العملي", description: "تعرّف على أثر الخوف والطمع والقرارات المتسرعة، وتدرّب على توثيق قراراتك ومراجعتها لبناء انضباط أفضل." },
  ] : [
    { title: "Candlestick and price-action foundations", description: "Understand the open, close, high and low of a candle, and read price movement in context rather than relying on one candle alone." },
    { title: "Chart patterns", description: "Learn to recognize chart patterns and distinguish a possible price move from a certain outcome. A pattern never guarantees market direction." },
    { title: "Support and resistance", description: "Explore areas where price previously reacted and why a market can break through those areas instead of reversing." },
    { title: "Trendlines and market structure", description: "Understand how highs, lows and trendlines relate, and how an upward or downward trend differs from a range-bound market." },
    { title: "Risk management and discipline", description: "Consider potential loss and risk limits before potential profit. Understand why position size and following a plan matter." },
    { title: "Trading psychology and practical application", description: "Recognize fear, greed and impulsive decisions. Practice documenting and reviewing your reasoning to develop stronger discipline." },
  ];
  const schema=buildCourseSchema({title:isAr?"دورة Alpha Traders المجانية لتعلم التداول":"Alpha Traders Free Trading Course",description:isAr?"مسار مجاني ومنظم لتعلم أساسيات التداول وإدارة المخاطر.":"A free, structured path for learning trading foundations and risk management.",locale:isAr?"ar":"en"});
  const faqs = isAr ? [
    { question: "هل دورة Alpha Traders مجانية؟", answer: "نعم. مسار تعلم التداول المعروض هنا مجاني، ويتطلب حسابًا وبريدًا إلكترونيًا مؤكدًا للدخول إلى الدروس وحفظ التقدم." },
    { question: "هل الدورة مناسبة للمبتدئين؟", answer: "نعم. يبدأ المسار بالأساسيات ثم ينتقل إلى بنية السوق وإدارة المخاطر وعلم نفس التداول والتطبيق العملي." },
    { question: "هل تضمن الدورة أرباحًا من التداول؟", answer: "لا. المحتوى تعليمي فقط، والتداول ينطوي على مخاطر ولا توجد أرباح مضمونة." },
  ] : [
    { question: "Is the Alpha Traders course free?", answer: "Yes. The trading education path shown here is free. An account with a verified email is required to access lessons and save progress." },
    { question: "Is the course suitable for beginners?", answer: "Yes. The path starts with foundations and progresses through market structure, risk management, trading psychology and practical application." },
    { question: "Does the course guarantee trading profits?", answer: "No. The content is educational only. Trading involves risk and profits are never guaranteed." },
  ];
  const faqSchema = buildFaqSchema({ locale: isAr ? "ar" : "en", path: "/learn-trading-free", faqs });
  const breadcrumbSchema = buildBreadcrumbSchema({
    locale: isAr ? "ar" : "en",
    items: [
      { name: isAr ? "الرئيسية" : "Home", path: "" },
      { name: isAr ? "ابدأ" : "Start", path: "/start" },
      { name: isAr ? "تعلم التداول مجانًا" : "Learn Trading for Free", path: "/learn-trading-free" },
    ],
  });
  return <section className="section-container page-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(schema)}} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(faqSchema)}} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(breadcrumbSchema)}} />
    <div className="mx-auto max-w-4xl space-y-8">
      <PublicDiscoveryBreadcrumbs locale={isAr ? "ar" : "en"} items={breadcrumbSchema.itemListElement} />
      <div className="space-y-4">
        <p className="section-label">{isAr?"Alpha Traders Academy · مجاني":"Alpha Traders Academy · Free"}</p>
        <h1 className="page-title">
          {isAr ? "تعلّم التداول. ابدأ مجانًا." : "Learn Trading. Start Free."}
          <span className="mt-3 block text-lg font-normal text-[#D1D5DB]">{isAr ? "دورة تداول مجانية للمبتدئين" : "Free Trading Course for Beginners"}</span>
        </h1>
        <p className="page-subtitle">{isAr?"ابنِ أساسك في حركة السعر وإدارة المخاطر وعلم نفس التداول. تعلّم ضمن مسار منظّم، بالسرعة المناسبة لك، دون رسوم للدورة." : "Build your foundation in price action, risk management and trading psychology. Follow a structured course at your own pace, with no course fee."}</p>
        <div className="space-y-3">
          <Link href={{ pathname: "/login", query: { redirectTo: `/${isAr ? "ar" : "en"}/academy` } }} className={buttonVariants({ className: "w-full sm:w-auto" })}>{isAr ? "ابدأ الدورة المجانية" : "Start the Free Course"}</Link>
          <p className="text-sm leading-7 text-[#D1D5DB]">{isAr ? "أنشئ حسابًا أو سجّل الدخول، ثم أكّد بريدك للوصول إلى الدروس وحفظ تقدّمك. المحتوى تعليمي والتداول ينطوي على مخاطر؛ لا توجد أرباح مضمونة." : "Create an account or sign in, then verify your email to access lessons and save progress. Content is educational and trading involves risk; profits are never guaranteed."}</p>
        </div>
        <p className="text-sm leading-7 text-[#D1D5DB]">{isAr ? "عندك خبرة وبدك تشتغل على التطبيق؟ " : "Already have experience and want to work on applying it? "}<Link href="/learn-with-mark" className="inline-flex min-h-11 items-center text-[#E5CA77] underline underline-offset-4">{isAr ? "تعرّف على ICT Mentorship مع مارك" : "Explore ICT Mentorship with Mark"}</Link></p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{topics.map((topic,i)=><div key={topic.title} className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5"><p className="text-xs text-[#C9A227]">{isAr?`المرحلة ${i+1}`:`Stage ${i+1}`}</p><h2 className="mt-2 font-semibold">{topic.title}</h2><p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{topic.description}</p></div>)}</div>
      <div className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-xl font-semibold">{isAr?"لمن صُمم هذا المسار؟":"Who is this learning path for?"}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr?"صُمم للمبتدئين والمتداولين الذين يريدون مراجعة الأساسيات ضمن مسار واضح باللغة العربية أو الإنجليزية. يمكنك استكشاف محتوى الدورة علنًا، لكن الدخول إلى الدروس وحفظ التقدم يتطلب حسابًا وبريدًا إلكترونيًا مؤكدًا.":"It is designed for beginners and traders who want to rebuild their foundations through a clear Arabic or English learning path. You can discover the course publicly, while lesson access and saved progress require an account with a verified email."}</p>
      </div>
      <div className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
        <h2 className="text-xl font-semibold">{isAr?"مجاني لا يعني وعودًا بالربح":"Free does not mean promises of profit"}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr?"الهدف هو التعليم المنظم. التداول ينطوي على مخاطر ولا توجد دورة تستطيع ضمان الأرباح. ركّز على التعلم وإدارة المخاطر والتطبيق المنضبط." : "The goal is structured education. Trading involves risk and no course can guarantee profits. Focus on learning, risk management and disciplined practice."}</p>
      </div>
      <div className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "كيف تبدأ؟" : "How to get started"}</h2>
        <ol className="mt-4 space-y-3 text-sm leading-7 text-[#D1D5DB]">
          <li>{isAr ? "1. استكشف المراحل والمواضيع في هذه الصفحة." : "1. Review the stages and topics on this page."}</li>
          <li>{isAr ? "2. أنشئ حسابًا باستخدام بريدك الإلكتروني أو سجّل الدخول." : "2. Create an account with your email or sign in."}</li>
          <li>{isAr ? "3. أكد بريدك الإلكتروني للدخول إلى الدروس وحفظ تقدمك." : "3. Verify your email to access lessons and save progress."}</li>
          <li>{isAr ? "4. تابع التعلم بالترتيب وركز على إدارة المخاطر قبل التطبيق." : "4. Follow the learning path in order and prioritize risk management before execution."}</li>
        </ol>
      </div>
      <div id="faq" className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "أسئلة شائعة" : "Frequently asked questions"}</h2>
        <div className="mt-4 space-y-4">{faqs.map((faq) => <div key={faq.question}><h3 className="font-semibold text-white">{faq.question}</h3><p className="mt-1 text-sm leading-7 text-[#D1D5DB]">{faq.answer}</p></div>)}</div>
      </div>
      <LearningNextStep locale={locale} />
      <LearningShareActions locale={locale} destination="academy" />
      <p className="text-sm leading-7 text-[#D1D5DB]">{isAr ? "الدورة مجانية. يلزم إنشاء حساب ببريد إلكتروني وتأكيده للدخول إلى الدروس وحفظ تقدّمك. لديك حساب؟ سجّل الدخول للمتابعة." : "The course is free. Create an account and verify your email to access lessons and save your progress. Already have an account? Sign in to continue."}</p>
      <div className="flex flex-wrap gap-3">
        <Link href={{ pathname: "/login", query: { redirectTo: `/${isAr ? "ar" : "en"}/academy` } }} className={buttonVariants()}>{isAr?"ابدأ الدورة المجانية":"Start the Free Course"}</Link>
        <Link href="/about-founder" className={buttonVariants({variant:"secondary"})}>{isAr?"عن المؤسس والمنهج":"Founder & Method"}</Link>
        <Link href="/usdt-exchange" className={buttonVariants({variant:"secondary"})}>{isAr?"استكشف Alpha Exchange":"Explore Alpha Exchange"}</Link>
      </div>
    </div>
  </section>;
}
