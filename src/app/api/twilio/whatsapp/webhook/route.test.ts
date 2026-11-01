// @vitest-environment node
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ statuses: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/whatsapp-notifications", () => ({ applyWhatsAppWebhookStatuses: mocks.statuses, revokeWhatsAppConsentByPhone: mocks.revoke }));
import { POST } from "./route";
const account = `AC${"a".repeat(32)}`;
const message = `SM${"b".repeat(32)}`;
const url = "https://www.alphatraders.co.il/api/twilio/whatsapp/webhook";
function request(fields: Record<string, string>, signatureValid = true) {
  const params = { AccountSid: account, MessageSid: message, ...fields };
  const signature = createHmac("sha1", "test-token").update(url + Object.keys(params).sort().map(key => key + params[key as keyof typeof params]).join("")).digest("base64");
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signatureValid ? signature : "invalid" }, body: new URLSearchParams(params) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.alphatraders.co.il");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PROVIDER", "twilio");
  vi.stubEnv("TWILIO_ACCOUNT_SID", account);
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "+15551234567");
});
afterEach(() => vi.unstubAllEnvs());
describe("signed Twilio WhatsApp callbacks", () => {
  it("rejects forged signatures before touching subscriptions or delivery state", async () => {
    expect((await POST(request({ MessageStatus: "delivered" }, false))).status).toBe(403);
    expect(mocks.statuses).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("records only a recognized signed message status", async () => {
    expect((await POST(request({ MessageStatus: "read" }))).status).toBe(204);
    expect(mocks.statuses).toHaveBeenCalledWith([expect.objectContaining({ messageId: message, status: "read" })]);
  });
  it("honors STOP for the registered sender without copying inbound text into chat", async () => {
    expect((await POST(request({ From: "whatsapp:+972501234567", To: "whatsapp:+15551234567", Body: "STOP" }))).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(expect.objectContaining({ phone: "+972501234567", messageId: message }));
    expect(mocks.statuses).not.toHaveBeenCalled();
  });
  it("ignores ordinary inbound messages", async () => {
    expect((await POST(request({ From: "whatsapp:+972501234567", To: "whatsapp:+15551234567", Body: "change my trade" }))).status).toBe(204);
    expect(mocks.revoke).not.toHaveBeenCalled(); expect(mocks.statuses).not.toHaveBeenCalled();
  });
  it("does not accept another Twilio account or a mismatched inbound sender", async () => {
    expect((await POST(request({ AccountSid: `AC${"c".repeat(32)}`, MessageStatus: "delivered" }))).status).toBe(403);
    expect((await POST(request({ From: "whatsapp:+972501234567", To: "whatsapp:+15559999999", Body: "STOP" }))).status).toBe(400);
    expect(mocks.revoke).not.toHaveBeenCalled(); expect(mocks.statuses).not.toHaveBeenCalled();
  });
});
