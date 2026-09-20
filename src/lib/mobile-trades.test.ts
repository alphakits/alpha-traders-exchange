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
