import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function LocalizedNotFound() {
  const locale = await getLocale();
  const isAr = locale === "ar";

  return (
    <section className="section-container page-shell">
      <div className="max-w-2xl rounded-2xl border border-white/10 p-6 md:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-[#C9A227]">404</p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-4xl">{isAr ? "الصفحة غير موجودة" : "Page not found"}</h1>
        <p className="mt-3 text-sm text-[#9CA3AF]">
          {isAr ? "الصفحة المطلوبة غير متاحة حالياً. يمكنك الرجوع للأكاديمية ومتابعة التعلم." : "The page you requested is unavailable. Return to the academy and continue learning."}
        </p>
        <div className="mt-6">
          <Link href="/academy">
            <Button>{isAr ? "العودة إلى الأكاديمية" : "Back to Academy"}</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
