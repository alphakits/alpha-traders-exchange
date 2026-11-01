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

/** Historical rounding only: never apply the former floor to a newly issued trade. */
export function calculateLegacySellerCommissionAmount(usdtAmount: string) {
  const amountMicrounits = toAmountMicrounits(usdtAmount, false);
  if (amountMicrounits === null) return null;
  // Retain the exact former calculation for already-issued requests/dues.
  // New requests use the versioned six-decimal contract and reject zero fees.
  const roundedCommissionCents = (amountMicrounits + BigInt(500_000)) / BigInt(1_000_000);
  const commissionCents = roundedCommissionCents > BigInt(0) ? roundedCommissionCents : BigInt(1);
  return Number(commissionCents) / 100;
}

export function calculateLegacySellerTotalAlphaDue(usdtAmount: string) {
  const sellerFee = calculateLegacySellerCommissionAmount(usdtAmount);
  const buyerFeeCollected = calculateLegacySellerCommissionAmount(usdtAmount);
  if (sellerFee === null || buyerFeeCollected === null) return null;
  return Number((sellerFee + buyerFeeCollected).toFixed(2));
}


export { calculateFiatAmount, calculateBuyerFiatFee, calculateBuyerFiatTotal, calculateTradePaymentTotal,
  calculateSellerCommissionAmount, calculateBuyerCommissionAmount, calculateSellerTotalAlphaDue,
  COMMISSION_CALCULATION_VERSION, formatCommissionAmount, commissionAmountInput, sumCommissionAmounts } from "@alpha-traders/contracts";
