import { describe, expect, it } from "vitest";
import {
  adminCommissionDestination,
  adminMarketplaceEnforcementDestination,
  adminMarketplaceListingsDestination,
  adminPurchaseRequestsDestination,
  completedTradeDestination,
  listingDestination,
  parseAdminDashboardDestination,
  sellerApplicationReviewDestination,
  sellerApplicationStatusDestination,
  sellerListingWorkspaceAnchor,
  sellerListingWorkspaceDestination,
  tradeDestination,
} from "@/lib/action-destinations";
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
    expect(sellerListingWorkspaceAnchor(listing)).toBe("seller-listing-listing-123");
    expect(sellerListingWorkspaceDestination(listing)).toBe("/usdt-exchange#seller-listing-listing-123");
    expect(sellerApplicationStatusDestination()).toBe("/usdt-exchange#seller-application");
    expect(sellerApplicationReviewDestination("application-123")).toBe("/admin/alpha-exchange?section=seller-applications&sellerApplication=application-123");
    expect(adminMarketplaceListingsDestination("listing-123")).toBe("/admin/alpha-exchange?section=marketplace-listings&listing=listing-123");
    expect(adminMarketplaceEnforcementDestination()).toBe("/admin/alpha-exchange?section=marketplace-enforcement");
    expect(adminPurchaseRequestsDestination("purchase-123")).toBe("/admin/alpha-exchange?section=purchase-requests&requestId=purchase-123");
    expect(adminCommissionDestination("commission-123")).toBe("/admin/alpha-exchange?section=commissions&commissionId=commission-123");
  });

  it("parses only supported admin destinations and preserves exact entity targets", () => {
    expect(parseAdminDashboardDestination(new URLSearchParams("section=marketplace-listings&listing=listing-123"))).toEqual({
      section: "marketplace-listings",
      listingId: "listing-123",
    });
    expect(parseAdminDashboardDestination(new URLSearchParams("section=purchase-requests&request=purchase-123"))).toEqual({
      section: "purchase-requests",
      purchaseRequestId: "purchase-123",
    });
    expect(parseAdminDashboardDestination(new URLSearchParams("section=commissions&commissionId=commission-123"))).toEqual({
      section: "commissions",
      commissionId: "commission-123",
    });
    expect(parseAdminDashboardDestination(new URLSearchParams("section=marketplace-enforcement"))).toEqual({
      section: "marketplace-enforcement",
    });
    expect(parseAdminDashboardDestination(new URLSearchParams("tab=listings&status=draft"))).toEqual({
      section: "marketplace-listings",
      listingStatus: "draft",
    });
  });

  it("fails malformed or mismatched admin entity queries safely", () => {
    expect(parseAdminDashboardDestination(new URLSearchParams("section=marketplace-listings&listing=not%20an%20id"))).toEqual({
      section: "marketplace-listings",
    });
    expect(parseAdminDashboardDestination(new URLSearchParams("section=not-a-section&listing=listing-123"))).toEqual({
      section: "marketplace-listings",
      listingId: "listing-123",
    });
    expect(parseAdminDashboardDestination(new URLSearchParams("section=overview&commissionId=commission-123"))).toEqual({
      section: "overview",
    });
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
