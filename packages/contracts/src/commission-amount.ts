import { canonicalizeTradeAmount } from "./trade-amount";

/** Versioned separately from the buyer/seller fee policy; existing dues keep their rounding. */
export const COMMISSION_CALCULATION_VERSION = "usdt_6dp_v2" as const;
const MICROS = BigInt(1_000_000);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toMicros(value: number): bigint | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const fixed = value.toFixed(6);
  if (!/^\d+\.\d{6}$/.test(fixed) || Number(fixed) !== value) return null;
  const [whole, fraction] = fixed.split(".");
  const micros = BigInt(whole!) * MICROS + BigInt(fraction!);
  return micros <= MAX_SAFE ? micros : null;
}

function fromMicros(value: bigint): number | null {
  const amount = Number(`${value / MICROS}.${String(value % MICROS).padStart(6, "0")}`);
  return toMicros(amount) === value ? amount : null;
}

function onePercentMicros(amount: string) {
  const canonical = canonicalizeTradeAmount(amount);
  if (!canonical) return null;
  const [whole, fraction = ""] = canonical.split(".");
  const quantity = BigInt(whole!) * MICROS + BigInt(fraction.padEnd(6, "0"));
  // Half-up rounding once per party at the common TRC20/BEP20 settlement precision.
  const fee = (quantity + BigInt(50)) / BigInt(100);
  // Reject unpayable/unsafe quantities before a new trade is submitted, never invent a floor.
  return fee > BigInt(0) && fromMicros(fee) !== null && fromMicros(fee * BigInt(2)) !== null ? fee : null;
}

export function calculateSellerCommissionAmount(amount: string) {
  const fee = onePercentMicros(amount);
  return fee === null ? null : fromMicros(fee);
}

export const calculateBuyerCommissionAmount = calculateSellerCommissionAmount;

export function calculateSellerTotalAlphaDue(amount: string) {
  const fee = onePercentMicros(amount);
  return fee === null ? null : fromMicros(fee * BigInt(2));
}

/** Keep payable sub-cent balances visible without changing the precision of fiat totals. */
export function formatCommissionAmount(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/** Exact editable/copyable amount; grouping separators must not enter the payment request. */
export function commissionAmountInput(value: number) {
  if (!Number.isFinite(value) || value < 0) return "";
  return value.toFixed(6).replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
}

export function sumCommissionAmounts(values: readonly number[]) {
  let sum = BigInt(0);
  for (const value of values) {
    const micros = toMicros(value);
    if (micros === null) throw new RangeError("Invalid commission amount");
    sum += micros;
    if (sum > MAX_SAFE) throw new RangeError("Commission total exceeds safe precision");
  }
  const result = fromMicros(sum);
  if (result === null) throw new RangeError("Commission total exceeds safe precision");
  return result;
}
