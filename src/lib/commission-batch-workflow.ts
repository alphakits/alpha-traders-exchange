import { createHash, randomUUID } from "node:crypto";
import { commissionPaymentDestination } from "./commission-payment-destination";
import type { AlphaExchangeDb, CommissionRecord, AuditLogEntry } from "@/types/alpha-exchange";
import {
  commissionAmountMicros, commissionReceiptKey, planCommissionBatch, COMMISSION_BATCH_CLOCK_SKEW_MS,
  type BatchReceipt, type BatchReceiptAttribution,
} from "./commission-batch-policy";

const INTENT = "commission_batch_receipt_approval_v1";
const SETTLED = "commission_batch_receipt_settled_v1";
const ATTEMPT = "commission_batch_receipt_attempt_v1";
export class CommissionBatchError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "CommissionBatchError"; }
}
export interface ApprovedCommissionBatch extends BatchReceiptAttribution {
  id: string;
  createdAt: string;
  expectedCommissions: Array<{ id: string; amountMicros: number; createdAt: string }>;
}
export interface VerifiedBatchReceipt {
  verified: boolean;
  pending?: boolean;
  /** Machine code only. Provider bodies/credentials must never reach the audit log. */
  code: string;
}
export interface CommissionBatchPorts {
  read(): Promise<AlphaExchangeDb>;
  /** Must reapply mutation against canonical state under the repository transaction lock. */
  atomic<T>(mutation: (snapshot: AlphaExchangeDb) => T): Promise<T>;
  verify(receipt: BatchReceipt, earliestTimestamp: number): Promise<VerifiedBatchReceipt>;
  destination(network: "TRC20" | "BEP20"): string;
  now?(): number;
  afterCommit?(): void;
}
function fail(code: string): never { throw new CommissionBatchError(code); }
function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function canonicalOwner(snapshot: AlphaExchangeDb, id: string) {
  const owner = snapshot.users.find((user) => user.id === id);
  if (!owner || owner.disabled || !(owner.role === "owner" || owner.roles?.includes("owner"))) fail("owner_required");
  return owner;
}
function taggedEntries(snapshot: AlphaExchangeDb, tag: string) {
  return snapshot.auditLogs.filter((entry) => jsonObject(entry.newValue)?.kind === tag);
}
function append(snapshot: AlphaExchangeDb, entry: AuditLogEntry) {
  if (!snapshot.auditLogs.some((current) => current.id === entry.id)) snapshot.auditLogs.unshift(entry);
}
export function getApprovedCommissionBatches(snapshot: AlphaExchangeDb): ApprovedCommissionBatch[] {
  return taggedEntries(snapshot, INTENT).map((entry) => {
    const raw = jsonObject(jsonObject(entry.newValue)?.batch);
    if (!raw || typeof raw.id !== "string" || raw.id !== entry.id.replace(/:approved$/, "")
      || typeof raw.sellerId !== "string" || raw.approvedByUserId !== entry.actorUserId
      || raw.kind !== "owner_confirmed_receipt" || typeof raw.signature !== "string"
      || !commissionReceiptKey(raw.signature) || !["TRC20", "BEP20"].includes(String(raw.network))
      || !Array.isArray(raw.commissionIds) || !raw.commissionIds.length || raw.commissionIds.length > 100
      || raw.commissionIds.some((id) => typeof id !== "string" || !id)
      || new Set(raw.commissionIds).size !== raw.commissionIds.length
      || !Array.isArray(raw.expectedCommissions) || raw.expectedCommissions.length !== raw.commissionIds.length
      || !Number.isSafeInteger(raw.expectedAmountMicros) || Number(raw.expectedAmountMicros) <= 0
      || typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))) fail("invalid_persisted_batch");
    const batch = raw as unknown as ApprovedCommissionBatch;
    const ids = new Set<string>();
    let total = BigInt(0);
    for (const expected of batch.expectedCommissions) {
      if (!expected || !batch.commissionIds.includes(expected.id) || ids.has(expected.id)
        || !Number.isSafeInteger(expected.amountMicros) || expected.amountMicros <= 0
        || !Number.isFinite(Date.parse(expected.createdAt))) fail("invalid_persisted_batch");
      ids.add(expected.id);
      total += BigInt(expected.amountMicros);
    }
    if (total !== BigInt(batch.expectedAmountMicros)) fail("invalid_persisted_batch");
    return batch;
  });
}
export function getCommissionBatchReceiptReservations(snapshot: AlphaExchangeDb) {
  // Approvals and settlements retain receipt ownership, even after a manual reset.
  return new Set(getApprovedCommissionBatches(snapshot).map((batch) => commissionReceiptKey(batch.signature)!));
}
function isSettled(snapshot: AlphaExchangeDb, id: string) {
  return taggedEntries(snapshot, SETTLED).some((entry) => jsonObject(entry.newValue)?.batchId === id);
}
export function getPendingCommissionBatches(snapshot: AlphaExchangeDb) {
  const lastAttempt = (id: string) => Math.max(0, ...taggedEntries(snapshot, ATTEMPT)
    .filter((entry) => jsonObject(entry.newValue)?.batchId === id).map((entry) => Date.parse(entry.createdAt) || 0));
  return getApprovedCommissionBatches(snapshot).filter((batch) => !isSettled(snapshot, batch.id))
    .sort((left, right) => lastAttempt(left.id) - lastAttempt(right.id) || left.createdAt.localeCompare(right.createdAt));
}
function assertFrozenAmounts(snapshot: AlphaExchangeDb, batch: ApprovedCommissionBatch) {
  for (const expected of batch.expectedCommissions) {
    const record = snapshot.commissionRecords.find((item) => item.id === expected.id);
    if (!record || record.sellerId !== batch.sellerId || record.createdAt !== expected.createdAt
      || commissionAmountMicros(record.commissionAmount) !== expected.amountMicros) fail("batch_amount_changed");
  }
}
function batchNote(batch: ApprovedCommissionBatch, receipt: BatchReceipt, waived: number, excess: number) {
  return `Verified combined payment: ${(receipt.amountMicros / 1e6).toFixed(6)} USDT received; `
    + `${(batch.expectedAmountMicros / 1e6).toFixed(6)} USDT due; ${(waived / 1e6).toFixed(6)} USDT waived; `
    + `${(excess / 1e6).toFixed(6)} USDT excess recorded. Receipt ${receipt.signature}.`;
}

