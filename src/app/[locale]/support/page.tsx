import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الدعم" : "Support",
    description: locale === "ar" ? "الحصول على دعم Alpha Traders." : "Get Alpha Traders support for account and marketplace issues.",
    path: "/support",
  });
}

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "الدعم" : "Support"}</h1>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
          <p>
            {isAr
              ? "للمساعدة في الحساب، التسجيل، أو مشاكل التداول، تواصل مع دعم Alpha Traders."
              : "For account, onboarding, or trade support, contact Alpha Traders support."}
          </p>
          <p>{isAr ? "البريد: support@alphatraders.co.il" : "Email: support@alphatraders.co.il"}</p>
          <p>{isAr ? "أو استخدم صفحة التواصل الرسمية لإرسال تفاصيل المشكلة." : "Or use the official contact page to submit full issue details."}</p>
        </div>
      </div>
    </section>
  );
}
