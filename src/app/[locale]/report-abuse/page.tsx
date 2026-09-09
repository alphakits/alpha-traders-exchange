import { buildPageMetadata } from "@/lib/seo";
import { ContactForm } from "@/components/sections/contact/contact-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الإبلاغ عن إساءة" : "Report Abuse",
    description:
      locale === "ar"
        ? "الإبلاغ عن أي إساءة أو نشاط مشبوه داخل Alpha Traders."
        : "Report abuse or suspicious activity inside Alpha Traders.",
    path: "/report-abuse",
  });
}

export default async function ReportAbusePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const isAr = locale === "ar";
  const rawTarget = Array.isArray(query.user) ? query.user[0] : query.user;
  const targetUserId = typeof rawTarget === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(rawTarget)
    ? rawTarget
    : "";
  const initialMessage = isAr
    ? `مرجع حساب المستخدم: ${targetUserId || ""}\nمعرّف الصفقة أو العرض: \nوقت الحادثة: \nوصف ما حدث: `
    : `User account reference: ${targetUserId || ""}\nTrade or listing ID: \nIncident time: \nDescription of what happened: `;
  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "الإبلاغ عن إساءة" : "Report Abuse"}</h1>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#D1D5DB]">
          <p>
            {isAr
              ? "إذا واجهت سلوكًا مسيئًا أو نشاطًا مشبوهًا، يرجى إبلاغ فريق Alpha Traders فورًا."
              : "If you encounter abusive behavior or suspicious activity, report it to the Alpha Traders team immediately."}
          </p>
          <p>
            {isAr
              ? "يرجى تضمين: معرف الصفقة، اسم المستخدم، الوقت، ووصف واضح للحادثة."
              : "Please include: trade ID, username, timestamp, and a clear incident description."}
          </p>
          <p>
            {isAr
              ? "قناة البلاغ: support@alphatraders.co.il أو صفحة التواصل الرسمية."
              : "Reporting channel: support@alphatraders.co.il or the official contact page."}
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-4xl">
        <ContactForm
          initialValues={{
            subject: isAr ? "بلاغ إساءة أو نشاط مشبوه" : "Abuse or suspicious activity report",
            message: initialMessage,
          }}
          locale={isAr ? "ar" : "en"}
        />
      </div>
    </section>
  );
}
