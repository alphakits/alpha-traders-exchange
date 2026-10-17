import { currencyText } from "@/components/ui/currency-text";
import { HelpDetails } from "@/components/ui/help-details";

export function CommissionNetworkFeeNotice({ isAr }: { isAr: boolean }) {
  return <div className="space-y-2">
    <p className="commission-notice text-sm leading-6">{isAr
      ? "رسوم الشبكة عليك. تأكد من وصول المبلغ كاملًا."
      : "You cover the network fee. Make sure the full amount arrives."}</p>
    <HelpDetails title={isAr ? "مثال على الرسوم" : "Fee example"}>
      <p>{currencyText(isAr
        ? "مثال: إذا كان المستحق 40 USDT وتُخصم رسوم 1 USDT من التحويل، أرسل 41 USDT ليصل 40 USDT."
        : "Example: if 40 USDT is due and a 1 USDT fee is deducted, send 41 USDT so 40 USDT arrives.")}</p>
      <p>{currencyText(isAr
        ? "إذا كانت محفظتك تدفع الرسوم بشكل منفصل، أرسل 40 USDT فقط. استخدم الرسوم الفعلية الظاهرة في محفظتك."
        : "If your wallet charges the fee separately, send 40 USDT. Use the actual fee shown in your wallet.")}</p>
    </HelpDetails>
  </div>;
}
