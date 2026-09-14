import { describe, expect, it } from "vitest";
import {
  BINANCE_USDT_TRC20_COMMISSION_ADDRESS,
  formatExactTrc20CommissionAmount,
  isLegacyCommissionOriginalTransactionBound,
  isValidTronTransactionId,
  normalizeTronTransactionIdInput,
  reconcileLocallyPendingCommissionId,
  resolveCommissionRecordContext,
  resolveCommissionPaymentVerificationUi,
  summarizeTronTransactionId,
  TRON_TRANSACTION_ID_LENGTH,
} from "./tron-commission-payment";

describe("native TRC20 commission payment safeguards", () => {
  it("locks the visible destination to the canonical Binance USDT TRC20 address", () => {
    expect(BINANCE_USDT_TRC20_COMMISSION_ADDRESS).toBe("TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8");
  });

  it("accepts only an exact 64-character hexadecimal TRON TxID", () => {
    const lowercaseTxId = "a1".repeat(TRON_TRANSACTION_ID_LENGTH / 2);
    const uppercaseTxId = "BF".repeat(TRON_TRANSACTION_ID_LENGTH / 2);

    expect(isValidTronTransactionId(lowercaseTxId)).toBe(true);
    expect(isValidTronTransactionId(uppercaseTxId)).toBe(true);
    expect(isValidTronTransactionId(lowercaseTxId.slice(1))).toBe(false);
    expect(isValidTronTransactionId(`${lowercaseTxId}0`)).toBe(false);
    expect(isValidTronTransactionId(`0x${lowercaseTxId}`)).toBe(false);
    expect(isValidTronTransactionId(`${lowercaseTxId.slice(0, -1)}g`)).toBe(false);
    expect(isValidTronTransactionId(` ${lowercaseTxId}`)).toBe(false);
  });

  it("cleans copy-and-paste whitespace before strict validation", () => {
    const txId = "12ab".repeat(TRON_TRANSACTION_ID_LENGTH / 4);
    const pasted = `\u200B${txId.slice(0, 32)}\n${txId.slice(32)}\uFEFF`;

    const normalized = normalizeTronTransactionIdInput(pasted);

    expect(normalized).toBe(txId);
    expect(isValidTronTransactionId(normalized)).toBe(true);
  });

  it("always renders the unique payment amount with all six USDT decimals", () => {
    expect(formatExactTrc20CommissionAmount(7)).toBe("7.000000 USDT");
    expect(formatExactTrc20CommissionAmount(7.000001)).toBe("7.000001 USDT");
  });

  it("keeps an admin-issued commission independent from trade navigation", () => {
    expect(resolveCommissionRecordContext({
      source: "admin_manual",
      issueReason: " Documented seller adjustment ",
    })).toEqual({
      isAdminIssued: true,
      issueReason: "Documented seller adjustment",
      requestId: undefined,
      tradeReference: undefined,
    });

    expect(resolveCommissionRecordContext({
      source: "trade",
      relatedRequestId: "request-123456",
      relatedTradeDisplayNumber: 42,
    })).toEqual({
      isAdminIssued: false,
      issueReason: undefined,
      requestId: "request-123456",
      tradeReference: 42,
    });
  });

  it("restores pending verification from durable server state after an app reload", () => {
    const state = resolveCommissionPaymentVerificationUi({
      commissionId: "commission-1",
      paymentVerificationStatus: "pending_verification",
      paymentSignature: "ab".repeat(32),
      paymentSubmittedAt: "2026-09-10T12:00:00.000Z",
    }, null);

    expect(state).toEqual({
      state: "pending",
      notes: undefined,
      paymentSignature: "ab".repeat(32),
      paymentSubmittedAt: "2026-09-10T12:00:00.000Z",
    });
  });

  it("locks TxID replacement only for a pending grandfathered base-amount payment", () => {
    expect(isLegacyCommissionOriginalTransactionBound({
      commissionId: "commission-legacy",
      paymentVerificationStatus: "pending_verification",
      paymentExpectedAmountMode: "legacy_base",
    })).toBe(true);
    expect(isLegacyCommissionOriginalTransactionBound({
      commissionId: "commission-unique",
      paymentVerificationStatus: "pending_verification",
      paymentExpectedAmountMode: "unique_v1",
    })).toBe(false);
    expect(isLegacyCommissionOriginalTransactionBound({
      commissionId: "commission-failed-legacy",
      paymentVerificationStatus: "failed",
      paymentExpectedAmountMode: "legacy_base",
    })).toBe(false);
  });

  it("uses local pending state briefly but lets terminal server failure win", () => {
    expect(resolveCommissionPaymentVerificationUi({
      commissionId: "commission-1",
    }, "commission-1").state).toBe("pending");

    const failed = resolveCommissionPaymentVerificationUi({
      commissionId: "commission-1",
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: "The amount did not match.",
    }, "commission-1");

    expect(failed.state).toBe("failed");
    expect(failed.notes).toBe("The amount did not match.");
  });

  it("clears stale local pending state when refreshed server state is no longer pending", () => {
    expect(reconcileLocallyPendingCommissionId("commission-1", [{
      commissionId: "commission-1",
      paymentVerificationStatus: "pending_verification",
    }])).toBe("commission-1");

    expect(reconcileLocallyPendingCommissionId("commission-1", [{
      commissionId: "commission-1",
      paymentVerificationStatus: "failed",
    }])).toBeNull();
    expect(reconcileLocallyPendingCommissionId("commission-1", [{
      commissionId: "commission-1",
    }])).toBeNull();
    expect(reconcileLocallyPendingCommissionId("commission-1", [])).toBeNull();
  });

  it("summarizes a saved TxID without losing its identifying ends", () => {
    const txId = "12ab".repeat(16);
    expect(summarizeTronTransactionId(txId)).toBe(`${txId.slice(0, 10)}…${txId.slice(-10)}`);
    expect(summarizeTronTransactionId(undefined)).toBeUndefined();
  });
});
