import { describe, expect, it } from "vitest";
import { canBuyerCancelTrade, canSellerDeclineTrade } from "@/lib/trade-room-actions";
import type { PurchaseRequest } from "@/types/alpha-exchange";

const request = {
  id: "request-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "pending",
} as PurchaseRequest;

describe("Trade Room secondary actions", () => {
  it("allows the buyer to cancel before payment evidence is submitted", () => {
    expect(canBuyerCancelTrade(request, "buyer-1")).toBe(true);
    expect(canBuyerCancelTrade({ ...request, status: "accepted" }, "buyer-1")).toBe(true);
    expect(canBuyerCancelTrade({ ...request, status: "payment_sent" }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade(request, "seller-1")).toBe(false);
  });

  it("allows the seller to decline only a pending request", () => {
    expect(canSellerDeclineTrade(request, "seller-1")).toBe(true);
    expect(canSellerDeclineTrade({ ...request, status: "accepted" }, "seller-1")).toBe(false);
    expect(canSellerDeclineTrade(request, "buyer-1")).toBe(false);
  });
});
