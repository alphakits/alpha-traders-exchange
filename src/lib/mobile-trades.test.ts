import { describe, expect, it } from "vitest";
import { mobileTradeErrorCode, toMobileTradeActions, toMobileTradeSummary } from "@/lib/mobile-trades";
import type { PurchaseRequest } from "@/types/alpha-exchange";

const acceptedBankTrade = {
  id: "trade-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "accepted",
  paymentMethod: "Bank Transfer",
} as PurchaseRequest;

describe("mobile trade actions", () => {
  it("exposes amount adjustment independently of buyer cancellation after bank disclosure", () => {
    const viewed = { ...acceptedBankTrade, sensitivePaymentKind: "bank_details" as const,
      sensitivePaymentSharedAt: "2026-10-28T12:00:00Z" };
    expect(toMobileTradeActions(viewed, "buyer-1")).toMatchObject({ canCancel: false, canAdjustAmounts: true });
    expect(toMobileTradeActions(viewed, "seller-1").canAdjustAmounts).toBe(true);
    expect(toMobileTradeActions(viewed, "outsider").canAdjustAmounts).toBe(false);
    expect(toMobileTradeActions(viewed, "buyer-1", { canOpenDispute: false, hasOpenDispute: true }).canAdjustAmounts).toBe(false);
    expect(toMobileTradeActions({ ...viewed, bankTransferProvider: "wise" }, "buyer-1").canAdjustAmounts).toBe(false);
  });
  it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])(
    "emits the payment-based amount capability for %s", paymentMethod => {
      for (const userId of ["buyer-1", "seller-1"]) {
        const trade = { ...acceptedBankTrade, paymentMethod };
        for (const status of ["pending", "accepted"] as const) {
          expect(toMobileTradeActions({ ...trade, status }, userId).canAdjustAmounts).toBe(true);
        }
        for (const status of ["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed", "review_open", "locked", "cancelled", "declined"] as const) {
          expect(toMobileTradeActions({ ...trade, status }, userId).canAdjustAmounts).toBe(false);
        }
        expect(toMobileTradeActions({ ...trade, paymentSentAt: "2026-10-28T12:00:00Z" }, userId).canAdjustAmounts).toBe(false);
        expect(toMobileTradeActions({ ...trade, sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: "2026-10-28T12:00:00Z" }, userId).canAdjustAmounts).toBe(false);
      }
    },
  );
  it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])(
    "pauses %s payment while retaining buyer approval of an accepted amount proposal", paymentMethod => {
      const trade = { ...acceptedBankTrade, paymentMethod, cardlessCodeAwaitingBuyerConfirmation: true,
        messages: [{ credentialKind: "cardless_code" }],
      } as PurchaseRequest;
      const proposal = { id: "amount-1", kind: "amount_correction" as const, status: "pending" as const,
        usdtAmount: "300", fiatAmount: "900.00", pricePerUsdt: "3.00", createdAt: "2026-10-28T12:00:00Z" };
      const current = toMobileTradeActions(trade, "buyer-1");
      const cash = paymentMethod !== "Bank Transfer";
      expect(current).toMatchObject({ canMarkPaymentSent: cash, canUploadPaymentEvidence: !cash,
        canConfirmPreparedCardlessCode: paymentMethod === "Cardless ATM Withdrawal" });
      const pending = { ...trade, termsProposal: proposal };
      expect(toMobileTradeActions(pending, "buyer-1")).toMatchObject({
        canMarkPaymentSent: false, canConfirmPreparedCardlessCode: false, canUploadPaymentEvidence: false,
        canAdjustAmounts: true, canCancel: current.canCancel,
      });
      expect(toMobileTradeActions(pending, "seller-1")).toMatchObject({ canConfirmFunds: false, canAdjustAmounts: true });
      expect(toMobileTradeActions({ ...trade, termsProposal: { ...proposal, status: "accepted" } }, "buyer-1"))
        .toMatchObject({ canMarkPaymentSent: cash, canUploadPaymentEvidence: !cash,
          canConfirmPreparedCardlessCode: paymentMethod === "Cardless ATM Withdrawal" });
    },
  );
  it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)(
    "does not expose seller progression for stale pending terms at %s", status => {
      for (const paymentMethod of ["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"]) {
        const trade = { ...acceptedBankTrade, paymentMethod, status,
          termsProposal: { id: "stale-proposal", kind: "amount_correction", status: "pending" },
        } as PurchaseRequest;
        expect(toMobileTradeActions(trade, "seller-1")).toMatchObject({
          canConfirmFunds: false, canBeginRelease: false, canMarkUsdtSent: false, canUploadReleaseEvidence: false,
          canCompleteTrade: false, canCompleteFaceToFace: false,
        });
      }
    },
  );
  it("distinguishes saved private ATM details from legacy accepted credentials", () => {
    const request = { ...acceptedBankTrade, paymentMethod: "Cardless ATM Withdrawal",
      messages: [{ credentialKind: "cardless_code" }] } as PurchaseRequest;
    expect(toMobileTradeActions(request, "buyer-1").canConfirmPreparedCardlessCode).toBe(false);
    expect(toMobileTradeActions(request, "buyer-1").canCancel).toBe(false);
    expect(toMobileTradeActions(request, "buyer-1").canAdjustAmounts).toBe(false);
    const prepared = { ...request, cardlessCodeAwaitingBuyerConfirmation: true };
    expect(toMobileTradeActions(prepared, "buyer-1").canConfirmPreparedCardlessCode).toBe(true);
    expect(toMobileTradeActions(prepared, "buyer-1").canCancel).toBe(true);
    expect(toMobileTradeActions(prepared, "buyer-1").canAdjustAmounts).toBe(true);
    expect(toMobileTradeActions(prepared, "seller-1").canConfirmPreparedCardlessCode).toBe(false);
    expect(toMobileTradeActions({ ...prepared, sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: "2026-10-16T12:00:00Z" }, "buyer-1").canCancel).toBe(false);
  });
  it("allows linked bank inspection before acceptance but closes the action at terminal stages", () => {
    const pending = { ...acceptedBankTrade, sellerBankAccountId: "bank-1", status: "pending" as const };
    expect(toMobileTradeActions(pending, "buyer-1").canViewBankDetails).toBe(true);
    expect(toMobileTradeActions(pending, "outsider").canViewBankDetails).toBe(false);
    for (const status of ["cancelled", "declined", "completed", "review_open", "locked"] as const) {
      expect(toMobileTradeActions({ ...pending, status }, "buyer-1").canViewBankDetails).toBe(false);
    }
    expect(mobileTradeErrorCode(new Error("Bank details are available only for an active Bank Transfer request."))).toBe("TRADE_ACTION_NOT_ALLOWED");
  });
  it("exposes the persisted adjustment count to both native participants", () => {
    for (const userId of ["seller-1", "buyer-1"]) {
      expect(toMobileTradeSummary({...acceptedBankTrade, amountAdjustmentCount:2}, userId).amountAdjustmentCount).toBe(2);
    }
  });
  it("counts legacy system proposals, without treating user chat as an adjustment", () => {
    const message = "Seller proposed 150 USDT for ILS 600.00 at 4.00 per USDT. Buyer confirmation required.";
    const trade = {...acceptedBankTrade, messages:[{kind:"user", message}, {kind:"system", message}]} as PurchaseRequest;
    expect(toMobileTradeSummary(trade, "seller-1").amountAdjustmentCount).toBe(1);
  });
  it.each([
    ["Bank Transfer", "usdt_sent", true],
    ["Bank Transfer", "funds_received", false],
    ["Face-to-Face (Meet in Person)", "funds_received", true],
    ["Face-to-Face (Meet in Person)", "payment_sent", false],
    ["Cardless ATM Withdrawal", "funds_received", false],
    ["Cardless ATM Withdrawal", "usdt_sent", true],
  ] as const)("exposes seller completion correctly for %s at %s", (paymentMethod, status, available) => {
    const request = { ...acceptedBankTrade, paymentMethod, status };
    expect(toMobileTradeActions(request, "seller-1").canCompleteTrade).toBe(available);
    expect(toMobileTradeActions(request, "buyer-1").canCompleteTrade).toBe(false);
    expect(toMobileTradeActions(request, "outsider").canCompleteTrade).toBe(false);
  });
  it("locks buyer cancellation after bank details are viewed and after payment starts", () => {
    expect(toMobileTradeActions({
      ...acceptedBankTrade,
      sensitivePaymentSharedAt: "2026-09-19T10:00:00.000Z",
      sensitivePaymentKind: "bank_details",
    }, "buyer-1").canCancel).toBe(false);

    expect(toMobileTradeActions({
      ...acceptedBankTrade,
      paymentSentAt: "2026-09-19T10:01:00.000Z",
    }, "buyer-1").canCancel).toBe(false);

    expect(toMobileTradeActions({
      ...acceptedBankTrade,
      buyerEvidence: { id: "evidence-1" } as never,
    }, "buyer-1").canCancel).toBe(false);
  });
});


