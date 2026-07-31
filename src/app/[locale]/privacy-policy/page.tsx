import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "سياسة الخصوصية" : "Privacy Policy",
    description: locale === "ar" ? "سياسة الخصوصية لمنصة Alpha Traders." : "Alpha Traders privacy policy.",
    path: "/privacy-policy",
  });
}

export default async function PrivacyPolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "سياسة الخصوصية" : "Privacy Policy"}</h1>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
          <p>
            {isAr
              ? "نحن في Alpha Traders نحترم خصوصيتك ونستخدم بياناتك فقط لتقديم الخدمات، حماية المعاملات، وتحسين تجربة المنصة."
              : "At Alpha Traders, we respect your privacy and process data only to deliver services, protect transactions, and improve platform experience."}
          </p>
          <p>
            {isAr
              ? "قد تتضمن البيانات: معلومات الحساب، بيانات التحقق، سجل التداول، وتفضيلات الإشعارات. لا نشارك بياناتك الحساسة مع أطراف خارجية دون سبب تشغيلي أو قانوني."
              : "Data may include account details, verification details, trade history, and notification preferences. We do not share sensitive personal data with third parties unless operationally or legally required."}
          </p>
          <p>
            {isAr
              ? "يمكنك إدارة إعدادات الخصوصية من صفحة الإعدادات، وطلب تصدير البيانات أو التواصل مع الدعم عند الحاجة."
              : "You can manage privacy settings from your settings page and request data export or support when needed."}
          </p>
        </div>
      </div>
    </section>
  );
}
