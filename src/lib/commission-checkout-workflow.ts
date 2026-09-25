import { randomInt, randomUUID } from "node:crypto";
import type { AlphaExchangeDb, CommissionRecord } from "@/types/alpha-exchange";

export const CHECKOUT_ISSUED = "commission_checkout_issued_v1";
export const CHECKOUT_SETTLED = "commission_checkout_settled_v1";
export const CHECKOUT_ATTEMPT = "commission_checkout_attempt_v1";
export const CHECKOUT_TOLERANCE = 1_000_000;
export type CheckoutNetwork = "TRC20" | "BEP20";
export interface CommissionCheckout {
  id: string;
  sellerId: string;
  network: CheckoutNetwork;
  createdAt: string;
  expectedMicros: number;
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
export function pendingCommissionCheckouts(snapshot: AlphaExchangeDb) {
  return getCommissionCheckouts(snapshot).filter((checkout) => !settled(snapshot, checkout.id));
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
function reserveAmount(snapshot: AlphaExchangeDb, desired: number, due: number, random: number) {
  if (Math.abs(desired - due) > CHECKOUT_TOLERANCE) fail("outside_tolerance");
  const used = new Set(getCommissionCheckouts(snapshot).map((checkout) => checkout.expectedMicros));
  for (const record of snapshot.commissionRecords) {
    for (const amount of [record.commissionAmount, record.paymentExpectedAmount, ...(record.paymentReservedExpectedAmounts ?? [])]) {
      if (typeof amount === "number" && amount > 0) used.add(checkoutMicros(amount));
    }
  }
  // Keep a requested rounded amount only when it is an unused pre-payment reference.
  // Collisions receive a visible micro suffix; never silently accept an arbitrary rounded deposit.
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
export function allocateCheckout(checkout: CommissionCheckout) {
  const parts = checkout.commissions.map((row) => {
    const product = BigInt(checkout.expectedMicros) * BigInt(row.dueMicros);
    return { id: row.id, dueMicros: row.dueMicros, receivedMicros: Number(product / BigInt(checkout.dueMicros)), remainder: product % BigInt(checkout.dueMicros) };
  });
  let remaining = checkout.expectedMicros - parts.reduce((sum, row) => sum + row.receivedMicros, 0);
  const order = [...parts].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const row of order) { if (remaining-- <= 0) break; row.receivedMicros++; }
  return parts.map(({ id, dueMicros, receivedMicros }) => ({ commissionId: id, amountDueMicros: dueMicros, receivedMicros,
    waivedMicros: Math.max(0, dueMicros - receivedMicros), excessMicros: Math.max(0, receivedMicros - dueMicros) }));
}
export function createCommissionCheckoutWorkflow(ports: CheckoutPorts) {
  const now = ports.now ?? Date.now;
  return {
    async issue(input: { sellerId: string; network: CheckoutNetwork; desiredAmount?: string }) {
      if (input.network !== "TRC20" && input.network !== "BEP20") fail("invalid_network");
      const chosen = input.desiredAmount === undefined ? undefined : parseCheckoutAmount(input.desiredAmount);
      const id = `checkout-${randomUUID()}`;
      const result = await ports.atomic((snapshot) => {
        authorize(snapshot, input.sellerId);
        const existing = pendingCommissionCheckouts(snapshot).find((checkout) => checkout.sellerId === input.sellerId);
        if (existing) {
          assertUnchanged(snapshot, existing);
          if (existing.network !== input.network || (chosen !== undefined && chosen !== existing.requestedMicros)) fail("checkout_already_issued");
          return existing;
        }
        const records = snapshot.commissionRecords.filter((record) => record.sellerId === input.sellerId && record.paymentStatus !== "paid")
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
        const expectedMicros = reserveAmount(snapshot, chosen ?? dueMicros, dueMicros, ports.random?.() ?? randomInt(9999));
        const checkout: CommissionCheckout = { id, sellerId: input.sellerId, network: input.network,
          createdAt: new Date(now()).toISOString(), dueMicros, expectedMicros, requestedMicros: chosen ?? dueMicros, commissions };
        assertUnchanged(snapshot, checkout);
        // The legacy allocator already respects this permanent reservation list.
        const leader = records[0];
        leader.paymentReservedExpectedAmounts = [...(leader.paymentReservedExpectedAmounts ?? []), expectedMicros / 1e6];
        snapshot.auditLogs.unshift({ id: `${id}:issued`, action: "commission_recorded", actorUserId: input.sellerId,
          targetUserId: input.sellerId, createdAt: checkout.createdAt,
          details: "Seller created an automatic commission checkout before payment. No payment has been received or credited.",
          newValue: { kind: CHECKOUT_ISSUED, checkout } });
        return checkout;
      });
      ports.afterCommit?.(); return result;
    },
    async state(sellerId: string) {
      const snapshot = await ports.read(); authorize(snapshot, sellerId);
      const all = getCommissionCheckouts(snapshot).filter((checkout) => checkout.sellerId === sellerId);
      const active = all.find((checkout) => !settled(snapshot, checkout.id));
      const last = all.find((checkout) => settled(snapshot, checkout.id));
      let status: "ready" | "waiting" | "paid" | "changed" = active ? "waiting" : last ? "paid" : "ready";
      if (active) { try { assertUnchanged(snapshot, active); } catch { status = "changed"; } }
      const outstanding = snapshot.commissionRecords.filter((record) => record.sellerId === sellerId && record.paymentStatus !== "paid");
      if (!active && outstanding.length) status = "ready";
      return { status, checkout: active ?? null, lastPaidCheckout: last ?? null, pendingCount: outstanding.length,
        totalDueUsdt: outstanding.reduce((sum, record) => sum + checkoutMicros(record.commissionAmount), 0) / 1e6 };
    },
    async reconcile(input: { deposits: readonly CheckoutDeposit[]; deadline: number; limit?: number }) {
      const summary = { checked: 0, verified: 0, pending: 0, review: 0, errors: 0, budgetExhausted: false };
      const initial = await ports.read();
      const attempts = entries(initial, CHECKOUT_ATTEMPT);
      const lastAttempt = (id: string) => Math.max(0, ...attempts.filter((entry) => object(entry.newValue)?.checkoutId === id).map((entry) => Date.parse(entry.createdAt)));
      const checkouts = pendingCommissionCheckouts(initial).sort((a, b) => lastAttempt(a.id) - lastAttempt(b.id) || a.createdAt.localeCompare(b.createdAt));
      const reserved = reservedReceipts(initial);
      for (const checkout of checkouts) {
        if (summary.checked >= (input.limit ?? 1) || now() + 14_000 >= input.deadline) { summary.budgetExhausted = true; break; }
        const deposits = input.deposits.filter((row) => row.network === checkout.network && row.amountMicros === checkout.expectedMicros
          && Number.isSafeInteger(row.timestamp) && row.timestamp >= Date.parse(checkout.createdAt) && row.timestamp <= now() + 300_000
          && checkoutReceiptKey(row.signature) && !reserved.has(checkoutReceiptKey(row.signature)));
        if (!deposits.length) continue;
        const first = [...deposits].sort((a, b) => a.timestamp - b.timestamp || a.signature.localeCompare(b.signature))[0];
        const key = checkoutReceiptKey(first.signature)!;
        const aliases = input.deposits.filter((row) => checkoutReceiptKey(row.signature) === key);
        summary.checked++;
        let code = "receipt_pending";
        try {
          if (aliases.some((row) => row.network !== checkout.network || row.amountMicros !== checkout.expectedMicros)) fail("conflicting_receipt");
          assertUnchanged(initial, checkout);
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
              if (snapshot.commissionRecords.some((record) => !canonical.commissions.some((row) => row.id === record.id)
                && typeof record.paymentExpectedAmount === "number" && checkoutMicros(record.paymentExpectedAmount) === canonical.expectedMicros)) fail("payment_reference_conflict");
              const paidAt = new Date(now()).toISOString();
              const allocations = allocateCheckout(canonical);
              const waivedMicros = Math.max(0, canonical.dueMicros - receipt.amountMicros);
              const excessMicros = Math.max(0, receipt.amountMicros - canonical.dueMicros);
              const note = `Automatic checkout: ${(receipt.amountMicros / 1e6).toFixed(6)} USDT received; ${(canonical.dueMicros / 1e6).toFixed(6)} USDT due; ${(waivedMicros / 1e6).toFixed(6)} USDT waived; ${(excessMicros / 1e6).toFixed(6)} USDT excess recorded.`;
              for (const allocation of allocations) {
                const index = snapshot.commissionRecords.findIndex((row) => row.id === allocation.commissionId);
                const record: CommissionRecord & { paymentBatchSettlement: unknown } = { ...snapshot.commissionRecords[index],
                  paymentStatus: "paid", paymentProvider: "crypto_wallet", paymentNetwork: canonical.network,
                  paymentSignature: receipt.signature, recipientWalletAddress: ports.destination(canonical.network),
                  paymentVerificationStatus: "verified", paymentVerificationNotes: note, paidAt, updatedAt: paidAt,
                  paymentSubmittedAt: canonical.createdAt,
                  paymentBatchSettlement: { batchId: canonical.id, ...allocation, signatureKey: key,
                    groupReceivedMicros: receipt.amountMicros, groupDueMicros: canonical.dueMicros,
                    attribution: "seller_preissued_payment_reference" } };
                snapshot.commissionRecords[index] = record;
              }
              const remaining = snapshot.commissionRecords.filter((row) => row.sellerId === canonical.sellerId && row.paymentStatus !== "paid");
              for (const allocation of allocations) {
                const record = snapshot.commissionRecords.find((row) => row.id === allocation.commissionId)!;
                record.paymentConfirmationEmailPending = { id: `${canonical.id}:${record.id}:email`, requestedAt: paidAt,
                  amountDueUsdt: allocation.receivedMicros / 1e6,
                  remainingCommissions: remaining.map((row) => ({ id: row.id, displayNumber: row.displayNumber })) };
              }
              snapshot.auditLogs.unshift({ id: `${canonical.id}:settled`, action: "commission_paid", actorUserId: canonical.sellerId,
                targetUserId: canonical.sellerId, createdAt: paidAt, details: note,
                newValue: { kind: CHECKOUT_SETTLED, checkoutId: canonical.id, checkout: canonical, receipt,
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
