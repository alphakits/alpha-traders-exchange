import { randomInt, randomUUID } from "node:crypto";
import { COMMISSION_TOLERANCE_MICROS } from "./commission-tolerance.mjs";
import type { AlphaExchangeDb, CommissionRecord } from "@/types/alpha-exchange";

export const CHECKOUT_ISSUED = "commission_checkout_issued_v1";
export const CHECKOUT_SETTLED = "commission_checkout_settled_v1";
export const CHECKOUT_ATTEMPT = "commission_checkout_attempt_v1";
export const CHECKOUT_RECOVERY = "commission_checkout_receipt_recovery_v1";
export const CHECKOUT_SELECTED = "commission_checkout_network_selected_v1";
export const CHECKOUT_TOLERANCE = COMMISSION_TOLERANCE_MICROS;
export const CHECKOUT_TOLERANCE_ATTRIBUTION = "unambiguous_checkout_tolerance_v1";
export type CheckoutNetwork = "TRC20" | "BEP20";
export interface CommissionCheckout {
  id: string;
  sellerId: string;
  network: CheckoutNetwork;
  createdAt: string;
  expectedMicros: number;
  /** An independently reserved whole-USDT overpayment option, issued before payment. */
  roundedMicros?: number;
  requestedMicros: number;
  dueMicros: number;
  commissions: Array<{ id: string; dueMicros: number; createdAt: string }>;
}
export interface CheckoutDeposit {
  signature: string; network: CheckoutNetwork; amountMicros: number; timestamp: number;
}
export interface CheckoutPorts {
  read(): Promise<AlphaExchangeDb>;
  atomic<T>(mutation: (snapshot: AlphaExchangeDb) => T): Promise<T>;
  verify(deposit: CheckoutDeposit, earliestTimestamp: number): Promise<{ verified: boolean; pending?: boolean }>;
  destination(network: CheckoutNetwork): string;
  now?(): number;
  random?(): number;
  afterCommit?(): void;
}
export class CommissionCheckoutError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "CommissionCheckoutError"; }
}
function fail(code: string): never { throw new CommissionCheckoutError(code); }
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function checkoutReceiptKey(value: string) {
  const text = value.trim();
  if (/^binance-deposit:\d{1,64}$/.test(text)) return text;
  return /^(?:0x)?[a-f0-9]{64}$/i.test(text) ? text.replace(/^0x/i, "").toLowerCase() : null;
}
export function checkoutMicros(value: number): number {
  const scaled = value * 1e6;
  const micros = Math.round(scaled);
  if (!Number.isFinite(value) || !Number.isSafeInteger(micros) || micros <= 0 || Math.abs(scaled - micros) > 0.000001) fail("invalid_amount");
  return micros;
}
export function parseCheckoutAmount(value: string) {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value)) fail("invalid_amount");
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  if (micros <= BigInt(0) || micros > BigInt(Number.MAX_SAFE_INTEGER)) fail("invalid_amount");
  return Number(micros);
}
function authorize(snapshot: AlphaExchangeDb, sellerId: string) {
  const user = snapshot.users.find((candidate) => candidate.id === sellerId);
  if (!user || user.disabled || !(user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended"
    || [user.role, ...(user.roles ?? [])].some((role) => ["owner", "admin", "approved_seller", "pending_seller_approval"].includes(role)))) fail("seller_required");
}
function entries(snapshot: AlphaExchangeDb, kind: string) {
  return snapshot.auditLogs.filter((entry) => object(entry.newValue)?.kind === kind);
}
export function getCommissionCheckouts(snapshot: AlphaExchangeDb): CommissionCheckout[] {
  return entries(snapshot, CHECKOUT_ISSUED).map((entry) => {
    const raw = object(object(entry.newValue)?.checkout);
    if (!raw || typeof raw.id !== "string" || entry.id !== `${raw.id}:issued`
      || raw.sellerId !== entry.actorUserId || raw.sellerId !== entry.targetUserId
      || (raw.network !== "TRC20" && raw.network !== "BEP20")
      || typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))
      || raw.createdAt !== entry.createdAt || !Number.isSafeInteger(raw.expectedMicros) || Number(raw.expectedMicros) <= 0
      || !Number.isSafeInteger(raw.requestedMicros) || Number(raw.requestedMicros) <= 0
      || Math.abs(Number(raw.requestedMicros) - Number(raw.dueMicros)) > CHECKOUT_TOLERANCE
      || !Number.isSafeInteger(raw.dueMicros) || Number(raw.dueMicros) <= 0
      || Math.abs(Number(raw.expectedMicros) - Number(raw.dueMicros)) > CHECKOUT_TOLERANCE
      || (raw.roundedMicros !== undefined && (!Number.isSafeInteger(raw.roundedMicros)
        || Number(raw.roundedMicros) !== Math.ceil(Number(raw.expectedMicros) / 1e6) * 1e6
        || Number(raw.roundedMicros) <= Number(raw.expectedMicros)
        || Number(raw.roundedMicros) < Number(raw.dueMicros)
        || Number(raw.roundedMicros) - Number(raw.dueMicros) > CHECKOUT_TOLERANCE
        || raw.expectedMicros !== raw.requestedMicros))
      || !Array.isArray(raw.commissions) || !raw.commissions.length || raw.commissions.length > 100) fail("invalid_saved_checkout");
    const checkout = raw as unknown as CommissionCheckout;
    const ids = new Set<string>();
    let total = BigInt(0);
    for (const row of checkout.commissions) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)
        || !Number.isSafeInteger(row.dueMicros) || row.dueMicros <= 0
        || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) fail("invalid_saved_checkout");
      total += BigInt(row.dueMicros); ids.add(row.id);
    }
    if (total !== BigInt(checkout.dueMicros)) fail("invalid_saved_checkout");
    return checkout;
  });
}
function settled(snapshot: AlphaExchangeDb, id: string) {
  return entries(snapshot, CHECKOUT_SETTLED).some((entry) => object(entry.newValue)?.checkoutId === id);
}
function assertUnchanged(snapshot: AlphaExchangeDb, checkout: CommissionCheckout) {
  for (const row of checkout.commissions) {
    const record = snapshot.commissionRecords.find((candidate) => candidate.id === row.id);
    if (!record || record.sellerId !== checkout.sellerId || record.createdAt !== row.createdAt
      || checkoutMicros(record.commissionAmount) !== row.dueMicros) fail("commission_changed");
    if (record.paymentStatus === "paid" || record.paymentVerificationStatus === "verified") fail("commission_already_paid");
    if (!["pending", "overdue"].includes(record.paymentStatus)) fail("invalid_commission_status");
    if (record.paymentSignature || record.paymentVerificationStatus === "pending_verification") fail("payment_in_progress");
  }
}
function paidThroughAnotherFlow(snapshot: AlphaExchangeDb, checkout: CommissionCheckout) {
  return checkout.commissions.every((expected) => snapshot.commissionRecords.some((record) => (
    record.id === expected.id && record.sellerId === checkout.sellerId && record.paymentStatus === "paid"
  )));
}
export function pendingCommissionCheckouts(snapshot: AlphaExchangeDb) {
  // A fully settled legacy/owner payment must not block later genuine dues.
  // Its old amount remains permanently reserved; no receipt is invented.
  return getCommissionCheckouts(snapshot).filter((checkout) => !settled(snapshot, checkout.id)
    && !paidThroughAnotherFlow(snapshot, checkout));
}
function sameCheckoutGroup(a: CommissionCheckout, b: CommissionCheckout) {
  return a.sellerId === b.sellerId && a.dueMicros === b.dueMicros
    && JSON.stringify(a.commissions) === JSON.stringify(b.commissions);
}
function selectedCheckout(snapshot: AlphaExchangeDb, sellerId: string, pending = pendingCommissionCheckouts(snapshot)) {
  const selection = entries(snapshot, CHECKOUT_SELECTED).find((entry) =>
    entry.id === `${sellerId}:checkout-network` && entry.actorUserId === sellerId && entry.targetUserId === sellerId);
  return pending.find((checkout) => checkout.sellerId === sellerId && checkout.id === object(selection?.newValue)?.checkoutId)
    ?? pending.find((checkout) => checkout.sellerId === sellerId);
}
function canChangeCheckoutNetwork(snapshot: AlphaExchangeDb, checkout: CommissionCheckout) {
  const group = getCommissionCheckouts(snapshot).filter((candidate) => sameCheckoutGroup(candidate, checkout));
  try { for (const candidate of group) assertUnchanged(snapshot, candidate); } catch { return false; }
  const ids = new Set(group.map((candidate) => candidate.id));
  // An attempt is recorded only after a possible deposit has been discovered.
  // Once that happens, keep checking it instead of inviting another payment.
  return !snapshot.auditLogs.some((entry) => {
    const value = object(entry.newValue);
    return [CHECKOUT_ATTEMPT, CHECKOUT_RECOVERY, CHECKOUT_SETTLED].includes(String(value?.kind))
      && ids.has(String(value?.checkoutId));
  }) && !snapshot.commissionRecords.some((record) => checkout.commissions.some((row) => row.id === record.id)
    && Boolean(record.paymentSubmittedAt));
}
function selectCheckoutNetwork(snapshot: AlphaExchangeDb, checkout: CommissionCheckout, now: number) {
  const id = `${checkout.sellerId}:checkout-network`;
  const index = snapshot.auditLogs.findIndex((entry) => entry.id === id);
  if (index >= 0 && object(snapshot.auditLogs[index].newValue)?.checkoutId === checkout.id) return;
  const entry = { id, action: "commission_recorded" as const, actorUserId: checkout.sellerId, targetUserId: checkout.sellerId,
    createdAt: new Date(now).toISOString(), details: "Seller changed the commission network before sending payment.",
    newValue: { kind: CHECKOUT_SELECTED, checkoutId: checkout.id } };
  if (index >= 0) snapshot.auditLogs[index] = entry; else snapshot.auditLogs.unshift(entry);
}
function reservedReceipts(snapshot: AlphaExchangeDb) {
  const used = new Set(snapshot.commissionRecords.map((record) => checkoutReceiptKey(record.paymentSignature ?? "")).filter(Boolean));
  for (const entry of snapshot.auditLogs) {
    const data = object(entry.newValue);
    if (data?.kind === CHECKOUT_SETTLED) used.add(checkoutReceiptKey(String(object(data.receipt)?.signature ?? "")));
    if (data?.kind === "commission_batch_receipt_approval_v1") used.add(checkoutReceiptKey(String(object(data.batch)?.signature ?? "")));
  }
  return used;
}
function reservedAmounts(snapshot: AlphaExchangeDb, currentIds: ReadonlySet<string>, includeHistoricalBase = true) {
  const used = new Set(getCommissionCheckouts(snapshot).flatMap((checkout) => [checkout.expectedMicros, ...(checkout.roundedMicros ? [checkout.roundedMicros] : [])]));
  for (const record of snapshot.commissionRecords) {
    // The current group's base fee is not a separate payment reference. Reserving
    // it against itself forced a needless micro suffix even for a single fee.
    // Keep all earlier/other fees, actual legacy references, and checkout history
    // reserved so a different seller can never claim the same displayed amount.
    for (const amount of [currentIds.has(record.id) || (!includeHistoricalBase && record.paymentExpectedAmountMode !== "legacy_base"
      && record.paymentExpectedAmount !== undefined) ? undefined : record.commissionAmount, record.paymentExpectedAmount, ...(record.paymentReservedExpectedAmounts ?? [])]) {
      if (typeof amount === "number" && amount > 0) used.add(checkoutMicros(amount));
    }
  }
  return used;
}
function reserveAmount(snapshot: AlphaExchangeDb, desired: number, due: number, random: number, currentIds: ReadonlySet<string>) {
  if (Math.abs(desired - due) > CHECKOUT_TOLERANCE) fail("outside_tolerance");
  const used = reservedAmounts(snapshot, currentIds);
  // Keep a requested rounded amount only when it is an unused pre-payment reference.
  // Collisions receive a visible micro suffix. Other amounts still require
  // independent verification and unambiguous attribution at receipt time.
  if (!used.has(desired)) return desired;
  const minimum = Math.max(1, due - CHECKOUT_TOLERANCE);
  const maximum = due + CHECKOUT_TOLERANCE;
  if (!Number.isSafeInteger(maximum)) fail("invalid_amount");
  const start = Number.isSafeInteger(random) ? Math.abs(random) % 9999 + 1 : 1;
  for (let i = 0; i < 9999; i++) {
    const offset = (start + i - 1) % 9999 + 1;
    for (const candidate of [desired + offset, desired - offset]) {
      if (candidate >= minimum && candidate <= maximum && !used.has(candidate)) return candidate;
    }
  }
  fail("payment_reference_unavailable");
}
function isIssuedReference(checkout: CommissionCheckout, amount: number) {
  return amount === checkout.expectedMicros || amount === checkout.roundedMicros;
}
function recoveryEntries(snapshot: AlphaExchangeDb, checkout: CommissionCheckout) {
  return entries(snapshot, CHECKOUT_RECOVERY).filter((entry) => object(entry.newValue)?.checkoutId === checkout.id);
}
/** The tolerance applies to the actual received amount, once for the whole group.
 * A reserved reference suffix does not revoke tolerance. Explicit recovery
 * grants retain their binding; competing references are checked separately. */
