import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ContactForm } from "@/components/sections/contact/contact-form";
import { LearningShareActions } from "@/components/academy/learning-share-actions";
import { PublicDiscoveryBreadcrumbs } from "@/components/seo/public-discovery-breadcrumbs";
import { buildBreadcrumbSchema } from "@/lib/seo-breadcrumb";
import { buildFaqSchema, buildPageMetadata, serializeJsonLd } from "@/lib/seo";
import { ICT_MENTORSHIP_OFFER, ictMentorshipOfferSummary, isIctMentorshipIntakeOpen } from "@/lib/ict-mentorship-offer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return buildPageMetadata({
    locale: isAr ? "ar" : "en", path: "/learn-with-mark",
    title: isAr ? "ICT Mentorship مع مارك" : "ICT Mentorship with Mark",
    description: isAr ? "تعرّف على ICT Mentorship مع مارك: دراسة، تطبيق وأسئلة ومراجعة. اسمع شرحه الأصلي، استكشف المنهج وابدأ بالأكاديمية المجانية." : "Explore ICT Mentorship with Mark: study, practice, questions and review. Hear his original explanation, explore the curriculum and start with the free Academy.",
    ogImage: "https://www.alphatraders.co.il/images/brand/alpha-ict-mentorship-social.png",
  });
}

