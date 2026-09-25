/** Pure settlement policy. Receipt verification and attribution are server-side responsibilities. */
export const COMMISSION_BATCH_TOLERANCE_MICROS = 1_000_000;
export const COMMISSION_BATCH_CLOCK_SKEW_MS = 5 * 60_000;

export interface BatchCommission {
  id: string;
  sellerId: string;
  commissionAmount: number;
  paymentStatus: string;
  paymentVerificationStatus?: string;
  paymentSignature?: string;
  createdAt: string;
  updatedAt: string;
}
export interface BatchReceipt {
  signature: string;
  network: "TRC20" | "BEP20";
  amountMicros: number;
  timestamp: number;
}
/** Obtained from persisted authenticated owner approval, NOT a request-body assertion. */
export interface BatchReceiptAttribution {
  kind: "owner_confirmed_receipt";
  sellerId: string;
  commissionIds: string[];
  signature: string;
  network: "TRC20" | "BEP20";
  expectedAmountMicros: number;
  approvedByUserId: string;
}
export type BatchRejection =
  | "attribution_required" | "invalid_attribution" | "invalid_receipt"
  | "receipt_already_used" | "commission_missing" | "wrong_seller"
  | "already_settled" | "payment_in_progress" | "invalid_commission_amount"
  | "amount_changed" | "outside_tolerance" | "before_commission" | "invalid_commission_status";
export interface CommissionBatchAllocation {
  commissionId: string;
  amountDueMicros: number;
  receivedMicros: number;
  waivedMicros: number;
  excessMicros: number;
}
export type CommissionBatchPlan =
  | { accepted: false; reason: BatchRejection }
  | { accepted: true; sellerId: string; signatureKey: string; expectedMicros: number;
      receivedMicros: number; waivedMicros: number; excessMicros: number;
      allocations: CommissionBatchAllocation[] };

export function commissionReceiptKey(value: string): string | null {
  const normalized = value.trim();
  if (/^binance-deposit:\d{1,64}$/.test(normalized)) return normalized;
  const hash = normalized.replace(/^0x/i, "");
  return /^[a-f\d]{64}$/i.test(hash) ? hash.toLowerCase() : null;
}
export function commissionAmountMicros(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const scaled = amount * 1_000_000;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || rounded <= 0 || Math.abs(scaled - rounded) > 0.000001) return null;
  return rounded;
}
/** Apply tolerance ONCE to the authorized group; no amount-only attribution. */
export function planCommissionBatch(input: {
  records: readonly BatchCommission[]; receipt: BatchReceipt;
  attribution: BatchReceiptAttribution | null; now: number;
}): CommissionBatchPlan {
  const reject = (reason: BatchRejection): CommissionBatchPlan => ({ accepted: false, reason });
  const { records, receipt, attribution, now } = input;
  if (!attribution) return reject("attribution_required");
  const key = commissionReceiptKey(receipt.signature);
  if (!key || !Number.isSafeInteger(receipt.amountMicros) || receipt.amountMicros <= 0
    || !Number.isFinite(now) || !Number.isSafeInteger(receipt.timestamp) || receipt.timestamp <= 0
    || receipt.timestamp > now + COMMISSION_BATCH_CLOCK_SKEW_MS
    || (receipt.network !== "TRC20" && receipt.network !== "BEP20")) return reject("invalid_receipt");
  const ids = attribution.commissionIds;
  if (attribution.kind !== "owner_confirmed_receipt" || !attribution.sellerId
    || !attribution.approvedByUserId || commissionReceiptKey(attribution.signature) !== key
    || attribution.network !== receipt.network || !ids.length || ids.length > 100
    || new Set(ids).size !== ids.length || ids.some((id) => !id)
    || !Number.isSafeInteger(attribution.expectedAmountMicros) || attribution.expectedAmountMicros <= 0) {
    return reject("invalid_attribution");
  }
  if (records.some((record) => record.paymentSignature && commissionReceiptKey(record.paymentSignature) === key)) {
    return reject("receipt_already_used");
  }
  const group: { record: BatchCommission; micros: number }[] = [];
  let expected = BigInt(0);
  for (const id of [...ids].sort()) {
    const matches = records.filter((record) => record.id === id);
    if (matches.length !== 1) return reject("commission_missing");
    const record = matches[0];
    if (record.sellerId !== attribution.sellerId) return reject("wrong_seller");
    if (record.paymentStatus === "paid" || record.paymentVerificationStatus === "verified") return reject("already_settled");
    if (record.paymentStatus !== "pending" && record.paymentStatus !== "overdue") return reject("invalid_commission_status");
    if (record.paymentSignature || record.paymentVerificationStatus === "pending_verification") return reject("payment_in_progress");
    const created = Date.parse(record.createdAt);
    if (!Number.isFinite(created) || receipt.timestamp < created - COMMISSION_BATCH_CLOCK_SKEW_MS) return reject("before_commission");
    const micros = commissionAmountMicros(record.commissionAmount);
    if (micros === null) return reject("invalid_commission_amount");
    expected += BigInt(micros);
    group.push({ record, micros });
  }
  if (expected > BigInt(Number.MAX_SAFE_INTEGER)) return reject("invalid_commission_amount");
  const expectedMicros = Number(expected);
  if (expectedMicros !== attribution.expectedAmountMicros) return reject("amount_changed");
  const delta = receipt.amountMicros - expectedMicros;
  if (Math.abs(delta) > COMMISSION_BATCH_TOLERANCE_MICROS) return reject("outside_tolerance");
  // Largest-remainder allocation conserves actual funds and never turns an
  // underpayment into an overpaid final invoice (or vice versa), even at 1 micro.
  const parts = group.map(({ record, micros }) => {
    const product = BigInt(receipt.amountMicros) * BigInt(micros);
    return { id: record.id, due: micros, received: Number(product / expected), remainder: product % expected };
  });
  let remaining = receipt.amountMicros - parts.reduce((sum, part) => sum + part.received, 0);
  const order = [...parts].sort((a, b) => a.remainder === b.remainder
    ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (const part of order) {
    if (remaining-- <= 0) break;
    part.received++;
  }
  const allocations = parts.map((part) => ({ commissionId: part.id, amountDueMicros: part.due,
    receivedMicros: part.received, waivedMicros: Math.max(0, part.due - part.received),
    excessMicros: Math.max(0, part.received - part.due) }));
  return { accepted: true, sellerId: attribution.sellerId, signatureKey: key, expectedMicros,
    receivedMicros: receipt.amountMicros, waivedMicros: Math.max(0, -delta), excessMicros: Math.max(0, delta), allocations };
}
