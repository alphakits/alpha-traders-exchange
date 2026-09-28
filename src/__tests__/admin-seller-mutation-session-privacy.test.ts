import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  suspendApprovedSellerByAdmin: vi.fn(),
  reactivateSellerByAdmin: vi.fn(),
  updateSellerProfileStateByAdmin: vi.fn(),
  updateSellerAvailabilityStatus: vi.fn(),
  overrideSellerPrestigeByAdmin: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  suspendApprovedSellerByAdmin: mocks.suspendApprovedSellerByAdmin,
  reactivateSellerByAdmin: mocks.reactivateSellerByAdmin,
  updateSellerProfileStateByAdmin: mocks.updateSellerProfileStateByAdmin,
  updateSellerAvailabilityStatus: mocks.updateSellerAvailabilityStatus,
  overrideSellerPrestigeByAdmin: mocks.overrideSellerPrestigeByAdmin,
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { POST as suspend } from "@/app/api/alpha-exchange/admin/sellers/[userId]/suspend/route";
import { POST as reactivate } from "@/app/api/alpha-exchange/admin/sellers/[userId]/reactivate/route";
import { PATCH as updateProfileState } from "@/app/api/alpha-exchange/admin/sellers/[userId]/profile-state/route";
import { PATCH as overridePrestige } from "@/app/api/alpha-exchange/admin/sellers/[userId]/prestige/route";

function sensitiveSeller(): AlphaExchangeUser {
  return {
    id: "seller-1", fullName: "Seller User", email: "seller@example.test", passwordHash: "secret-password-hash", whatsappNumber: "+972500000000",
    preferredNetworks: ["TRC20"], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "online", availabilityStatus: "available",
    role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller", createdAt: "2026-01-01", updatedAt: "2026-01-02",
    phoneOtpHash: "secret-otp-hash", phoneOtpSalt: "secret-otp-salt", verifiedPhone: "+972522222222", phoneVerifiedAt: "2026-01-02",
    emailVerificationTokenHash: "secret-email-token-hash", sellerBankAccounts: [{ accountNumber: "secret-account-number", id: "bank-1" }],
    notificationPreferences: { inApp: true, email: false, sms: false, browserPushSubscriptionHash: "secret-browser-push-subscription-hash" },
    ownerSettings: { future: "secret-owner-setting" },
  } as unknown as AlphaExchangeUser;
}

function assertSafeSellerResponse(payload: { seller: Record<string, unknown> }) {
  const serialized = JSON.stringify(payload);
  expect(payload.seller).toMatchObject({ id: "seller-1", sellerStatus: "approved_seller" });
  for (const key of [
    "passwordHash", "phoneOtpHash", "phoneOtpSalt", "verifiedPhone", "phoneVerifiedAt", "emailVerificationTokenHash",
    "sellerBankAccounts", "notificationPreferences", "ownerSettings",
  ]) {
    expect(payload.seller).not.toHaveProperty(key);
  }
  for (const value of [
    "secret-password-hash", "secret-otp-hash", "secret-otp-salt", "+972522222222", "secret-email-token-hash",
    "secret-account-number", "secret-browser-push-subscription-hash", "secret-owner-setting",
  ]) {
    expect(serialized).not.toContain(value);
  }
}

describe("admin seller mutation response privacy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({ user: { id: "admin-1", role: "admin" }, unauthorized: null });
    mocks.suspendApprovedSellerByAdmin.mockResolvedValue(sensitiveSeller());
    mocks.reactivateSellerByAdmin.mockResolvedValue(sensitiveSeller());
    mocks.updateSellerProfileStateByAdmin.mockResolvedValue(sensitiveSeller());
    mocks.updateSellerAvailabilityStatus.mockResolvedValue(sensitiveSeller());
    mocks.overrideSellerPrestigeByAdmin.mockResolvedValue(sensitiveSeller());
  });

  it.each([
    ["suspend", suspend, "POST", { reason: "Policy review" }],
    ["reactivate", reactivate, "POST", { reason: "Issue resolved" }],
    ["profile state", updateProfileState, "PATCH", { feature: true }],
    ["prestige", overridePrestige, "PATCH", { rank: "gold", reason: "Manual review" }],
  ] as const)("allowlists the %s success response", async (_name, handler, method, body) => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/admin/sellers/seller-1", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await handler(request, { params: Promise.resolve({ userId: "seller-1" }) });
    const payload = await response.json() as { seller: Record<string, unknown> };

    expect(response.status).toBe(200);
    assertSafeSellerResponse(payload);
  });
});
