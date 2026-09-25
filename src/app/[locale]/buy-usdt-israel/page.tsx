import { Link } from "@/i18n/navigation";
import { buildFaqSchema, buildPageMetadata, serializeJsonLd } from "@/lib/seo";
import { buttonVariants } from "@/components/ui/button";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: isAr ? "ar" : "en",
    title: isAr ? "شراء وبيع USDT في إسرائيل بالشيكل | Alpha Exchange" : "Buy & Sell USDT in Israel with ILS | Alpha Exchange",
    description: isAr
      ? "دليل Alpha Exchange العام لشراء وبيع USDT مقابل الشيكل عبر سوق P2P منظم مع بائعين معتمدين وطرق دفع محلية."
      : "Learn how Alpha Exchange supports structured P2P USDT/ILS trading in Israel with approved sellers, local payment methods, trade rooms, reviews and support.",
    path: "/buy-usdt-israel",
  });
}

export default async function BuyUsdtIsraelPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  const faqs = isAr ? [
    { question: "هل يمكن شراء وبيع USDT مقابل الشيكل عبر Alpha Exchange؟", answer: "يعرض Alpha Exchange سوق P2P منظمًا لصفقات USDT مقابل ILS عندما تتوفر عروض مناسبة من البائعين المعتمدين." },
    { question: "هل هذه الصفحة نفسها تفتح صفقة؟", answer: "لا. هذه صفحة عامة للمعلومات والاكتشاف. فتح طلب صفقة أو دخول غرفة التداول يتطلب تسجيل الدخول واستيفاء متطلبات الحساب الحالية." },
    { question: "ما طرق الدفع التي قد تكون متاحة؟", answer: "تعتمد الطرق على العرض وقد تشمل التحويل البنكي والسحب النقدي بدون بطاقة واللقاء المباشر. يجب مراجعة تفاصيل العرض قبل المتابعة." },
    { question: "هل البائع المعتمد يعني أن الصفقة بلا مخاطر؟", answer: "لا. الموافقة على وصول البائع للسوق لا تضمن سلوكه المستقبلي أو صفقة خالية من المخاطر. راجع السعر والتقييمات وإشارات الثقة ومسار الصفقة." },
  ] : [
    { question: "Can I buy and sell USDT for ILS through Alpha Exchange?", answer: "Alpha Exchange provides a structured P2P marketplace workflow for USDT/ILS trades when suitable listings from approved sellers are available." },
    { question: "Does this public page open a trade?", answer: "No. This is a public information and discovery page. Opening a trade request or entering a Trade Room requires sign-in and the platform’s existing account requirements." },
    { question: "Which payment methods may be available?", answer: "Methods depend on each listing and may include bank transfer, cardless cash withdrawal and face-to-face settlement. Review the listing details before continuing." },
    { question: "Does Approved Seller status make a trade risk-free?", answer: "No. Marketplace approval does not guarantee future seller behavior or a risk-free trade. Review price, ratings, trust signals and the trade flow before proceeding." },
  ];
  const faqSchema = buildFaqSchema({ locale: isAr ? "ar" : "en", path: "/buy-usdt-israel", faqs });
  const points = isAr
    ? ["قارن عروض USDT والأسعار قبل فتح الطلب.", "تعامل مع بائعين تمت الموافقة على وصولهم للسوق.", "استخدم مسار صفقة منظم ومحادثة داخل غرفة التداول.", "طرق الدفع المتاحة تعتمد على العرض وقد تشمل التحويل البنكي والسحب بدون بطاقة واللقاء المباشر.", "راجع التقييمات وإشارات الثقة قبل المتابعة."]
    : ["Compare available USDT listings and prices before opening a request.", "Trade with sellers whose marketplace access has been approved.", "Use a structured trade flow with communication inside the Trade Room.", "Available methods depend on each listing and may include bank transfer, cardless cash withdrawal and face-to-face.", "Review seller ratings and public trust signals before continuing."];
  return <section className="section-container page-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(faqSchema)}} />
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-4">
        <p className="section-label">Alpha Exchange · USDT / ILS · Israel</p>
        <h1 className="page-title">{isAr ? "شراء وبيع USDT في إسرائيل بالشيكل" : "Buy and Sell USDT in Israel with ILS"}</h1>
        <p className="page-subtitle">{isAr ? "Alpha Exchange هو مسار P2P منظم يربط المشترين ببائعين معتمدين لصفقات USDT مقابل ILS." : "Alpha Exchange is a structured P2P marketplace workflow connecting buyers with approved sellers for USDT/ILS trades."}</p>
      </div>
      <div className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-2xl font-semibold">{isAr ? "كيف يعمل" : "How it works"}</h2>
        <div className="mt-4 space-y-3 text-sm leading-7 text-[#D1D5DB]">{points.map((p) => <p key={p}>• {p}</p>)}</div>
      </div>
      <div className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "الوصول إلى السوق" : "Marketplace access"}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "هذه الصفحة دليل عام فقط. لفتح طلب صفقة أو دخول غرفة التداول يجب تسجيل الدخول وإكمال متطلبات الحساب الحالية. صلاحيات المشتري والبائع وموافقة البائع تبقى كما هي داخل Alpha Exchange." : "This page is a public guide only. Opening a trade request or entering a Trade Room requires sign-in and the platform’s existing account requirements. Buyer and seller permissions, including seller approval, remain enforced inside Alpha Exchange."}</p>
      </div>
      <div className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "الرسوم والشفافية" : "Fees and transparency"}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "تعرض Alpha Exchange الرسوم المطبقة داخل مسار الصفقة قبل الإكمال. راجع دائمًا السعر والمبلغ وطريقة الدفع والشبكة قبل إرسال أي قيمة." : "Alpha Exchange shows applicable fees in the trade flow before completion. Always review the price, amount, payment method and blockchain network before sending value."}</p>
      </div>
      <div id="faq" className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "أسئلة شائعة عن USDT / ILS" : "USDT / ILS frequently asked questions"}</h2>
        <div className="mt-4 space-y-4">{faqs.map((faq) => <div key={faq.question}><h3 className="font-semibold text-white">{faq.question}</h3><p className="mt-1 text-sm leading-7 text-[#D1D5DB]">{faq.answer}</p></div>)}</div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/usdt-exchange" className={buttonVariants()}>{isAr ? "ابدأ عبر Alpha Exchange" : "Start with Alpha Exchange"}</Link>
        <Link href="/safety-trust" className={buttonVariants({variant:"secondary"})}>{isAr ? "الأمان والثقة" : "Safety & Trust"}</Link>
        <Link href="/learn-trading-free" className={buttonVariants({variant:"secondary"})}>{isAr ? "تعلم التداول مجانًا" : "Learn Trading for Free"}</Link>
      </div>
      <p className="text-xs leading-6 text-[#9CA3AF]">{isAr ? "تداول العملات الرقمية وP2P ينطوي على مخاطر. الموافقة على البائع لا تضمن سلوكه المستقبلي أو صفقة خالية من المخاطر." : "Crypto and P2P trading involve risk. Approved Seller status does not guarantee future behavior or a risk-free transaction."}</p>
    </div>
  </section>;
}
