import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
  canPublishListings: vi.fn(),
  createMarketplaceListing: vi.fn(),
  getMarketplaceListings: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  fetchUsdIlsMarketRate: vi.fn(),
  getListingPriceValidationError: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  canPublishListings: mocks.canPublishListings,
  createMarketplaceListing: mocks.createMarketplaceListing,
  getMarketplaceListings: mocks.getMarketplaceListings,
}));

vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/listing-price-validation", () => ({
  fetchUsdIlsMarketRate: mocks.fetchUsdIlsMarketRate,
  getListingPriceValidationError: mocks.getListingPriceValidationError,
}));

import { POST } from "@/app/api/alpha-exchange/listings/route";

function createRequest() {
  return new NextRequest("http://localhost/api/alpha-exchange/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      availableAmount: "100",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankAccountId: "bank-1",
      bankName: "Bank Hapoalim",
      minimumTrade: "25",
      maximumTrade: "100",
      acceptedCommissionPolicy: true,
    }),
  });
}

describe("listing create session boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.canPublishListings.mockReturnValue(true);
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.fetchUsdIlsMarketRate.mockResolvedValue("3.05");
    mocks.getListingPriceValidationError.mockReturnValue(null);
    mocks.createMarketplaceListing.mockResolvedValue({
      id: "listing-1",
      sellerId: "seller-1",
      status: "draft",
      approvalStatus: "pending",
    });
  });

  it("keeps the create endpoint protected when no server session exists", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(mocks.canPublishListings).not.toHaveBeenCalled();
    expect(mocks.createMarketplaceListing).not.toHaveBeenCalled();
  });

  it("allows an authenticated approved seller without a verified phone to submit a pending listing", async () => {
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "seller-1", fullName: "Seller", role: "approved_seller", sellerStatus: "approved_seller", emailVerified: true, verifiedPhone: "", phoneVerifiedAt: "" },
      unauthorized: null,
    });

    const response = await POST(createRequest());
    const payload = await response.json() as { listing?: { status?: string; approvalStatus?: string }; destination?: string };

    expect(response.status).toBe(201);
    expect(payload.listing).toMatchObject({ status: "draft", approvalStatus: "pending" });
    expect(payload.destination).toBe("/usdt-exchange#seller-listing-listing-1");
    expect(mocks.createMarketplaceListing).toHaveBeenCalledWith(expect.objectContaining({ sellerId: "seller-1", actorUserId: "seller-1" }));
  });

  it("lets fifteen approved sellers sharing a network create listings independently", async () => {
    const { checkRateLimit } = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
    mocks.checkSharedRateLimit.mockImplementation((input) => checkRateLimit({ ...input, key: `shared-network:${input.key}` }));
    const responses = await Promise.all(Array.from({ length: 15 }, (_, index) => {
      mocks.requireApiUser.mockResolvedValueOnce({
        user: { id: `network-seller-${index}`, fullName: "Seller", role: "approved_seller", emailVerified: true },
        unauthorized: null,
      });
      const request = createRequest();
      request.headers.set("x-vercel-forwarded-for", "203.0.113.15");
      return POST(request);
    }));
    expect(responses.map((response) => response.status)).toEqual(Array(15).fill(201));
    expect(mocks.createMarketplaceListing).toHaveBeenCalledTimes(15);
  });

  it("keeps one seller's limit when their network address changes", async () => {
    const { checkRateLimit } = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
    mocks.checkSharedRateLimit.mockImplementation((input) => checkRateLimit({ ...input, key: `rotating-network:${input.key}` }));
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "limited-seller", fullName: "Seller", role: "approved_seller", emailVerified: true },
      unauthorized: null,
    });
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) => {
      const request = createRequest();
      request.headers.set("x-vercel-forwarded-for", `203.0.113.${index + 1}`);
      return POST(request);
    }));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(10);
    const blocked = responses.find((response) => response.status === 429);
    expect(blocked).toBeDefined();
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mocks.createMarketplaceListing).toHaveBeenCalledTimes(10);
  });
});
