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
