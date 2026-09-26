import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ContactForm } from "@/components/sections/contact/contact-form";
import { PublicDiscoveryBreadcrumbs } from "@/components/seo/public-discovery-breadcrumbs";
import { buildBreadcrumbSchema } from "@/lib/seo-breadcrumb";
import { buildFaqSchema, buildPageMetadata, serializeJsonLd } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: isAr ? "ar" : "en", path: "/learn-with-mark",
    title: isAr ? "تعلّم التداول مع مارك" : "Learn Trading with Mark",
    description: isAr ? "ابدأ بدورة التداول المجانية بالعربي، ثم سجّل اهتمامك بالتعلّم المباشر مع مارك: أخبرنا بمستواك وهدفك والوقت المناسب لك. بدون حجز أو دفع عند الاستفسار." : "Start with the free trading course, then register your interest in learning directly with Mark. Share your level, goal and availability without booking or payment.",
  });
}

export default async function LearnWithMarkPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  const language = isAr ? "ar" : "en";
  const faqs = isAr ? [
    { question: "هل يجب أن أدفع لأبدأ التعلّم؟", answer: "لا. يمكنك البدء بمسار الأكاديمية المجاني. يتطلب الدخول إلى الدروس حسابًا وبريدًا إلكترونيًا مؤكدًا. إرسال طلب الاهتمام هنا لا يتطلب أي دفع." },
    { question: "هل التسجيل هنا يحجز لي درسًا مع مارك؟", answer: "لا. هذه قائمة اهتمام بالتعلّم المباشر. تُوضح المواعيد وطريقة اللقاءات والمحتوى وأي رسوم قبل أي التزام، ولم يُعلن هنا عن موعد أو مقعد مؤكد." },
    { question: "تعلّمت سابقًا وما زلت مشتتًا، هل يمكنني البدء؟", answer: "نعم. راجع المنهج المجاني وحدّد ما تريد فهمه بشكل أفضل، مثل قراءة السعر أو إدارة المخاطر أو الانضباط. يمكنك ذكر هذه النقاط في طلبك بدون مشاركة تفاصيل مالية خاصة." },
    { question: "هل يجب استخدام Alpha Exchange حتى أتعلّم؟", answer: "لا. التعلّم واستخدام السوق مساران منفصلان. لا يلزمك شراء USDT أو فتح صفقة لبدء المسار التعليمي المجاني." },
    { question: "هل التعليم يضمن أرباحًا أو تعويض خسائر؟", answer: "لا. المحتوى تعليمي ولا يضمن أرباحًا أو استرداد خسائر سابقة. التداول والأصول الرقمية ينطويان على مخاطر." },
  ] : [
    { question: "Do I have to pay to start learning?", answer: "No. You can start with the free Academy path. Lessons require an account with a verified email. Sending an interest enquiry here does not require payment." },
    { question: "Does this reserve a lesson with Mark?", answer: "No. This is an expression of interest in direct teaching. Dates, format, content and any fees will be explained before any commitment. No date or confirmed place is announced here." },
    { question: "Can I start if previous learning left me confused?", answer: "Yes. Review the free curriculum and identify what you want to understand better, such as price action, risk management or discipline. Describe those learning goals without sharing private financial details." },
    { question: "Must I use Alpha Exchange to learn?", answer: "No. Education and the marketplace are separate paths. You do not need to buy USDT or open a trade to start the free learning path." },
    { question: "Does teaching guarantee profits or recover losses?", answer: "No. The content is educational and does not guarantee profits or recovery of previous losses. Trading and digital assets involve risk." },
  ];
  const breadcrumb = buildBreadcrumbSchema({ locale: language, items: [
    { name: isAr ? "الرئيسية" : "Home", path: "" },
    { name: isAr ? "ابدأ" : "Start", path: "/start" },
    { name: isAr ? "التعلّم مع مارك" : "Learn with Mark", path: "/learn-with-mark" },
  ] });
  return <section className="section-container page-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildFaqSchema({ locale: language, path: "/learn-with-mark", faqs })) }} />
    <div className="mx-auto max-w-4xl space-y-8">
      <PublicDiscoveryBreadcrumbs locale={language} items={breadcrumb.itemListElement} />
      <div className="space-y-4">
        <p className="section-label">Alpha Traders Academy</p>
        <h1 className="page-title">{isAr ? "تعلّم التداول مع مارك: ابدأ بالأساس" : "Learn Trading with Mark: Start with the Foundations"}</h1>
        <p className="page-subtitle">{isAr ? "بدك تتعلّم من الصفر، أو ترتّب معلوماتك بعد تجربة سابقة؟ ابدأ بمنهج الأكاديمية المجاني. وإذا مهتم بتعلّم مباشر مع مارك، احكيلنا عن مستواك وهدفك لنفهم احتياجك قبل أي التزام." : "Starting from scratch, or looking for structure after previous learning? Begin with the free Academy curriculum. If you are interested in direct teaching with Mark, share your level and goals before making any commitment."}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/learn-trading-free" className={buttonVariants()}>{isAr ? "استكشف الدورة المجانية" : "Explore the Free Course"}</Link>
          <a href="#interest" className={buttonVariants({ variant: "secondary" })}>{isAr ? "مهتم بالتعلّم مع مارك" : "Interested in Learning with Mark"}</a>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">{[
        { title: isAr ? "افهم المنهج أولًا" : "Understand the curriculum", text: isAr ? "شموع وحركة سعر، دعم ومقاومة، بنية سوق، مخاطر وعلم نفس التداول. راجع المواضيع ثم ابدأ الدروس بالترتيب." : "Candlesticks and price action, support and resistance, market structure, risk and psychology. Review the topics, then follow the lessons in order." },
        { title: isAr ? "حدّد احتياجك" : "Describe your learning needs", text: isAr ? "اكتب إن كنت مبتدئًا أو تعلّمت سابقًا، وما الذي تريد فهمه، والوقت الذي تستطيع تخصيصه للتعلّم." : "Tell us whether you are new or have studied before, what you want to understand, and the time you can dedicate to learning." },
        { title: isAr ? "قرّر بعد معرفة التفاصيل" : "Decide after seeing the details", text: isAr ? "طلب الاهتمام ليس حجزًا. تُوضح تفاصيل التعلّم المباشر والمواعيد وأي رسوم قبل أن تقرّر الانضمام." : "An interest enquiry is not a booking. The teaching format, schedule and any fees are explained before you decide to join." },
      ].map(item => <div key={item.title} className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5"><h2 className="font-semibold">{item.title}</h2><p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{item.text}</p></div>)}</div>
      <div className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "اختَر التعلّم على أساس واضح" : "Choose learning with clear expectations"}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "اطّلع على المنهج، وافهم ما هو مجاني وما الذي ستناقشه مع المدرّس. اسأل عن طريقة الشرح والتطبيق والمتابعة. المعرفة تحتاج وقتًا وتدريبًا؛ لا أحد يستطيع ضمان الربح أو تعويض خسائرك." : "Review the curriculum and understand what is free and what you will discuss with the teacher. Ask about explanation, practice and follow-up. Learning takes time and practice; nobody can guarantee profits or recover your losses."}</p>
        <Link href="/about-founder" className="mt-4 inline-block text-sm text-[#C9A227] underline underline-offset-4">{isAr ? "تعرّف على المؤسس والمنهج" : "Meet the Founder and Explore the Method"}</Link>
      </div>
      <div id="interest" className="scroll-mt-24">
        <p className="text-sm leading-7 text-[#D1D5DB]">{isAr ? "للبالغين 18 عامًا فما فوق. ابدأ التعلّم المجاني الآن، واترك طلبك إذا كنت مهتمًا بالتعلّم المباشر مستقبلًا." : "For adults aged 18 and over. Start the free course now, and leave an enquiry if you are interested in direct teaching in the future."}</p>
        <ContactForm locale={language} topic="learning-with-mark" />
        <Link href="/privacy-policy" className="mt-4 inline-block text-sm text-[#C9A227] underline underline-offset-4">{isAr ? "سياسة الخصوصية" : "Privacy Policy"}</Link>
      </div>
      <div id="faq" className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "أسئلة عن التعلّم مع مارك" : "Questions about Learning with Mark"}</h2>
        <div className="mt-4 space-y-4">{faqs.map(faq => <div key={faq.question}><h3 className="font-semibold">{faq.question}</h3><p className="mt-1 text-sm leading-7 text-[#D1D5DB]">{faq.answer}</p></div>)}</div>
      </div>
      <p className="text-sm leading-7 text-[#D1D5DB]">{isAr ? "مهتم أيضًا بشراء أو بيع USDT مقابل الشيكل؟" : "Also interested in buying or selling USDT for Israeli shekels?"} <Link href="/buy-usdt-israel" className="text-[#C9A227] underline underline-offset-4">{isAr ? "تعرّف على Alpha Exchange" : "Explore Alpha Exchange"}</Link></p>
    </div>
  </section>;
}
