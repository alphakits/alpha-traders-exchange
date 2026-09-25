import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getCommissionRecordsForAutomaticReconciliation,
  reverifyPendingCommissionPayments,
  recoverPendingCommissionPaymentConfirmationEmails,
  submitSellerCommissionWalletPayment,
} from "@/lib/alpha-exchange-store";
import {
  scanTronCommissionDeposits, scanBep20CommissionDeposits, scanBinanceCommissionDeposits,
  type CommissionDeposit,
} from "@/lib/commission-deposit-discovery";
import { normalizeTransactionHash } from "@/lib/tx-hash-utils";
import { logEvent } from "@/lib/structured-logging";
import { COMMISSION_PAYMENT_CLOCK_SKEW_MS } from "@/lib/commission-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_AUTO_RECONCILIATIONS_PER_RUN = 2;
type Candidate = Awaited<ReturnType<typeof getCommissionRecordsForAutomaticReconciliation>>[number];
type BatchRuntime = Awaited<ReturnType<typeof import("@/lib/commission-batch-runtime").getCommissionBatchRuntime>>;
type BatchSummary = Awaited<ReturnType<BatchRuntime["reconcile"]>>;
function signatureKey(value = "") {
  const normalized = normalizeTransactionHash(value);
  const hex = normalized.replace(/^0x/i, "");
  return /^[a-f0-9]{64}$/i.test(hex) ? hex.toLowerCase() : normalized;
}
function lowerBound(record: Candidate) {
  return new Date(record.paymentExpectedAmountMode === "legacy_base"
    ? record.createdAt : record.paymentExpectedAmountAssignedAt ?? "").getTime();
}
function expectedMicros(record: Candidate) {
  const amount = Number(record.paymentExpectedAmountMode === "legacy_base" ? record.commissionAmount : record.paymentExpectedAmount);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(Math.round(amount * 1_000_000))
    ? Math.round(amount * 1_000_000) : null;
}
function emptySummary() {
  return {
    candidates: 0, scannedTransfers: 0, matched: 0, verified: 0, pending: 0, rejected: 0, errors: 0, legacyMatched: 0,
    skippedUsed: 0, retriedRejected: 0, unmatchedAmount: 0, baseAmountOnly: 0, ambiguous: 0, beforeIntent: 0,
    providers: {} as Record<string, { configured: boolean; complete: boolean; pages: number; deposits: number; error?: string; fallback?: string }>,
  };
}
async function reconcileUnsubmittedCommissionPayments(deadline: number) {
  const summary: ReturnType<typeof emptySummary> & { batchSettlement?: BatchSummary } = emptySummary();
  // Default off until the financial integration release gates pass. Existing
  // exact-payment automation is unchanged when this feature is not enabled.
  const batchRuntime = process.env.ALPHA_EXCHANGE_COMMISSION_BATCH_V1 === "1"
    ? await (await import("@/lib/commission-batch-runtime")).getCommissionBatchRuntime() : null;
  const batchContext = batchRuntime ? await batchRuntime.scanContext() : null;
  const records = await getCommissionRecordsForAutomaticReconciliation();
  const candidates = records.filter((record) => (
    record.id && record.sellerId && record.paymentStatus !== "paid" && record.paymentVerificationStatus !== "verified"
    && (!record.paymentSignature || (record.paymentVerificationStatus === "failed" && record.paymentExpectedAmountMode === "unique_v1"))
    && expectedMicros(record) !== null && Number.isFinite(lowerBound(record)) && lowerBound(record) > 0
  ));
  summary.candidates = candidates.length;
  const lowerBounds = candidates.map(lowerBound);
  if (batchContext?.earliestTimestamp !== null && batchContext?.earliestTimestamp !== undefined) lowerBounds.push(batchContext.earliestTimestamp);
  if (!lowerBounds.length) return summary;
  const minTimestamp = Math.min(...lowerBounds) - COMMISSION_PAYMENT_CLOCK_SKEW_MS;
  const providers = [
    ["TRC20", scanTronCommissionDeposits], ["BEP20", scanBep20CommissionDeposits], ["BINANCE_DEPOSITS", scanBinanceCommissionDeposits],
  ] as const;
  const scans = await Promise.allSettled(providers.map(([, scan]) => scan(minTimestamp)));
  const binance = scans[2];
  const binanceHistoryComplete = binance.status === "fulfilled" && binance.value.configured && binance.value.complete;
  const deposits: CommissionDeposit[] = [];
  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    const provider = providers[i][0];
    const fallback = provider === "BEP20" && binanceHistoryComplete ? "BINANCE_DEPOSITS" : undefined;
    if (scan.status === "rejected") {
      if (!fallback) summary.errors++;
      const label = scan.reason instanceof Error && /^(?:tron|bep20|binance)_[a-z0-9_]+$/.test(scan.reason.message)
        ? scan.reason.message : "provider_unavailable";
      summary.providers[provider] = { configured: true, complete: false, pages: 0, deposits: 0, error: label, fallback };
      logEvent(fallback ? "warn" : "error", { event: "commission_deposit_discovery", outcome: fallback ? "success" : "failed", reason: label, metadata: { provider, fallback } });
      continue;
    }
    const value = scan.value;
    summary.providers[provider] = { configured: value.configured, complete: value.complete, pages: value.pages, deposits: value.deposits.length,
      fallback: !value.configured || !value.complete ? fallback : undefined,
    };
    if (value.configured && !value.complete && !fallback) summary.errors++;
    deposits.push(...value.deposits);
  }
  summary.scannedTransfers = deposits.length;
  // Reuse this same bounded scan. An approved receipt still passes independent
  // finality/credited-account verification; similarity of amounts is never identity.
  if (batchRuntime && batchContext?.pending.length) {
    try {
      summary.batchSettlement = await batchRuntime.reconcile({ deposits, deadline, limit: 1 });
      summary.errors += summary.batchSettlement.errors;
    } catch {
      summary.errors++;
      logEvent("error", { event: "commission_batch_reconciliation", outcome: "failed", reason: "batch_reconciliation_unavailable" });
    }
  }
  const reserved = new Set(records.filter((record) => record.paymentStatus === "paid"
    || record.paymentVerificationStatus === "verified" || record.paymentVerificationStatus === "pending_verification")
    .map((record) => signatureKey(record.paymentSignature)).filter(Boolean));
  for (const signature of batchContext?.reserved ?? []) reserved.add(signatureKey(signature));
  const seen = new Set<string>();
  const used = new Set<string>();
  const byAmount = new Map<number, Candidate[]>();
  for (const record of candidates) {
    const amount = expectedMicros(record)!;
    byAmount.set(amount, [...(byAmount.get(amount) ?? []), record]);
  }
  const depositQueue = deposits.map((deposit) => ({
    deposit,
    previouslyRejected: (byAmount.get(deposit.amountMicros) ?? []).find((record) => (
      record.paymentVerificationStatus === "failed" && signatureKey(record.paymentSignature) === signatureKey(deposit.signature)
    )),
  })).sort((left, right) => {
    const rejectionOrder = Number(Boolean(left.previouslyRejected)) - Number(Boolean(right.previouslyRejected));
    if (rejectionOrder) return rejectionOrder;
    if (left.previouslyRejected && right.previouslyRejected) {
      const lastAttempt = (record: Candidate) => new Date(record.updatedAt).getTime() || 0;
      const retryOrder = lastAttempt(left.previouslyRejected) - lastAttempt(right.previouslyRejected);
      if (retryOrder) return retryOrder;
    }
    return left.deposit.timestamp - right.deposit.timestamp;
  });
  for (const { deposit } of depositQueue) {
    if (summary.matched + (summary.batchSettlement?.checked ?? 0) >= MAX_AUTO_RECONCILIATIONS_PER_RUN || Date.now() >= deadline) break;
    const key = signatureKey(deposit.signature);
    if (seen.has(key)) continue;
    seen.add(key);
    if (reserved.has(key)) { summary.skippedUsed++; continue; }
    const amountMatches = byAmount.get(deposit.amountMicros) ?? [];
    if (!amountMatches.length) {
      summary.unmatchedAmount++;
      if (candidates.some((record) => Math.round(Number(record.commissionAmount) * 1_000_000) === deposit.amountMicros)) summary.baseAmountOnly++;
      continue;
    }
    const matches = amountMatches.filter((record) => deposit.timestamp >= lowerBound(record) - COMMISSION_PAYMENT_CLOCK_SKEW_MS);
    if (!matches.length) { summary.beforeIntent++; continue; }
    // Check ambiguity before removing used candidates: do not resolve an
    // ambiguous shared amount merely by processing one other transfer first.
    if (matches.length !== 1) { summary.ambiguous++; continue; }
    const record = matches[0];
    if (used.has(record.id)) continue;
    used.add(record.id);
    if (record.paymentVerificationStatus === "failed" && signatureKey(record.paymentSignature) === key) summary.retriedRejected++;
    summary.matched++;
    if (record.paymentExpectedAmountMode === "legacy_base") summary.legacyMatched++;
    try {
      const result = await submitSellerCommissionWalletPayment({ sellerUserId: record.sellerId, commissionId: record.id,
        network: deposit.network, payerWalletAddress: deposit.payer, paymentSignature: deposit.signature,
      });
      if (result.verification.verified) summary.verified++;
      else if (result.verification.pending) summary.pending++;
      else summary.rejected++;
    } catch {
      summary.errors++;
      logEvent("error", { event: "commission_payment_auto_reconciliation", outcome: "failed", reason: "matched_transfer_submission_failed" });
    }
  }
  return summary;
}
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    logEvent("error", { event: "commission_payment_verification_cron", outcome: "failed", reason: "cron_secret_not_configured" });
    return NextResponse.json({ error: "Commission verification scheduler is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const provided = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  let autoReconciliation = emptySummary();
  try {
    autoReconciliation = await reconcileUnsubmittedCommissionPayments(startedAt + 35_000);
  } catch {
    autoReconciliation.errors++;
    logEvent("error", { event: "commission_payment_auto_reconciliation", outcome: "failed", reason: "deposit_scan_failed" });
  }
  try {
    const pendingLimit = autoReconciliation.matched > 0 ? 1 : 2;
    const result = await reverifyPendingCommissionPayments({ limit: pendingLimit, deadline: startedAt + 45_000 });
    let emailRecovery = { checked: 0, queued: 0, errors: 0, pending: 0, budgetExhausted: false };
    const emailBudgetMs = Math.min(8_000, Math.max(0, startedAt + 55_000 - Date.now()));
    if (emailBudgetMs >= 6_000) {
      try { emailRecovery = await recoverPendingCommissionPaymentConfirmationEmails({ limit: 2, maxDurationMs: emailBudgetMs }); }
      catch {
        emailRecovery.errors++;
        logEvent("error", { event: "commission_payment_confirmation_recovery", outcome: "failed", reason: "email_recovery_failed" });
      }
    } else { emailRecovery.budgetExhausted = true; }
    const ok = autoReconciliation.errors === 0 && result.errors === 0 && emailRecovery.errors === 0;
    logEvent(ok ? "info" : "error", {
      event: "commission_payment_verification_cron", outcome: ok ? "success" : "failed",
      reason: ok ? undefined : "commission_verification_degraded", metadata: { ...result, autoReconciliation, confirmationRecovery: emailRecovery,
        providerHealth: JSON.stringify(autoReconciliation.providers),
      },
    });
    return NextResponse.json({ ok, autoReconciliation, ...result, emailRecovery }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    logEvent("error", { event: "commission_payment_verification_cron", outcome: "failed", reason: "verification_sweep_failed", metadata: { autoReconciliation } });
    return NextResponse.json({ error: "Commission verification sweep failed.", autoReconciliation }, { status: 500 });
  }
}
