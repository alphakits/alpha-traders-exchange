import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/notification-platform", () => ({
  mapTwilioStatus: vi.fn(),
  validateTwilioSignature: vi.fn(),
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  updateSmsDeliveryStatus: vi.fn(),
}));
vi.mock("@/lib/site-url", () => ({
  getSiteUrl: () => "https://alphatraders.co.il",
}));

import { POST } from "@/app/api/twilio/status/route";
import { mapTwilioStatus, validateTwilioSignature } from "@/lib/notification-platform";
import { updateSmsDeliveryStatus } from "@/lib/alpha-exchange-store";

function callbackRequest(body: Record<string, string>) {
  return new NextRequest("https://alphatraders.co.il/api/twilio/status", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "signature",
    },
    body: new URLSearchParams(body),
  });
}

describe("Twilio status callback", () => {
  beforeEach(() => {
    vi.mocked(validateTwilioSignature).mockReset().mockReturnValue(true);
    vi.mocked(mapTwilioStatus).mockReset().mockReturnValue("delivered");
    vi.mocked(updateSmsDeliveryStatus).mockReset().mockResolvedValue(true);
  });

  it("acknowledges a valid callback after persisting it", async () => {
    const response = await POST(callbackRequest({ MessageSid: "SM123", MessageStatus: "delivered" }));
    expect(response.status).toBe(204);
    expect(updateSmsDeliveryStatus).toHaveBeenCalledWith({
      messageSid: "SM123",
      status: "delivered",
      providerStatus: "delivered",
    });
  });

  it("rejects invalid signatures and malformed statuses", async () => {
    vi.mocked(validateTwilioSignature).mockReturnValueOnce(false);
    expect((await POST(callbackRequest({ MessageSid: "SM123", MessageStatus: "sent" }))).status).toBe(403);

    vi.mocked(mapTwilioStatus).mockReturnValueOnce(null);
    expect((await POST(callbackRequest({ MessageSid: "SM123", MessageStatus: "unknown" }))).status).toBe(400);
  });
});
