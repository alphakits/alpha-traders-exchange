import {
  canonicalizeNonNegativeTradeAmount,
  canonicalizeTradeAmount,
  normalizeLocalizedDecimalInput,
  normalizeTradeAmountInput,
} from "@alpha-traders/contracts";

export {
  canonicalizeNonNegativeTradeAmount,
  canonicalizeTradeAmount,
  normalizeLocalizedDecimalInput,
  normalizeTradeAmountInput,
};

function toAmountMicrounits(value: string, allowZero = true) {
  const canonical = allowZero
    ? canonicalizeNonNegativeTradeAmount(value)
    : canonicalizeTradeAmount(value);
  if (canonical === null) return null;
  const [wholePart, decimalPart = ""] = canonical.split(".");
  return BigInt(wholePart) * BigInt(1_000_000) + BigInt(decimalPart.padEnd(6, "0"));
}

function formatAmountMicrounits(value: bigint) {
  const wholePart = value / BigInt(1_000_000);
  const decimalPart = (value % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return decimalPart ? `${wholePart}.${decimalPart}` : wholePart.toString();
}

/** Multiplies a six-decimal USDT amount by a two-decimal unit price, rounded half-up to cents. */
export function calculateFiatAmount(usdtAmount: string, unitPrice: string) {
  const canonicalAmount = canonicalizeTradeAmount(usdtAmount);
  const priceMatch = unitPrice.match(/^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!canonicalAmount || !priceMatch) return null;
  const [amountWhole, amountDecimal = ""] = canonicalAmount.split(".");
  const [priceWhole, priceDecimal = ""] = unitPrice.split(".");
  const amountMicrounits = BigInt(amountWhole) * BigInt(1_000_000) + BigInt(amountDecimal.padEnd(6, "0"));
  const priceCents = BigInt(priceWhole) * BigInt(100) + BigInt(priceDecimal.padEnd(2, "0"));
  const fiatCents = (amountMicrounits * priceCents + BigInt(500_000)) / BigInt(1_000_000);
  return `${fiatCents / BigInt(100)}.${(fiatCents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function subtractTradeAmounts(availableAmount: string, soldAmount: string) {
  const available = toAmountMicrounits(availableAmount);
  const sold = toAmountMicrounits(soldAmount, false);
  if (available === null || sold === null || sold > available) return null;
  return formatAmountMicrounits(available - sold);
}

export function isTradeAmountLessThan(left: string, right: string) {
  const leftUnits = toAmountMicrounits(left);
  const rightUnits = toAmountMicrounits(right);
  if (leftUnits === null || rightUnits === null) return null;
  return leftUnits < rightUnits;
}

export const MARKETPLACE_BUYER_FEE_RATE = 0.01;
export const MARKETPLACE_SELLER_FEE_RATE = 0.01;
export const MARKETPLACE_TOTAL_FEE_RATE = MARKETPLACE_BUYER_FEE_RATE + MARKETPLACE_SELLER_FEE_RATE;
export const MARKETPLACE_FEE_CUTOVER_VERSION = "buyer_seller_1pct_v1" as const;

function calculateOnePercentUsdtFee(usdtAmount: string) {
  const amountMicrounits = toAmountMicrounits(usdtAmount, false);
  if (amountMicrounits === null) return null;
  // Every positive completed trade must create a payable obligation. Without
  // the one-cent floor, sub-1-USDT trades produced a zero-value pending record
  // that still locked the seller but could not be settled consistently.
  const roundedCommissionCents = (amountMicrounits + BigInt(500_000)) / BigInt(1_000_000);
  const commissionCents = roundedCommissionCents > BigInt(0) ? roundedCommissionCents : BigInt(1);
  return Number(commissionCents) / 100;
}

export function calculateSellerCommissionAmount(usdtAmount: string) {
  return calculateOnePercentUsdtFee(usdtAmount);
}

export function calculateBuyerCommissionAmount(usdtAmount: string) {
  return calculateOnePercentUsdtFee(usdtAmount);
}

export function calculateSellerTotalAlphaDue(usdtAmount: string) {
  const sellerFee = calculateSellerCommissionAmount(usdtAmount);
  const buyerFeeCollected = calculateBuyerCommissionAmount(usdtAmount);
  if (sellerFee === null || buyerFeeCollected === null) return null;
  return Number((sellerFee + buyerFeeCollected).toFixed(2));
}

export function calculateBuyerFiatFee(fiatAmount: string) {
  const match = fiatAmount.match(/^(?:0|[1-9]\\d*)(?:\\.(\\d{1,2}))?$/);
  if (!match) return null;
  const [wholePart, decimalPart = ""] = fiatAmount.split(".");
  const fiatCents = BigInt(wholePart) * BigInt(100) + BigInt(decimalPart.padEnd(2, "0"));
  // One percent of fiat cents, rounded half-up to the nearest cent.
  const feeCents = (fiatCents + BigInt(50)) / BigInt(100);
  return `${feeCents / BigInt(100)}.${(feeCents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function calculateBuyerFiatTotal(fiatAmount: string) {
  const fee = calculateBuyerFiatFee(fiatAmount);
  if (fee === null) return null;
  const [baseWhole, baseDecimal = ""] = fiatAmount.split(".");
  const [feeWhole, feeDecimal = ""] = fee.split(".");
  const baseCents = BigInt(baseWhole) * BigInt(100) + BigInt(baseDecimal.padEnd(2, "0"));
  const feeCents = BigInt(feeWhole) * BigInt(100) + BigInt(feeDecimal.padEnd(2, "0"));
  const totalCents = baseCents + feeCents;
  return `${totalCents / BigInt(100)}.${(totalCents % BigInt(100)).toString().padStart(2, "0")}`;
}
