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

export function calculateSellerCommissionAmount(usdtAmount: string) {
  const amountMicrounits = toAmountMicrounits(usdtAmount, false);
  if (amountMicrounits === null) return null;
  // Every positive completed trade must create a payable obligation. Without
  // the one-cent floor, sub-1-USDT trades produced a zero-value pending record
  // that still locked the seller but could not be settled consistently.
  const roundedCommissionCents = (amountMicrounits + BigInt(500_000)) / BigInt(1_000_000);
  const commissionCents = roundedCommissionCents > BigInt(0) ? roundedCommissionCents : BigInt(1);
  return Number(commissionCents) / 100;
}
