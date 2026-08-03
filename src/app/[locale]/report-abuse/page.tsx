import { buildPageMetadata } from "@/lib/seo";

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

export default async function ReportAbusePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
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
    </section>
  );
}
