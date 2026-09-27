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
    description: isAr ? "ابدأ بدورة التداول المجانية، ثم استكشف تعليمًا مباشرًا مدفوعًا مع مارك باختيارك. تعرّف على المحتوى والمواعيد والسعر قبل الالتزام. الاستفسار مجاني." : "Start with the free trading course, then explore optional paid teaching with Mark. Understand the content, schedule and price before committing. Enquiries are free.",
  });
}

export default async function LearnWithMarkPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  const language = isAr ? "ar" : "en";
  const faqs = isAr ? [
    { question: "هل يجب أن أدفع لأبدأ التعلّم؟", answer: "لا. يمكنك البدء بمسار الأكاديمية المجاني. يتطلب الدخول إلى الدروس حسابًا وبريدًا إلكترونيًا مؤكدًا. إرسال طلب الاهتمام هنا لا يتطلب أي دفع." },
    { question: "هل التسجيل هنا يحجز لي درسًا مع مارك؟", answer: "لا. التعليم المباشر مع مارك مدفوع واختياري، وإرسال الاستفسار مجاني. تُوضح المواعيد وطريقة اللقاءات والمحتوى والسعر قبل أي التزام. لا يؤكد الطلب موعدًا أو مقعدًا." },
    { question: "تعلّمت سابقًا وما زلت مشتتًا، هل يمكنني البدء؟", answer: "نعم. راجع المنهج المجاني وحدّد ما تريد فهمه بشكل أفضل، مثل قراءة السعر أو إدارة المخاطر أو الانضباط. يمكنك ذكر هذه النقاط في طلبك بدون مشاركة تفاصيل مالية خاصة." },
    { question: "هل يجب استخدام Alpha Exchange حتى أتعلّم؟", answer: "لا. التعلّم واستخدام السوق مساران منفصلان. لا يلزمك شراء USDT أو فتح صفقة لبدء المسار التعليمي المجاني." },
    { question: "هل التعليم يضمن أرباحًا أو تعويض خسائر؟", answer: "لا. المحتوى تعليمي ولا يضمن أرباحًا أو استرداد خسائر سابقة. التداول والأصول الرقمية ينطويان على مخاطر." },
  ] : [
    { question: "Do I have to pay to start learning?", answer: "No. You can start with the free Academy path. Lessons require an account with a verified email. Sending an interest enquiry here does not require payment." },
    { question: "Does this reserve a lesson with Mark?", answer: "No. Direct teaching with Mark is optional and paid; sending an enquiry is free. Dates, format, content and price will be explained before any commitment. An enquiry does not confirm a date or place." },
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
        <h1 className="page-title">{isAr ? "ابنِ أساسك. ثم تعلّم مع مارك." : "Build Your Foundation. Then Learn with Mark."}</h1>
        <p className="page-subtitle">{isAr ? "ابدأ بالدورة المجانية وبالسرعة المناسبة لك. بعد إكمالها، إذا أردت تعليمًا مباشرًا مع مارك، استكشف الخيار المدفوع واحكيلنا عن أهدافك. الدورة المجانية تبقى مجانية، والانضمام للتعليم المدفوع باختيارك." : "Start with the free course at your own pace. After completing it, explore optional paid teaching with Mark if you want to continue learning directly with him. The free course stays free. Share your goals and decide after seeing the details."}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/learn-trading-free" className={buttonVariants()}>{isAr ? "استكشف الدورة المجانية" : "Explore the Free Course"}</Link>
          <a href="#interest" className={buttonVariants({ variant: "secondary" })}>{isAr ? "استفسر عن التعليم المدفوع" : "Enquire About Paid Teaching"}</a>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">{[
        { title: isAr ? "افهم المنهج أولًا" : "Understand the curriculum", text: isAr ? "شموع وحركة سعر، دعم ومقاومة، بنية سوق، مخاطر وعلم نفس التداول. راجع المواضيع ثم ابدأ الدروس بالترتيب." : "Candlesticks and price action, support and resistance, market structure, risk and psychology. Review the topics, then follow the lessons in order." },
        { title: isAr ? "حدّد احتياجك" : "Describe your learning needs", text: isAr ? "اكتب إن كنت مبتدئًا أو تعلّمت سابقًا، وما الذي تريد فهمه، والوقت الذي تستطيع تخصيصه للتعلّم." : "Tell us whether you are new or have studied before, what you want to understand, and the time you can dedicate to learning." },
        { title: isAr ? "قرّر بعد معرفة التفاصيل" : "Decide after seeing the details", text: isAr ? "التعليم المباشر مع مارك مدفوع واختياري. الاستفسار مجاني وليس حجزًا؛ تُوضح طريقة اللقاءات والمواعيد والسعر قبل أن تقرّر الانضمام." : "Direct teaching with Mark is optional and paid. An enquiry is free, not a booking. The format, schedule and price are explained before you decide to join." },
      ].map(item => <div key={item.title} className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5"><h2 className="font-semibold">{item.title}</h2><p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{item.text}</p></div>)}</div>
      <div className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
        <h2 className="text-xl font-semibold">{isAr ? "اختَر التعلّم على أساس واضح" : "Choose learning with clear expectations"}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "اطّلع على المنهج، وافهم ما هو مجاني وما الذي ستناقشه مع المدرّس. اسأل عن طريقة الشرح والتطبيق والمتابعة. المعرفة تحتاج وقتًا وتدريبًا؛ لا أحد يستطيع ضمان الربح أو تعويض خسائرك." : "Review the curriculum and understand what is free and what you will discuss with the teacher. Ask about explanation, practice and follow-up. Learning takes time and practice; nobody can guarantee profits or recover your losses."}</p>
        <Link href="/about-founder" className="mt-4 inline-block text-sm text-[#C9A227] underline underline-offset-4">{isAr ? "تعرّف على المؤسس والمنهج" : "Meet the Founder and Explore the Method"}</Link>
      </div>
      <div id="interest" className="scroll-mt-24">
        <p className="text-sm leading-7 text-[#D1D5DB]">{isAr ? "للبالغين 18 عامًا فما فوق. هذا استفسار مجاني عن تعليم مباشر مدفوع مع مارك. لا يوجد حجز أو دفع أو التزام عند الإرسال." : "For adults aged 18 and over. This is a free enquiry about paid teaching with Mark. Submitting does not book a place, take payment or create a commitment."}</p>
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
