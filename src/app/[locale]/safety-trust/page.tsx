import { AlertTriangle, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { PUBLIC_TRUST_LAST_UPDATED, getPublicTrustFaqs } from "@/lib/public-trust";
import { buildPageMetadata, buildTrustFaqSchema, serializeJsonLd } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as AppLocale,
    title: locale === "ar" ? "مركز الأمان والثقة" : "Safety & Trust Center",
    description:
      locale === "ar"
        ? "ضوابط الأمان وحدود الحماية وطريقة تسوية صفقات Alpha Exchange."
        : "Alpha Exchange safety controls, protection limits, and direct trade settlement explained clearly.",
    path: "/safety-trust",
  });
}

const content = {
  en: {
    eyebrow: "PUBLIC SAFETY GUIDE",
    intro:
      "Alpha Traders uses structured trade controls to reduce risk and make marketplace activity easier to review. Those controls matter, but no peer-to-peer or blockchain transaction is risk-free.",
    controlsTitle: "Controls built into Alpha Exchange",
    controls: [
      "Only sellers manually approved by Alpha Traders can publish marketplace listings.",
      "Current seller signals, trade limits, payment methods, and network details are shown before a buyer opens a request.",
      "Every request receives a fixed trade ID, staged status history, evidence tools, notifications, and time controls.",
      "Sensitive trade details are disclosed according to the trade stage, with dispute and report paths available.",
    ],
    limitsTitle: "What these controls do not guarantee",
    limits: [
      "Approved Seller is a platform access decision, not a guarantee of identity, future conduct, profit, or a successful transaction.",
      "Alpha Traders cannot eliminate fraud, bank-payment reversals, counterparty mistakes, wallet errors, or blockchain risk.",
      "Academy content is educational; it is not personalized financial, legal, or tax advice and does not promise returns.",
      "A logo, domain, social profile, private message, or identity document is not by itself proof of registration or a financial-services licence.",
    ],
    settlementTitle: "How marketplace settlement works",
    settlement:
      "Alpha Traders coordinates and records the workflow; it does not take custody of the principal funds. The buyer pays the seller through the agreed payment method, the seller verifies receipt in their own account, and the seller transfers USDT directly to the buyer's confirmed wallet and network. This is not custodial escrow.",
    channelsTitle: "Use official channels only",
    channels:
      "Use alphatraders.co.il and keep trade communication and evidence inside the official Trade Room. Discord, WhatsApp, and social channels are not the transaction system. Never send funds, passwords, recovery codes, identity documents, wallet secrets, or payment evidence in an unsolicited private message.",
    suspiciousTitle: "If something looks wrong",
    suspicious:
      "Stop before sending or releasing value. Preserve the trade record and evidence, open a dispute or report, and contact support through the official website. Do not accept replacement payment or wallet instructions sent off-platform.",
    faqTitle: "Safety questions, answered clearly",
    report: "Report suspicious activity",
    terms: "Read the marketplace terms",
    updated: "Last reviewed",
  },
  ar: {
    eyebrow: "دليل الأمان العام",
    intro:
      "تستخدم Alpha Traders ضوابط منظمة لتقليل المخاطر وتسهيل مراجعة نشاط السوق. هذه الضوابط مهمة، لكن لا توجد معاملة نظير إلى نظير أو معاملة بلوكشين بلا مخاطر.",
    controlsTitle: "الضوابط المدمجة في Alpha Exchange",
    controls: [
      "يمكن فقط للبائعين الذين وافقت عليهم Alpha Traders يدويًا نشر عروض السوق.",
      "تظهر إشارات البائع الحالية وحدود الصفقة ووسائل الدفع وتفاصيل الشبكة قبل فتح الطلب.",
      "يحصل كل طلب على معرّف صفقة ثابت وسجل مراحل وأدوات أدلة وإشعارات وضوابط وقت.",
      "تظهر تفاصيل الصفقة الحساسة حسب مرحلتها، مع توفر مسارات للنزاع والبلاغ.",
    ],
    limitsTitle: "ما الذي لا تضمنه هذه الضوابط",
    limits: [
      "البائع المعتمد هو قرار لمنح صلاحية استخدام المنصة، وليس ضمانًا للهوية أو السلوك المستقبلي أو الربح أو نجاح الصفقة.",
      "لا تستطيع Alpha Traders إلغاء مخاطر الاحتيال أو عكس الدفعات البنكية أو أخطاء الطرف المقابل أو المحفظة أو البلوكشين.",
      "محتوى الأكاديمية تعليمي، وليس نصيحة مالية أو قانونية أو ضريبية شخصية ولا يعد بعوائد.",
      "الشعار أو النطاق أو الحساب الاجتماعي أو الرسالة الخاصة أو وثيقة الهوية لا يثبت بمفرده تسجيل النشاط أو وجود ترخيص خدمات مالية.",
    ],
    settlementTitle: "كيف تتم تسوية صفقة السوق",
    settlement:
      "تنسق Alpha Traders مسار الصفقة وتسجله، لكنها لا تحتفظ بأصل الأموال. يدفع المشتري للبائع بوسيلة الدفع المتفق عليها، ويتحقق البائع من الاستلام في حسابه، ثم يرسل USDT مباشرة إلى محفظة المشتري وشبكته المؤكدتين. هذا ليس إسكرو احتجازيًا.",
    channelsTitle: "استخدم القنوات الرسمية فقط",
    channels:
      "استخدم alphatraders.co.il واحتفظ بتواصل الصفقة وأدلتها داخل غرفة التداول الرسمية. Discord وWhatsApp وقنوات التواصل ليست نظام الصفقات. لا ترسل أموالًا أو كلمات مرور أو رموز استرداد أو وثائق هوية أو أسرار محفظة أو أدلة دفع في رسالة خاصة غير مطلوبة.",
    suspiciousTitle: "إذا لاحظت شيئًا غير صحيح",
    suspicious:
      "توقف قبل إرسال أو تحرير أي قيمة. احتفظ بسجل الصفقة والأدلة، وافتح نزاعًا أو بلاغًا، وتواصل مع الدعم من خلال الموقع الرسمي. لا تقبل تعليمات بديلة للدفع أو المحفظة تُرسل خارج المنصة.",
    faqTitle: "إجابات واضحة عن أسئلة الأمان",
    report: "الإبلاغ عن نشاط مريب",
    terms: "قراءة شروط السوق",
    updated: "آخر مراجعة",
  },
} as const;

