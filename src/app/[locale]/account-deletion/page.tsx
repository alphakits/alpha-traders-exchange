import { ContactForm } from "@/components/sections/contact/contact-form";
import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale === "ar" ? "ar" : "en",
    title: locale === "ar" ? "حذف الحساب" : "Account Deletion",
    description: locale === "ar"
      ? "ابدأ طلب حذف حساب Alpha Traders والبيانات المرتبطة به."
      : "Start a request to delete your Alpha Traders account and associated data.",
    path: "/account-deletion",
  });
}

export default async function AccountDeletionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale === "ar" ? "ar" : "en";
  const isAr = locale === "ar";

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-3xl p-5 sm:p-6 md:p-8">
        <h1 className="page-title">{isAr ? "طلب حذف الحساب" : "Request account deletion"}</h1>
        <div className="mt-5 space-y-4 text-sm leading-7 text-[#D1D5DB] sm:text-base">
          <p>
            {isAr
              ? "يمكنك بدء حذف حساب Alpha Traders والبيانات الشخصية المرتبطة به من هذه الصفحة، حتى إذا لم يعد التطبيق مثبتًا على جهازك."
              : "You can start deletion of your Alpha Traders account and associated personal data from this page, even if the app is no longer installed."}
          </p>
          <ol className="list-decimal space-y-2 ps-6">
            <li>
              {isAr
                ? "أرسل النموذج أدناه باستخدام البريد الإلكتروني المسجل في حسابك."
                : "Submit the form below using the email address registered to your account."}
            </li>
            <li>
              {isAr
                ? "سيتحقق فريق الدعم من ملكية الحساب وقد يطلب تأكيدًا إضافيًا عبر البريد الإلكتروني."
                : "Support will verify account ownership and may request an additional email confirmation."}
            </li>
            <li>
              {isAr
                ? "نؤكد استلام الطلب ونكمل الحذف عادةً خلال 30 يومًا."
                : "We acknowledge the request and normally complete deletion within 30 days."}
            </li>
          </ol>
          <p>
            {isAr
              ? "سيُحذف الحساب والبيانات الشخصية غير المطلوبة قانونيًا. قد نحتفظ بسجلات محدودة عند الحاجة للنزاعات أو منع الاحتيال أو أمان المنصة أو الالتزامات القانونية، وسنزيل ارتباطها بالهوية عندما يكون ذلك ممكنًا. يجب أولًا تسوية الصفقات أو النزاعات النشطة."
              : "The account and personal data not legally required will be deleted. Limited records may be retained where needed for disputes, fraud prevention, platform security, or legal obligations, and de-identified where possible. Active trades or disputes must be resolved first."}
          </p>
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-amber-100">
            {isAr
              ? "لا ترسل كلمة المرور أو عبارة استرداد المحفظة أو المفاتيح الخاصة أو أدلة الدفع في هذا النموذج."
              : "Never include your password, wallet recovery phrase, private keys, or payment evidence in this form."}
          </p>
          <p className="text-xs text-[#9CA3AF]">
            {isAr ? "للمتابعة عبر البريد الإلكتروني:" : "To follow up by email:"}{" "}
            <a className="text-[#D4AF37] underline underline-offset-4" href={`mailto:${BRAND_SUPPORT_EMAIL}?subject=${encodeURIComponent("Alpha Traders account deletion request")}`}>
              {BRAND_SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-3xl">
        <ContactForm
          initialValues={{
            subject: isAr ? "طلب حذف حساب Alpha Traders" : "Alpha Traders account deletion request",
            message: isAr
              ? "أطلب حذف حساب Alpha Traders المرتبط بالبريد الإلكتروني المذكور أعلاه والبيانات المرتبطة به."
              : "I request deletion of the Alpha Traders account registered to the email address above and its associated data.",
          }}
          locale={locale}
        />
      </div>
    </section>
  );
}
