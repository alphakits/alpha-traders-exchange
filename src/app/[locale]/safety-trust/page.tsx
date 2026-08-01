import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "مركز الأمان والثقة" : "Safety & Trust Center",
    description: locale === "ar" ? "كيف تحمي Alpha Traders المشترين والبائعين أثناء التداول." : "How Alpha Traders protects buyers and sellers across the marketplace.",
    path: "/safety-trust",
  });
}

export default async function SafetyTrustCenterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "مركز الأمان والثقة" : "Safety & Trust Center"}</h1>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
          <p>
            {isAr
              ? "نطبّق قواعد تحقق للبائعين، مراجعات تداول، وإجراءات أمان لحماية المشترين والبائعين أثناء كل عملية."
              : "We enforce seller verification, trade review workflows, and security controls to protect both buyers and sellers in every transaction."}
          </p>
          <p>
            {isAr
              ? "عمولة المنصة 1% على الصفقات المكتملة، ولا يمكن نشر أو تجديد عروض جديدة عند وجود عمولات معلّقة."
              : "Platform commission is 1% on completed trades, and sellers cannot publish or renew listings while commission payments are pending."}
          </p>
          <p>
            {isAr
              ? "في صفقات النقد وجهًا لوجه: شارك المعلومات الضرورية فقط، واجتمع في مكان عام آمن، ولا تنفذ أي تحويل خارج مسار الصفقة الرسمي."
              : "For face-to-face cash trades: share only required details, meet in a safe public location, and never execute payment outside the official trade flow."}
          </p>
          <p>
            {isAr
              ? "يتم إظهار البيانات الحساسة تدريجيًا وفق مرحلة الصفقة. إذا لاحظت أي سلوك مريب، أوقف الصفقة وبلّغ الدعم فورًا."
              : "Sensitive details are disclosed progressively by trade stage. If anything appears suspicious, stop the trade and contact support immediately."}
          </p>
        </div>
      </div>
    </section>
  );
}