export default async function SafetyTrustCenterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  const locale = localeParam as AppLocale;
  const copy = content[locale];
  const faqs = getPublicTrustFaqs(locale);
  const faqSchema = buildTrustFaqSchema(locale);

  return (
    <section className="section-container page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }}
      />
      <div className="surface-panel mx-auto max-w-5xl p-5 sm:p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">{copy.eyebrow}</p>
        <h1 className="page-title mt-3">{locale === "ar" ? "مركز الأمان والثقة" : "Safety & Trust Center"}</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[#D1D5DB] sm:text-base">{copy.intro}</p>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
              {copy.controlsTitle}
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-[#D1D5DB]">
              {copy.controls.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
              {copy.limitsTitle}
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-[#D1D5DB]">
              {copy.limits.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article id="settlement" className="scroll-mt-28 rounded-2xl border border-[#C9A227]/25 bg-black/30 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <LockKeyhole className="h-5 w-5 shrink-0 text-[#D4AF37]" aria-hidden="true" />
              {copy.settlementTitle}
            </h2>
            <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{copy.settlement}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-black/30 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-white">{copy.channelsTitle}</h2>
            <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{copy.channels}</p>
          </article>
        </div>

        <article className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">{copy.suspiciousTitle}</h2>
          <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{copy.suspicious}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link href="/report-abuse" locale={locale} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#C9A227] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#D4AF37]">
              {copy.report}
            </Link>
            <Link href="/terms" locale={locale} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white transition hover:border-[#C9A227]/50">
              {copy.terms}
            </Link>
          </div>
        </article>

        <div id="faq" className="mt-10 scroll-mt-28">
          <h2 className="text-xl font-semibold text-white sm:text-2xl">{copy.faqTitle}</h2>
          <div className="mt-4 space-y-3">
            {faqs.map((faq) => (
              <details key={faq.id} className="group rounded-2xl border border-white/10 bg-black/30 p-4 open:border-[#C9A227]/30 sm:p-5">
                <summary className="cursor-pointer list-none pr-7 text-sm font-semibold leading-6 text-white marker:hidden sm:text-base">
                  {faq.question}
                </summary>
                <p className="mt-3 border-t border-white/10 pt-3 text-sm leading-7 text-[#D1D5DB]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <p className="mt-8 text-xs text-[#9CA3AF]">
          {copy.updated}: <time dateTime={PUBLIC_TRUST_LAST_UPDATED}>{PUBLIC_TRUST_LAST_UPDATED}</time>
        </p>
      </div>
    </section>
  );
}
