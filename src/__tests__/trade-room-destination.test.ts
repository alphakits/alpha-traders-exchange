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
});
