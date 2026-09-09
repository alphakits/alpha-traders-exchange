import { describe, expect, it } from "vitest";
import {
  acquireTradeRoomMutation,
  canBuyerCancelTrade,
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
});
