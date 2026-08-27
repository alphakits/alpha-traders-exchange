import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as AppLocale,
    title: locale === "ar" ? "مركز المساعدة" : "Help Center",
    description: locale === "ar" ? "إرشادات Alpha Traders للتداول والأمان والدعم." : "Alpha Traders onboarding, trade-safety, and account support guidance.",
    path: "/help-center",
  });
}

export default async function HelpCenterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  const locale = localeParam as AppLocale;
  const isAr = locale === "ar";
  const guides = isAr
    ? [
        "ابدأ من الموقع الرسمي، وأنشئ حسابك، ثم راجع عروض البائعين المعتمدين وإشاراتهم الحالية قبل فتح الطلب.",
        "داخل غرفة التداول، أكد المبلغ ووسيلة الدفع وشبكة USDT وعنوان المحفظة، وارفع الأدلة المطلوبة في الوقت المناسب.",
        "المشتري يدفع للبائع مباشرة، والبائع يتحقق من وصول الأموال في حسابه ثم يرسل USDT مباشرة إلى محفظة المشتري المؤكدة.",
        "لا تنقل الصفقة إلى Discord أو WhatsApp أو رسالة خاصة، ولا ترسل كلمات مرور أو رموز استرداد أو وثائق هوية خارج المسار الرسمي.",
      ]
    : [
        "Start on the official website, create your account, then review approved listings and each seller's current signals before opening a request.",
        "Inside the Trade Room, confirm the amount, payment method, USDT network, and wallet address, and upload required evidence on time.",
        "The buyer pays the seller directly; the seller verifies receipt in their own account and then sends USDT directly to the buyer's confirmed wallet.",
        "Do not move a trade to Discord, WhatsApp, or a private message, and never send passwords, recovery codes, or identity documents outside the official flow.",
      ];

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-5 sm:p-6 md:p-8">
        <h1 className="page-title">{isAr ? "مركز المساعدة" : "Help Center"}</h1>
        <p className="mt-4 text-sm leading-7 text-[#D1D5DB] sm:text-base">
          {isAr
            ? "اتبع مسار Alpha Exchange الرسمي من فتح الطلب حتى توثيق التحويل وإكمال الصفقة. المنصة تنسق المراحل والأدلة، لكنها لا تحتفظ بأصل أموال الصفقة كإسكرو احتجازي."
            : "Follow the official Alpha Exchange workflow from request creation through transfer evidence and completion. The platform coordinates stages and records; it does not hold marketplace principal in custodial escrow."}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {guides.map((guide, index) => (
            <article key={guide} className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs font-semibold text-[#D4AF37]">{isAr ? `الخطوة ${index + 1}` : `STEP ${index + 1}`}</p>
              <p className="mt-2 text-sm leading-6 text-[#D1D5DB]">{guide}</p>
            </article>
          ))}
        </div>

        <div id="faq" className="mt-8 scroll-mt-28 rounded-2xl border border-white/10 bg-[#0B0B0B]/80 p-5">
          <h2 className="text-lg font-semibold text-white">{isAr ? "الأسئلة الشائعة" : "Frequently Asked Questions"}</h2>
          <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
            <div>
              <h3 className="font-semibold text-white">{isAr ? "هل صفقة Alpha Exchange مضمونة؟" : "Is an Alpha Exchange trade guaranteed?"}</h3>
              <p>{isAr ? "لا. ضوابط المنصة تقلل المخاطر وتُحسن إمكانية مراجعة الصفقة، لكن لا يمكنها إلغاء جميع مخاطر الاحتيال أو الدفع أو الطرف المقابل أو البلوكشين." : "No. Platform controls reduce risk and improve reviewability, but they cannot eliminate every fraud, payment, counterparty, or blockchain risk."}</p>
            </div>
            <div>
              <h3 className="font-semibold text-white">{isAr ? "ماذا يعني بائع معتمد؟" : "What does Approved Seller mean?"}</h3>
              <p>{isAr ? "يعني أن Alpha Traders راجعت طلبه وسمحت له بنشر العروض. لا يعني ذلك ضمان الهوية أو السلوك المستقبلي أو نجاح كل صفقة." : "It means Alpha Traders reviewed the application and allowed that seller to publish listings. It does not guarantee identity, future behavior, or the outcome of every trade."}</p>
            </div>
            <div>
              <h3 className="font-semibold text-white">{isAr ? "ماذا أفعل عند وجود مشكلة؟" : "What should I do when there is a problem?"}</h3>
              <p>{isAr ? "توقف قبل إرسال أو تحرير القيمة، واحتفظ بالأدلة داخل الصفقة، واستخدم النزاع أو البلاغ، ثم تواصل مع الدعم الرسمي." : "Stop before sending or releasing value, preserve evidence inside the trade, use the dispute or report path, and contact official support."}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href="/safety-trust" locale={locale} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#C9A227] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#D4AF37]">
            {isAr ? "قراءة دليل الأمان الكامل" : "Read the complete safety guide"}
          </Link>
          <Link href="/report-abuse" locale={locale} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white transition hover:border-[#C9A227]/50">
            {isAr ? "فتح بلاغ" : "Open a report"}
          </Link>
        </div>
        <p className="mt-6 break-words text-sm text-[#BFC6D2]">
          {isAr ? "الدعم الرسمي:" : "Official support:"}{" "}
          <a className="text-[#D4AF37] underline underline-offset-4" href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a>
        </p>
      </div>
    </section>
  );
}
