// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  getMarketplaceListingById: vi.fn(),
  getMyMarketplaceListings: vi.fn(),
  getSellerListingWorkspaceSummary: vi.fn(),
  hasRole: vi.fn(),
  requireMobileApiUser: vi.fn(),
  updateMarketplaceListingForSeller: vi.fn(),
  updateSellerAvailabilityStatus: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getMarketplaceListingById: mocks.getMarketplaceListingById,
  getMyMarketplaceListings: mocks.getMyMarketplaceListings,
  getSellerListingWorkspaceSummary: mocks.getSellerListingWorkspaceSummary,
  updateMarketplaceListingForSeller: mocks.updateMarketplaceListingForSeller,
  updateSellerAvailabilityStatus: mocks.updateSellerAvailabilityStatus,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/roles", () => ({ hasRole: mocks.hasRole }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { GET } from "@/app/api/mobile/v1/seller/listings/route";
import { PATCH as PATCH_LISTING } from "@/app/api/mobile/v1/seller/listings/[listingId]/route";
import { PATCH as PATCH_AVAILABILITY } from "@/app/api/mobile/v1/seller/availability/route";

const headers = {
  authorization: "Bearer test-access",
  "content-type": "application/json",
  "x-app-version": "1.0.0",
  "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
  "x-platform": "ios",
  "x-request-id": "seller-workspace-request",
};

function collectionRequest(query = "") {
  return new NextRequest(
    `https://www.alphatraders.co.il/api/mobile/v1/seller/listings${query}`,
    { headers },
  );
}

function patchRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`https://www.alphatraders.co.il${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "listing-own",
    sellerId: "seller-1",
    sellerDisplayName: "Seller One",
    displayNumber: 42,
    photos: ["private-photo"],
    originalAmount: "1000",
    availableAmount: "800",
    price: "3.30",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    bankAccountId: "private-bank-account-id",
    bankName: "Private bank",
    minimumTrade: "100",
    maximumTrade: "800",
    notes: "private seller note",
    sellerDescription: "private description",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    sellerProfile: { contact: { email: "private-email-marker", phone: "private-phone-marker" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: {
      id: "seller-1",
      email: "seller-email-marker",
      fullName: "Seller One",
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      availabilityStatus: "available",
    },
    accessToken: "access",
    unauthorized: null,
  });
  mocks.hasRole.mockReturnValue(true);
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.getMyMarketplaceListings.mockResolvedValue([]);
  mocks.getSellerListingWorkspaceSummary.mockResolvedValue({
    activeListingLimit: 3,
    openListingCount: 1,
    openTradeCount: 2,
    pendingCommissionCount: 0,
    canCreateListing: true,
    blockedReason: null,
    enforcement: { restricted: false },
  });
});

describe("mobile seller workspace routes", () => {
  it("returns only the authenticated seller's bounded privacy-safe listings", async () => {
    mocks.getMyMarketplaceListings.mockResolvedValue([
      listing(),
      listing({ id: "listing-foreign", sellerId: "seller-2" }),
    ]);

    const response = await GET(collectionRequest());
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      total: 1,
      availabilityStatus: "available",
      pagination: { limit: 30, offset: 0, nextOffset: null },
      summary: {
        activeListingLimit: 3,
        openListingCount: 1,
        openTradeCount: 2,
        pendingCommissionCount: 0,
        canCreateListing: true,
      },
      listings: [{
        id: "listing-own",
        status: "active",
        actions: { canPause: true, canResume: false },
      }],
    });
    for (const privateValue of [
      "listing-foreign",
      "seller-1",
      "private-bank-account-id",
      "Private bank",
      "private seller note",
      "private description",
      "private-email-marker",
      "private-phone-marker",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("rejects non-sellers and invalid pagination before reading seller data", async () => {
    mocks.hasRole.mockReturnValueOnce(false);
    const forbidden = await GET(collectionRequest());
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ error: { code: "SELLER_ROLE_REQUIRED" } });

    mocks.requireMobileApiUser.mockClear();
    const invalid = await GET(collectionRequest("?limit=0"));
    expect(invalid.status).toBe(400);
    expect(mocks.requireMobileApiUser).not.toHaveBeenCalled();
  });

  it("pauses an owned active listing using only the authenticated seller identity", async () => {
    mocks.getMarketplaceListingById.mockResolvedValue(listing());
    mocks.updateMarketplaceListingForSeller.mockResolvedValue(listing({ status: "paused" }));

    const response = await PATCH_LISTING(
      patchRequest("/api/mobile/v1/seller/listings/listing-own", { action: "pause", sellerId: "forged" }),
      { params: Promise.resolve({ listingId: "listing-own" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateMarketplaceListingForSeller).toHaveBeenCalledWith({
      listingId: "listing-own",
      sellerId: "seller-1",
      actorUserId: "seller-1",
      status: "paused",
    });
    await expect(response.json()).resolves.toMatchObject({
      listing: { status: "paused", actions: { canPause: false, canResume: true } },
    });
  });

  it("treats a repeated status request as idempotent and hides foreign listings", async () => {
    mocks.getMarketplaceListingById.mockResolvedValueOnce(listing({ status: "paused" }));
    const retry = await PATCH_LISTING(
      patchRequest("/api/mobile/v1/seller/listings/listing-own", { action: "pause" }),
      { params: Promise.resolve({ listingId: "listing-own" }) },
    );
    expect(retry.status).toBe(200);
    expect(mocks.updateMarketplaceListingForSeller).not.toHaveBeenCalled();

    mocks.getMarketplaceListingById.mockResolvedValueOnce(listing({ sellerId: "seller-2" }));
    const foreign = await PATCH_LISTING(
      patchRequest("/api/mobile/v1/seller/listings/listing-foreign", { action: "pause" }),
      { params: Promise.resolve({ listingId: "listing-foreign" }) },
    );
    expect(foreign.status).toBe(404);
    await expect(foreign.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("maps locked status changes to a stable conflict response", async () => {
    mocks.getMarketplaceListingById.mockResolvedValue(listing());
    mocks.updateMarketplaceListingForSeller.mockRejectedValue(
      new Error("This listing is locked by an active trade and cannot be edited right now."),
    );

    const response = await PATCH_LISTING(
      patchRequest("/api/mobile/v1/seller/listings/listing-own", { action: "pause" }),
      { params: Promise.resolve({ listingId: "listing-own" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "LISTING_ACTION_NOT_ALLOWED" },
    });
  });

  it("updates availability with an allowlisted value and canonical identity", async () => {
    mocks.updateSellerAvailabilityStatus.mockResolvedValue({ availabilityStatus: "vacation" });
    const response = await PATCH_AVAILABILITY(
      patchRequest("/api/mobile/v1/seller/availability", {
        availabilityStatus: "vacation",
        sellerId: "forged",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSellerAvailabilityStatus).toHaveBeenCalledWith({
      sellerId: "seller-1",
      actorUserId: "seller-1",
      availabilityStatus: "vacation",
    });
    await expect(response.json()).resolves.toMatchObject({ availabilityStatus: "vacation" });

    mocks.updateSellerAvailabilityStatus.mockClear();
    const invalid = await PATCH_AVAILABILITY(
      patchRequest("/api/mobile/v1/seller/availability", { availabilityStatus: "hidden" }),
    );
    expect(invalid.status).toBe(400);
    expect(mocks.updateSellerAvailabilityStatus).not.toHaveBeenCalled();
  });
});
