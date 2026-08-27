import type { AppLocale } from "@/i18n/routing";
import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import { PUBLIC_TRUST_LAST_UPDATED } from "@/lib/public-trust";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as AppLocale,
    title: locale === "ar" ? "سياسة الخصوصية" : "Privacy Policy",
    description: locale === "ar" ? "كيف تجمع Alpha Traders البيانات وتستخدمها وتحميها." : "How Alpha Traders collects, uses, shares, and protects personal data.",
    path: "/privacy-policy",
  });
}

const privacySections = {
  en: [
    {
      title: "Information we may collect",
      body: "Depending on how you use the service, data may include account and contact details, authentication and verification records, profile information, marketplace listings, trade messages and status history, payment or wallet details needed for a trade, uploaded evidence, support reports, notification preferences, and technical security logs.",
    },
    {
      title: "How information is used",
      body: "We process information to provide accounts and marketplace features, coordinate trades, display appropriate public seller signals, deliver notifications, investigate disputes and abuse, secure the platform, enforce rules, maintain records, improve reliability, and meet applicable legal obligations.",
    },
    {
      title: "Trade-stage disclosure",
      body: "Sensitive trade information is disclosed according to the trade stage and participant role. Only submit information needed for the transaction. Do not place identity documents, bank details, payment evidence, passwords, recovery codes, or wallet secrets in public profiles, Discord, social channels, or unsolicited private messages.",
    },
    {
      title: "Service providers and legal disclosure",
      body: "Information may be shared with vendors that help operate hosting, authentication, messaging, security, storage, or support, subject to their service role. We may also preserve or disclose information when reasonably necessary to investigate abuse, protect users or the service, enforce terms, respond to lawful requests, or meet applicable law. We do not treat private identity documents as public business proof.",
    },
    {
      title: "Retention and security",
      body: "We use reasonable technical and organizational measures intended to protect information. No internet service or storage system can guarantee absolute security. Records are retained only as reasonably needed for operations, security, disputes, enforcement, and applicable legal requirements, after which they may be deleted or de-identified.",
    },
    {
      title: "Your choices and requests",
      body: "You can update available account and notification settings. You may contact support to request access, correction, export, or deletion of personal information. Some information may need to be retained where reasonably required for security, disputes, fraud prevention, record integrity, or law. We may need to verify the requester before acting.",
    },
    {
      title: "Cookies and similar technology",
      body: "The service may use cookies or local storage for authentication, security, preferences, language, and essential functionality. See the Cookies page for additional information.",
    },
  ],
  ar: [
    {
      title: "المعلومات التي قد نجمعها",
      body: "بحسب استخدامك للخدمة، قد تشمل البيانات معلومات الحساب والتواصل، وسجلات المصادقة والتحقق، ومعلومات الملف، وعروض السوق، ورسائل الصفقة وسجل حالتها، وتفاصيل الدفع أو المحفظة اللازمة للصفقة، والأدلة المرفوعة، وبلاغات الدعم، وتفضيلات الإشعارات، وسجلات الأمان التقنية.",
    },
    {
      title: "كيف نستخدم المعلومات",
      body: "نعالج المعلومات لتقديم الحساب وميزات السوق، وتنسيق الصفقات، وإظهار إشارات البائع العامة المناسبة، وإرسال الإشعارات، والتحقيق في النزاعات والإساءة، وحماية المنصة، وتطبيق القواعد، وحفظ السجلات، وتحسين الاعتمادية، والوفاء بالمتطلبات القانونية المعمول بها.",
    },
    {
      title: "إظهار البيانات حسب مرحلة الصفقة",
      body: "تظهر معلومات الصفقة الحساسة حسب مرحلتها ودور المشارك. أرسل فقط المعلومات اللازمة للمعاملة. لا تضع وثائق الهوية أو تفاصيل البنك أو أدلة الدفع أو كلمات المرور أو رموز الاسترداد أو أسرار المحفظة في ملف عام أو Discord أو قنوات التواصل أو رسالة خاصة غير مطلوبة.",
    },
    {
      title: "مزودو الخدمة والإفصاح القانوني",
      body: "قد نشارك المعلومات مع مزودين يساعدون في الاستضافة أو المصادقة أو المراسلة أو الأمان أو التخزين أو الدعم وفق دورهم في الخدمة. وقد نحفظ المعلومات أو نكشفها عند الحاجة المعقولة للتحقيق في إساءة أو حماية المستخدمين أو الخدمة أو تطبيق الشروط أو الاستجابة لطلب قانوني أو الوفاء بالقانون. لا نعامل وثائق الهوية الخاصة كدليل تجاري عام.",
    },
    {
      title: "الاحتفاظ والأمان",
      body: "نستخدم إجراءات تقنية وتنظيمية معقولة لحماية المعلومات. لا يمكن لأي خدمة إنترنت أو نظام تخزين ضمان الأمان المطلق. نحتفظ بالسجلات بقدر الحاجة المعقولة للتشغيل والأمان والنزاعات وتطبيق القواعد والمتطلبات القانونية، ثم قد نحذفها أو نزيل ارتباطها بالهوية.",
    },
    {
      title: "خياراتك وطلباتك",
      body: "يمكنك تحديث إعدادات الحساب والإشعارات المتاحة. ويمكنك التواصل مع الدعم لطلب الوصول إلى معلوماتك الشخصية أو تصحيحها أو تصديرها أو حذفها. قد نحتاج للاحتفاظ ببعض المعلومات لأسباب تتعلق بالأمان أو النزاعات أو منع الاحتيال أو سلامة السجلات أو القانون، وقد نتحقق من هوية مقدم الطلب أولًا.",
    },
    {
      title: "الكوكيز والتقنيات المشابهة",
      body: "قد تستخدم الخدمة الكوكيز أو التخزين المحلي للمصادقة والأمان والتفضيلات واللغة والوظائف الأساسية. راجع صفحة الكوكيز لمعلومات إضافية.",
    },
  ],
} as const;

export default async function PrivacyPolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  const locale = localeParam as AppLocale;
  const isAr = locale === "ar";

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-5 sm:p-6 md:p-8">
        <h1 className="page-title">{isAr ? "سياسة الخصوصية" : "Privacy Policy"}</h1>
        <p className="mt-4 text-sm leading-7 text-[#D1D5DB] sm:text-base">
          {isAr
            ? "تشرح هذه السياسة المعلومات التي قد تعالجها Alpha Traders عند استخدام الموقع أو الأكاديمية أو Alpha Exchange، ولماذا نحتاج إليها وكيف نتعامل معها."
            : "This policy explains information Alpha Traders may process when you use the website, academy, or Alpha Exchange, why it is needed, and how it is handled."}
        </p>

        <div className="mt-8 space-y-4">
          {privacySections[locale].map((section, index) => (
            <article key={section.title} className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <h2 className="text-base font-semibold text-white sm:text-lg">{index + 1}. {section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{section.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 border-t border-white/10 pt-5 text-xs leading-6 text-[#9CA3AF]">
          <p>{isAr ? "آخر مراجعة" : "Last reviewed"}: <time dateTime={PUBLIC_TRUST_LAST_UPDATED}>{PUBLIC_TRUST_LAST_UPDATED}</time></p>
          <p className="break-words">{isAr ? "طلبات الخصوصية" : "Privacy requests"}: <a className="text-[#D4AF37] underline underline-offset-4" href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a></p>
        </div>
      </div>
    </section>
  );
}
