import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getAdminPrepDashboardData,
  reverifyPendingCommissionPayments,
  submitSellerCommissionWalletPayment,
} from "@/lib/alpha-exchange-store";
import {
  CANONICAL_TRC20_COMMISSION_WALLET,
  OFFICIAL_TRON_USDT_CONTRACT,
} from "@/lib/commission-config";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TRONGRID_DEFAULT_BASE_URL = "https://api.trongrid.io";
const TRONGRID_SCAN_TIMEOUT_MS = 8_000;
const MAX_AUTO_RECONCILIATIONS_PER_RUN = 2;
const PAYMENT_ASSIGNMENT_CLOCK_SKEW_MS = 2 * 60_000;
const PAYMENT_FUTURE_CLOCK_SKEW_MS = 5 * 60_000;

interface CommissionCandidate {
  id: string;
  sellerId: string;
  commissionAmount?: number;
  createdAt?: string;
  paymentStatus?: string;
  paymentVerificationStatus?: string;
  paymentSignature?: string;
  paymentExpectedAmount?: number;
  paymentExpectedAmountMode?: "legacy_base" | "unique_v1";
  paymentExpectedAmountAssignedAt?: string;
}

interface TronGridTrc20Transfer {
  transaction_id?: string;
  block_timestamp?: number;
  from?: string;
  to?: string;
  type?: string;
  value?: string;
  token_info?: {
    address?: string;
    decimals?: number;
    symbol?: string;
  };
}

interface TronGridTrc20Response {
  success?: boolean;
  data?: TronGridTrc20Transfer[];
}

