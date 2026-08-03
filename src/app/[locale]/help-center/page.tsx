import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "مركز المساعدة" : "Help Center",
    description: locale === "ar" ? "إرشادات Alpha Traders للتداول، التحقق، وحل المشكلات." : "Alpha Traders guides for onboarding, trading, and account support.",
    path: "/help-center",
  });
}

export default async function HelpCenterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "مركز المساعدة" : "Help Center"}</h1>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
          <p>
            {isAr
              ? "ابدأ من التحقق من الحساب، ثم استكشف العروض المعتمدة، واختر البائع المناسب بناءً على السعر والثقة وسرعة الاستجابة."
              : "Start by verifying your account, then browse approved listings and choose sellers based on price, trust score, and response speed."}
          </p>
          <p>
            {isAr
              ? "إذا كنت بائعًا: أنشئ عرضًا واضحًا مع حدود تداول دقيقة، وتابع الطلبات من لوحة البائع، وارفع إثباتات الصفقة في الوقت المناسب."
              : "If you are a seller: publish clear listings with accurate limits, manage requests from your seller dashboard, and upload evidence on time."}
          </p>
          <p>
            {isAr
              ? "للأمان: لا تشارك معلومات إضافية غير مطلوبة، ولا تستخدم قنوات دفع خارج المنصة."
              : "For safety: never share unnecessary personal information and never use payment channels outside the platform workflow."}
          </p>
          <p>
            {isAr
              ? "للتواصل مع الدعم: support@alphatraders.co.il أو واتساب الرسمي."
              : "Support: support@alphatraders.co.il or the official Alpha Traders WhatsApp channel."}
          </p>
        </div>

        <div id="faq" className="mt-8 scroll-mt-28 rounded-2xl border border-white/10 bg-[#0B0B0B]/80 p-5">
          <h2 className="text-lg font-semibold text-white">{isAr ? "الأسئلة الشائعة" : "Frequently Asked Questions"}</h2>
          <div className="mt-3 space-y-3 text-sm text-[#D1D5DB]">
            <p>{isAr ? "كيف أبدأ؟ أنشئ حسابًا ثم تحقق من البيانات الأساسية وادخل السوق." : "How do I start? Create your account, complete basic verification, then enter the marketplace."}</p>
            <p>{isAr ? "هل التداول آمن؟ نعم، عمليات السوق تتم ضمن مسار تنسيقي مع حماية الإسكرو." : "Is trading secure? Yes, trades follow a coordinated workflow with escrow protection."}</p>
            <p>{isAr ? "كيف أتواصل مع الدعم؟ عبر صفحة الدعم أو قنوات Alpha Traders الرسمية." : "How can I contact support? Use the support page or official Alpha Traders channels."}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