function acceptsDeposit(snapshot: AlphaExchangeDb, checkout: CommissionCheckout, deposit: CheckoutDeposit) {
  if (isIssuedReference(checkout, deposit.amountMicros)) return true;
  if (!Number.isSafeInteger(deposit.amountMicros) || deposit.amountMicros <= 0
    || Math.abs(deposit.amountMicros - checkout.dueMicros) > CHECKOUT_TOLERANCE) return false;
  const recoveries = recoveryEntries(snapshot, checkout);
  if (!recoveries.length) return true;
  return recoveries.some((entry) => {
    const grant = object(entry.newValue);
    const owner = snapshot.users.find((user) => user.id === entry.actorUserId);
    return entry.id === `${checkout.id}:receipt-recovery` && entry.targetUserId === checkout.sellerId
      && owner && !owner.disabled && (owner.role === "owner" || owner.roles?.includes("owner"))
      && grant?.checkoutId === checkout.id && grant.network === checkout.network
      && grant.amountMicros === deposit.amountMicros && Number.isSafeInteger(grant.timestamp)
      && Number.isSafeInteger(grant.timestampToleranceMs) && Number(grant.timestampToleranceMs) >= 0
      && Number(grant.timestampToleranceMs) <= 60_000
      && Math.abs(deposit.timestamp - Number(grant.timestamp)) <= Number(grant.timestampToleranceMs);
  });
}
function receiptAttribution(snapshot: AlphaExchangeDb, checkout: CommissionCheckout, deposit: CheckoutDeposit) {
  return isIssuedReference(checkout, deposit.amountMicros) ? "seller_preissued_payment_reference"
    : recoveryEntries(snapshot, checkout).length ? "owner_confirmed_received_deposit" : CHECKOUT_TOLERANCE_ATTRIBUTION;
}
function assertToleranceAttribution(snapshot: AlphaExchangeDb, checkout: CommissionCheckout, deposit: CheckoutDeposit) {
  if (receiptAttribution(snapshot, checkout, deposit) !== CHECKOUT_TOLERANCE_ATTRIBUTION) return;
  // Compare payment instructions that could accept this receipt when it arrived.
  // An exact-only legacy invoice does not own a tolerance range: referenceConflict
  // protects its actual issued references, including historical reservations.
  // Keep checkouts paid AT/AFTER receipt time, so scan order cannot manufacture
  // uniqueness. Only a fully paid group with an earlier paidAt is closed.
  const otherCheckout = getCommissionCheckouts(snapshot).some((other) => other.id !== checkout.id
    && other.network === checkout.network && Date.parse(other.createdAt) <= deposit.timestamp
    && acceptsDeposit(snapshot, other, deposit)
    && !other.commissions.every((expected) => snapshot.commissionRecords.some((record) => (
      record.id === expected.id && record.sellerId === other.sellerId
      && record.createdAt === expected.createdAt && record.paymentStatus === "paid"
      && Number.isFinite(Date.parse(record.paidAt ?? "")) && Date.parse(record.paidAt!) < deposit.timestamp
    ))));
  if (otherCheckout) fail("ambiguous_payment_amount");
}
/** A received amount is not a reusable transaction identifier. Keep it reserved
 * for instruction allocation, but let a later, independently verified receipt
 * use the same amount after every member of the earlier checkout was paid. */
