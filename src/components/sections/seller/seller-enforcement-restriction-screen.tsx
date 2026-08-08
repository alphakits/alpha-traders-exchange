import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import type { MarketplaceEnforcementRecord } from "@/types/alpha-exchange";

type SellerEnforcementRestrictionScreenProps = {
  locale: "ar" | "en";
  sellerName: string;
  activeRecord?: MarketplaceEnforcementRecord;
  blockReason: string;
};

export function SellerEnforcementRestrictionScreen({
  locale,
  sellerName,
  activeRecord,
  blockReason,
}: SellerEnforcementRestrictionScreenProps) {
  const isAr = locale === "ar";
  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="section-container page-shell flex min-h-screen items-center justify-center py-10">
        <section className="w-full max-w-3xl rounded-3xl border border-red-500/25 bg-[radial-gradient(circle_at_top_right,rgba(185,28,28,0.22),transparent_35%),linear-gradient(135deg,rgba(12,12,12,0.96),rgba(6,6,6,0.98))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] md:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-400/25 bg-red-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-200">
            <ShieldAlert className="h-3.5 w-3.5" />
            {isAr ? "تقييد سوق مؤقت" : "Temporary Marketplace Restriction"}
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
            {isAr ? "تم تقييد صلاحيات البائع مؤقتًا" : "Seller Marketplace Access Is Temporarily Restricted"}
          </h1>
          <p className="mt-3 text-sm text-[#E5E7EB] md:text-base">
            {isAr
              ? `مرحبًا ${sellerName}، تم تقييد قدرات النشر والإدارة الخاصة بعروضك حتى معالجة حالة الامتثال.`
              : `Hi ${sellerName}, listing and publishing permissions are currently restricted until this compliance case is resolved.`}
          </p>

          <div className="mt-5 rounded-2xl border border-red-500/20 bg-black/35 p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-red-200">{isAr ? "سبب التقييد" : "Restriction Reason"}</p>
            <p className="mt-2 text-sm leading-relaxed text-[#F3F4F6]">{blockReason}</p>
          </div>

          {activeRecord ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "رقم المخالفة" : "Violation"}</p>
                <p className="mt-1 text-lg font-semibold text-white">#{activeRecord.violationNumber}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "رسوم الاسترداد" : "Marketplace Recovery Fee"}</p>
                <p className="mt-1 text-lg font-semibold text-[#FDE68A]">{activeRecord.feeAmount.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {activeRecord.feeCurrency}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "موعد الاستحقاق" : "Due Date"}</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {activeRecord.dueAt
                    ? new Date(activeRecord.dueAt).toLocaleString(locale === "ar" ? "ar-EG" : "en-IL")
                    : (isAr ? "غير محدد" : "Not specified")}
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link className={buttonVariants()} href="/dashboard/seller/compliance-payment" locale={locale}>
              {isAr ? "فتح صفحة الدفع" : "Open Payment Page"}
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href={`/${locale}/support`}>
              {isAr ? "التواصل مع الدعم" : "Contact Support"}
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
            <p className="inline-flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              {isAr ? "ملاحظة مهمة" : "Important"}
            </p>
            <p className="mt-1 leading-relaxed text-amber-50/90">
              {isAr
                ? "الصفقات النشطة حاليًا تبقى قابلة للإكمال. هذا التقييد يمنع إنشاء أو تعديل أو تجديد العروض فقط حتى التسوية، وسيتم استعادة صلاحيات البيع تلقائيًا بعد تأكيد الدفع. مخالفة مؤكدة ثانية قد تؤدي إلى سحب صفة البائع المعتمد بشكل دائم."
                : "Existing active trades remain available for completion. This restriction blocks creating, editing, renewing, and publishing listings until resolved, and seller permissions will be restored automatically after payment is confirmed. A second confirmed violation may permanently revoke Approved Seller privileges."}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
