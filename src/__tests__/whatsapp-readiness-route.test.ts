// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireApiAdmin: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));

import { GET } from "@/app/api/alpha-exchange/admin/whatsapp/readiness/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED", "false");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", "false");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", "false");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", "private-case-reference");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", "0123456789abcdef0123456789abcdef");
  vi.stubEnv("META_WHATSAPP_WABA_ID", "123456789");
  vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "987654321");
  vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "private-access-token");
  vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v23.0");
  vi.stubEnv("META_WHATSAPP_APP_SECRET", "private-app-secret-private-value");
  vi.stubEnv("META_WHATSAPP_WEBHOOK_VERIFY_TOKEN", "private-verify-token");
  mocks.requireApiAdmin.mockResolvedValue({ user: { id: "admin-1" }, unauthorized: null });
});

describe("WhatsApp readiness route", () => {
  it("provides a secret-free, no-send simulation while policy gates are closed", async () => {
    const response = await GET();
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("simulation_only");
    expect(payload.readinessScope).toBe("local_configuration_only");
    expect(payload.endToEndVerified).toBe(false);
    expect(payload.provider.readyToSend).toBe(false);
    expect(payload.consent.available).toBe(false);
    expect(payload.templates).toHaveLength(8);
    expect(payload.templates[0].simulatedPayloads.en.type).toBe("template");
    expect(serialized).not.toContain("private-access-token");
    expect(serialized).not.toContain("private-app-secret-private-value");
    expect(serialized).not.toContain("private-verify-token");
    expect(serialized).not.toContain("private-case-reference");
    expect(serialized).not.toMatch(/\b(?:usdt|crypto|amount|wallet|bank|payment|buyer|seller|buy|sell)\b/i);
  });
});
