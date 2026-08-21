import { describe, expect, it } from "vitest";
import { completedTradeDestination, listingDestination, sellerApplicationReviewDestination, sellerApplicationStatusDestination, sellerListingWorkspaceDestination, tradeDestination } from "@/lib/action-destinations";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

const listing = { id: "listing-123" } as MarketplaceListing;

function request(status: PurchaseRequest["status"]): PurchaseRequest {
  return {
    id: "purchase-123",
    listingId: listing.id,
    buyerId: "buyer-1",
    sellerId: "seller-1",
    buyerName: "Buyer",
    buyerWhatsapp: "+972500000000",
    buyerNotes: "",
    usdtAmount: "100",
    fiatAmount: "320",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    status,
    timeline: [],
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  } as PurchaseRequest;
}

describe("canonical action destinations", () => {
  it("builds exact listing and application destinations", () => {
    expect(listingDestination(listing)).toBe("/usdt-exchange#listing-listing-123");
    expect(sellerListingWorkspaceDestination(listing)).toBe("/usdt-exchange#my-listings-section");
    expect(sellerApplicationStatusDestination()).toBe("/usdt-exchange#seller-application");
    expect(sellerApplicationReviewDestination("application-123")).toBe("/admin/alpha-exchange?section=seller-applications&sellerApplication=application-123");
  });

  it("resolves active trade actions for the current actor", () => {
    expect(tradeDestination(request("accepted"), "buyer-1")).toContain("action=upload-payment-receipt#evidence");
    expect(tradeDestination(request("payment_sent"), "seller-1")).toContain("action=confirm-money-received#action-required");
    expect(tradeDestination(request("usdt_sent"), "buyer-1")).toContain("action=confirm-usdt-received#action-required");
  });

  it("resolves completed trades to history/review context", () => {
    expect(tradeDestination(request("review_open"), "buyer-1")).toBe("/trade-room/purchase-123?action=review-trade#status-banner");
    expect(completedTradeDestination(request("completed"))).toBe("/usdt-exchange?trade=purchase-123#my-trade-requests-section");
  });
});
