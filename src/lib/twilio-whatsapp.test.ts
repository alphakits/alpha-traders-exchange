import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getWhatsAppAuthenticationReadiness, getWhatsAppCloudReadiness, sendWhatsAppAuthenticationCode, sendWhatsAppTemplate, WHATSAPP_EVENT_TEMPLATES } from "@/lib/whatsapp-platform";

const account = `AC${"a".repeat(32)}`;
const message = `SM${"b".repeat(32)}`;
const enSid = `HX${"c".repeat(32)}`;
const arSid = `HX${"d".repeat(32)}`;
function configure() {
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PROVIDER", "twilio");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", "unit-test-approval");
  vi.stubEnv("TWILIO_ACCOUNT_SID", account);
  vi.stubEnv("TWILIO_AUTH_TOKEN", "unit-test-token");
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "+15551234567");
  vi.stubEnv("TWILIO_WHATSAPP_CONTENT_SIDS", JSON.stringify(Object.fromEntries([
    ...Object.values(WHATSAPP_EVENT_TEMPLATES).map(template => [template.name, { en: enSid, ar: arSid }]),
    ["alpha_phone_verification", { en: enSid, ar: arSid }],
  ])));
}
beforeEach(configure);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Twilio WhatsApp templates", () => {
  it("keeps authentication independent from the utility-notification send switch", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", "false");
    expect(getWhatsAppCloudReadiness().readyToSend).toBe(false);
    expect(getWhatsAppAuthenticationReadiness()).toMatchObject({ provider: "twilio_whatsapp", readyToSend: true });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ sid: message, status: "queued" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendWhatsAppAuthenticationCode({ to: "+972501234567", code: "482901", locale: "ar" });
    expect(result).toEqual({ ok: true, messageId: message, status: "accepted" });
    const payload = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(payload.get("To")).toBe("whatsapp:+972501234567");
    expect(payload.get("From")).toBe("whatsapp:+15551234567");
    expect(payload.get("ContentSid")).toBe(arSid);
    expect(JSON.parse(payload.get("ContentVariables")!)).toEqual({ "1": "482901" });
    expect(payload.has("Body")).toBe(false);
    expect(payload.get("StatusCallback")).toMatch(/\/api\/twilio\/whatsapp\/webhook$/);
    expect(JSON.stringify(result)).not.toMatch(/482901|unit-test-token|972501234567/);
  });
  it.each(["ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED", "ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED"])("fails closed when %s is off", async flag => {
    vi.stubEnv(flag, "false");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await sendWhatsAppAuthenticationCode({ to: "+972501234567", code: "482901" })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires both approved language mappings and rejects malformed configuration", () => {
    vi.stubEnv("TWILIO_WHATSAPP_CONTENT_SIDS", JSON.stringify({ alpha_phone_verification: { en: enSid } }));
    expect(getWhatsAppAuthenticationReadiness().readyToSend).toBe(false);
    vi.stubEnv("TWILIO_WHATSAPP_CONTENT_SIDS", "invalid JSON");
    expect(getWhatsAppCloudReadiness().readyToSend).toBe(false);
  });
  it("rejects sending a code to its own WhatsApp sender before making a request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await sendWhatsAppAuthenticationCode({ to: "+15551234567", code: "482901" })).toMatchObject({ ok: false, reason: "not_ready", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends utility alerts using fixed templates without private trade content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ sid: message, status: "queued" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendWhatsAppTemplate({ to: "+972501234567", event: "new_request", locale: "en" });
    const payload = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(payload.get("ContentSid")).toBe(enSid);
    expect(payload.has("Body")).toBe(false);
    expect(payload.has("ContentVariables")).toBe(false);
  });
  it("does not report a failed or incomplete provider response as successful delivery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ sid: message, status: "failed" }, { status: 201 })));
    expect(await sendWhatsAppAuthenticationCode({ to: "+972501234567", code: "482901" })).toMatchObject({ ok: false, reason: "provider_rejected", retryable: false });
  });
});
