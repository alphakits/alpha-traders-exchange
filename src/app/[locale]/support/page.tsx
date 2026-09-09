import { ContactForm } from "@/components/sections/contact/contact-form";
import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
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
  const { locale: rawLocale } = await params;
  const locale = rawLocale === "ar" ? "ar" : "en";
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
          <p>
            {isAr ? "البريد:" : "Email:"}{" "}
            <a
              className="break-all text-[#D4AF37] underline underline-offset-4"
              href={`mailto:${BRAND_SUPPORT_EMAIL}?subject=${encodeURIComponent("Alpha Traders support request")}`}
            >
              {BRAND_SUPPORT_EMAIL}
            </a>
          </p>
          <p>
            {isAr
              ? "يمكنك أيضًا إرسال تفاصيل المشكلة مباشرة من نموذج الدعم الآمن أدناه. لا ترسل كلمة المرور أو رموز الاسترداد أو المفاتيح الخاصة."
              : "You can also send the full issue details directly through the secure support form below. Never include a password, recovery code, or private key."}
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-4xl">
        <ContactForm
          initialValues={{
            subject: isAr ? "طلب دعم Alpha Traders" : "Alpha Traders support request",
          }}
          locale={locale}
        />
      </div>
    </section>
  );
}
