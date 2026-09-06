// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getMarketplaceListings: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getMarketplaceListings: mocks.getMarketplaceListings,
}));

import { GET } from "@/app/api/mobile/v1/marketplace/listings/route";

function request(query = "") {
  return new NextRequest(`https://www.alphatraders.co.il/api/mobile/v1/marketplace/listings${query}`, {
    headers: {
      "accept-language": "en",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-app-version": "1.0.0",
      "x-platform": "android",
      "x-request-id": "market-request-1",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMarketplaceListings.mockResolvedValue([
    {
      id: "listing-1",
      sellerId: "private-seller-id",
      sellerDisplayName: "Verified Seller",
      photos: ["https://cdn.example/listing.webp"],
      displayNumber: 81,
      originalAmount: "15000",
      availableAmount: "12000",
      price: "3.30",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      paymentMethods: ["Bank Transfer"],
      bankAccountId: "private-bank-record",
      bankName: "Bank Hapoalim",
      minimumTrade: "500",
      maximumTrade: "12000",
      notes: "private seller notes",
      sellerDescription: "Fast settlement",
      responseTime: "5 min",
      status: "active",
      approvalStatus: "approved",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      sellerProfile: {
        sellerId: "private-seller-id",
        sellerName: "Verified Seller",
        profilePhotoUrl: "https://cdn.example/seller.webp",
        memberSince: "2026-01-01T00:00:00.000Z",
        languages: ["Arabic"],
        preferredNetworks: ["TRC20"],
        bio: "",
        onlineStatus: "online",
        availabilityStatus: "available",
        isOwner: false,
        isFoundingSeller: true,
        isFeaturedSeller: true,
        contact: { email: "private@example.test", phone: "+972500000000" },
      },
      sellerReputation: {
        sellerId: "private-seller-id",
        trustScore: 98,
        rating: 4.9,
        completedTrades: 82,
        responseTimeMinutes: 4,
        level: "gold",
      },
    },
    {
      id: "draft-1",
      status: "draft",
      approvalStatus: "pending",
    },
  ]);
});

describe("GET /api/mobile/v1/marketplace/listings", () => {
  it("returns an action-ready public projection without seller contact or persistence identifiers", async () => {
    const response = await GET(request());
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.requestId).toBe("market-request-1");
    expect(payload.listings).toHaveLength(1);
    expect(payload.total).toBe(1);
    expect(payload.pagination).toEqual({ limit: 30, offset: 0, nextOffset: null });
    expect(payload.listings[0]).toMatchObject({
      id: "listing-1",
      seller: {
        displayName: "Verified Seller",
        trustScore: 98,
        rating: 4.9,
      },
      actions: {
        canViewSellerProfile: true,
        canBuyNow: true,
        canMakeOffer: true,
      },
    });
    for (const value of [
      "private-seller-id",
      "private-bank-record",
      "private seller notes",
      "private@example.test",
      "+972500000000",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("returns a bounded page and rejects invalid pagination", async () => {
    const valid = await GET(request("?limit=1&offset=1"));
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({
      listings: [],
      total: 1,
      pagination: { limit: 1, offset: 1, nextOffset: null },
    });

    mocks.getMarketplaceListings.mockClear();
    const invalid = await GET(request("?limit=500&offset=0"));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(mocks.getMarketplaceListings).not.toHaveBeenCalled();
  });

  it("supports a safe exact-listing lookup for direct trade deep links", async () => {
    const response = await GET(request("?listingId=listing-1&limit=1&offset=0"));
    await expect(response.json()).resolves.toMatchObject({
      listings: [{ id: "listing-1" }],
      total: 1,
      pagination: { limit: 1, offset: 0, nextOffset: null },
    });

    mocks.getMarketplaceListings.mockClear();
    const invalid = await GET(request("?listingId=bad%2Flisting&limit=1"));
    expect(invalid.status).toBe(400);
    expect(mocks.getMarketplaceListings).not.toHaveBeenCalled();
  });
});