export function createCommissionBatchWorkflow(ports: CommissionBatchPorts) {
  const now = ports.now ?? Date.now;
  return {
    /** Authentication must resolve actorUserId on the server; role is rechecked at commit. */
    async approve(input: { actorUserId: string; sellerId: string; commissionIds: string[];
      signature: string; network: "TRC20" | "BEP20" }) {
      const key = commissionReceiptKey(input.signature);
      if (!key || !["TRC20", "BEP20"].includes(input.network) || !input.sellerId
        || !Array.isArray(input.commissionIds) || !input.commissionIds.length || input.commissionIds.length > 100
        || input.commissionIds.some((id) => typeof id !== "string" || !id)
        || new Set(input.commissionIds).size !== input.commissionIds.length) fail("invalid_batch_input");
      const ids = [...input.commissionIds].sort();
      const id = `commission-batch-${createHash("sha256").update(JSON.stringify([key, input.network, input.sellerId, ids])).digest("hex").slice(0, 32)}`;
      const result = await ports.atomic((snapshot) => {
        canonicalOwner(snapshot, input.actorUserId);
        const existing = getApprovedCommissionBatches(snapshot);
        const same = existing.find((batch) => batch.id === id);
        if (same) return same;
        if (existing.some((batch) => commissionReceiptKey(batch.signature) === key)) fail("receipt_reserved");
        if (getPendingCommissionBatches(snapshot).some((batch) => batch.commissionIds.some((item) => ids.includes(item)))) fail("group_overlap");
        if (snapshot.commissionRecords.some((record) => record.paymentSignature && commissionReceiptKey(record.paymentSignature) === key)) fail("receipt_already_used");
        if (!snapshot.users.some((user) => user.id === input.sellerId)) fail("seller_missing");
        const expectedCommissions = ids.map((commissionId) => {
          const record = snapshot.commissionRecords.find((item) => item.id === commissionId);
          if (!record || record.sellerId !== input.sellerId) fail("wrong_seller");
          if (!["pending", "overdue"].includes(record.paymentStatus) || record.paymentVerificationStatus === "verified") fail("already_settled");
          if (record.paymentSignature || record.paymentVerificationStatus === "pending_verification") fail("payment_in_progress");
          const amountMicros = commissionAmountMicros(record.commissionAmount);
          if (amountMicros === null || !Number.isFinite(Date.parse(record.createdAt))) fail("invalid_commission_amount");
          return { id: commissionId, amountMicros, createdAt: record.createdAt };
        });
        const total = expectedCommissions.reduce((sum, item) => sum + BigInt(item.amountMicros), BigInt(0));
        if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail("invalid_commission_amount");
        const batch: ApprovedCommissionBatch = { id, kind: "owner_confirmed_receipt", sellerId: input.sellerId,
          commissionIds: ids, signature: key.startsWith("binance-deposit:") ? key : input.network === "BEP20" ? `0x${key}` : key,
          network: input.network, expectedAmountMicros: Number(total), approvedByUserId: input.actorUserId,
          createdAt: new Date(now()).toISOString(), expectedCommissions };
        append(snapshot, { id: `${id}:approved`, action: "commission_recorded", actorUserId: input.actorUserId,
          targetUserId: input.sellerId, details: "Owner associated an original receipt with a specific commission group. Receipt verification is still required.",
          newValue: { kind: INTENT, batch }, createdAt: batch.createdAt });
        return batch;
      });
      ports.afterCommit?.();
      return result;
    },
    async reconcile(input: { deposits: readonly BatchReceipt[]; deadline: number; limit?: number }) {
      const summary = { checked: 0, verified: 0, waiting: 0, review: 0, errors: 0, duplicate: 0, budgetExhausted: false };
      const initial = await ports.read();
      const batches = getPendingCommissionBatches(initial);
      const limit = Math.min(2, Math.max(1, Math.trunc(input.limit ?? 1)));
      for (const batch of batches) {
        // Allow at least a provider lookup plus commit budget; never exceed the cron budget intentionally.
        if (summary.checked >= limit || now() + 14_000 >= input.deadline) { summary.budgetExhausted = true; break; }
        const matches = input.deposits.filter((receipt) => receipt.network === batch.network
          && commissionReceiptKey(receipt.signature) === commissionReceiptKey(batch.signature));
        if (!matches.length) { summary.waiting++; continue; }
        summary.checked++;
        // Two providers can expose the same chain receipt at slightly different index times.
        // Conflicting AMOUNTS must never be chosen by array order; chain time is reverified below.
        const conflictingAmounts = matches.some((receipt) => receipt.amountMicros !== matches[0].amountMicros);
        const receipt = { ...matches[0], signature: batch.signature,
          timestamp: Math.min(...matches.map((item) => item.timestamp)) };
        let code = "batch_unavailable";
        try {
          if (conflictingAmounts) fail("conflicting_provider_receipts");
          canonicalOwner(initial, batch.approvedByUserId);
          assertFrozenAmounts(initial, batch);
          const preliminary = planCommissionBatch({ records: initial.commissionRecords, receipt, attribution: batch, now: now() });
          if (!preliminary.accepted) fail(preliminary.reason);
          const earliest = Math.max(...batch.expectedCommissions.map((item) => Date.parse(item.createdAt))) - COMMISSION_BATCH_CLOCK_SKEW_MS;
          const proof = await ports.verify(receipt, earliest);
          code = /^[a-z_]{1,80}$/.test(proof.code) ? proof.code : "provider_unavailable";
          if (!proof.verified) {
            if (proof.pending) summary.waiting++; else summary.review++;
          } else if (now() >= input.deadline) {
            summary.budgetExhausted = true;
          } else {
            const outcome = await ports.atomic((snapshot) => {
              const canonical = getApprovedCommissionBatches(snapshot).find((item) => item.id === batch.id);
              if (!canonical || JSON.stringify(canonical) !== JSON.stringify(batch)) fail("batch_approval_changed");
              canonicalOwner(snapshot, canonical.approvedByUserId);
              if (isSettled(snapshot, canonical.id)) return "duplicate" as const;
              assertFrozenAmounts(snapshot, canonical);
              const plan = planCommissionBatch({ records: snapshot.commissionRecords, receipt, attribution: canonical, now: now() });
              if (!plan.accepted) fail(plan.reason);
              const paidAt = new Date(now()).toISOString();
              const note = batchNote(canonical, receipt, plan.waivedMicros, plan.excessMicros);
              for (const allocation of plan.allocations) {
                const index = snapshot.commissionRecords.findIndex((record) => record.id === allocation.commissionId);
                const previous = snapshot.commissionRecords[index];
                const record: CommissionRecord & { paymentBatchSettlement: unknown } = { ...previous,
                  paymentStatus: "paid", paymentProvider: "crypto_wallet", paymentVerificationStatus: "verified",
                  paymentNetwork: receipt.network, recipientWalletAddress: ports.destination(receipt.network),
                  paymentSignature: canonical.signature, paidAt, updatedAt: paidAt, paymentSubmittedAt: canonical.createdAt,
                  paymentVerificationNotes: note,
                  paymentBatchSettlement: { batchId: canonical.id, ...allocation, signatureKey: plan.signatureKey,
                    groupReceivedMicros: plan.receivedMicros, groupDueMicros: plan.expectedMicros,
                    approvedByUserId: canonical.approvedByUserId } };
                snapshot.commissionRecords[index] = record;
              }
              const remaining = snapshot.commissionRecords.filter((record) => record.sellerId === canonical.sellerId && record.paymentStatus !== "paid");
              for (const allocation of plan.allocations) {
                const record = snapshot.commissionRecords.find((item) => item.id === allocation.commissionId)!;
                record.paymentConfirmationEmailPending = { id: `${canonical.id}:${record.id}:email`, requestedAt: paidAt,
                  amountDueUsdt: allocation.receivedMicros / 1e6,
                  remainingCommissions: remaining.map((item) => ({ id: item.id, displayNumber: item.displayNumber })) };
              }
              append(snapshot, { id: `${canonical.id}:settled`, action: "commission_paid", actorUserId: canonical.approvedByUserId,
                targetUserId: canonical.sellerId, details: note,
                newValue: { kind: SETTLED, batchId: canonical.id, receipt, plan }, createdAt: paidAt });
              const href = remaining.length ? commissionPaymentDestination(remaining[0].id) : "/dashboard/seller#my-listings-section";
              snapshot.notifications.unshift({ id: `${canonical.id}:notification`, userId: canonical.sellerId,
                category: "trade", title: "Combined commission payment verified", titleAr: "تم تأكيد دفعة العمولات المجمعة",
                messageAr: `تم استلام ${(receipt.amountMicros / 1e6).toFixed(6)} USDT. تم إعفاء ${(plan.waivedMicros / 1e6).toFixed(6)} USDT وتسجيل زيادة ${(plan.excessMicros / 1e6).toFixed(6)} USDT. ${remaining.length ? "ما زالت هناك عمولات أخرى غير مدفوعة." : "لا توجد عمولات مستحقة. أي قيود أخرى على الحساب تبقى سارية."}`,
                message: `${note} ${remaining.length
                  ? "Other commission dues remain outstanding." : "No commission dues remain. Other account restrictions still apply."}`,
                isRead: false, reason: remaining.length ? "commission_payment_due" : "commission_payment_verified",
                actionHref: href, relatedHref: href, actionLabel: remaining.length ? "Review commissions" : "Manage listings", createdAt: paidAt });
              // No listing status, seller approval, user roles, trade payment stage or sessions are rewritten.
              return "verified" as const;
            });
            summary[outcome]++;
            code = outcome;
            ports.afterCommit?.();
          }
        } catch (error) {
          if (error instanceof CommissionBatchError) { code = error.code; summary.review++; }
          else { code = "batch_provider_or_commit_unavailable"; summary.errors++; }
        }
        // Persist a bounded retry position, including failed/stale groups, so one
        // bad reference cannot monopolize every future minute. No provider body is logged.
        if (code !== "verified" && code !== "duplicate") {
          try {
            const attemptedAt = new Date(now()).toISOString();
            await ports.atomic((snapshot) => {
              if (isSettled(snapshot, batch.id)) return;
              append(snapshot, { id: `${batch.id}:attempt:${randomUUID()}`, action: "commission_recorded",
                actorUserId: batch.approvedByUserId, targetUserId: batch.sellerId,
                details: "Combined payment verification retry; no commission was credited.",
                newValue: { kind: ATTEMPT, batchId: batch.id, code }, createdAt: attemptedAt });
            });
          } catch { summary.errors++; }
        }
      }
      return summary;
    },
  };
}
