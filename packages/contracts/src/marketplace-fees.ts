import { canonicalizeTradeAmount } from "./trade-amount";

/** Multiplies a six-decimal USDT amount by a two-decimal unit price, rounded half-up to cents. */
export function calculateFiatAmount(usdtAmount: string, unitPrice: string) {
  const canonicalAmount = canonicalizeTradeAmount(usdtAmount);
  const priceMatch = unitPrice.match(/^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!canonicalAmount || !priceMatch) return null;
  const [amountWhole, amountDecimal = ""] = canonicalAmount.split(".");
  const [priceWhole, priceDecimal = ""] = unitPrice.split(".");
  const amountMicrounits = BigInt(amountWhole!) * BigInt(1_000_000) + BigInt(amountDecimal.padEnd(6, "0"));
  const priceCents = BigInt(priceWhole!) * BigInt(100) + BigInt(priceDecimal.padEnd(2, "0"));
  const fiatCents = (amountMicrounits * priceCents + BigInt(500_000)) / BigInt(1_000_000);
  return `${fiatCents / BigInt(100)}.${(fiatCents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function calculateBuyerFiatFee(fiatAmount: string) {
  const match = fiatAmount.match(/^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const [wholePart, decimalPart = ""] = fiatAmount.split(".");
  const fiatCents = BigInt(wholePart!) * BigInt(100) + BigInt(decimalPart.padEnd(2, "0"));
  // One percent of fiat cents, rounded half-up to the nearest cent.
  const feeCents = (fiatCents + BigInt(50)) / BigInt(100);
  return `${feeCents / BigInt(100)}.${(feeCents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function calculateBuyerFiatTotal(fiatAmount: string) {
  const fee = calculateBuyerFiatFee(fiatAmount);
  if (fee === null) return null;
  const [baseWhole, baseDecimal = ""] = fiatAmount.split(".");
  const [feeWhole, feeDecimal = ""] = fee.split(".");
  const baseCents = BigInt(baseWhole!) * BigInt(100) + BigInt(baseDecimal.padEnd(2, "0"));
  const feeCents = BigInt(feeWhole!) * BigInt(100) + BigInt(feeDecimal.padEnd(2, "0"));
  const totalCents = baseCents + feeCents;
  return `${totalCents / BigInt(100)}.${(totalCents % BigInt(100)).toString().padStart(2, "0")}`;
}

export const MARKETPLACE_FEE_POLICY = "buyer_seller_1pct_v1" as const;

export function calculateTradePaymentTotal(amount: string, price: string, includesBuyerFee = false) {
  const base = calculateFiatAmount(amount, price);
  if (base === null || !includesBuyerFee) return base;
  const canonicalAmount = canonicalizeTradeAmount(amount)!;
  const [whole, fraction = ""] = canonicalAmount.split(".");
  const [priceWhole, priceFraction = ""] = price.split(".");
  const micros = BigInt(whole!) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  const priceCents = BigInt(priceWhole!) * BigInt(100) + BigInt(priceFraction.padEnd(2, "0"));
  // Round the inclusive total once. Rounding the base first creates gaps
  // (e.g. an exact 5,000 ILS ATM withdrawal becomes unrepresentable).
  const cents = (micros * priceCents * BigInt(101) + BigInt(50_000_000)) / BigInt(100_000_000);
  return `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

/** Allocate rounding to the displayed buyer fee so the two lines always sum to the total. */
export function calculateTradeBuyerFiatFee(amount: string, price: string) {
  const base = calculateFiatAmount(amount, price);
  const total = calculateTradePaymentTotal(amount, price, true);
  if (base === null || total === null) return null;
  const cents = (value: string) => BigInt(value.replace(".", ""));
  const fee = cents(total) - cents(base);
  return `${fee / BigInt(100)}.${(fee % BigInt(100)).toString().padStart(2, "0")}`;
}

export function sellerFeeResponsibilityNotice(locale: string) {
  return locale === "ar"
    ? "عليك تحويل 2% إجمالاً إلى Alpha: 1% عمولتك و1% حصة المشتري ضمن دفعته. حصّل إجمالي الدفع الظاهر كاملاً قبل تأكيد الاستلام وإرسال USDT. إذا قبلت مبلغاً ناقصاً، تتحمّل حصة المشتري الناقصة من مالك؛ ويبقى كامل الـ2% مستحقاً حتى التحقق من السداد. يخص ذلك الصفقات الجديدة فقط."
    : "You must pay Alpha 2% in total: your own 1% plus the buyer’s 1%, included in their payment. Collect the full displayed total before confirming receipt and sending USDT. If you accept less, you cover the missing buyer fee yourself; the full 2% remains due until payment is verified. This applies only to new-policy trades.";
}
