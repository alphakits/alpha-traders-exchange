// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  getWhatsAppChannelStatus: vi.fn(),
  getWhatsAppConsentCopy: vi.fn(),
  updateWhatsAppSubscription: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  createRateLimitResponse: mocks.createRateLimitResponse,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  updateNotificationPreferences: mocks.updateNotificationPreferences,
}));
vi.mock("@/lib/whatsapp-notifications", () => ({
  CURRENT_WHATSAPP_CONSENT_VERSION: "2026-09-12.v1",
  WhatsAppPreferenceValidationError: class WhatsAppPreferenceValidationError extends Error {},
  getWhatsAppChannelStatus: mocks.getWhatsAppChannelStatus,
  getWhatsAppConsentCopy: mocks.getWhatsAppConsentCopy,
  updateWhatsAppSubscription: mocks.updateWhatsAppSubscription,
}));

import { GET, PATCH } from "@/app/api/alpha-exchange/notification-preferences/route";

const user = {
  id: "user-1",
  preferredLocale: "en",
  verifiedPhone: "+972541234567",
  phoneVerifiedAt: "2026-09-12T00:00:00.000Z",
  notificationPreferences: { inApp: true, email: true, sms: false },
};

const disabledChannel = {
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

function patch(body: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/notification-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiUser.mockResolvedValue({ user, unauthorized: null });
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.getWhatsAppConsentCopy.mockReturnValue("Explicit Alpha Traders WhatsApp consent.");
  mocks.getWhatsAppChannelStatus.mockResolvedValue(disabledChannel);
  mocks.updateWhatsAppSubscription.mockResolvedValue(disabledChannel);
  mocks.updateNotificationPreferences.mockResolvedValue(user.notificationPreferences);
});

describe("web WhatsApp notification preferences", () => {
  it("returns a masked verified phone and dormant channel state", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      phone: { verified: true, masked: "+97•••67" },
      whatsapp: {
        tradeUpdates: false,
        chatMessages: false,
        consented: false,
        sendingEnabled: false,
        consentVersion: "2026-09-12.v1",
        status: "feature_disabled",
      },
    });
    expect(JSON.stringify(payload)).not.toContain(user.verifiedPhone);
  });

  it("binds explicit consent to the authenticated user's verified phone", async () => {
    mocks.getWhatsAppChannelStatus.mockResolvedValueOnce({ ...disabledChannel, available: true });
    mocks.updateWhatsAppSubscription.mockResolvedValueOnce({
      ...disabledChannel,
      available: true,
      sendingEnabled: true,
      providerState: "ready",
      subscribed: true,
      active: true,
      currentConsent: true,
      tradeUpdatesEnabled: true,
      chatMessagesEnabled: true,
      reason: "available",
    });

    const response = await PATCH(patch({
      whatsappTradeUpdates: true,
      whatsappChatMessages: true,
      whatsappConsentAccepted: true,
      whatsappConsentVersion: "2026-09-12.v1",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateWhatsAppSubscription).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      verifiedPhone: user.verifiedPhone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      consentAccepted: true,
      consentVersion: "2026-09-12.v1",
    }));
    await expect(response.json()).resolves.toMatchObject({
      whatsapp: { tradeUpdates: true, chatMessages: true, consented: true },
    });
  });

  it("rejects client-supplied phone numbers and unknown fields", async () => {
    const response = await PATCH(patch({
      whatsappTradeUpdates: true,
      whatsappConsentAccepted: true,
      whatsappConsentVersion: "2026-09-12.v1",
      phone: "+15550000000",
    }));

    expect(response.status).toBe(400);
    expect(mocks.updateWhatsAppSubscription).not.toHaveBeenCalled();
  });
});
