import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الشروط والأحكام" : "Terms of Service",
    description: locale === "ar" ? "الشروط والأحكام لاستخدام Alpha Traders." : "Terms governing use of Alpha Traders.",
    path: "/terms",
  });
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "الشروط والأحكام" : "Terms of Service"}</h1>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
          <p>
            {isAr
              ? "باستخدام منصة Alpha Traders، فإنك توافق على الالتزام بسياسات المنصة، متطلبات التحقق، وقواعد السوق."
              : "By using Alpha Traders, you agree to comply with platform policies, verification requirements, and marketplace rules."}
          </p>
          <p>
            {isAr
              ? "أي محاولة احتيال، إساءة استخدام، أو خرق لقواعد التداول قد تؤدي إلى تعليق الحساب أو إنهائه وفق تقدير الإدارة."
              : "Any fraud attempt, abuse, or breach of trading rules may result in account suspension or termination at administration discretion."}
          </p>
          <p>
            {isAr
              ? "تخضع خدمات Alpha Exchange لتوافر الأنظمة، ومراجعة الأمان، والقيود التنظيمية المحلية."
              : "Alpha Exchange services are subject to system availability, security review, and applicable local compliance constraints."}
          </p>
        </div>
      </div>
    </section>
  );
}
