// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  logEvent: vi.fn(),
  requireMobileApiUser: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  getWhatsAppChannelStatus: vi.fn(),
  getWhatsAppConsentCopy: vi.fn(),
  updateWhatsAppSubscription: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  updateNotificationPreferences: mocks.updateNotificationPreferences,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/whatsapp-notifications", () => ({
  CURRENT_WHATSAPP_CONSENT_VERSION: "2026-09-12.v1",
  WhatsAppPreferenceValidationError: class WhatsAppPreferenceValidationError extends Error {},
  getWhatsAppChannelStatus: mocks.getWhatsAppChannelStatus,
  getWhatsAppConsentCopy: mocks.getWhatsAppConsentCopy,
  updateWhatsAppSubscription: mocks.updateWhatsAppSubscription,
}));

import { GET, PATCH } from "@/app/api/mobile/v1/settings/notifications/route";

const user = {
  id: "settings-user",
  fullName: "Mobile Buyer",
  email: "buyer@example.test",
  passwordHash: "never-return-password-hash",
  whatsappNumber: "+972500000000",
  preferredNetworks: ["TRC20"],
  profilePhotoUrl: "",
  languages: ["English"],
  bio: "",
  onlineStatus: "online",
  availabilityStatus: "available",
  role: "buyer",
  sellerStatus: "none",
  verifiedPhone: "+972501234567",
  phoneVerifiedAt: "2026-09-01T00:00:00.000Z",
  notificationPreferences: { inApp: true, email: false, sms: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const whatsappDisabled = {
  available: false,
  sendingEnabled: false,
  providerState: "disabled",
  subscribed: false,
  active: false,
  phoneVerified: true,
  currentConsent: false,
  tradeUpdatesEnabled: false,
  chatMessagesEnabled: false,
  consentVersion: "2026-09-12.v1",
  consentedAt: null,
  revokedAt: null,
  reason: "feature_disabled",
};

function request(method: "GET" | "PATCH", body?: Record<string, unknown>, includeDeviceHeaders = true) {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/settings/notifications", {
    method,
    headers: {
      "accept-language": "en",
      authorization: "Bearer mobile-access-token",
      "content-type": "application/json",
      "x-request-id": "notification-settings-request",
      ...(includeDeviceHeaders ? {
        "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
        "x-app-version": "1.0.0",
        "x-platform": "ios",
      } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user,
    accessToken: "mobile-access-token",
    unauthorized: null,
  });
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.updateNotificationPreferences.mockResolvedValue({ inApp: true, email: true, sms: true });
  mocks.getWhatsAppChannelStatus.mockResolvedValue(whatsappDisabled);
  mocks.getWhatsAppConsentCopy.mockReturnValue("Explicit Alpha Traders WhatsApp consent.");
  mocks.updateWhatsAppSubscription.mockResolvedValue(whatsappDisabled);
});

describe("mobile notification preferences route", () => {
  it("returns only preference state and a masked verified phone", async () => {
    const response = await GET(request("GET"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      preferences: { inApp: true, email: false, sms: true },
      phone: { verified: true, masked: "+97•••67" },
      whatsapp: { status: "feature_disabled" },
      requestId: "notification-settings-request",
    });
    expect(serialized).not.toContain("never-return-password-hash");
    expect(serialized).not.toContain("+972501234567");
  });

  it("updates only allowlisted boolean preference fields", async () => {
    const response = await PATCH(request("PATCH", { email: true, inApp: false }));

    expect(response.status).toBe(200);
    expect(mocks.updateNotificationPreferences).toHaveBeenCalledWith({
      userId: user.id,
      preferences: { email: true, inApp: false },
    });
    await expect(response.json()).resolves.toMatchObject({
      preferences: { inApp: true, email: true, sms: true },
    });
  });

  it("rejects unknown fields, non-booleans, and missing device identity", async () => {
    const unknown = await PATCH(request("PATCH", { email: true, role: "owner" }));
    expect(unknown.status).toBe(400);

    const invalid = await PATCH(request("PATCH", { email: "yes" }));
    expect(invalid.status).toBe(400);

    const missingDevice = await GET(request("GET", undefined, false));
    expect(missingDevice.status).toBe(400);
    await expect(missingDevice.json()).resolves.toMatchObject({ error: { code: "DEVICE_HEADERS_REQUIRED" } });
    expect(mocks.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("requires a verified phone before enabling SMS", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: { ...user, verifiedPhone: undefined, phoneVerifiedAt: undefined },
      accessToken: "mobile-access-token",
      unauthorized: null,
    });

    const response = await PATCH(request("PATCH", { sms: true }));

    expect(response.status).toBe(400);
    expect(mocks.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("uses only the authenticated verified phone for explicit WhatsApp consent", async () => {
    const activeChannel = {
      ...whatsappDisabled,
      available: true,
      sendingEnabled: true,
      providerState: "ready",
      subscribed: true,
      active: true,
      currentConsent: true,
      tradeUpdatesEnabled: true,
      reason: "available",
    };
    mocks.getWhatsAppChannelStatus.mockResolvedValueOnce({ ...whatsappDisabled, available: true });
    mocks.updateWhatsAppSubscription.mockResolvedValueOnce(activeChannel);

    const response = await PATCH(request("PATCH", {
      whatsappTradeUpdates: true,
      whatsappChatMessages: false,
      whatsappConsentAccepted: true,
      whatsappConsentVersion: "2026-09-12.v1",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateWhatsAppSubscription).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      verifiedPhone: user.verifiedPhone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      tradeUpdatesEnabled: true,
      chatMessagesEnabled: false,
      consentAccepted: true,
      consentVersion: "2026-09-12.v1",
    }));
    await expect(response.json()).resolves.toMatchObject({
      whatsapp: { tradeUpdates: true, chatMessages: false, consented: true },
    });
  });

  it("rejects any client-supplied WhatsApp destination", async () => {
    const response = await PATCH(request("PATCH", {
      whatsappTradeUpdates: true,
      whatsappConsentAccepted: true,
      whatsappConsentVersion: "2026-09-12.v1",
      verifiedPhone: "+15550000000",
    }));

    expect(response.status).toBe(400);
    expect(mocks.updateWhatsAppSubscription).not.toHaveBeenCalled();
  });

  it("rate-limits writes before persistence", async () => {
    mocks.checkSharedRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 14 });

    const response = await PATCH(request("PATCH", { email: true }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("14");
    expect(mocks.updateNotificationPreferences).not.toHaveBeenCalled();
  });
});
