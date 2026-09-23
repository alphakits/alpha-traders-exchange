import { CheckCircle2, CircleDot, Radar, ScanLine, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type CommissionScanState = "awaiting" | "confirming" | "review" | "verified" | "unavailable";

export function CommissionAutomationPanel({
  isAr,
  state,
}: {
  isAr: boolean;
  state: CommissionScanState;
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
    <section
      aria-label={isAr ? "فحص ذكي للبلوك تشين" : "Smart Blockchain Scan"}
      dir={isAr ? "rtl" : "ltr"}
      className="relative isolate overflow-hidden rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-950/60 via-[#0B1514] to-[#091019] p-4 shadow-[inset_0_1px_0_rgba(110,231,183,0.08)] sm:p-5"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -end-10 -top-14 -z-10 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="flex items-start gap-3">
        <div aria-hidden="true" className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">
          <Radar className="h-6 w-6" />
          <span className="absolute -bottom-1 -end-1 h-2.5 w-2.5 rounded-full border-2 border-[#0B1514] bg-emerald-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-wide text-emerald-300">{isAr ? "تأكيد تلقائي للعمولة" : "AUTOMATIC COMMISSION CONFIRMATION"}</p>
          <h3 className="mt-1 text-lg font-semibold leading-snug text-white">{isAr ? "فحص ذكي للبلوك تشين" : "Smart Blockchain Scan"}</h3>
          <p className="mt-1 text-xs leading-5 text-emerald-100/75">{isAr ? "فحص البلوك تشين وإيداعات Binance · كل دقيقة" : "Blockchain & Binance deposit checks · every minute"}</p>
        </div>
      </div>

      <p className="mt-4 text-sm font-medium text-white">{isAr ? "أرسل الدفعة، واترك التأكيد علينا." : "Send once. We handle confirmation."}</p>
      <ol aria-label={isAr ? "كيف يعمل التأكيد التلقائي" : "How automatic confirmation works"} className="mt-3 grid grid-cols-3 gap-2">
        {[
          isAr ? "أرسل المبلغ الدقيق" : "Send exact amount",
          isAr ? "نطابق الاستلام" : "We verify receipt",
          isAr ? "تُسجّل كمدفوعة" : "Marked paid",
        ].map((label, index) => (
          <li key={index} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-3 text-center">
            <span aria-hidden="true" className="mx-auto mb-2 flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/20 text-[10px] font-bold text-emerald-200">{index + 1}</span>
            <span className="block text-[11px] font-medium leading-4 text-slate-200">{label}</span>
          </li>
        ))}
      </ol>

      <div role="status" aria-atomic="true" className={cn("mt-3 rounded-xl border p-3", needsAttention ? "border-amber-300/25 bg-amber-300/5" : "border-emerald-300/15 bg-black/15")}>
        <p className={cn("flex items-center gap-2 text-xs font-semibold", needsAttention ? "text-amber-200" : "text-emerald-200")}>
          {state === "verified" ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" /> : state === "confirming" ? <ScanLine aria-hidden="true" className="h-4 w-4 shrink-0 motion-safe:animate-pulse" /> : <CircleDot aria-hidden="true" className="h-4 w-4 shrink-0" />}
          {status}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-slate-300">{detail}</p>
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-300">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <p>{isAr ? "نتحقق من المبلغ والمستلم والشبكة، ونمنع احتساب الدفعة نفسها مرتين." : "Amount, recipient and network checked. Each payment can be credited only once."}</p>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-slate-400">{isAr ? "قد يستغرق تأكيد الشبكة وقتًا. تُزال قيود العمولة تلقائيًا بعد تسديد جميع المستحقات." : "Network confirmation can take time. Commission restrictions clear automatically once all dues are settled."}</p>
    </section>
  );
}
