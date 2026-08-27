import type { AppLocale } from "@/i18n/routing";
import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import { PUBLIC_TRUST_LAST_UPDATED } from "@/lib/public-trust";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as AppLocale,
    title: locale === "ar" ? "الشروط والأحكام" : "Terms of Service",
    description: locale === "ar" ? "شروط استخدام Alpha Traders وAlpha Exchange." : "Terms governing use of Alpha Traders and Alpha Exchange.",
    path: "/terms",
  });
}

const sections = {
  en: [
    {
      id: "platform-role",
      title: "1. Platform role and direct settlement",
      paragraphs: [
        "Alpha Traders provides trading education and a structured peer-to-peer workflow for USDT listings and trade requests. The platform coordinates trade stages, records activity and evidence, and provides support and dispute tools.",
        "For marketplace trades, Alpha Traders does not take custody of the principal funds. Buyers send the agreed payment directly to sellers, and sellers transfer USDT directly to the buyer's confirmed wallet and network. The workflow is not custodial escrow.",
      ],
    },
    {
      id: "marketplace-rules",
      title: "2. Marketplace rules and user responsibility",
      paragraphs: [
        "Users must provide accurate information, use only payment methods and wallets they are authorized to use, verify the amount, recipient, network, address, and transaction status, and keep required communication and evidence inside the official Trade Room.",
        "Users accept the risks of peer-to-peer payment, counterparties, payment reversals, wallet mistakes, network fees, blockchain delays, and digital assets. No trade, price, outcome, or profit is guaranteed.",
      ],
    },
    {
      id: "seller-approval",
      title: "3. Seller approval",
      paragraphs: [
        "Only sellers approved by Alpha Traders may publish listings. Applications are reviewed manually, and additional information may be requested. Approval is a revocable platform access decision; it is not a guarantee of identity, future conduct, solvency, profit, or a risk-free transaction.",
      ],
    },
    {
      id: "fees",
      title: "4. Fees and listing access",
      paragraphs: [
        "The current platform commission is 1% of completed marketplace trades unless a different fee is clearly shown before the relevant action. Sellers may be prevented from publishing or renewing listings while commission payments are pending. Fees and fee rules may change prospectively after notice on the website.",
      ],
    },
    {
      id: "evidence-disputes",
      title: "5. Evidence, disputes, and enforcement",
      paragraphs: [
        "Users must preserve accurate payment and transfer evidence. Alpha Traders may review trade records, request additional information, pause actions, restrict listings, suspend accounts, or take other reasonable platform measures when investigating a dispute, suspected fraud, abuse, or a rule violation.",
        "Support and dispute review can help assess platform records but cannot reverse an external bank transfer or blockchain transaction and does not guarantee recovery.",
      ],
    },
    {
      id: "prohibited-conduct",
      title: "6. Prohibited conduct",
      paragraphs: [
        "Users may not impersonate another person, submit false evidence, manipulate reviews or reputation signals, evade restrictions or fees, misuse another person's payment method or account, threaten or harass others, distribute secrets or personal data, or use the service for unlawful activity.",
      ],
    },
    {
      id: "education",
      title: "7. Education and financial decisions",
      paragraphs: [
        "Academy material is general educational information. It is not personalized investment, financial, legal, accounting, or tax advice. Users remain responsible for their own decisions and should seek qualified independent advice where appropriate.",
      ],
    },
    {
      id: "availability",
      title: "8. Availability and changes",
      paragraphs: [
        "Features may be unavailable, delayed, corrected, restricted, or changed for maintenance, security, operational, or legal reasons. Alpha Traders may update these terms prospectively; the reviewed date below identifies the published version.",
      ],
    },
  ],
  ar: [
    {
      id: "platform-role",
      title: "1. دور المنصة والتسوية المباشرة",
      paragraphs: [
        "تقدم Alpha Traders تعليم التداول ومسارًا منظمًا نظيرًا إلى نظير لعروض USDT وطلبات الصفقات. تنسق المنصة مراحل الصفقة وتسجل النشاط والأدلة وتوفر أدوات للدعم والنزاعات.",
        "لا تحتفظ Alpha Traders بأصل أموال صفقات السوق. يرسل المشتري الدفعة المتفق عليها مباشرة إلى البائع، ويرسل البائع USDT مباشرة إلى محفظة المشتري وشبكته المؤكدتين. هذا المسار ليس إسكرو احتجازيًا.",
      ],
    },
    {
      id: "marketplace-rules",
      title: "2. قواعد السوق ومسؤولية المستخدم",
      paragraphs: [
        "يجب على المستخدم تقديم معلومات دقيقة، واستخدام وسائل دفع ومحافظ يملك صلاحية استخدامها، والتحقق من المبلغ والمستلم والشبكة والعنوان وحالة المعاملة، والاحتفاظ بالتواصل والأدلة المطلوبة داخل غرفة التداول الرسمية.",
        "يتحمل المستخدم مخاطر الدفع نظيرًا إلى نظير والطرف المقابل وعكس الدفعات وأخطاء المحفظة ورسوم الشبكة وتأخير البلوكشين والأصول الرقمية. لا توجد صفقة أو نتيجة أو ربح مضمون.",
      ],
    },
    {
      id: "seller-approval",
      title: "3. اعتماد البائع",
      paragraphs: [
        "يمكن فقط للبائعين الذين وافقت عليهم Alpha Traders نشر العروض. تُراجع الطلبات يدويًا وقد تُطلب معلومات إضافية. الاعتماد صلاحية استخدام قابلة للسحب، وليس ضمانًا للهوية أو السلوك المستقبلي أو الملاءة أو الربح أو صفقة بلا مخاطر.",
      ],
    },
    {
      id: "fees",
      title: "4. العمولات وصلاحية نشر العروض",
      paragraphs: [
        "العمولة الحالية للمنصة هي 1% من صفقات السوق المكتملة ما لم تظهر عمولة مختلفة بوضوح قبل الإجراء المعني. قد يُمنع البائع من نشر العروض أو تجديدها أثناء وجود عمولات معلقة. يمكن تعديل العمولات وقواعدها مستقبلًا بعد إشعار على الموقع.",
      ],
    },
    {
      id: "evidence-disputes",
      title: "5. الأدلة والنزاعات والإجراءات",
      paragraphs: [
        "يجب الاحتفاظ بأدلة دقيقة للدفع والتحويل. يمكن لـ Alpha Traders مراجعة سجلات الصفقة وطلب معلومات إضافية وإيقاف إجراءات أو تقييد العروض أو تعليق الحسابات أو اتخاذ إجراءات معقولة عند التحقيق في نزاع أو احتيال مشتبه أو إساءة أو مخالفة للقواعد.",
        "قد تساعد مراجعة الدعم والنزاعات في تقييم سجلات المنصة، لكنها لا تستطيع عكس تحويل بنكي خارجي أو معاملة بلوكشين ولا تضمن استرداد الأموال.",
      ],
    },
    {
      id: "prohibited-conduct",
      title: "6. السلوك المحظور",
      paragraphs: [
        "لا يجوز انتحال شخصية الغير أو تقديم أدلة مزيفة أو التلاعب بالمراجعات أو إشارات السمعة أو تجاوز القيود أو العمولات أو إساءة استخدام وسيلة دفع أو حساب لشخص آخر أو التهديد أو المضايقة أو نشر الأسرار أو البيانات الشخصية أو استخدام الخدمة في نشاط غير قانوني.",
      ],
    },
    {
      id: "education",
      title: "7. التعليم والقرارات المالية",
      paragraphs: [
        "محتوى الأكاديمية معلومات تعليمية عامة، وليس نصيحة استثمارية أو مالية أو قانونية أو محاسبية أو ضريبية شخصية. يبقى المستخدم مسؤولًا عن قراراته وعليه طلب مشورة مستقلة مؤهلة عند الحاجة.",
      ],
    },
    {
      id: "availability",
      title: "8. التوفر والتعديلات",
      paragraphs: [
        "قد تتوقف الميزات أو تتأخر أو تُصحح أو تُقيد أو تتغير لأسباب تتعلق بالصيانة أو الأمان أو التشغيل أو القانون. يمكن لـ Alpha Traders تحديث هذه الشروط مستقبلًا، ويحدد تاريخ المراجعة أدناه النسخة المنشورة.",
      ],
    },
  ],
} as const;

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  const locale = localeParam as AppLocale;
  const isAr = locale === "ar";

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-5 sm:p-6 md:p-8">
        <h1 className="page-title">{isAr ? "الشروط والأحكام" : "Terms of Service"}</h1>
        <p className="mt-4 text-sm leading-7 text-[#D1D5DB]">
          {isAr
            ? "باستخدام Alpha Traders أو Alpha Exchange، فإنك توافق على هذه الشروط وسياسات المنصة المعروضة أثناء استخدام الخدمة."
            : "By using Alpha Traders or Alpha Exchange, you agree to these terms and the platform rules shown while using the service."}
        </p>

        <div className="mt-8 space-y-4">
          {sections[locale].map((section) => (
            <article key={section.id} id={section.id} className="scroll-mt-28 rounded-2xl border border-white/10 bg-black/30 p-5">
              <h2 className="text-base font-semibold text-white sm:text-lg">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-[#D1D5DB]">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </article>
          ))}
        </div>

        <div id="aml-policy" className="mt-4 scroll-mt-28 rounded-2xl border border-white/10 bg-[#0B0B0B]/80 p-5">
          <h2 className="text-base font-semibold text-white">{isAr ? "مراجعة النشاط المشبوه (AML)" : "Suspicious-activity review (AML)"}</h2>
          <p className="mt-2 text-sm leading-7 text-[#D1D5DB]">
            {isAr
              ? "قد تراجع Alpha Traders النشاط المشتبه به، وتطلب معلومات، وتقيد استخدام المنصة، وتحفظ السجلات أو تقدم البلاغات عندما يتطلب القانون المعمول به ذلك. لا يمثل هذا القسم ادعاءً بوجود ترخيص مالي محدد."
              : "Alpha Traders may review suspected activity, request information, restrict platform use, preserve records, or make reports when required by applicable law. This section is not a claim that Alpha Traders holds a particular financial-services licence."}
          </p>
        </div>
        <div id="kyc-policy" className="mt-4 scroll-mt-28 rounded-2xl border border-white/10 bg-[#0B0B0B]/80 p-5">
          <h2 className="text-base font-semibold text-white">{isAr ? "معلومات التحقق (KYC)" : "Verification information (KYC)"}</h2>
          <p className="mt-2 text-sm leading-7 text-[#D1D5DB]">
            {isAr
              ? "قد يُطلب من المستخدم معلومات تحقق إضافية لأسباب تتعلق بالأمان أو النزاعات أو مخاطر المنصة أو القانون. يجب تقديم الوثائق الحساسة فقط من خلال قناة رسمية تطلبها Alpha Traders، ولا يجوز نشرها في الملفات العامة أو قنوات المجتمع."
              : "Users may be asked for additional verification information for security, dispute, platform-risk, or legal reasons. Sensitive documents should be submitted only through an official channel requested by Alpha Traders and must not be posted in public profiles or community channels."}
          </p>
        </div>
        <div id="compliance-policy" className="mt-4 scroll-mt-28 rounded-2xl border border-white/10 bg-[#0B0B0B]/80 p-5">
          <h2 className="text-base font-semibold text-white">{isAr ? "الامتثال للقانون" : "Compliance with law"}</h2>
          <p className="mt-2 text-sm leading-7 text-[#D1D5DB]">
            {isAr
              ? "يتحمل المستخدم مسؤولية التأكد من أن استخدامه للخدمة وطرق الدفع والمحافظ والأصول الرقمية مسموح في مكانه. قد تُقيد Alpha Traders ميزات عندما يكون ذلك مطلوبًا لأسباب قانونية أو أمنية أو تشغيلية."
              : "Users are responsible for ensuring their use of the service, payment methods, wallets, and digital assets is permitted where they are located. Alpha Traders may restrict features when reasonably required for legal, security, or operational reasons."}
          </p>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5 text-xs leading-6 text-[#9CA3AF]">
          <p>{isAr ? "آخر مراجعة" : "Last reviewed"}: <time dateTime={PUBLIC_TRUST_LAST_UPDATED}>{PUBLIC_TRUST_LAST_UPDATED}</time></p>
          <p className="break-words">{isAr ? "أسئلة الشروط" : "Terms questions"}: <a className="text-[#D4AF37] underline underline-offset-4" href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a></p>
        </div>
      </div>
    </section>
  );
}
