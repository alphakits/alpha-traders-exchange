"use client";

import { normalizeCardlessDigits, type CardlessVerificationKind } from "@alpha-traders/contracts";
import { Input } from "@/components/ui/input";

type Props = {
  isAr: boolean;
  phase?: "request" | "trade";
  tone?: "platform" | "exchange";
  disabled: boolean;
  code: string;
  verificationKind: CardlessVerificationKind;
  verificationValue: string;
  onCodeChange: (value: string) => void;
  onKindChange: (value: CardlessVerificationKind) => void;
  onValueChange: (value: string) => void;
};

export function CardlessWithdrawalFields(props: Props) {
  const { isAr, disabled, code, verificationKind, verificationValue } = props;
  const isBirthDate = verificationKind === "date_of_birth";
  const exchange = props.tone === "exchange";
  const inputClass = exchange ? "h-11 text-base focus-visible:ring-blue-400" : undefined;
  return (
    <fieldset id="cardless-withdrawal-details" disabled={disabled} className={"min-w-0 scroll-mt-28 space-y-4 rounded-xl border p-4 " + (exchange ? "border-blue-400/30 bg-blue-400/[0.06]" : "border-[#C9A227]/40 bg-[#C9A227]/10")}>
      <legend className={"max-w-full px-1 font-semibold " + (exchange ? "text-blue-200" : "text-[#FDE68A]")}>{isAr ? "بيانات السحب دون بطاقة" : "Cardless withdrawal details"}</legend>
      <p id="cardless-details-help" className="text-sm text-[#D1D5DB]">
        {isAr ? "أدخل الرمز ورقم الهوية أو تاريخ الميلاد الذي يطلبه البنك." : "Enter the code and the ID number or date of birth required by your bank."}
      </p>
      <div className="space-y-2">
        <label htmlFor="cardless-withdrawal-code" className="block text-sm font-medium">{isAr ? "١. رمز السحب" : "1. Withdrawal code"}</label>
        <Input id="cardless-withdrawal-code" name="withdrawalCode" className={inputClass} required autoComplete="off" inputMode="numeric" dir="ltr" maxLength={12}
          aria-describedby="cardless-details-help" placeholder={isAr ? "رمز من 4 إلى 12 رقماً" : "4–12 digit code"}
          value={code} onChange={(event) => props.onCodeChange(normalizeCardlessDigits(event.target.value).replace(/\s+/g, ""))} />
      </div>
      <div className="space-y-2">
        <label htmlFor="cardless-verification-kind" className="block text-sm font-medium">{isAr ? "نوع المعلومة المطلوبة من البنك" : "Detail requested by the bank"}</label>
        <select id="cardless-verification-kind" value={verificationKind}
          className={"min-h-11 w-full rounded-lg border border-white/20 bg-[#111] px-3 py-2 text-white " + (exchange ? "text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" : "text-sm")}
          onChange={(event) => { props.onKindChange(event.target.value as CardlessVerificationKind); props.onValueChange(""); }}>
          <option value="id_number">{isAr ? "رقم الهوية" : "ID number"}</option>
          <option value="date_of_birth">{isAr ? "تاريخ الميلاد" : "Date of birth"}</option>
        </select>
        <label htmlFor="cardless-verification-value" className="block text-sm font-medium">
          {isBirthDate ? (isAr ? "٢. تاريخ الميلاد" : "2. Date of birth") : (isAr ? "٢. رقم الهوية" : "2. ID number")}
        </label>
        <Input id="cardless-verification-value" name="verificationValue" className={inputClass} required autoComplete="off" dir="ltr"
          type="text" inputMode={isBirthDate ? "text" : "numeric"}
          maxLength={isBirthDate ? 10 : 12} value={verificationValue}
          aria-describedby={isBirthDate ? "cardless-birth-date-help" : undefined}
          placeholder={isBirthDate ? "DD/MM/YYYY" : (isAr ? "رقم الهوية المطلوب للسحب" : "ID number required for withdrawal")}
          onChange={(event) => props.onValueChange(normalizeCardlessDigits(event.target.value))} />
        {isBirthDate ? <p id="cardless-birth-date-help" className="text-xs text-[#D1D5DB]">
          {isAr ? "اكتب يوم/شهر/سنة، مثال: 25/08/1995" : "Type day/month/year, for example: 25/08/1995"}
        </p> : null}
      </div>
      <p className="text-xs text-[#D1D5DB]">{props.phase === "request" ? (isAr ? "أنشئ الرمز لدى بنكك أولًا. تبقى التفاصيل خاصة حتى تؤكد إرسالها بعد قبول البائع، ثم يُقفل الإلغاء." : "Create the code with your bank first. Details stay private until you confirm sending them after seller acceptance; cancellation then closes.") : isAr ? "راجع البيانات قبل الإرسال. بعد إرسالها يبدأ سحب النقد ولا يعود الإلغاء العادي متاحاً." : "Check both details before sending. Cash collection starts after submission and normal cancellation is no longer available."}</p>
    </fieldset>
  );
}