export default async function LearnWithMarkPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  const language = isAr ? "ar" : "en";
  const t = (en: string, ar: string) => isAr ? ar : en;
  const intakeOpen = isIctMentorshipIntakeOpen();
  const offer = ictMentorshipOfferSummary(language);
  const faqs = [
    { question: t("Is this one programme, and what is the fee?", "هل هو برنامج واحد، وقديش الرسوم؟"), answer: intakeOpen ? offer : t("The 2026 intake has closed. The fees shown on this page are a record of that intake. The free Academy remains available.", "انتهت نافذة 2026. الرسوم الظاهرة في هذه الصفحة تخص تلك الدفعة. الأكاديمية المجانية ما زالت متاحة.") },
    { question: t("How long is this mentorship window open?", "لأي وقت نافذة المنتورشيب مفتوحة؟"), answer: intakeOpen ? t("This is Mark’s final mentorship enquiry window, through 31 December 2026 (Israel time). Your session dates, format and follow-up are agreed before joining. An enquiry does not reserve a place.", "هذه نافذة مارك الأخيرة لاستقبال طلبات المنتورشيب، حتى 31 ديسمبر 2026 بتوقيت إسرائيل. تُتفق مواعيد اللقاءات وصيغتها والمتابعة قبل الانضمام. الاستفسار لا يحجز مقعدًا.") : t("This final enquiry window closed at the end of 31 December 2026, Israel time. New mentorship enquiries are no longer accepted through this form.", "انتهت نافذة الاستفسارات الأخيرة بنهاية 31 ديسمبر 2026 بتوقيت إسرائيل. هذا النموذج لم يعد يستقبل استفسارات منتورشيب جديدة.") },
    { question: t("Is ICT Mentorship the same as the free Academy?", "هل ICT Mentorship هو نفس الأكاديمية المجانية؟"), answer: t("The free Academy is a place to begin; lessons require an account with a verified email. ICT Mentorship is a separate programme with Mark and has a fee. An enquiry is free and does not reserve a place. Fees, duration, schedule, follow-up scope and cancellation terms are explained before any commitment.", "الأكاديمية المجانية متاحة كبداية، والدروس تتطلب حسابًا وبريدًا مؤكدًا. ICT Mentorship برنامج منفصل مع مارك برسوم. الاستفسار مجاني ولا يحجز مقعدًا؛ تُوضح الرسوم والمدة والمواعيد ونطاق المتابعة وشروط الإلغاء قبل أي التزام.") },
    { question: t("Who teaches the mentorship?", "مين يقدّم المنتورشيب؟"), answer: t("Mark, the founder of Alpha Traders, provides the teaching and follow-up. This is Alpha Traders’ independent programme teaching ICT concepts; it is not presented as an official ICT programme or certification.", "مارك، مؤسس Alpha Traders، يقدّم المنهج والمتابعة. هذا برنامج Alpha Traders المستقل الذي يدرّس مفاهيم ICT؛ لا يُقدَّم بوصفه برنامجًا رسميًا أو شهادة صادرة عن ICT.") },
    { question: t("I have studied before but still feel lost. Is this relevant?", "تعلّمت سابقًا وما زلت مشتتًا، هل يناسبني؟"), answer: t("Describe your experience and what you find difficult to understand or apply. The approach is to study concepts, document decisions and bring specific questions for review. You do not need to share balances or private financial information in your enquiry.", "احكِ عن خبرتك وما يصعب عليك فهمه أو تطبيقه. الهدف هو دراسة المفاهيم، توثيق القرارات وطرح أسئلة محدّدة للمراجعة. لا تحتاج لمشاركة أرصدتك أو تفاصيلك المالية في الاستفسار.") },
    { question: t("Do I need previous experience?", "هل أحتاج خبرة سابقة؟"), answer: t("If you are new, begin with the free Academy and build your foundation. If you have experience, explain your level and goals in the enquiry so you can discuss the appropriate path and study commitment with Mark.", "إذا كنت مبتدئًا، ابدأ بالأكاديمية المجانية وابنِ أساسك. إذا عندك خبرة، اشرح مستواك وأهدافك عند الاستفسار، حتى تناقش مع مارك المسار المناسب والوقت المطلوب للدراسة والتطبيق.") },
    { question: t("What does follow-up involve?", "كيف بتكون المتابعة؟"), answer: t("Bring questions from your own study and practice: the reasoning for an entry, a stop that was hit, or an exit before a target. The aim is to understand your decisions and build independence. Before joining, clarify the session format, question channel, access period and follow-up scope with Mark.", "ارجع بأسئلة من دراستك وتطبيقك: سبب الدخول، ستوب انضرب، أو خروج قبل الهدف. الهدف تفهم قراراتك وتبني استقلاليتك. قبل الانضمام، وضّح مع مارك صيغة اللقاءات، طريقة طرح الأسئلة، مدة الوصول ونطاق المتابعة.") },
    { question: t("What happens after I send an enquiry?", "شو بصير بعد ما أرسل الاستفسار؟"), answer: t("Your enquiry is saved privately for Mark to review. Use an email address you can access, and explain your experience, goal and available study time. You can keep exploring the free Academy and recording while awaiting a reply. You decide whether to join after reviewing the current programme details; an enquiry is not an enrolment.", "بينحفظ استفسارك بشكل خاص ليراجعه مارك. استخدم بريدًا بتقدر تفتحه، واشرح خبرتك وهدفك ووقتك المتاح. بتقدر تكمّل بالأكاديمية المجانية وتسمع التسجيل وأنت بانتظار الرد. بتقرر الانضمام بعد ما تشوف تفاصيل البرنامج الحالي؛ الاستفسار مش تسجيل بالبرنامج.") },
    { question: t("Are the prices and numbers in the recording the current offer?", "هل الأسعار والأرقام في التسجيل هي العرض الحالي؟"), answer: t("The original recording is from 7 September 2026 and includes historical prices, counts and personal experiences. These are not current enrolment terms or evidence of results you will achieve. The current tuition is listed in the programme section below; the remaining details are clarified before joining.", "التسجيل الأصلي من 7 سبتمبر 2026، وفيه أسعار وأعداد وتجارب سابقة. هذه ليست شروط التسجيل الحالية ولا دليلًا على نتيجة ستحصل عليها. الرسوم الحالية مذكورة بقسم البرنامج أدناه، وبقية التفاصيل تُوضح قبل الانضمام.") },
    { question: t("Do I need to buy USDT or hand over my money?", "هل يلزمني شراء USDT أو تسليم أموالي؟"), answer: t("No. Education is separate from Alpha Exchange. Mentorship is education, not money management; it does not require buying USDT or opening a trade. Trading involves risk, and education does not guarantee profits or recovery of losses.", "لا. التعلّم منفصل عن Alpha Exchange. المنتورشيب تعليم وليس إدارة أموال، ولا يلزمك شراء USDT أو فتح صفقة. التداول ينطوي على مخاطر، ولا يضمن التعليم أرباحًا أو تعويض خسائر.") },
  ];
  const approach = [
    { title: t("Study and understand", "ادرس وافهم"), text: t("Start with the terminology and how a strategy is built. Understand the reasoning before trying to apply it.", "ابدأ بالمصطلحات وبنية الاستراتيجية. افهم لماذا الفكرة موجودة قبل أن تحاول استخدامها.") },
    { title: t("Practise and document", "طبّق ووثّق"), text: t("Work through charts and record your entry reasoning, risk, stop and targets within a clear plan.", "تدرّب على قراءة الرسم وتسجيل سبب الدخول، المخاطرة، الستوب والأهداف ضمن خطة واضحة.") },
    { title: t("Ask and review", "اسأل وراجع"), text: t("Bring specific questions: why was the stop hit, why did I exit before my target, and what did I miss in the analysis?", "ارجع بأسئلة محدّدة: لماذا ضرب الستوب؟ لماذا خرجت قبل الهدف؟ ماذا فاتني في التحليل؟") },
    { title: t("Build independence", "ابنِ استقلاليتك"), text: t("Use review to understand mistakes and strengthen your decision-making and discipline. Progress takes your time and effort.", "استخدم المراجعة لفهم الأخطاء وتحسين قراراتك وانضباطك. التقدّم يحتاج وقتًا وجهدًا منك.") },
  ];
  const curriculum = [
    { title: t("ICT / SMC and price action", "ICT / SMC وقراءة السعر"), text: t("Market structure, market maker models, liquidity, price inefficiencies, market traps and recurring patterns across timeframes.", "بنية السوق، نماذج صانع السوق، السيولة، اختلالات السعر، فخاخ السوق، وتكرار الأنماط عبر الأطر الزمنية.") },
    { title: t("Strategy and execution", "بناء الاستراتيجية والتنفيذ"), text: t("OTE and Fibonacci settings, timing, entry conditions, stops and targets, and the distinction between scalping and swing approaches.", "مفاهيم OTE وإعدادات فيبوناتشي، التوقيت، شروط الدخول، الستوب والأهداف، والفرق بين السكالب والسوينج.") },
    { title: t("Economics and news", "الاقتصاد والأخبار"), text: t("Global economic context, USD news and economic releases such as unemployment, and how they relate to reading the market.", "فهم سياق الاقتصاد العالمي، أخبار الدولار والبيانات الاقتصادية مثل البطالة، وعلاقتها بقراءة السوق.") },
    { title: t("Risk and trading psychology", "إدارة المخاطر وعلم النفس"), text: t("Planning risk, impulsive decisions, emotions, following a plan and reviewing recurring mistakes.", "تخطيط المخاطرة، التسرّع، المشاعر، الالتزام بالخطة ومراجعة الأخطاء المتكررة.") },
    { title: t("Context across markets", "السياق عبر الأسواق"), text: t("Study examples from futures, Nasdaq and S&P, forex and gold, and crypto markets such as Bitcoin and Ethereum.", "دراسة أمثلة من العقود الآجلة وNasdaq وS&P، الفوركس والذهب، والكريبتو مثل Bitcoin وEthereum.") },
    { title: t("Lessons, practice and follow-up", "الدروس والتطبيق والمتابعة"), text: t("Recorded material, live learning and questions drawn from practice. Group or individual format, schedules and the scope of follow-up are defined before joining.", "مواد مسجّلة، تعلّم مباشر وأسئلة مبنية على التطبيق. تُحدد صيغة المجموعة أو الفردي ومواعيد ونطاق المتابعة قبل الانضمام.") },
  ];
  const summary = [
    t("Commitment comes first: make time to study and practise, then bring questions rather than only watching lessons.", "الجدية أولًا: خصص وقتًا للدراسة والتطبيق، وارجع بأسئلتك بدل الاكتفاء بمشاهدة الدروس."),
    t("Understand the terminology, strategy structure, OTE concepts and targets before trying to apply them.", "افهم المصطلحات وبناء الاستراتيجية، ومفاهيم OTE والأهداف، قبل محاولة تنفيذها."),
    t("Review starts with a specific question about your decision: the entry, the stop or an exit before the target.", "المراجعة تبدأ بسؤال واضح عن قرارك: سبب الدخول، الستوب، أو الخروج قبل الهدف."),
    t("Previous experience differs from starting at zero; learning takes time, practice and discipline.", "الخبرة السابقة تختلف عن البداية من الصفر؛ التعلّم يحتاج وقتًا وممارسة وانضباطًا."),
    t("Mark explains why he prefers taking risks with his own money; he is not offering to manage students’ money.", "مارك يشرح لماذا يفضّل تحمّل مخاطرة أمواله الشخصية، ولا يعرض إدارة أموال الطلاب."),
  ];
  const breadcrumb = buildBreadcrumbSchema({ locale: language, items: [
    { name: t("Home", "الرئيسية"), path: "" },
    { name: t("Start", "ابدأ"), path: "/start" },
    { name: "ICT Mentorship", path: "/learn-with-mark" },
  ] });
  return <section className="section-container page-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildFaqSchema({ locale: language, path: "/learn-with-mark", faqs })) }} />
    <div className="mx-auto max-w-4xl space-y-8 sm:space-y-10">
      <PublicDiscoveryBreadcrumbs locale={language} items={breadcrumb.itemListElement} />
      <div className="space-y-5">
        <p className="section-label">Alpha Traders Academy</p>
        <p className="text-sm font-medium text-[#E5CA77]">{intakeOpen ? t("Mark’s final mentorship window · Through the end of 2026", "نافذة مارك الأخيرة للمنتورشيب · حتى نهاية 2026") : t("The 2026 mentorship enquiry window has closed", "انتهت نافذة استقبال طلبات المنتورشيب لعام 2026")}</p>
        <h1 className="page-title">{t("ICT Mentorship with Mark", "ICT Mentorship مع مارك")}</h1>
        <p className="text-xl font-medium leading-relaxed text-[#E5CA77]">{t("Understand the reasoning behind your trades.", "افهم السبب وراء قراراتك.")}</p>
        <p className="page-subtitle">{t("Around a year or two in the markets, but still struggling to put what you have learned into practice? Bring your questions, review the reasoning behind your decisions and build a clearer approach with Mark.", "إلك تقريبًا سنة أو سنتين بالمجال، ولسه مش قادر تطبّق اللي تعلّمته بوضوح؟ ارجع بأسئلتك، راجع الأسباب وراء قراراتك، وابنِ طريقة أوضح مع مارك.")}</p>
        <div className="flex flex-wrap gap-3">
          <a href="#mark-explains" className={buttonVariants({ className: "w-full sm:w-auto whitespace-normal text-center" })}>{t("Hear Mark’s Approach · 7:44", "اسمع شرح مارك · 7:44")}</a>
          <a href={intakeOpen ? "#interest" : `/${language}/learn-trading-free`} className={buttonVariants({ variant: "secondary", className: "w-full sm:w-auto whitespace-normal text-center" })}>{intakeOpen ? t("Ask About ICT Mentorship", "استفسر عن ICT Mentorship") : t("Explore the Free Academy", "استكشف الأكاديمية المجانية")}</a>
        </div>
        <p className="text-sm leading-7 text-[#D1D5DB]">{t("Start with the foundations at your own pace. ", "ابدأ بالأساسيات على راحتك. ")}<Link href="/learn-trading-free" className="text-[#E5CA77] underline underline-offset-4">{t("Explore the Free Academy", "استكشف الأكاديمية المجانية")}</Link></p>
        <nav aria-label={t("Mentorship information", "معلومات المنتورشيب")} className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-3 text-sm text-[#E5CA77]">
          <a href="#tuition" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("Programme & tuition", "البرنامج والرسوم")}</a>
          <a href="#curriculum" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("Curriculum", "المنهج")}</a>
          <a href="#next-steps" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("How to get started", "كيف تبدأ")}</a>
          <a href="#faq" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("Common questions", "أسئلة شائعة")}</a>
        </nav>
      </div>
      <section id="mark-explains" aria-labelledby="recording-title" className="scroll-mt-24 rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-5 sm:p-7">
        <p className="section-label">{t("In Mark’s own voice", "بصوت مارك")}</p>
        <h2 id="recording-title" className="mt-3 text-2xl font-semibold">{t("Hear how I approach teaching.", "اسمع طريقة تفكيري بالتعليم.")}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{t("A full explanation of commitment, study, practice and follow-up. Mark discusses student questions, mistakes and what he expects from someone who wants to learn.", "شرح كامل عن الجدية، الدراسة، التطبيق والمتابعة. مارك يحكي عن أسئلة الطلاب والأخطاء وما يتوقّعه من شخص جاي يتعلّم.")}</p>
        <p id="recording-language" className="mb-3 mt-4 text-sm text-[#E5CA77]">{t("Original recording · Arabic with Hebrew phrases · 7:44", "التسجيل الأصلي · عربي مع عبارات عبرية · 7:44")}</p>
        <audio controls preload="none" aria-label={t("Mark’s full mentorship explanation", "شرح مارك الكامل عن المنتورشيب")} aria-describedby="recording-language recording-context" className="block w-full min-w-0" src="/audio/mark-ict-mentorship-original.m4a">
          <a href="/audio/mark-ict-mentorship-original.m4a">{t("Open the original recording", "افتح التسجيل الأصلي")}</a>
        </audio>
        <a href="/audio/mark-ict-mentorship-original.m4a" className="mt-3 inline-block text-sm text-[#E5CA77] underline underline-offset-4">{t("Open recording in your player", "افتح التسجيل في المشغّل")}</a>
        <details className="mt-5 rounded-xl border border-white/10 p-4">
          <summary className="cursor-pointer font-medium">{t("Key points from the recording", "خلاصة الشرح")}</summary>
          <ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-7 text-[#D1D5DB]">{summary.map(point => <li key={point}>{point}</li>)}</ul>
          <p className="mt-3 text-xs leading-6 text-white/50">{t("This is a summary of the clear points, not a verbatim transcript.", "هذه خلاصة للمعاني الواضحة، وليست تفريغًا حرفيًا للتسجيل.")}</p>
        </details>
        <p id="recording-context" className="mt-4 text-xs leading-6 text-white/60">{t("Recorded 7 September 2026. Prices, counts and investing stories are historical, not current enrolment terms or promised results. The current tuition is listed in the programme section below; the remaining details are clarified before joining.", "مسجّل في 7 سبتمبر 2026. الأسعار والأعداد والقصص الاستثمارية فيه تاريخية؛ ليست شروط التسجيل الحالية ولا وعدًا بنتائج. الرسوم الحالية مذكورة بقسم البرنامج أدناه، وبقية التفاصيل تُوضح قبل الانضمام.")}</p>
      </section>
      <section aria-labelledby="approach-title">
        <h2 id="approach-title" className="text-2xl font-semibold">{t("Study. Practise. Ask. Review.", "دراسة. تطبيق. سؤال. مراجعة.")}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">{approach.map((item, index) => <div key={item.title} className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5"><p className="text-xs text-[#C9A227]">0{index + 1}</p><h3 className="mt-2 font-semibold">{item.title}</h3><p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{item.text}</p></div>)}</div>
      </section>
      <section id="curriculum" aria-labelledby="curriculum-title" className="scroll-mt-24">
        <h2 id="curriculum-title" className="text-2xl font-semibold">{t("What you will study", "ما الذي ستدرسه؟")}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">{curriculum.map(item => <div key={item.title} className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5"><h3 className="font-semibold">{item.title}</h3><p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{item.text}</p></div>)}</div>
      </section>
      <section id="tuition" aria-labelledby="tuition-title" className="scroll-mt-24 rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-5 sm:p-7">
        <p className="section-label">{t("One ICT Mentorship programme", "برنامج ICT Mentorship واحد")}</p>
        <h2 id="tuition-title" className="mt-3 text-2xl font-semibold">{t("Your starting point. A clear fee.", "بدايتك واضحة. والرسوم واضحة.")}</h2>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{t("The main focus is people with around one to two years in the markets who still struggle with applying their learning and making progress. Someone ready to start from zero can also enquire.", "التركيز الأساسي على اللي إله تقريبًا سنة أو سنتين بالمجال ولسه بيواجه صعوبة بالتطبيق والتقدّم. واللي جاهز يبدأ من الصفر بيقدر يستفسر كمان.")}</p>
        <dl className="mt-5 divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/20 px-4">
          <div className="py-4"><dt className="font-semibold">{t("With prior market experience", "للي عنده خبرة سابقة بالمجال")}</dt><dd className="mt-2 text-2xl font-semibold text-[#E5CA77]"><span dir="ltr">{ICT_MENTORSHIP_OFFER.experiencedFee}</span></dd></div>
          <div className="py-4"><dt className="font-semibold">{t("Starting from zero", "للي بيبدأ من الصفر")}</dt><dd className="mt-2 text-2xl font-semibold text-[#E5CA77]"><span dir="ltr">{ICT_MENTORSHIP_OFFER.beginnerFee}</span></dd></div>
        </dl>
        <p className="mt-4 text-sm leading-7 text-[#D1D5DB]">{intakeOpen ? t("Final enquiry window: through 31 December 2026, Israel time. Share your experience so your starting point and fee can be confirmed before joining.", "نافذة الاستفسارات الأخيرة حتى 31 ديسمبر 2026 بتوقيت إسرائيل. احكِ عن خبرتك لتوضيح نقطة بدايتك والرسوم قبل الانضمام.") : t("The 2026 enquiry window is closed. These were the fees for that intake. The free Academy remains available.", "انتهت نافذة الاستفسارات لعام 2026. هذه كانت رسوم تلك الدفعة. الأكاديمية المجانية ما زالت متاحة.")}</p>
        {intakeOpen ? <a href="#interest" className={buttonVariants({ className: "mt-4 w-full sm:w-auto whitespace-normal text-center" })}>{t("Ask About ICT Mentorship", "استفسر عن ICT Mentorship")}</a> : null}
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{t("The free Academy stays free. ICT Mentorship with Mark is a separate programme with a fee. Before joining, review the content, duration, session format, schedule, price, follow-up scope and cancellation terms. An enquiry does not reserve a place or create a payment commitment.", "الأكاديمية المجانية بتضل مجانية. المنتورشيب مع مارك برنامج منفصل برسوم. قبل الانضمام، تعرف على المحتوى والمدة وصيغة اللقاءات والمواعيد والسعر ونطاق المتابعة وشروط الإلغاء. الاستفسار لا يحجز مقعدًا ولا ينشئ التزامًا بالدفع.")}</p>
        <div className="mt-4 flex flex-wrap gap-4"><Link href="/learn-trading-free" className="text-sm text-[#E5CA77] underline underline-offset-4">{t("Start with the Free Academy", "ابدأ بالأكاديمية المجانية")}</Link><Link href="/about-founder" className="text-sm text-[#E5CA77] underline underline-offset-4">{t("Meet Mark and Explore the Method", "تعرّف على مارك والمنهج")}</Link></div>
      </section>
      <section id="next-steps" aria-labelledby="next-steps-title" className="scroll-mt-24 rounded-3xl border border-white/10 p-5 sm:p-7">
        <h2 id="next-steps-title" className="text-2xl font-semibold">{t("A clear next step, at your pace.", "خطوة واضحة، على راحتك.")}</h2>
        {intakeOpen ? <ol className="mt-4 list-decimal space-y-4 ps-5 text-sm leading-7 text-[#D1D5DB]">
          <li><strong className="text-white">{t("Explore the teaching. ", "تعرّف على التعليم. ")}</strong>{t("Hear the recording and read the curriculum. If you are starting from zero, explore the free Academy first.", "اسمع التسجيل واقرأ المنهج. إذا بتبدأ من الصفر، استكشف الأكاديمية المجانية أولًا.")}</li>
          <li><strong className="text-white">{t("Tell Mark what you need. ", "احكِ لمارك شو بتحتاج. ")}</strong>{t("Share your experience, learning goal and study availability below. Your enquiry is private, and your email is used to respond to it.", "شارك خبرتك وهدفك ووقتك المتاح بالنموذج أدناه. الاستفسار خاص، وبريدك يُستخدم للرد عليه.")}</li>
          <li><strong className="text-white">{t("Review the programme before joining. ", "راجع تفاصيل البرنامج قبل الانضمام. ")}</strong>{t("Clarify the format, dates, fees, access and follow-up with Mark. Decide after you have the information you need.", "وضّح مع مارك الصيغة والمواعيد والرسوم ومدة الوصول والمتابعة. قرّر بعد ما تكون المعلومات واضحة إلك.")}</li>
        </ol> : <p className="mt-4 text-sm leading-7 text-[#D1D5DB]">{t("The final enquiry window has closed. You can still hear the recording, explore the curriculum and study with the free Academy.", "انتهت نافذة الاستفسارات الأخيرة. بتقدر تسمع التسجيل، تتعرّف على المنهج وتدرس بالأكاديمية المجانية.")}</p>}
      </section>
      <div id="interest" className="scroll-mt-24">
        {intakeOpen && <p className="text-sm leading-7 text-[#D1D5DB]">{t("For adults aged 18 and over. Share your level, learning goal and available study time to discuss whether ICT Mentorship with Mark is a fit.", "للبالغين 18 عامًا فما فوق. احكِ عن مستواك وهدفك والوقت الذي تستطيع تخصيصه للتعلّم، حتى تناقش مع مارك إن كان ICT Mentorship مناسبًا لك.")}</p>}
        {intakeOpen ? <ContactForm locale={language} topic="learning-with-mark" /> : <p className="mt-5 rounded-2xl border border-white/10 p-5 text-sm leading-7">{t("This mentorship enquiry window has closed. You can continue learning with the free Academy.", "انتهت نافذة استقبال طلبات المنتورشيب. بتقدر تكمّل التعلّم بالأكاديمية المجانية.")} <Link href="/learn-trading-free" className="text-[#E5CA77] underline">{t("Explore the Free Academy", "استكشف الأكاديمية المجانية")}</Link></p>}
        <Link href="/privacy-policy" className="mt-4 inline-block text-sm text-[#E5CA77] underline underline-offset-4">{t("Privacy Policy", "سياسة الخصوصية")}</Link>
      </div>
      <LearningShareActions locale={language} />
      <section id="faq" aria-labelledby="faq-title" className="rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-5 sm:p-7">
        <h2 id="faq-title" className="text-2xl font-semibold">{t("ICT Mentorship questions", "أسئلة عن ICT Mentorship")}</h2>
        <div className="mt-4 space-y-3">{faqs.map(faq => <details key={faq.question} className="rounded-xl border border-white/10 p-4"><summary className="cursor-pointer font-semibold">{faq.question}</summary><p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{faq.answer}</p></details>)}</div>
      </section>
      <p className="text-sm leading-7 text-[#D1D5DB]">{t("Also interested in buying or selling USDT for Israeli shekels?", "مهتم أيضًا بشراء أو بيع USDT مقابل الشيكل؟")} <Link href="/buy-usdt-israel" className="text-[#E5CA77] underline underline-offset-4">{t("Explore Alpha Exchange", "تعرّف على Alpha Exchange")}</Link></p>
    </div>
  </section>;
}
