// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type {
  AccountProfileSummary,
  SellerAccountStats,
} from "@/lib/alpha-exchange-store";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  findUserById: vi.fn(),
  getAccountProfileData: vi.fn(),
  logEvent: vi.fn(),
  requireMobileApiUser: vi.fn(),
  updateAccountProfileData: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  findUserById: mocks.findUserById,
  getAccountProfileData: mocks.getAccountProfileData,
  updateAccountProfileData: mocks.updateAccountProfileData,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { GET, PATCH } from "@/app/api/mobile/v1/profile/route";

const user = {
  id: "profile-user",
  fullName: "Mobile Seller",
  email: "seller@example.test",
  passwordHash: "never-return-password-hash",
  whatsappNumber: "+972500000000",
  preferredNetworks: ["TRC20"],
  profilePhotoUrl: "https://username:password@cdn.example/private.webp",
  languages: ["Arabic", "English"],
  preferredLocale: "en",
  bio: "Private persistence bio",
  onlineStatus: "online",
  availabilityStatus: "available",
  role: "approved_seller",
  roles: ["approved_seller", "buyer"],
  sellerStatus: "approved_seller",
  emailVerified: true,
  emailVerificationTokenHash: "never-return-verification-token",
  isFoundingMember: true,
  isFoundingSeller: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} satisfies AlphaExchangeUser;

const profile = {
  id: user.id,
  profilePhotoUrl: "http://insecure.example/avatar.webp",
  coverBannerUrl: "https://cdn.example/private-cover.webp",
  fullName: user.fullName,
  username: "mobile-seller",
  email: user.email,
  role: user.role,
  sellerStatus: user.sellerStatus,
  memberSince: user.createdAt,
  lastLogin: "2026-09-06T10:00:00.000Z",
  onlineStatus: "online",
  bio: "Fast and verified.",
  country: "Jordan",
  language: "Arabic",
  preferredLocale: "en",
  whatsappNumber: user.whatsappNumber,
  showTradeStats: true,
  showLastActive: true,
  allowDirectMessages: true,
  allowProfileSearch: true,
  showPhonePublic: false,
  showEmailPublic: false,
} satisfies AccountProfileSummary;

const stats = {
  kind: "seller",
  sellerLevel: "gold",
  nextLevel: "diamond",
  progressToNextLevelPercent: 64.5,
  amountToNextLevelUsdt: 12_000,
  lifetimeCompletedVolumeUsdt: 38_000,
  commissionPaid: 380,
  averageTradeSize: 760,
  promotionHistory: [],
  trustScore: 97.4,
  completedTrades: 50,
  activeListings: 3,
  pendingListings: 1,
  averageRating: 4.9,
  buyerActivity: {
    buyerLevel: "silver",
    nextLevel: "gold",
    progressToNextLevelPercent: 25,
    amountToNextLevelUsdt: 1_500,
    requiredVolumeUsdt: 2_000,
    lifetimeCompletedVolumeUsdt: 500,
    activeTrades: 1,
    completedTrades: 2,
    reviewsGiven: 2,
  },
} satisfies SellerAccountStats;

function mobileRequest(method: "GET" | "PATCH", body?: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/profile", {
    method,
    headers: {
      "accept-language": "en",
      authorization: "Bearer mobile-access-token",
      "content-type": "application/json",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-app-version": "1.0.0",
      "x-platform": "ios",
      "x-request-id": "profile-request-1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSharedRateLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    reason: null,
  });
  mocks.requireMobileApiUser.mockResolvedValue({
    user,
    accessToken: "mobile-access-token",
    unauthorized: null,
  });
  mocks.getAccountProfileData.mockResolvedValue({ profile, stats });
  mocks.findUserById.mockResolvedValue(user);
  mocks.updateAccountProfileData.mockResolvedValue(user);
});

describe("mobile v1 account profile route", () => {
  it("returns only the native profile and reputation allowlists", async () => {
    const response = await GET(mobileRequest("GET"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(payload).toMatchObject({
      requestId: "profile-request-1",
      profile: {
        fullName: "Mobile Seller",
        email: "seller@example.test",
        profilePhotoUrl: "",
        country: "Jordan",
        showPhonePublic: false,
      },
      stats: {
        kind: "seller",
        level: "gold",
        lifetimeCompletedVolumeUsdt: 38_000,
        completedTrades: 50,
        activeListings: 3,
        averageRating: 4.9,
        trustScore: 97.4,
      },
      user: {
        id: user.id,
        fullName: user.fullName,
        profilePhotoUrl: "",
      },
    });
    for (const privateValue of [
      "never-return-password-hash",
      "never-return-verification-token",
      "+972500000000",
      "private-cover.webp",
      "mobile-seller",
      "commissionPaid",
      "averageTradeSize",
      "promotionHistory",
      "buyerActivity",
      "amountToNextLevelUsdt",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("derives the account identity and passes only validated editable fields", async () => {
    const update = {
      fullName: "  Updated Seller  ",
      bio: "  Clear profile bio.  ",
      country: "  Jordan  ",
      showTradeStats: false,
      showLastActive: false,
      allowDirectMessages: true,
      allowProfileSearch: false,
      showPhonePublic: false,
      showEmailPublic: true,
    };
    const response = await PATCH(mobileRequest("PATCH", update));

    expect(response.status).toBe(200);
    expect(mocks.updateAccountProfileData).toHaveBeenCalledWith({
      userId: user.id,
      fullName: "Updated Seller",
      bio: "Clear profile bio.",
      country: "Jordan",
      showTradeStats: false,
      showLastActive: false,
      allowDirectMessages: true,
      allowProfileSearch: false,
      showPhonePublic: false,
      showEmailPublic: true,
    });
    expect(mocks.logEvent).toHaveBeenCalledWith("info", expect.objectContaining({
      actorUserId: user.id,
      event: "mobile_profile_update",
      metadata: {
        requestId: "profile-request-1",
        updatedFields: expect.arrayContaining(["fullName", "bio", "country", "showEmailPublic"]),
      },
      outcome: "success",
    }));
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain("Clear profile bio.");
  });

  it("rejects identity, role, and unknown-field injection", async () => {
    const response = await PATCH(mobileRequest("PATCH", {
      fullName: "Attacker",
      userId: "different-user",
      role: "owner",
      commissionPaid: 0,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PROFILE_INVALID" } });
    expect(mocks.updateAccountProfileData).not.toHaveBeenCalled();
  });

  it("rejects malformed profile values before persistence", async () => {
    const response = await PATCH(mobileRequest("PATCH", {
      fullName: "   ",
      showTradeStats: "yes",
    }));

    expect(response.status).toBe(400);
    expect(mocks.updateAccountProfileData).not.toHaveBeenCalled();
  });

  it("rate-limits updates before parsing or persistence work", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 19,
      reason: "shared_limit",
    });
    const response = await PATCH(mobileRequest("PATCH", { fullName: "Updated Seller" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("19");
    expect(mocks.updateAccountProfileData).not.toHaveBeenCalled();
  });
});
