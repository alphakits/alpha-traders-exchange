import Link from "next/link";
import { CheckCircle2, CircleDot, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { HelpDetails } from "@/components/ui/help-details";

type CommissionScanState = "awaiting" | "confirming" | "review" | "verified" | "unavailable";

export function CommissionAutomationPanel({
  isAr,
  state,
  lastCheckedAt,
  verificationNotes,
  restrictionReason,
}: {
  isAr: boolean;
  state: CommissionScanState;
  lastCheckedAt?: string;
  verificationNotes?: string;
  restrictionReason?: string;
}) {
  const status = {
    awaiting: isAr ? "بانتظار مطابقة الدفعة" : "Waiting for a matching payment",
    confirming: isAr ? "الدفعة قيد التحقق" : "Payment verification in progress",
    review: isAr ? "راجع تفاصيل الدفعة" : "Review payment details",
    verified: isAr ? "تم التحقق من الدفعة" : "Payment verified",
    unavailable: isAr ? "عنوان الدفع غير متاح" : "Payment address unavailable",
  }[state];
  const detail = {
    awaiting: isAr
      ? "بعد الإرسال، نطابق الدفعة تلقائيًا. لا تحتاج إلى رفع صورة أو انتظار موافقة يدوية عند تطابق الدفعة."
      : "After you send, we match the payment automatically. Matching payments need no screenshot or manual approval.",
    confirming: isAr
      ? "تم حفظ مرجع دفعتك. يستمر التحقق تلقائيًا حتى تأكيد الاستلام. لا ترسل المبلغ مرة أخرى."
      : "Your payment reference is saved. Automatic checks continue while receipt is confirmed. Do not send the amount again.",
    review: isAr
      ? "لم تتم مطابقة المرجع السابق. راجع السبب أدناه واستخدم معرّف الدفعة الأصلية الصحيح. لا تدفع مرة أخرى."
      : "The previous reference did not match. Review the reason below and use the correct original payment ID. Do not pay again.",
    verified: isAr
      ? "تم تأكيد الاستلام. تُحدّث حالة العمولة تلقائيًا، وتُزال قيود العمولة بعد تسديد جميع المستحقات."
      : "Receipt is confirmed. Your commission updates automatically; commission restrictions clear once all dues are settled.",
    unavailable: isAr
      ? "لا ترسل أي مبلغ حتى يظهر عنوان الدفع المعتمد. راجع رسالة الشبكة أدناه."
      : "Wait for a valid payment address before sending funds. Check the network message below.",
  }[state];
  const needsAttention = state === "review" || state === "unavailable";

  return (
    <section aria-label={isAr ? "حالة الدفع" : "Payment status"} dir={isAr ? "rtl" : "ltr"}
      className="commission-surface space-y-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.04] p-4">
      <div role="status" aria-atomic="true">
        <h3 className="commission-notice flex items-center gap-2 text-base font-semibold">
          {state === "verified" ? <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0" /> : state === "confirming" ? <ScanLine aria-hidden="true" className="h-5 w-5 shrink-0" /> : <CircleDot aria-hidden="true" className="h-5 w-5 shrink-0" />}
          {status}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#D1D5DB]">{isAr ? "نتحقق تلقائيًا كل دقيقة. إذا أرسلت الدفعة، لا ترسلها مرة أخرى." : "We check automatically every minute. Already sent? Do not send again."}</p>
        {verificationNotes && state === "review" ? <p className="commission-notice mt-2 text-sm">{verificationNotes}</p> : null}
        {restrictionReason ? <p className="commission-notice mt-2 text-sm">{restrictionReason}</p> : null}
      </div>
      <Link href={`/${isAr ? "ar" : "en"}/seller/commission-checkout`} className="block min-h-11 rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-center text-sm font-semibold text-amber-200">
        {state === "confirming" ? (isAr ? "متابعة الدفع" : "View payment") : (isAr ? "فتح دفع العمولات" : "Open commission payment")}
      </Link>
      <HelpDetails title={isAr ? "تفاصيل التحقق" : "Verification details"}>
        <p>{detail}</p>
        <p className={cn(needsAttention && "commission-notice")}>{isAr ? "آخر فحص" : "Last check"}: {lastCheckedAt && Number.isFinite(Date.parse(lastCheckedAt)) ? <time dateTime={lastCheckedAt}>{new Date(lastCheckedAt).toLocaleString(isAr ? "ar" : "en-US")}</time> : (isAr ? "بانتظار الفحص" : "Waiting for a check")}</p>
      </HelpDetails>
    </section>
  );
}