function authorizedCronRequest(request: NextRequest, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const provided = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function usdtToMicros(value: number) {
  return Math.round(value * 1_000_000);
}

function parseTransferAmountMicros(transfer: TronGridTrc20Transfer) {
  const rawValue = transfer.value;
  const decimals = transfer.token_info?.decimals;
  if (!rawValue || !/^\d+$/.test(rawValue) || !Number.isInteger(decimals) || decimals !== 6) return null;
  try {
    const micros = BigInt(rawValue);
    if (micros <= BigInt(0) || micros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(micros);
  } catch {
    return null;
  }
}

function isLegacyBaseCandidate(record: CommissionCandidate) {
  return record.paymentExpectedAmountMode === "legacy_base";
}

function candidateLowerBoundMs(record: CommissionCandidate) {
  const primary = isLegacyBaseCandidate(record)
    ? new Date(record.createdAt ?? "").getTime()
    : new Date(record.paymentExpectedAmountAssignedAt ?? "").getTime();
  if (Number.isFinite(primary) && primary > 0) return primary;
  const fallback = new Date(record.paymentExpectedAmountAssignedAt ?? record.createdAt ?? "").getTime();
  return Number.isFinite(fallback) && fallback > 0 ? fallback : Number.NaN;
}

function candidateExpectedAmountMicros(record: CommissionCandidate) {
  const amount = isLegacyBaseCandidate(record)
    ? Number(record.commissionAmount ?? record.paymentExpectedAmount)
    : Number(record.paymentExpectedAmount);
  return Number.isFinite(amount) && amount > 0 ? usdtToMicros(amount) : null;
}

function isEligibleCommissionCandidate(record: CommissionCandidate) {
  if (!record.id || !record.sellerId) return false;
  if (record.paymentStatus === "paid") return false;
  if (record.paymentVerificationStatus === "verified") return false;
  if (record.paymentSignature) return false;
  if (candidateExpectedAmountMicros(record) === null) return false;
  return Number.isFinite(candidateLowerBoundMs(record));
}

async function fetchRecentIncomingUsdtTransfers(minTimestampMs: number) {
  const baseUrl = (process.env.ALPHA_EXCHANGE_TRONGRID_API_URL?.trim() || TRONGRID_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/v1/accounts/${encodeURIComponent(CANONICAL_TRC20_COMMISSION_WALLET)}/transactions/trc20`);
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("only_to", "true");
  url.searchParams.set("limit", "50");
  url.searchParams.set("order_by", "block_timestamp,desc");
  url.searchParams.set("contract_address", OFFICIAL_TRON_USDT_CONTRACT);
  url.searchParams.set("min_timestamp", String(Math.max(0, Math.floor(minTimestampMs))));

  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.ALPHA_EXCHANGE_TRONGRID_API_KEY?.trim();
  if (apiKey) headers["TRON-PRO-API-KEY"] = apiKey;

  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(TRONGRID_SCAN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TRON deposit scan failed with status ${response.status}.`);
  const payload = await response.json() as TronGridTrc20Response;
  if (payload.success === false || !Array.isArray(payload.data)) {
    throw new Error("TRON deposit scan returned an invalid response.");
  }
  return payload.data;
}

async function reconcileUnsubmittedCommissionPayments() {
  const dashboard = await getAdminPrepDashboardData();
  const records = (dashboard.commissionRecords ?? []) as CommissionCandidate[];
  const candidates = records.filter(isEligibleCommissionCandidate);
  if (candidates.length === 0) {
    return { scannedTransfers: 0, matched: 0, verified: 0, pending: 0, errors: 0, legacyMatched: 0 };
  }

  const earliestLowerBound = Math.min(...candidates.map(candidateLowerBoundMs));
  const transfers = await fetchRecentIncomingUsdtTransfers(earliestLowerBound - PAYMENT_ASSIGNMENT_CLOCK_SKEW_MS);
  const now = Date.now();

  const candidatesByAmount = new Map<number, CommissionCandidate[]>();
  for (const record of candidates) {
    const amountMicros = candidateExpectedAmountMicros(record);
    if (amountMicros === null) continue;
    const bucket = candidatesByAmount.get(amountMicros);
    if (bucket) bucket.push(record);
    else candidatesByAmount.set(amountMicros, [record]);
  }

  let matched = 0;
  let verified = 0;
  let pending = 0;
  let errors = 0;
  let legacyMatched = 0;
  const usedCommissionIds = new Set<string>();

  for (const transfer of transfers) {
    if (matched >= MAX_AUTO_RECONCILIATIONS_PER_RUN) break;
    const txId = String(transfer.transaction_id ?? "").trim();
    const blockTimestamp = Number(transfer.block_timestamp);
    const amountMicros = parseTransferAmountMicros(transfer);
    if (!/^[A-Fa-f0-9]{64}$/.test(txId)) continue;
    if (!Number.isFinite(blockTimestamp) || blockTimestamp <= 0 || blockTimestamp > now + PAYMENT_FUTURE_CLOCK_SKEW_MS) continue;
    if (transfer.to !== CANONICAL_TRC20_COMMISSION_WALLET) continue;
    if (transfer.type && transfer.type !== "Transfer") continue;
    if (transfer.token_info?.address && transfer.token_info.address !== OFFICIAL_TRON_USDT_CONTRACT) continue;
    if (amountMicros === null) continue;

    const amountCandidates = (candidatesByAmount.get(amountMicros) ?? []).filter((record) => {
      if (usedCommissionIds.has(record.id)) return false;
      return blockTimestamp >= candidateLowerBoundMs(record) - PAYMENT_ASSIGNMENT_CLOCK_SKEW_MS;
    });

    // Never guess. A historical base-amount payment is credited only when it maps
    // to one unpaid commission. Unique-v1 payments remain matched by their exact
    // immutable amount as before.
    if (amountCandidates.length !== 1) continue;
    const commission = amountCandidates[0];
    usedCommissionIds.add(commission.id);
    matched += 1;
    if (isLegacyBaseCandidate(commission)) legacyMatched += 1;

    try {
      const result = await submitSellerCommissionWalletPayment({
        sellerUserId: commission.sellerId,
        commissionId: commission.id,
        network: "TRC20",
        payerWalletAddress: String(transfer.from ?? ""),
        paymentSignature: txId,
      });
      if (result.verification.verified) verified += 1;
      else pending += 1;
    } catch (error) {
      errors += 1;
      logEvent("error", {
        event: "commission_payment_auto_reconciliation",
        outcome: "failed",
        reason: "matched_transfer_submission_failed",
        metadata: {
          commissionId: commission.id,
          legacy: isLegacyBaseCandidate(commission),
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
    }
  }

  return { scannedTransfers: transfers.length, matched, verified, pending, errors, legacyMatched };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    logEvent("error", { event: "commission_payment_verification_cron", outcome: "failed", reason: "cron_secret_not_configured" });
    return NextResponse.json({ error: "Commission verification scheduler is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!authorizedCronRequest(request, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  let autoReconciliation = { scannedTransfers: 0, matched: 0, verified: 0, pending: 0, errors: 0, legacyMatched: 0 };
  try {
    autoReconciliation = await reconcileUnsubmittedCommissionPayments();
  } catch (error) {
    autoReconciliation.errors += 1;
    logEvent("error", {
      event: "commission_payment_auto_reconciliation",
      outcome: "failed",
      reason: "deposit_scan_failed",
      metadata: { errorType: error instanceof Error ? error.name : typeof error },
    });
  }

  try {
    const pendingLimit = autoReconciliation.matched > 0 ? 1 : 2;
    const result = await reverifyPendingCommissionPayments({ limit: pendingLimit });
    logEvent("info", {
      event: "commission_payment_verification_cron",
      outcome: "success",
      metadata: { ...result, autoReconciliation },
    });
    return NextResponse.json({ ok: true, autoReconciliation, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logEvent("error", {
      event: "commission_payment_verification_cron",
      outcome: "failed",
      reason: "verification_sweep_failed",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, autoReconciliation },
    });
    return NextResponse.json({ error: "Commission verification sweep failed.", autoReconciliation }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
