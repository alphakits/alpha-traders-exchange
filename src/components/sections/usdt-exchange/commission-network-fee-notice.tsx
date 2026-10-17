import { currencyText } from "@/components/ui/currency-text";
import { HelpDetails } from "@/components/ui/help-details";

export function CommissionNetworkFeeNotice({ isAr, receiveAmountUsdt = 40 }: { isAr: boolean; receiveAmountUsdt?: number }) {
  const format = (amount: number) => amount.toLocaleString("en-US", { maximumFractionDigits: 6 });
  const receive = format(receiveAmountUsdt);
  const send = format((Math.round(receiveAmountUsdt * 1e6) + 1_000_000) / 1e6);
  return <div className="space-y-2">
    <p className="commission-notice text-sm leading-6">{isAr
      ? "يرجى تحمّل رسوم الشبكة ليصل المبلغ كاملًا."
      : "Please cover the network fee so the full amount shown arrives."}</p>
    <p className="text-sm leading-6 text-slate-300">{isAr
      ? "إذا قُبلت دفعة ناقصة، يُضاف المبلغ المتبقي فقط إلى عمولتك التالية."
      : "Any accepted shortfall is added to your next commission."}</p>
    <HelpDetails title={isAr ? "مثال على الرسوم" : "Fee example"}>
      <p>{currencyText(isAr
        ? `مثال: إذا كان المطلوب وصوله ${receive} USDT وتُخصم رسوم 1 USDT من التحويل، أرسل ${send} USDT ليصل ${receive} USDT.`
        : `Example: if ${receive} USDT must arrive and a 1 USDT fee is deducted, send ${send} USDT so ${receive} USDT arrives.`)}</p>
      <p>{currencyText(isAr
        ? `إذا كانت محفظتك تدفع الرسوم بشكل منفصل، أرسل ${receive} USDT فقط. استخدم الرسوم الفعلية الظاهرة في محفظتك.`
        : `If your wallet charges the fee separately, send ${receive} USDT. Use the actual fee shown in your wallet.`)}</p>
    </HelpDetails>
  </div>;
}
