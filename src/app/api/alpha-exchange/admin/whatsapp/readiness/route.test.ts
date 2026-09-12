import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  getWhatsAppDeliveryOperationsSummary: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/whatsapp-notifications", () => ({
  CURRENT_WHATSAPP_CONSENT_VERSION: "test-consent-version",
  getWhatsAppDeliveryOperationsSummary: mocks.getWhatsAppDeliveryOperationsSummary,
  isWhatsAppChannelAvailable: () => false,
}));

import { GET } from "./route";

const ENVIRONMENT_KEYS = [
  "ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER",
  "ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED",
  "ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED",
  "ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED",
  "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED",
  "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE",
  "META_WHATSAPP_WABA_ID",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_GRAPH_VERSION",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
] as const;

describe("admin WhatsApp readiness", () => {
  beforeEach(() => {
    for (const key of ENVIRONMENT_KEYS) delete process.env[key];
    Object.assign(process.env, {
      ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER: "whatsapp",
      ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: "false",
      ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: "true",
      ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED: "true",
      ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED: "true",
      ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE: "private-meta-case",
      META_WHATSAPP_WABA_ID: "123456789012345",
      META_WHATSAPP_PHONE_NUMBER_ID: "987654321098765",
      META_WHATSAPP_ACCESS_TOKEN: "private-access-token",
      META_WHATSAPP_GRAPH_VERSION: "v23.0",
    });
    mocks.requireApiAdmin.mockReset().mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
      unauthorized: null,
    });
    mocks.getWhatsAppDeliveryOperationsSummary.mockReset().mockResolvedValue({
      pending: 0,
      failed: 0,
    });
  });

  afterEach(() => {
    for (const key of ENVIRONMENT_KEYS) delete process.env[key];
  });

  it("shows independent authentication readiness and safe payload simulations", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.mode).toBe("simulation_only");
    expect(payload.authentication).toEqual(expect.objectContaining({
      mode: "configuration_ready",
      selectedPhoneVerificationProvider: "whatsapp",
      readiness: expect.objectContaining({
        readyToSend: true,
        authenticationTemplateApproved: true,
      }),
      template: expect.objectContaining({ name: "alpha_phone_verification" }),
    }));
    expect(payload.authentication.template.simulatedPayloads.en.template.language.code).toBe("en_US");
    expect(payload.authentication.template.simulatedPayloads.ar.template.language.code).toBe("ar");
    expect(payload.authentication.template.simulatedPayloads.en.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "000000" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "000000" }] },
    ]);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("private-access-token");
    expect(serialized).not.toContain("private-meta-case");
    expect(serialized).not.toContain("123456789012345");
    expect(serialized).not.toContain("987654321098765");
  });
});