it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("offers completion without cancellation or repeated release for %s after delivery", (paymentMethod) => {
  const actions = toMobileTradeActions({ ...acceptedBankTrade, paymentMethod, status: "usdt_sent" }, "seller-1");
  expect(actions).toMatchObject({ canCompleteTrade: true, canCancel: false, canDecline: false,
    canConfirmFunds: false, canBeginRelease: false, canMarkUsdtSent: false, canUploadReleaseEvidence: false });
});

it("offers only completion for face-to-face after cash receipt", () => {
  expect(toMobileTradeActions({ ...acceptedBankTrade, paymentMethod: "Face-to-Face (Meet in Person)", status: "funds_received" }, "seller-1"))
    .toMatchObject({ canCompleteTrade: true, canMarkUsdtSent: false, canCancel: false, canBeginRelease: false });
});

it("never offers cancellation after a cardless code was exposed, even with a stale accepted status", () => {
  const request = { ...acceptedBankTrade, paymentMethod: "Cardless ATM Withdrawal",
    sensitivePaymentKind: "cardless_code" as const, sensitivePaymentSharedAt: "2026-09-24T12:00:00Z" };
  expect(toMobileTradeActions(request, "buyer-1").canCancel).toBe(false);
  expect(toMobileTradeActions(request, "seller-1").canCancel).toBe(false);
});

 it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("exposes direct receipt only to the face-to-face seller for %s", paymentMethod => {
   const request = { ...acceptedBankTrade, paymentMethod };
   expect(toMobileTradeActions(request, "seller-1").canConfirmFunds).toBe(paymentMethod.startsWith("Face-to-Face"));
   expect(toMobileTradeActions(request, "buyer-1").canConfirmFunds).toBe(false);
   expect(toMobileTradeActions(request, "outsider").canConfirmFunds).toBe(false);
   expect(toMobileTradeActions(request, "seller-1", { canOpenDispute: false, hasOpenDispute: true }).canConfirmFunds).toBe(false);
 });
