import { describe, expect, it } from "vitest";
import {
  acquireTradeRoomMutation,
  canBuyerCancelTrade,
  canSellerCancelTrade,
  canSellerDeclineTrade,
  releaseTradeRoomMutation,
} from "@/lib/trade-room-actions";
import type { PurchaseRequest } from "@/types/alpha-exchange";

const request = {
  id: "request-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "pending",
} as PurchaseRequest;

describe("Trade Room secondary actions", () => {
  it("allows only one rapid Trade Room mutation and only its owner can release the lock", () => {
    const lock = { current: null as string | null };

    expect(acquireTradeRoomMutation(lock, "trade-1:pending:accepted")).toBe(true);
    expect(acquireTradeRoomMutation(lock, "trade-1:pending:declined")).toBe(false);
    expect(lock.current).toBe("trade-1:pending:accepted");

    releaseTradeRoomMutation(lock, "trade-1:pending:declined");
    expect(lock.current).toBe("trade-1:pending:accepted");

    releaseTradeRoomMutation(lock, "trade-1:pending:accepted");
    expect(lock.current).toBeNull();
    expect(acquireTradeRoomMutation(lock, "trade-1:cancel")).toBe(true);
  });

  it("allows the buyer to cancel until payment evidence is submitted", () => {
    expect(canBuyerCancelTrade(request, "buyer-1")).toBe(true);
    expect(canBuyerCancelTrade({ ...request, status: "accepted" }, "buyer-1")).toBe(true);
    expect(canBuyerCancelTrade({ ...request, status: "accepted", sensitivePaymentSharedAt: "2026-09-04T11:55:00.000Z", sensitivePaymentKind: "bank_details" }, "buyer-1")).toBe(true);
    expect(canBuyerCancelTrade({ ...request, status: "accepted", paymentSentAt: "2026-09-04T12:00:00.000Z" }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade({ ...request, status: "accepted", buyerEvidence: { id: "evidence-1" } as never }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade({ ...request, status: "payment_sent" }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade(request, "seller-1")).toBe(false);
  });

  it("allows the seller to decline only a pending request", () => {
    expect(canSellerDeclineTrade(request, "seller-1")).toBe(true);
    expect(canSellerDeclineTrade({ ...request, status: "accepted" }, "seller-1")).toBe(false);
    expect(canSellerDeclineTrade(request, "buyer-1")).toBe(false);
  });

  it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("allows seller cancellation before payment for %s", (paymentMethod) => {
    expect(canSellerCancelTrade({ ...request, paymentMethod }, "seller-1")).toBe(true);
    expect(canSellerCancelTrade({ ...request, paymentMethod, status: "accepted" }, "seller-1")).toBe(true);
    expect(canSellerCancelTrade({ ...request, paymentMethod, status: "accepted" }, "buyer-1")).toBe(false);
    expect(canSellerCancelTrade({ ...request, paymentMethod, status: "accepted" }, "outsider")).toBe(false);
  });

  it.each([
    { paymentSentAt: "2026-09-22T12:00:00Z" },
    { fundsReceivedAt: "2026-09-22T12:00:00Z" },
    { usdtReleaseStartedAt: "2026-09-22T12:00:00Z" },
    { usdtSentAt: "2026-09-22T12:00:00Z" },
    { buyerEvidence: { id: "buyer-proof" } },
    { sellerEvidence: { id: "seller-proof" } },
    { sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: "2026-09-22T12:00:00Z" },
    { messages: [{ credentialKind: "cardless_code" }] },
  ] as Partial<PurchaseRequest>[])("blocks both participants when a stale accepted request has progress: %j", (progress) => {
    const stale = { ...request, status: "accepted" as const, ...progress };
    expect(canSellerCancelTrade(stale, "seller-1")).toBe(false);
    expect(canBuyerCancelTrade(stale, "buyer-1")).toBe(false);
    if (!progress.messages) expect(canSellerDeclineTrade({ ...stale, status: "pending" }, "seller-1")).toBe(false);
  });

  it("keeps seller cancellation available after bank account details are revealed", () => {
    expect(canSellerCancelTrade({ ...request, status: "accepted", sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: "2026-09-22T12:00:00Z" }, "seller-1")).toBe(true);
  });

  it("allows cancelling a pending cardless request with a prepared, undisclosed code", () => {
    const prepared = { ...request, paymentMethod: "Cardless ATM Withdrawal", messages: [{ credentialKind: "cardless_code" }] } as PurchaseRequest;
    expect(canSellerDeclineTrade(prepared, "seller-1")).toBe(true);
    expect(canBuyerCancelTrade(prepared, "buyer-1")).toBe(true);
  });
});
