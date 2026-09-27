import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "سياسة ملفات الارتباط" : "Cookie Policy",
    description: locale === "ar" ? "تفاصيل استخدام ملفات الارتباط في Alpha Traders." : "How Alpha Traders uses cookies.",
    path: "/cookies",
  });
}

export default async function CookiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "سياسة ملفات الارتباط" : "Cookie Policy"}</h1>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
          <p>{isAr
            ? "لربط طلبات التعلّم بالمحتوى الذي جلب الاهتمام، قد نحفظ رمز رابط حملة معروف في تخزين الجلسة داخل علامة التبويب لمدة تصل إلى 30 دقيقة. لا نحفظ لهذا الغرض الرابط الكامل أو كلمات البحث أو معرّفات النقر الإعلاني، ولا نستخدم بكسل إعلان خارجي. يُتجاوز هذا القياس عند تفعيل عدم التتبع أو Global Privacy Control، وتعطيل التخزين لا يمنع إرسال طلب التعلّم."
            : "To understand which content brought learning enquiries, we may keep a recognised campaign link code in this tab's session storage for up to 30 minutes. This does not store the full URL, search terms or advertising click IDs, or use an external ad pixel. Do Not Track or Global Privacy Control disables this measurement. Blocking storage does not prevent an enquiry."}</p>
          <p>
            {isAr
              ? "نستخدم ملفات الارتباط الأساسية للحفاظ على الجلسة، الأمان، وتفضيلات اللغة."
              : "We use essential cookies for session continuity, security, and language preferences."}
          </p>
          <p>
            {isAr
              ? "يمكن تعطيل بعض ملفات الارتباط من المتصفح، لكن ذلك قد يؤثر على وظائف تسجيل الدخول وتجربة المنصة."
              : "You may disable some cookies in your browser, but this can impact login flows and core platform functionality."}
          </p>
        </div>
      </div>
    </section>
  );
}
