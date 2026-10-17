import { createHash } from "node:crypto";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import { COMMISSION_TOLERANCE_MICROS } from "./commission-tolerance.mjs";

export const SHORTFALL_POLICY = "carry_forward_v1";
const SETTLEMENT = "commission_shortfall_balance_v1";
const APPLIED = "commission_shortfall_applied_v1";
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function ledger(snapshot: AlphaExchangeDb) {
  return snapshot.auditLogs.filter((entry) => [SETTLEMENT, APPLIED].includes(String(object(entry.newValue)?.kind)));
}
/** Historical settlements have no balance event and are never reopened. */
export function commissionShortfallBalances(snapshot: AlphaExchangeDb) {
  const balances = new Map<string, number>();
  const ids = new Set<string>();
  for (const entry of ledger(snapshot)) {
    const value = object(entry.newValue)!;
    if (ids.has(entry.id) || typeof value.sellerId !== "string" || value.sellerId !== entry.targetUserId
      || value.policy !== SHORTFALL_POLICY || !Number.isSafeInteger(value.deltaMicros)) throw new Error("Invalid commission shortfall ledger");
    ids.add(entry.id);
    const total = (balances.get(value.sellerId) ?? 0) + Number(value.deltaMicros);
    if (!Number.isSafeInteger(total)) throw new Error("Commission shortfall exceeds supported precision");
    balances.set(value.sellerId, total);
  }
  for (const balance of balances.values()) if (balance < 0) throw new Error("Invalid negative commission shortfall");
  return balances;
}

/** Run only in the same canonical transaction as a provider-verified settlement. */
export function recordCommissionShortfall(snapshot: AlphaExchangeDb, input: {
  settlementId: string; sellerId: string; shortfallMicros: number; excessMicros: number; createdAt: string;
}) {
  for (const amount of [input.shortfallMicros, input.excessMicros]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid commission settlement amount");
  }
  if (input.shortfallMicros && input.excessMicros) throw new Error("Conflicting commission settlement amounts");
  const id = `${input.settlementId}:shortfall`;
  const previous = snapshot.auditLogs.find((entry) => entry.id === id);
  if (previous) {
    const value = object(previous.newValue);
    if (value?.kind !== SETTLEMENT || value.sellerId !== input.sellerId
      || value.shortfallMicros !== input.shortfallMicros || value.excessMicros !== input.excessMicros) throw new Error("Commission shortfall settlement changed");
    return Number(value.appliedExcessMicros);
  }
  const balance = commissionShortfallBalances(snapshot).get(input.sellerId) ?? 0;
  const appliedExcessMicros = Math.min(balance, input.excessMicros);
  const deltaMicros = input.shortfallMicros - appliedExcessMicros;
  if (deltaMicros) snapshot.auditLogs.unshift({ id, action: "commission_recorded", actorUserId: input.sellerId,
    targetUserId: input.sellerId, createdAt: input.createdAt,
    details: "Verified payment shortfall carried forward; excess first offsets an outstanding carried balance. No historical waiver changed.",
    newValue: { kind: SETTLEMENT, policy: SHORTFALL_POLICY, sellerId: input.sellerId,
      sourceSettlementId: input.settlementId, shortfallMicros: input.shortfallMicros,
      excessMicros: input.excessMicros, appliedExcessMicros, deltaMicros } });
  return appliedExcessMicros;
}

/** Attach the balance to the next debt without changing previously issued amounts. */
export function materializeCommissionShortfalls(snapshot: AlphaExchangeDb, createdAt: string, sellerId?: string) {
  let changed = false;
  for (const [seller, balance] of commissionShortfallBalances(snapshot)) {
    if (!balance || (sellerId && seller !== sellerId)) continue;
    const unpaid = snapshot.commissionRecords.filter((record) => record.sellerId === seller && record.paymentStatus !== "paid");
    // A single allowed shortfall stays deferred. Concurrent old instructions may
    // create a larger balance; collect it immediately instead of accumulating waivers.
    if (!unpaid.length && balance <= COMMISSION_TOLERANCE_MICROS) continue;
    const sources = ledger(snapshot).filter((entry) => entry.targetUserId === seller).map((entry) => entry.id).sort();
    const id = `carry-${createHash("sha256").update(JSON.stringify([seller, sources])).digest("hex").slice(0, 32)}`;
    if (snapshot.commissionRecords.some((record) => record.id === id)) throw new Error("Commission shortfall already applied");
    const dueAt = unpaid.map((record) => record.dueAt).filter((date): date is string => Boolean(date && Number.isFinite(Date.parse(date)))).sort()[0];
    snapshot.commissionRecords.push({ id, sellerId: seller, source: "tolerance_carry_forward",
      commissionCalculationVersion: "usdt_6dp_v2", rate: 0, grossAmount: 0,
      commissionAmount: balance / 1e6, paymentStatus: "pending", createdAt, updatedAt: createdAt,
      dueAt: dueAt ?? new Date(Date.parse(createdAt) + 3 * 86_400_000).toISOString(),
      issueReason: "Unpaid balance from an earlier verified commission payment. This is not an additional trading fee." });
    snapshot.auditLogs.unshift({ id: `${id}:applied`, action: "commission_recorded", actorUserId: seller,
      targetUserId: seller, createdAt, details: "Carried shortfall included once in the next payable commission balance.",
      newValue: { kind: APPLIED, policy: SHORTFALL_POLICY, sellerId: seller, commissionId: id, deltaMicros: -balance } });
    changed = true;
  }
  return changed;
}
