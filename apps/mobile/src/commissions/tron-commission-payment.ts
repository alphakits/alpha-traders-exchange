export const BINANCE_USDT_TRC20_COMMISSION_ADDRESS = "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8" as const;

export const TRON_TRANSACTION_ID_LENGTH = 64;

const TRON_TRANSACTION_ID_PATTERN = /^[0-9a-fA-F]{64}$/;

export type CommissionPaymentVerificationStatus = "pending_verification" | "verified" | "failed";

export type CommissionPaymentVerificationUiState = "ready" | "pending" | "verified" | "failed";

export interface CommissionPaymentVerificationRecord {
  commissionId: string;
  paymentVerificationStatus?: CommissionPaymentVerificationStatus;
  paymentVerificationNotes?: string;
  paymentSignature?: string;
  paymentSubmittedAt?: string;
  paymentExpectedAmountMode?: "unique_v1" | "legacy_base";
}

export interface CommissionRecordContextInput {
  source?: "trade" | "admin_manual";
  issueReason?: string;
  relatedRequestId?: string;
  relatedTradeId?: string;
  relatedTradeDisplayNumber?: number;
}

/**
 * Manual commissions intentionally have no trade relationship. Resolve the
 * optional context once so native screens never manufacture a trade link or
 * dereference a missing request id.
 */
export function resolveCommissionRecordContext(record: CommissionRecordContextInput) {
  const requestId = record.relatedRequestId?.trim() || undefined;
  const isAdminIssued = record.source === "admin_manual";
  const tradeReference = isAdminIssued
    ? undefined
    : record.relatedTradeDisplayNumber
      ?? record.relatedTradeId?.trim()
      ?? (requestId ? requestId.slice(-6) : undefined);
  return {
    isAdminIssued,
    issueReason: record.issueReason?.trim() || undefined,
    requestId: isAdminIssued ? undefined : requestId,
    tradeReference,
  };
}

/**
 * Grandfathered base-amount payments cannot safely accept a different TxID:
 * their original submitted TxID is the only durable payment-to-commission
 * binding. New unique-amount intents may still self-service a correction.
 */
export function isLegacyCommissionOriginalTransactionBound(
  record: CommissionPaymentVerificationRecord | undefined,
): boolean {
  return record?.paymentVerificationStatus === "pending_verification"
    && record.paymentExpectedAmountMode === "legacy_base";
}

export interface CommissionPaymentVerificationUiDetails {
  state: CommissionPaymentVerificationUiState;
  notes?: string;
  paymentSignature?: string;
  paymentSubmittedAt?: string;
}

/**
 * Removes whitespace and invisible formatting characters that can be included
 * when a TxID is copied from an exchange withdrawal-history screen.
 */
export function normalizeTronTransactionIdInput(raw: string): string {
  return raw.replace(/[\p{Z}\p{C}]/gu, "");
}

/** A TRON transaction ID is exactly 32 bytes rendered as 64 hex characters. */
export function isValidTronTransactionId(value: string): boolean {
  return TRON_TRANSACTION_ID_PATTERN.test(value);
}

/**
 * Resolves durable server verification state while retaining the short local
 * pending state between a submission response and the next server refresh.
 * Terminal server states always win over stale local state.
 */
export function resolveCommissionPaymentVerificationUi(
  record: CommissionPaymentVerificationRecord | undefined,
  locallyPendingCommissionId: string | null,
): CommissionPaymentVerificationUiDetails {
  const serverStatus = record?.paymentVerificationStatus;
  let state: CommissionPaymentVerificationUiState = "ready";

  if (serverStatus === "verified") {
    state = "verified";
  } else if (serverStatus === "failed") {
    state = "failed";
  } else if (serverStatus === "pending_verification" || record?.commissionId === locallyPendingCommissionId) {
    state = "pending";
  }

  return {
    state,
    notes: record?.paymentVerificationNotes,
    paymentSignature: record?.paymentSignature,
    paymentSubmittedAt: record?.paymentSubmittedAt,
  };
}

/** Clears optimistic pending state once refreshed server data is authoritative. */
export function reconcileLocallyPendingCommissionId(
  locallyPendingCommissionId: string | null,
  records: CommissionPaymentVerificationRecord[],
): string | null {
  if (!locallyPendingCommissionId) return null;
  const record = records.find((item) => item.commissionId === locallyPendingCommissionId);
  return record?.paymentVerificationStatus === "pending_verification"
    ? locallyPendingCommissionId
    : null;
}

export function summarizeTronTransactionId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}…${value.slice(-10)}`;
}

export function formatExactTrc20CommissionAmount(value: number): string {
  const finiteValue = Number.isFinite(value) ? value : 0;
  return `${finiteValue.toFixed(6)} USDT`;
}
