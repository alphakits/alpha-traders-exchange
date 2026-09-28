import { describe, expect, it } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { buildTradeRoomDestination } from "@/lib/trade-room-destination";

function createRequest(status: PurchaseRequest["status"]): PurchaseRequest {
  const now = new Date().toISOString();
  return {
    id: "purchase-1",
    listingId: "listing-1",
    buyerId: "buyer-1",
    buyerName: "Buyer",
    buyerWhatsapp: "+972500000000",
    buyerNotes: "",
    sellerId: "seller-1",
    usdtAmount: "250",
    fiatAmount: "920",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    status,
    createdAt: now,
    updatedAt: now,
    timeline: [],
  };
}

describe("buildTradeRoomDestination", () => {
  it("targets seller acceptance action for pending trades", () => {
    const destination = buildTradeRoomDestination(createRequest("pending"), "seller-1");
    expect(destination).toBe("/trade-room/purchase-1?action=accept-trade#action-required");
  });

  it("targets buyer evidence section for accepted trades", () => {
    const destination = buildTradeRoomDestination(createRequest("accepted"), "buyer-1");
    expect(destination).toBe("/trade-room/purchase-1?action=upload-payment-receipt#evidence");
  });

  it("targets seller confirmation action after buyer submits payment", () => {
    const destination = buildTradeRoomDestination(createRequest("payment_sent"), "seller-1");
    expect(destination).toBe("/trade-room/purchase-1?action=confirm-money-received#action-required");
  });

  it("falls back to status banner for non-actionable viewer states", () => {
    const destination = buildTradeRoomDestination(createRequest("payment_sent"), "buyer-1");
    expect(destination).toBe("/trade-room/purchase-1?action=open-trade#status-banner");
  });

  it.each(["funds_received", "usdt_release_pending"] as const)("targets face-to-face seller completion at %s", (status) => {
    const request = { ...createRequest(status), paymentMethod: "Face-to-Face (Meet in Person)" };
    expect(buildTradeRoomDestination(request, "seller-1")).toBe("/trade-room/purchase-1?action=complete-cash-trade#action-required");
    expect(buildTradeRoomDestination(request, "buyer-1")).toBe("/trade-room/purchase-1?action=open-trade#status-banner");
  });

  it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("targets seller completion after USDT is sent for %s", (paymentMethod) => {
    const request = { ...createRequest("usdt_sent"), paymentMethod };
    expect(buildTradeRoomDestination(request, "seller-1")).toBe("/trade-room/purchase-1?action=complete-cash-trade#action-required");
    expect(buildTradeRoomDestination(request, "buyer-1")).toBe("/trade-room/purchase-1?action=confirm-usdt-received#action-required");
  });

  it("preserves cardless USDT confirmation and bank release before completion is available", () => {
    expect(buildTradeRoomDestination({ ...createRequest("funds_received"), paymentMethod: "Cardless ATM Withdrawal" }, "seller-1"))
      .toBe("/trade-room/purchase-1?action=confirm-usdt-sent#action-required");
    expect(buildTradeRoomDestination(createRequest("funds_received"), "seller-1"))
      .toBe("/trade-room/purchase-1?action=release-usdt#action-required");
  });
});
