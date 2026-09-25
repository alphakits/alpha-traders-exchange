import { Link } from "@/i18n/navigation";
import { buildFaqSchema, buildPageMetadata, serializeJsonLd } from "@/lib/seo";
import { buttonVariants } from "@/components/ui/button";
import { buildBreadcrumbSchema } from "@/lib/seo-breadcrumb";
import { PublicDiscoveryBreadcrumbs } from "@/components/seo/public-discovery-breadcrumbs";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: isAr ? "ar" : "en",
    title: isAr ? "دليل تعلم التداول وUSDT" : "Trading Education & USDT Guide",
    description: isAr
      ? "ابدأ من هنا لاستكشاف تعليم التداول المجاني وسوق USDT/ILS العام في Alpha Traders، ثم سجّل الدخول للمتابعة ضمن صلاحيات حسابك."
      : "Start here to discover Alpha Traders free trading education and the public USDT/ILS marketplace guide, then sign in to continue through your account permissions.",
    path: "/start",
  });
}

export default async function StartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  const faqs = isAr ? [
    { question: "ما هو Alpha Traders Academy & Exchange؟", answer: "منصة تجمع بين تعليم التداول المنظم ومسار عام لاكتشاف سوق P2P لصفقات USDT مقابل ILS." },
    { question: "من أين أبدأ إذا أردت تعلم التداول؟", answer: "ابدأ من دليل تعلم التداول المجاني. للدخول إلى الدروس وحفظ التقدم يلزم حساب وبريد إلكتروني مؤكد." },
    { question: "من أين أبدأ إذا أردت USDT مقابل ILS؟", answer: "ابدأ من دليل USDT/ILS العام، ثم سجّل الدخول لاستخدام وظائف السوق وفق صلاحيات حسابك ومتطلبات المنصة." },
  ] : [
    { question: "What is Alpha Traders Academy & Exchange?", answer: "It combines structured trading education with public discovery information for a P2P USDT/ILS marketplace workflow." },
    { question: "Where should I start if I want to learn trading?", answer: "Start with the free trading education guide. Lesson access and saved progress require an account with a verified email." },
    { question: "Where should I start if I want USDT for ILS?", answer: "Start with the public USDT/ILS guide, then sign in to use marketplace functions according to your account permissions and platform requirements." },
  ];
  const faqSchema = buildFaqSchema({ locale: isAr ? "ar" : "en", path: "/start", faqs });
  const breadcrumbSchema = buildBreadcrumbSchema({
    locale: isAr ? "ar" : "en",
    items: [
      { name: isAr ? "الرئيسية" : "Home", path: "" },
      { name: isAr ? "ابدأ" : "Start", path: "/start" },
    ],
  });

  return <section className="section-container page-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbSchema) }} />
    <div className="mx-auto max-w-5xl space-y-8">
      <PublicDiscoveryBreadcrumbs locale={isAr ? "ar" : "en"} items={breadcrumbSchema.itemListElement} />
      <div className="space-y-4">
        <p className="section-label">Alpha Traders Academy & Exchange</p>
        <h1 className="page-title">{isAr ? "ابدأ من المسار المناسب لك" : "Start with the right Alpha Traders path"}</h1>
        <p className="page-subtitle">{isAr ? "صفحة عامة تساعدك على اختيار المسار: تعلم التداول مجانًا أو استكشاف USDT/ILS. استخدام الميزات الفعلية يستمر عبر تسجيل الدخول والتحقق والصلاحيات الحالية." : "A public starting point for choosing your path: learn trading for free or explore USDT/ILS. Actual product access continues through the existing sign-in, verification and permission flow."}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-[#C9A227]/30 bg-[#0B0B0B]/90 p-6">
          <p className="text-sm font-semibold text-[#C9A227]">Alpha Traders Academy</p>
          <h2 className="mt-2 text-2xl font-semibold">{isAr ? "تعلم التداول مجانًا" : "Learn Trading for Free"}</h2>
          <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "استكشف أساسيات الشموع والنماذج والدعم والمقاومة وبنية السوق وإدارة المخاطر وعلم النفس." : "Explore candlesticks, chart patterns, support and resistance, market structure, risk management and trading psychology."}</p>
          <Link href="/learn-trading-free" className={buttonVariants({ className: "mt-5" })}>{isAr ? "استكشف المسار المجاني" : "Explore the Free Path"}</Link>
        </div>
        <div className="rounded-3xl border border-[#6CAEFF]/30 bg-[#0B0B0B]/90 p-6">
          <p className="text-sm font-semibold text-[#93C5FD]">Alpha Exchange · USDT / ILS</p>
          <h2 className="mt-2 text-2xl font-semibold">{isAr ? "استكشف سوق USDT / ILS" : "Explore the USDT / ILS Marketplace"}</h2>
          <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "تعرف على مسار P2P والبائعين المعتمدين وطرق الدفع وإشارات الثقة قبل تسجيل الدخول." : "Understand the P2P workflow, approved sellers, payment methods and trust signals before signing in."}</p>
          <Link href="/buy-usdt-israel" className={buttonVariants({ variant: "secondary", className: "mt-5" })}>{isAr ? "دليل USDT / ILS" : "USDT / ILS Guide"}</Link>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: isAr ? "تعليم واضح قبل التطبيق" : "Education before execution",
            text: isAr ? "ابدأ بالمفاهيم وإدارة المخاطر والانضباط قبل الانتقال إلى أي تطبيق عملي." : "Start with concepts, risk management and discipline before moving into practical execution.",
          },
          {
            title: isAr ? "سوق P2P بمراحل واضحة" : "Structured P2P workflow",
            text: isAr ? "استكشف كيف تعمل العروض والبائعون المعتمدون وغرفة التداول قبل فتح أي طلب." : "Understand listings, approved sellers and the Trade Room flow before opening a request.",
          },
          {
            title: isAr ? "الوصول حسب الحساب" : "Account-based access",
            text: isAr ? "المحتوى العام قابل للاكتشاف، بينما الميزات الفعلية تبقى خلف تسجيل الدخول والتحقق والصلاحيات." : "Public information is discoverable while actual features remain behind sign-in, verification and permissions.",
          },
        ].map((item) => (
          <div key={item.title} className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5">
            <h2 className="font-semibold text-white">{item.title}</h2>
            <p className="mt-2 text-sm leading-7 text-[#D1D5DB]">{item.text}</p>
          </div>
        ))}
      </div>
      <div id="faq" className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "أسئلة البداية" : "Getting started FAQ"}</h2>
        <div className="mt-4 space-y-4">{faqs.map((faq) => <div key={faq.question}><h3 className="font-semibold">{faq.question}</h3><p className="mt-1 text-sm leading-7 text-[#D1D5DB]">{faq.answer}</p></div>)}</div>
      </div>
    </div>
  </section>;
}
