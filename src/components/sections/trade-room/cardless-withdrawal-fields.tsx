"use client";

import { normalizeCardlessDigits, type CardlessVerificationKind } from "@alpha-traders/contracts";
import { Input } from "@/components/ui/input";

type Props = {
  isAr: boolean;
  phase?: "request" | "trade";
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
  return (
    <fieldset id="cardless-withdrawal-details" disabled={disabled} className="scroll-mt-28 space-y-4 rounded-xl border border-[#C9A227]/40 bg-[#C9A227]/10 p-4">
      <legend className="px-1 font-semibold text-[#FDE68A]">{isAr ? "بيانات السحب دون بطاقة" : "Cardless withdrawal details"}</legend>
      <p id="cardless-details-help" className="text-sm text-[#D1D5DB]">
        {isAr ? "أدخل رمز السحب، ثم رقم الهوية أو تاريخ الميلاد الذي يطلبه البنك. الخانتان مطلوبتان لإرسال البيانات للبائع." : "Enter the withdrawal code and the ID number or date of birth requested by the bank. Both fields are required to send the details to the seller."}
      </p>
      <div className="space-y-2">
        <label htmlFor="cardless-withdrawal-code" className="block text-sm font-medium">{isAr ? "١. رمز السحب" : "1. Withdrawal code"}</label>
        <Input id="cardless-withdrawal-code" name="withdrawalCode" required autoComplete="off" inputMode="numeric" dir="ltr" maxLength={12}
          aria-describedby="cardless-details-help" placeholder={isAr ? "رمز من 4 إلى 12 رقماً" : "4–12 digit code"}
          value={code} onChange={(event) => props.onCodeChange(normalizeCardlessDigits(event.target.value).replace(/\s+/g, ""))} />
      </div>
      <div className="space-y-2">
        <label htmlFor="cardless-verification-kind" className="block text-sm font-medium">{isAr ? "نوع المعلومة المطلوبة من البنك" : "Detail requested by the bank"}</label>
        <select id="cardless-verification-kind" value={verificationKind}
          className="min-h-11 w-full rounded-lg border border-white/20 bg-[#111] px-3 py-2 text-sm text-white"
          onChange={(event) => { props.onKindChange(event.target.value as CardlessVerificationKind); props.onValueChange(""); }}>
          <option value="id_number">{isAr ? "رقم الهوية" : "ID number"}</option>
          <option value="date_of_birth">{isAr ? "تاريخ الميلاد" : "Date of birth"}</option>
        </select>
        <label htmlFor="cardless-verification-value" className="block text-sm font-medium">
          {isBirthDate ? (isAr ? "٢. تاريخ الميلاد" : "2. Date of birth") : (isAr ? "٢. رقم الهوية" : "2. ID number")}
        </label>
        <Input id="cardless-verification-value" name="verificationValue" required autoComplete="off" dir="ltr"
          type="text" inputMode={isBirthDate ? "text" : "numeric"}
          maxLength={isBirthDate ? 10 : 12} value={verificationValue}
          aria-describedby={isBirthDate ? "cardless-birth-date-help" : undefined}
          placeholder={isBirthDate ? "DD/MM/YYYY" : (isAr ? "رقم الهوية المطلوب للسحب" : "ID number required for withdrawal")}
          onChange={(event) => props.onValueChange(normalizeCardlessDigits(event.target.value))} />
        {isBirthDate ? <p id="cardless-birth-date-help" className="text-xs text-[#D1D5DB]">
          {isAr ? "اكتب يوم/شهر/سنة، مثال: 25/08/1995" : "Type day/month/year, for example: 25/08/1995"}
        </p> : null}
      </div>
      <p className="text-xs text-[#D1D5DB]">{props.phase === "request" ? (isAr ? "جهّز السحب من البنك أولاً. تبقى البيانات مخفية حتى يقبل البائع؛ بعد القبول يبدأ سحب النقد ولا يعود الإلغاء العادي متاحاً." : "Prepare the withdrawal with your bank first. Details stay hidden until the seller accepts; cash collection then starts and normal cancellation is no longer available.") : isAr ? "راجع البيانات قبل الإرسال. بعد إرسالها يبدأ سحب النقد ولا يعود الإلغاء العادي متاحاً." : "Check both details before sending. Cash collection starts after submission and normal cancellation is no longer available."}</p>
    </fieldset>
  );
}
