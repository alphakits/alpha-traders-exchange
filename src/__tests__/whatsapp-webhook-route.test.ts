// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  verifyChallenge,
  verifySignature,
  parseWebhook,
  applyStatuses,
  revokeByPhone,
} = vi.hoisted(() => ({
  verifyChallenge: vi.fn(),
  verifySignature: vi.fn(),
  parseWebhook: vi.fn(),
  applyStatuses: vi.fn(),
  revokeByPhone: vi.fn(),
}));

vi.mock("@/lib/whatsapp-platform", () => ({
  verifyWhatsAppWebhookChallenge: verifyChallenge,
  verifyWhatsAppWebhookSignature: verifySignature,
  parseWhatsAppWebhook: parseWebhook,
}));
vi.mock("@/lib/whatsapp-notifications", () => ({
  applyWhatsAppWebhookStatuses: applyStatuses,
  revokeWhatsAppConsentByPhone: revokeByPhone,
}));

import { GET, POST } from "@/app/api/meta/whatsapp/webhook/route";

describe("Meta WhatsApp webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyChallenge.mockReturnValue("challenge-value");
    verifySignature.mockReturnValue(true);
    parseWebhook.mockReturnValue({ deliveryStatuses: [], optOuts: [] });
    applyStatuses.mockResolvedValue(0);
    revokeByPhone.mockResolvedValue(0);
  });

  it("returns Meta's challenge only after verifying the token", async () => {
    const request = new NextRequest(
      "https://www.alphatraders.co.il/api/meta/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token&hub.challenge=challenge-value",
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-value");
    expect(verifyChallenge).toHaveBeenCalledWith({
      mode: "subscribe",
      verifyToken: "token",
      challenge: "challenge-value",
    });

    verifyChallenge.mockReturnValueOnce(null);
    expect((await GET(request)).status).toBe(403);
  });

  it("rejects unsigned payloads before parsing or database work", async () => {
    verifySignature.mockReturnValueOnce(false);
    const request = new NextRequest("https://www.alphatraders.co.il/api/meta/whatsapp/webhook", {
      method: "POST",
      body: JSON.stringify({ object: "whatsapp_business_account" }),
    });
    expect((await POST(request)).status).toBe(403);
    expect(parseWebhook).not.toHaveBeenCalled();
    expect(applyStatuses).not.toHaveBeenCalled();
  });

  it("updates receipts and applies only parser-recognized STOP opt-outs", async () => {
    parseWebhook.mockReturnValueOnce({
      deliveryStatuses: [{ messageId: "wamid.1", status: "delivered" }],
      optOuts: [{ messageId: "wamid.stop", senderPhone: "+972501234567" }],
    });
    applyStatuses.mockResolvedValueOnce(1);
    revokeByPhone.mockResolvedValueOnce(1);
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    const request = new NextRequest("https://www.alphatraders.co.il/api/meta/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=valid" },
      body,
    });
    expect((await POST(request)).status).toBe(204);
    expect(verifySignature).toHaveBeenCalledWith({ rawBody: body, signature: "sha256=valid" });
    expect(applyStatuses).toHaveBeenCalledWith([{ messageId: "wamid.1", status: "delivered" }]);
    expect(revokeByPhone).toHaveBeenCalledWith({
      phone: "+972501234567",
      messageId: "wamid.stop",
      occurredAt: undefined,
    });
  });

  it("rejects malformed JSON after signature verification", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/meta/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=valid" },
      body: "{",
    });
    expect((await POST(request)).status).toBe(400);
    expect(parseWebhook).not.toHaveBeenCalled();
  });
});
