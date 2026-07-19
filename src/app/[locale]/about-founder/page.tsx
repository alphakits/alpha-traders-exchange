import { getLocale } from "next-intl/server";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "عن المؤسس" : "About Founder",
    description: locale === "ar" ? "قصة بناء Alpha Traders والمنهج التعليمي." : "Founder story and educational methodology.",
    path: "/about-founder",
  });
}

export default async function AboutFounderPage() {
  const locale = await getLocale();
  const isAr = locale === "ar";
  return (
    <section className="section-container page-shell">
      <h1 className="page-title">{isAr ? "عن المؤسس" : "About Founder"}</h1>
      <p className="page-subtitle">
        {isAr ? "رؤية تأسيس Alpha Traders ومنهج التعليم المنضبط." : "The vision behind Alpha Traders and disciplined education."}
      </p>
      <div className="mt-6 max-w-3xl space-y-4 text-[#9CA3AF]">
        <p>
          {isAr
            ? "أُسست Alpha Traders لتقديم تعليم تداول عربي مجاني بمستوى عالمي، بعيداً عن الترويج الوهمي."
            : "Alpha Traders was built to deliver world-class free Arabic trading education without hype."}
        </p>
        <p>
          {isAr
            ? "المنهج مبني على الهيكل السعري، إدارة المخاطر، وعلم النفس التداولي مع تطبيقات عملية."
            : "The methodology is built on structure, risk management, and trading psychology with practical application."}
        </p>
      </div>
    </section>
  );
}
