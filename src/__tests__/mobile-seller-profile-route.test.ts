// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getMarketplaceListings: vi.fn(),
  getPremiumSellerProfile: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getMarketplaceListings: mocks.getMarketplaceListings,
  getPremiumSellerProfile: mocks.getPremiumSellerProfile,
}));

import { GET } from "@/app/api/mobile/v1/marketplace/listings/[listingId]/seller/route";

function request(listingId = "listing-1") {
  return new NextRequest(`https://www.alphatraders.co.il/api/mobile/v1/marketplace/listings/${listingId}/seller`, {
    headers: {
      "accept-language": "en",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-app-version": "1.0.0",
      "x-platform": "ios",
      "x-request-id": "seller-request-1",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMarketplaceListings.mockResolvedValue([
    {
      id: "listing-1",
      sellerId: "private-seller-id",
      currency: "ILS",
      status: "active",
      approvalStatus: "approved",
    },
  ]);
  mocks.getPremiumSellerProfile.mockResolvedValue({
    sellerId: "private-seller-id",
    profile: {
      sellerId: "private-seller-id",
      sellerName: "Verified Seller",
      publicTradingName: "Alpha OTC",
      profilePhotoUrl: "https://cdn.example/seller.webp",
      bio: "Fast, verified settlement.",
      memberSince: "2025-01-01T00:00:00.000Z",
      languages: ["Arabic", "English"],
      preferredNetworks: ["TRC20"],
      country: "Israel",
      onlineStatus: "online",
      availabilityStatus: "available",
      isEmailVerified: true,
      isOwner: false,
      isFoundingMember: true,
      isFoundingSeller: true,
      isFeaturedSeller: true,
      contact: {
        email: "private@example.test",
        phone: "+972500000000",
      },
    },
    sellerLevel: "gold",
    trustScore: 97.4,
    completedTrades: 82,
    averageRating: 4.9,
    responseTimeMinutes: 4,
    completionRate: 98.5,
    repeatBuyersPercent: 42,
    totalReviews: 1,
    publicVolumeRange: "50K+ USDT",
    badges: ["top_rated", "fast_responder"],
    latestReviews: [
      {
        id: "private-review-id",
        tradeId: "private-trade-id",
        buyerId: "private-buyer-id",
        buyerName: "Verified Buyer",
        rating: 5,
        comment: "Excellent trade.",
        createdAt: "2026-09-01T00:00:00.000Z",
        verifiedPurchase: true,
        sellerResponse: {
          responderUserId: "private-seller-id",
          message: "Thank you.",
          createdAt: "2026-09-01T01:00:00.000Z",
        },
      },
    ],
    ownerTools: {
      auditHistory: [{ private: "audit-secret" }],
    },
  });
});

describe("GET /api/mobile/v1/marketplace/listings/[listingId]/seller", () => {
  it("returns a public seller projection without persistence or contact identifiers", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ listingId: "listing-1" }),
    });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.requestId).toBe("seller-request-1");
    expect(payload.seller).toMatchObject({
      listingId: "listing-1",
      displayName: "Alpha OTC",
      level: "gold",
      trustScore: 97.4,
      canMakeOffer: true,
      latestReviews: [
        {
          buyerDisplayName: "Verified Buyer",
          comment: "Excellent trade.",
          sellerResponse: { message: "Thank you." },
        },
      ],
    });
    for (const value of [
      "private-seller-id",
      "private-review-id",
      "private-trade-id",
      "private-buyer-id",
      "private@example.test",
      "+972500000000",
      "audit-secret",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("returns a stable not-found response for listings outside the public feed", async () => {
    mocks.getMarketplaceListings.mockResolvedValue([]);

    const response = await GET(request("missing-listing"), {
      params: Promise.resolve({ listingId: "missing-listing" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("NOT_FOUND");
    expect(mocks.getPremiumSellerProfile).not.toHaveBeenCalled();
  });

  it("rejects malformed listing identifiers before reading marketplace data", async () => {
    const response = await GET(request("bad%2Fid"), {
      params: Promise.resolve({ listingId: "bad/id" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.getMarketplaceListings).not.toHaveBeenCalled();
  });
});
