import type { ReactNode } from "react";
import { calculateFiatAmount, calculateTradeBuyerFiatFee, calculateTradePaymentTotal } from "@alpha-traders/contracts";
import { formatIls, formatUsdt } from "@/lib/usdt-demand-format";
import type { DemandView } from "@/types/usdt-demand";

export const requestPanel = "rounded-2xl border border-white/10 bg-[#111318] p-5 sm:p-6";
export const requestPrimary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111318] disabled:cursor-not-allowed disabled:opacity-40";
export const requestSecondary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/20 px-4 py-3 text-sm text-gray-100 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-40";
export const requestField = "mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-[#090b0f] px-3 py-3 text-base text-white outline-none placeholder:text-gray-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20 aria-[invalid=true]:border-red-400";

export function paymentLabel(method: string, ar: boolean) {
  if (!ar) return method === "Face-to-Face (Meet in Person)" ? "Face-to-Face" : method;
  return ({ "Bank Transfer": "تحويل بنكي", "Cardless ATM Withdrawal": "سحب دون بطاقة", "Face-to-Face (Meet in Person)": "لقاء شخصي" } as Record<string, string>)[method] ?? method;
}

export function RequestStatus({ state, ar }: { state: DemandView["state"]; ar: boolean }) {
  const labels: Record<DemandView["state"], [string, string]> = {
    open: ["Open", "مفتوح"], paused: ["Needs attention", "بحاجة للمراجعة"], matched: ["Trade in progress", "الصفقة جارية"],
    fulfilled: ["Completed", "مكتمل"], expired: ["Expired", "منتهي"], cancelled: ["Cancelled", "ملغى"], trade_cancelled: ["Trade cancelled", "تم إلغاء الصفقة"],
  };
  const active = ["open", "matched", "fulfilled"].includes(state);
  return <span className={"inline-flex h-fit shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium " + (active ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-300/10 text-amber-200")}>
    <span aria-hidden="true" className={"h-1.5 w-1.5 rounded-full " + (active ? "bg-emerald-400" : "bg-amber-300")} />{labels[state][ar ? 1 : 0]}
  </span>;
}

export function FeeBreakdown({ amount, price, ar, title, seller = false }: { amount: string; price: string; ar: boolean; title: string; seller?: boolean }) {
  const total = calculateTradePaymentTotal(amount, price, true);
  return <section aria-label={title} data-testid="fee-breakdown" className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.04] p-4 sm:p-5">
    <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
    <dl className="mt-4 space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-gray-400">{ar ? "كمية USDT" : "USDT amount"}</dt><dd className="font-medium tabular-nums"><bdi dir="ltr">{formatUsdt(amount)} USDT</bdi></dd></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-gray-400">{ar ? "المبلغ قبل الرسوم" : "Subtotal"}</dt><dd className="tabular-nums"><bdi dir="ltr">₪{formatIls(calculateFiatAmount(amount, price))}</bdi></dd></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-gray-400">{ar ? "رسوم المشتري (1%)" : "Buyer fee (1%)"}</dt><dd className="tabular-nums"><bdi dir="ltr">₪{formatIls(calculateTradeBuyerFiatFee(amount, price))}</bdi></dd></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><dt className="font-semibold">{seller ? (ar ? "إجمالي ما يدفعه المشتري" : "Buyer pays in total") : (ar ? "إجمالي ما تدفعه" : "You pay in total")}</dt><dd className="text-2xl font-semibold tabular-nums text-emerald-300"><bdi dir="ltr">₪{formatIls(total)}</bdi></dd></div>
    </dl>
    <p className="mt-3 text-xs leading-5 text-gray-400">{ar ? "يشمل الإجمالي رسوم المشتري. يستلم المشتري كامل كمية USDT الموضحة." : "The total includes the buyer fee. The buyer receives the full USDT amount shown."}</p>
  </section>;
}

export function RequestSteps({ selling, step, ar }: { selling: boolean; step: number; ar: boolean }) {
  const labels = selling
    ? (ar ? ["اختر طلبًا", "أرسل سعرك", "تابع في غرفة الصفقة"] : ["Choose a request", "Send your price", "Continue in Trade Room"])
    : (ar ? ["أنشئ طلبًا", "قارن الردود", "راجع وافتح الصفقة"] : ["Create a request", "Compare responses", "Review and open trade"]);
  return <ol aria-label={ar ? "خطوات الطلب" : "Request steps"} className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 sm:gap-4 sm:p-4">
    {labels.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={"flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 " + (step === index ? "text-amber-200" : "text-gray-400")}>
      <span className={"flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " + (step === index ? "bg-amber-300 text-black" : "bg-white/10")}>{index + 1}</span>
      <span className="text-xs leading-5 sm:text-sm">{label}</span>
    </li>)}
  </ol>;
}

export function NextStep({ title, children, ar }: { title: string; children: ReactNode; ar: boolean }) {
  return <section data-testid="next-step-panel" aria-label={ar ? "الخطوة التالية" : "Your next step"} className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-5">
    <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">{ar ? "الخطوة التالية" : "Your next step"}</p>
    <h2 className="mt-2 text-lg font-semibold">{title}</h2>
    <div className="mt-2 space-y-3 text-sm leading-6 text-gray-300">{children}</div>
  </section>;
}