function earlierCheckoutReceipt(snapshot: AlphaExchangeDb, record: CommissionRecord, deposit: CheckoutDeposit) {
  const settlement = object((record as CommissionRecord & { paymentBatchSettlement?: unknown }).paymentBatchSettlement);
  const previous = getCommissionCheckouts(snapshot).find((row) => row.id === settlement?.batchId);
  const key = checkoutReceiptKey(record.paymentSignature ?? "");
  if (!previous || !key || isIssuedReference(previous, deposit.amountMicros)
    || !previous.commissions.some((member) => member.id === record.id)) return false;
  return previous.commissions.every((member) => snapshot.commissionRecords.some((paid) => {
    const allocation = object((paid as CommissionRecord & { paymentBatchSettlement?: unknown }).paymentBatchSettlement);
    return paid.id === member.id && paid.sellerId === previous.sellerId && paid.createdAt === member.createdAt
      && paid.paymentStatus === "paid" && paid.paymentVerificationStatus === "verified"
      && Number.isFinite(Date.parse(paid.paidAt ?? "")) && Date.parse(paid.paidAt!) < deposit.timestamp
      && checkoutReceiptKey(paid.paymentSignature ?? "") === key
      && allocation?.batchId === previous.id && allocation?.groupReceivedMicros === deposit.amountMicros;
  }));
}
/** A whole-number option is not a permanent payer identity. Keep its reservation
 * for instruction allocation, but allow a new verified receipt only after the
 * entire old group was verified paid BEFORE the new checkout was issued.
 * Exact references, open groups and missing/late closure remain protected. */
