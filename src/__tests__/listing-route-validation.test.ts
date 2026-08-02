import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requirePhoneVerificationForTrading: vi.fn(),
  canPublishListings: vi.fn(),
  getMarketplaceListingById: vi.fn(),
  updateMarketplaceListingForSeller: vi.fn(),
  renewMarketplaceListing: vi.fn(),
  deleteMarketplaceListingForSeller: vi.fn(),
  fetchUsdIlsMarketRate: vi.fn(),
  getListingPriceValidationError: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requirePhoneVerificationForTrading: mocks.requirePhoneVerificationForTrading,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  canPublishListings: mocks.canPublishListings,
  getMarketplaceListingById: mocks.getMarketplaceListingById,
  updateMarketplaceListingForSeller: mocks.updateMarketplaceListingForSeller,
  renewMarketplaceListing: mocks.renewMarketplaceListing,
  deleteMarketplaceListingForSeller: mocks.deleteMarketplaceListingForSeller,
}));

vi.mock("@/lib/listing-price-validation", () => ({
  fetchUsdIlsMarketRate: mocks.fetchUsdIlsMarketRate,
  getListingPriceValidationError: mocks.getListingPriceValidationError,
}));

import { PATCH } from "@/app/api/alpha-exchange/listings/[listingId]/route";

describe("alpha-exchange listing route validation", () => {
  beforeEach(() => {
    mocks.requireApiUser.mockReset();
    mocks.requirePhoneVerificationForTrading.mockReset();
    mocks.canPublishListings.mockReset();
    mocks.getMarketplaceListingById.mockReset();
    mocks.updateMarketplaceListingForSeller.mockReset();
    mocks.renewMarketplaceListing.mockReset();
    mocks.deleteMarketplaceListingForSeller.mockReset();
    mocks.fetchUsdIlsMarketRate.mockReset();
    mocks.getListingPriceValidationError.mockReset();
    mocks.checkRateLimit.mockReset();

    mocks.requireApiUser.mockResolvedValue({
      user: { id: "seller-1", role: "approved_seller", sellerStatus: "approved_seller" },
      unauthorized: null,
    });
    mocks.requirePhoneVerificationForTrading.mockReturnValue(null);
    mocks.canPublishListings.mockReturnValue(true);
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.fetchUsdIlsMarketRate.mockResolvedValue("3.05");
    mocks.getListingPriceValidationError.mockReturnValue(null);
    mocks.updateMarketplaceListingForSeller.mockResolvedValue({ id: "listing-1", status: "active" });
  });

  it("uses stored currency when resuming without sending currency in payload", async () => {
    mocks.getMarketplaceListingById.mockResolvedValue({
      id: "listing-1",
      price: "100.00",
      currency: "USD",
      availableAmount: "1000",
      minimumTrade: "100",
      maximumTrade: "1000",
    });

    const request = new NextRequest("http://localhost/api/alpha-exchange/listings/listing-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await PATCH(request, { params: Promise.resolve({ listingId: "listing-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.getListingPriceValidationError).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD", price: "100.00" }),
    );
  });

  it("rejects maximum trade values above available amount with a clear message", async () => {
    mocks.getMarketplaceListingById.mockResolvedValue({
      id: "listing-1",
      price: "3.10",
      currency: "ILS",
      availableAmount: "1000",
      minimumTrade: "100",
      maximumTrade: "1000",
    });

    const request = new NextRequest("http://localhost/api/alpha-exchange/listings/listing-1", {
      method: "PATCH",
      body: JSON.stringify({ maximumTrade: "2000" }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await PATCH(request, { params: Promise.resolve({ listingId: "listing-1" }) });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Maximum trade must be less than or equal to available amount.");
    expect(mocks.updateMarketplaceListingForSeller).not.toHaveBeenCalled();
  });

  it("rejects listings with more than two payment methods", async () => {
    mocks.getMarketplaceListingById.mockResolvedValue({
      id: "listing-1",
      price: "3.10",
      currency: "ILS",
      availableAmount: "1000",
      minimumTrade: "100",
      maximumTrade: "1000",
      paymentMethods: ["Bank Transfer"],
      paymentMethod: "Bank Transfer",
      bankName: "Bank Hapoalim",
    });

    const request = new NextRequest("http://localhost/api/alpha-exchange/listings/listing-1", {
      method: "PATCH",
      body: JSON.stringify({ paymentMethods: ["Bank Transfer", "Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"] }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await PATCH(request, { params: Promise.resolve({ listingId: "listing-1" }) });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Select no more than 2 payment methods per listing.");
    expect(mocks.updateMarketplaceListingForSeller).not.toHaveBeenCalled();
  });

  it("requires supported banks when cardless ATM is enabled", async () => {
    mocks.getMarketplaceListingById.mockResolvedValue({
      id: "listing-1",
      price: "3.10",
      currency: "ILS",
      availableAmount: "1000",
      minimumTrade: "100",
      maximumTrade: "1000",
      paymentMethods: ["Face-to-Face (Meet in Person)"],
      paymentMethod: "Face-to-Face (Meet in Person)",
      bankName: undefined,
    });

    const request = new NextRequest("http://localhost/api/alpha-exchange/listings/listing-1", {
      method: "PATCH",
      body: JSON.stringify({ paymentMethods: ["Cardless ATM Withdrawal"] }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await PATCH(request, { params: Promise.resolve({ listingId: "listing-1" }) });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Please choose one or two supported banks before saving the listing.");
    expect(mocks.updateMarketplaceListingForSeller).not.toHaveBeenCalled();
  });
});
