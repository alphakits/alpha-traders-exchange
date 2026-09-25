import { describe, expect, it } from "vitest";
import { toMobileTradeActions } from "@/lib/mobile-trades";
import type { PurchaseRequest } from "@/types/alpha-exchange";

const acceptedBankTrade = {
  id: "trade-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "accepted",
  paymentMethod: "Bank Transfer",
} as PurchaseRequest;

describe("mobile trade actions", () => {
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
  it("keeps cancellation available after bank details are viewed but not after payment starts", () => {
    expect(toMobileTradeActions({
      ...acceptedBankTrade,
      sensitivePaymentSharedAt: "2026-09-19T10:00:00.000Z",
      sensitivePaymentKind: "bank_details",
    }, "buyer-1").canCancel).toBe(true);

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

it.each(["Face-to-Face (Meet in Person)", "Bank Transfer", "Cardless ATM Withdrawal"])("offers direct cash receipt only to the accepted face-to-face seller for %s", (paymentMethod) => {
  const request = { ...acceptedBankTrade, paymentMethod };
  expect(toMobileTradeActions(request, "seller-1").canConfirmFunds).toBe(paymentMethod === "Face-to-Face (Meet in Person)");
  expect(toMobileTradeActions(request, "buyer-1").canConfirmFunds).toBe(false);
  expect(toMobileTradeActions(request, "outsider").canConfirmFunds).toBe(false);
});