function closedRoundedReference(snapshot: AlphaExchangeDb, previous: CommissionCheckout, current: CommissionCheckout, amount: number) {
  const issuedAt = Date.parse(current.createdAt);
  return previous.id !== current.id && previous.roundedMicros === amount && previous.expectedMicros !== amount
    && Date.parse(previous.createdAt) < issuedAt
    && previous.commissions.every((member) => snapshot.commissionRecords.some((record) => (
      record.id === member.id && record.sellerId === previous.sellerId && record.createdAt === member.createdAt
      && checkoutMicros(record.commissionAmount) === member.dueMicros
      && record.paymentStatus === "paid" && record.paymentVerificationStatus === "verified"
      && Number.isFinite(Date.parse(record.paidAt ?? "")) && Date.parse(record.paidAt!) < issuedAt
    )));
}
function referenceConflict(snapshot: AlphaExchangeDb, checkout: CommissionCheckout, deposit: CheckoutDeposit) {
  const amount = deposit.amountMicros;
  const ids = new Set(checkout.commissions.map((row) => row.id));
  const checkouts = getCommissionCheckouts(snapshot);
  return checkouts.some((other) => other.id !== checkout.id
    && (other.expectedMicros === amount || (other.roundedMicros === amount
      && !closedRoundedReference(snapshot, other, checkout, amount))))
    || snapshot.commissionRecords.some((record) => !ids.has(record.id)
      && ([record.paymentExpectedAmountMode === "legacy_base" || record.paymentExpectedAmount === undefined ? record.commissionAmount : undefined,
        record.paymentExpectedAmount].some((value) => typeof value === "number" && value > 0 && checkoutMicros(value) === amount)
        || ((record.paymentReservedExpectedAmounts ?? []).some((value) => checkoutMicros(value) === amount)
          && !earlierCheckoutReceipt(snapshot, record, deposit)
          && !checkouts.some((previous) => previous.sellerId === record.sellerId
            && previous.commissions.some((member) => member.id === record.id)
            && closedRoundedReference(snapshot, previous, checkout, amount)))));
}
export function allocateCheckout(checkout: CommissionCheckout, receivedMicros = checkout.expectedMicros) {
  const parts = checkout.commissions.map((row) => {
    const product = BigInt(receivedMicros) * BigInt(row.dueMicros);
    return { id: row.id, dueMicros: row.dueMicros, receivedMicros: Number(product / BigInt(checkout.dueMicros)), remainder: product % BigInt(checkout.dueMicros) };
  });
  let remaining = receivedMicros - parts.reduce((sum, row) => sum + row.receivedMicros, 0);
  const order = [...parts].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const row of order) { if (remaining-- <= 0) break; row.receivedMicros++; }
  return parts.map(({ id, dueMicros, receivedMicros }) => ({ commissionId: id, amountDueMicros: dueMicros, receivedMicros,
    waivedMicros: Math.max(0, dueMicros - receivedMicros), excessMicros: Math.max(0, receivedMicros - dueMicros) }));
}
export function createCommissionCheckoutWorkflow(ports: CheckoutPorts) {
  const now = ports.now ?? Date.now;
  return {
    async issue(input: { sellerId: string; network: CheckoutNetwork; desiredAmount?: string; currentCheckoutId?: string }) {
      if (input.network !== "TRC20" && input.network !== "BEP20") fail("invalid_network");
      const chosen = input.desiredAmount === undefined ? undefined : parseCheckoutAmount(input.desiredAmount);
      const id = `checkout-${randomUUID()}`;
      const result = await ports.atomic((snapshot) => {
        authorize(snapshot, input.sellerId);
        const pending = pendingCommissionCheckouts(snapshot);
        const existing = selectedCheckout(snapshot, input.sellerId, pending);
        if (input.currentCheckoutId !== undefined) {
          const original = pending.find((checkout) => checkout.id === input.currentCheckoutId && checkout.sellerId === input.sellerId);
          if (!original || !existing || !sameCheckoutGroup(original, existing)
            || (existing.id !== input.currentCheckoutId && existing.network !== input.network)) fail("checkout_changed");
          if (!canChangeCheckoutNetwork(snapshot, existing)) fail("payment_in_progress");
          if (chosen !== undefined && chosen !== existing.requestedMicros) fail("checkout_already_issued");
          const alternative = pending.find((checkout) => sameCheckoutGroup(checkout, existing) && checkout.network === input.network);
          if (alternative) {
            selectCheckoutNetwork(snapshot, alternative, now());
            return alternative;
          }
          // Preserve immutable instructions and monitor both networks until the
          // same commission group settles once. Reuse each network on return.
        }
        if (existing) {
          assertUnchanged(snapshot, existing);
          if (input.currentCheckoutId === undefined) {
            if (existing.network !== input.network || (chosen !== undefined && chosen !== existing.requestedMicros)) fail("checkout_already_issued");
            return existing;
          }
        }
        const records = snapshot.commissionRecords.filter((record) => record.sellerId === input.sellerId && record.paymentStatus !== "paid")
          .filter((record) => !existing || existing.commissions.some((row) => row.id === record.id))
          .sort((a, b) => a.id.localeCompare(b.id));
        if (!records.length) fail("no_commissions_due");
        if (records.length > 100) fail("too_many_commissions");
        const ids = new Set(records.map((record) => record.id));
        if (entries(snapshot, "commission_batch_receipt_approval_v1").some((entry) => {
          const batch = object(object(entry.newValue)?.batch);
          return Array.isArray(batch?.commissionIds) && batch.commissionIds.some((value) => ids.has(String(value)));
        })) fail("payment_in_progress");
        const commissions = records.map((record) => ({ id: record.id, dueMicros: checkoutMicros(record.commissionAmount), createdAt: record.createdAt }));
        const total = commissions.reduce((sum, row) => sum + BigInt(row.dueMicros), BigInt(0));
        if (total > BigInt(Number.MAX_SAFE_INTEGER - CHECKOUT_TOLERANCE)) fail("invalid_amount");
        const dueMicros = Number(total);
        const requestedMicros = chosen ?? existing?.requestedMicros ?? dueMicros;
        const expectedMicros = reserveAmount(snapshot, requestedMicros, dueMicros, ports.random?.() ?? randomInt(9999), ids);
        const rounded = Math.ceil(expectedMicros / 1e6) * 1e6;
        const roundedMicros = expectedMicros === requestedMicros && rounded > expectedMicros
          && rounded >= dueMicros && rounded - dueMicros <= CHECKOUT_TOLERANCE
          && !reservedAmounts(snapshot, ids, false).has(rounded) ? rounded : undefined;
        const checkout: CommissionCheckout = { id, sellerId: input.sellerId, network: input.network,
          createdAt: new Date(now()).toISOString(), dueMicros, expectedMicros, requestedMicros, commissions,
          ...(roundedMicros ? { roundedMicros } : {}) };
        assertUnchanged(snapshot, checkout);
        // The legacy allocator already respects this permanent reservation list.
        const leader = records[0];
        leader.paymentReservedExpectedAmounts = [...(leader.paymentReservedExpectedAmounts ?? []), expectedMicros / 1e6,
          ...(roundedMicros ? [roundedMicros / 1e6] : [])];
        leader.updatedAt = new Date(Math.max(now(), (Date.parse(leader.updatedAt ?? "") || 0) + 1)).toISOString();
        snapshot.auditLogs.unshift({ id: `${id}:issued`, action: "commission_recorded", actorUserId: input.sellerId,
          targetUserId: input.sellerId, createdAt: checkout.createdAt,
          details: "Seller created an automatic commission checkout before payment. No payment has been received or credited.",
          newValue: { kind: CHECKOUT_ISSUED, checkout } });
        if (existing) selectCheckoutNetwork(snapshot, checkout, now());
        return checkout;
      });
      ports.afterCommit?.(); return result;
    },
    async state(sellerId: string) {
      const snapshot = await ports.read(); authorize(snapshot, sellerId);
      const all = getCommissionCheckouts(snapshot).filter((checkout) => checkout.sellerId === sellerId);
      const active = selectedCheckout(snapshot, sellerId);
      const last = all.find((checkout) => settled(snapshot, checkout.id));
      let status: "ready" | "waiting" | "paid" | "changed" = active ? "waiting" : last || all.some((checkout) => paidThroughAnotherFlow(snapshot, checkout)) ? "paid" : "ready";
      if (active) { try { assertUnchanged(snapshot, active); } catch { status = "changed"; } }
      const outstanding = snapshot.commissionRecords.filter((record) => record.sellerId === sellerId && record.paymentStatus !== "paid");
      if (!active && outstanding.length) status = "ready";
      const outstandingMicros = outstanding.reduce((sum, record) => sum + BigInt(checkoutMicros(record.commissionAmount)), BigInt(0));
      if (outstandingMicros > BigInt(Number.MAX_SAFE_INTEGER)) fail("invalid_amount");
      const groupIds = new Set(active ? all.filter((checkout) => sameCheckoutGroup(checkout, active)).map((checkout) => checkout.id) : []);
      const diagnostic = active ? entries(snapshot, CHECKOUT_ATTEMPT).filter(entry => groupIds.has(String(object(entry.newValue)?.checkoutId)) && entry.targetUserId === sellerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
      return { status, checkout: active ?? null, lastPaidCheckout: last ?? null, pendingCount: outstanding.length,
        canChangeNetwork: status === "waiting" && Boolean(active && canChangeCheckoutNetwork(snapshot, active)),
        totalDueUsdt: Number(outstandingMicros) / 1e6,
        ...(diagnostic && Number.isFinite(Date.parse(diagnostic.createdAt)) ? { lastVerificationCheckAt: diagnostic.createdAt, verificationCode: String(object(diagnostic.newValue)?.code ?? "") } : {}) };
    },
    async reconcile(input: { deposits: readonly CheckoutDeposit[]; deadline: number; limit?: number }) {
      const summary = { checked: 0, verified: 0, pending: 0, review: 0, errors: 0, budgetExhausted: false,
        reviewReasons: {} as Record<string, number> };
      const initial = await ports.read();
      const attempts = entries(initial, CHECKOUT_ATTEMPT);
      const lastAttempt = (id: string) => Math.max(0, ...attempts.filter((entry) => object(entry.newValue)?.checkoutId === id).map((entry) => Date.parse(entry.createdAt)));
      const checkouts = pendingCommissionCheckouts(initial).sort((a, b) => lastAttempt(a.id) - lastAttempt(b.id) || a.createdAt.localeCompare(b.createdAt));
      const reserved = reservedReceipts(initial);
      for (const checkout of checkouts) {
        if (summary.checked >= (input.limit ?? 1) || now() + 14_000 >= input.deadline) { summary.budgetExhausted = true; break; }
        const deposits = input.deposits.filter((row) => row.network === checkout.network && acceptsDeposit(initial, checkout, row)
          && Number.isSafeInteger(row.timestamp) && row.timestamp >= Date.parse(checkout.createdAt) && row.timestamp <= now() + 300_000
          && checkoutReceiptKey(row.signature) && !reserved.has(checkoutReceiptKey(row.signature)));
        if (!deposits.length) continue;
        const first = [...deposits].sort((a, b) => a.timestamp - b.timestamp || a.signature.localeCompare(b.signature))[0];
        const key = checkoutReceiptKey(first.signature)!;
        const aliases = input.deposits.filter((row) => checkoutReceiptKey(row.signature) === key);
        summary.checked++;
        let code = "receipt_pending";
        try {
          if (aliases.some((row) => row.network !== checkout.network || row.amountMicros !== first.amountMicros)) fail("conflicting_receipt");
          if (first.amountMicros !== checkout.expectedMicros && new Set(deposits.map((row) => checkoutReceiptKey(row.signature))).size !== 1) fail("ambiguous_rounded_receipts");
          if (deposits.some((row) => checkoutReceiptKey(row.signature) !== key && row.amountMicros !== first.amountMicros)) fail("multiple_payment_options_received");
          assertUnchanged(initial, checkout);
          if (referenceConflict(initial, checkout, first)) fail("payment_reference_conflict");
          assertToleranceAttribution(initial, checkout, first);
          const receipt = { ...first, signature: key.startsWith("binance-deposit:") ? key : checkout.network === "BEP20" ? `0x${key}` : key };
          const proof = await ports.verify(receipt, Date.parse(checkout.createdAt));
          if (!proof.verified) { if (proof.pending) summary.pending++; else summary.review++; code = proof.pending ? "receipt_pending" : "receipt_rejected"; }
          else if (now() >= input.deadline) { summary.budgetExhausted = true; }
          else {
            const saved = await ports.atomic((snapshot) => {
              const canonical = getCommissionCheckouts(snapshot).find((row) => row.id === checkout.id);
              if (!canonical || JSON.stringify(canonical) !== JSON.stringify(checkout)) fail("checkout_changed");
              if (settled(snapshot, checkout.id)) return false;
              assertUnchanged(snapshot, canonical);
              if (reservedReceipts(snapshot).has(key)) fail("receipt_already_used");
              if (!acceptsDeposit(snapshot, canonical, receipt)) fail("receipt_attribution_changed");
              if (referenceConflict(snapshot, canonical, receipt)) fail("payment_reference_conflict");
              assertToleranceAttribution(snapshot, canonical, receipt);
              const attribution = receiptAttribution(snapshot, canonical, receipt);
              const paidAt = new Date(now()).toISOString();
              const allocations = allocateCheckout(canonical, receipt.amountMicros);
              const waivedMicros = Math.max(0, canonical.dueMicros - receipt.amountMicros);
              const excessMicros = Math.max(0, receipt.amountMicros - canonical.dueMicros);
              const note = `Automatic checkout: ${(receipt.amountMicros / 1e6).toFixed(6)} USDT received; ${(canonical.dueMicros / 1e6).toFixed(6)} USDT due; ${(waivedMicros / 1e6).toFixed(6)} USDT waived; ${(excessMicros / 1e6).toFixed(6)} USDT excess recorded.`;
              for (const allocation of allocations) {
                const index = snapshot.commissionRecords.findIndex((row) => row.id === allocation.commissionId);
                const record: CommissionRecord & { paymentBatchSettlement: unknown } = { ...snapshot.commissionRecords[index],
                  paymentStatus: "paid", paymentProvider: "crypto_wallet", paymentNetwork: canonical.network,
                  paymentSignature: receipt.signature, recipientWalletAddress: ports.destination(canonical.network),
                  paymentVerificationStatus: "verified", paymentVerificationNotes: note, paymentLastCheckedAt: paidAt, paidAt, updatedAt: paidAt,
                  paymentSubmittedAt: canonical.createdAt,
                  paymentBatchSettlement: { batchId: canonical.id, ...allocation, signatureKey: key,
                    groupReceivedMicros: receipt.amountMicros, groupDueMicros: canonical.dueMicros,
                    attribution } };
                snapshot.commissionRecords[index] = record;
              }
              // Preserve the actual reference for the legacy allocator as well.
              const leader = snapshot.commissionRecords.find((row) => row.id === canonical.commissions[0].id)!;
              leader.paymentReservedExpectedAmounts = [...new Set([...(leader.paymentReservedExpectedAmounts ?? []), receipt.amountMicros / 1e6])];
              const remaining = snapshot.commissionRecords.filter((row) => row.sellerId === canonical.sellerId && row.paymentStatus !== "paid");
              for (const allocation of allocations) {
                const record = snapshot.commissionRecords.find((row) => row.id === allocation.commissionId)!;
                record.paymentConfirmationEmailPending = { id: `${canonical.id}:${record.id}:email`, requestedAt: paidAt,
                  amountDueUsdt: allocation.receivedMicros / 1e6,
                  remainingCommissions: remaining.map((row) => ({ id: row.id, displayNumber: row.displayNumber })) };
              }
              snapshot.auditLogs.unshift({ id: `${canonical.id}:settled`, action: "commission_paid", actorUserId: canonical.sellerId,
                targetUserId: canonical.sellerId, createdAt: paidAt, details: note,
                newValue: { kind: CHECKOUT_SETTLED, checkoutId: canonical.id, checkout: canonical, receipt, attribution,
                  plan: { expectedMicros: canonical.dueMicros, receivedMicros: receipt.amountMicros, waivedMicros, excessMicros, allocations } } });
              snapshot.notifications.unshift({ id: `${canonical.id}:notification`, userId: canonical.sellerId, category: "trade",
                title: "Commission payment verified", titleAr: "تم تأكيد دفعة العمولة", message: `${note} ${remaining.length ? "Other commission dues remain." : "Commission restrictions are cleared. Other account restrictions still apply."}`,
                messageAr: `تم استلام ${(receipt.amountMicros / 1e6).toFixed(6)} USDT وإعفاء ${(waivedMicros / 1e6).toFixed(6)} USDT. ${remaining.length ? "ما زالت هناك عمولات أخرى." : "تمت إزالة قيود العمولة. تبقى أي قيود أخرى على الحساب سارية."}`,
                isRead: false, reason: remaining.length ? "commission_payment_due" : "commission_payment_verified",
                actionHref: "/seller/commission-checkout", relatedHref: "/seller/commission-checkout", actionLabel: "View payment", createdAt: paidAt });
              return true;
            });
            if (saved) summary.verified++;
            ports.afterCommit?.(); continue;
          }
        } catch (error) {
          if (error instanceof CommissionCheckoutError) { code = error.code; summary.review++; }
          else { code = "verification_unavailable"; summary.errors++; }
        }
        if (code !== "receipt_pending" && code !== "verification_unavailable") {
          summary.reviewReasons[code] = (summary.reviewReasons[code] ?? 0) + 1;
        }
        if (now() < input.deadline) {
          try {
            await ports.atomic((snapshot) => {
              if (settled(snapshot, checkout.id)) return;
              // One updatable diagnostic per checkout, not an unbounded audit per minute.
              const id = `${checkout.id}:attempt`;
              const previous = snapshot.auditLogs.findIndex((row) => row.id === id);
              const entry = { id, action: "commission_recorded" as const, actorUserId: checkout.sellerId, targetUserId: checkout.sellerId,
                createdAt: new Date(now()).toISOString(), details: "Automatic checkout verification has not credited a payment.",
                newValue: { kind: CHECKOUT_ATTEMPT, checkoutId: checkout.id, code } };
              if (previous >= 0) snapshot.auditLogs[previous] = entry; else snapshot.auditLogs.unshift(entry);
            });
          } catch { summary.errors++; }
        }
      }
      return summary;
    },
  };
}
