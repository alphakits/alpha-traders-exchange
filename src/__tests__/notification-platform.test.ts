import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSmsTemplate, isSmsLifecycleEvent, mapTwilioStatus, normalizeE164, resolveSmsDeliveryStatusTransition, sendTwilioMessageWithRetry, validateTwilioSignature } from "@/lib/notification-platform";

describe("notification platform", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts valid international E.164 numbers only", () => {
    expect(normalizeE164("+15551234567")).toBe("+15551234567");
    expect(normalizeE164(" +44 20 7946 0018 ")).toBe("+442079460018");
    expect(normalizeE164("055-1234567")).toBeNull();
  });

  it("allows only critical lifecycle SMS events", () => {
    expect(isSmsLifecycleEvent("funds_received")).toBe(true);
    expect(isSmsLifecycleEvent("announcement")).toBe(false);
    expect(getSmsTemplate("trade_completed")).toContain("completed");
    expect(getSmsTemplate("trade_completed", "https://alphatraders.co.il/trade-room/123"))
      .toContain("https://alphatraders.co.il/trade-room/123");
  });

  it("maps provider statuses without treating unknown statuses as delivery", () => {
    expect(mapTwilioStatus("queued")).toBe("queued");
    expect(mapTwilioStatus("delivered")).toBe("delivered");
    expect(mapTwilioStatus("undelivered")).toBe("failed");
    expect(mapTwilioStatus("read")).toBeNull();
  });

  it("validates Twilio signatures using sorted form fields", () => {
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    const url = "https://example.test/api/twilio/status";
    const params = { MessageSid: "SM1", MessageStatus: "delivered" };
    const signature = createHmac("sha1", "test-token").update(`${url}MessageSidSM1MessageStatusdelivered`).digest("base64");
    expect(validateTwilioSignature({ signature, url, params })).toBe(true);
    expect(validateTwilioSignature({ signature: "wrong", url, params })).toBe(false);
  });

  it("retries transient Twilio failures once", async () => {
    vi.useFakeTimers();
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sid: "SM1", status: "queued" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const delivery = sendTwilioMessageWithRetry({ to: "+15557654321", body: "critical" });
    await vi.runAllTimersAsync();
    const result = await delivery;
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a timed-out provider request without waiting indefinitely", async () => {
    vi.useFakeTimers();
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const delivery = sendTwilioMessageWithRetry({
      to: "+15557654321",
      body: "critical",
      maxAttempts: 1,
      timeoutMs: 250,
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(delivery).resolves.toEqual(expect.objectContaining({
      ok: false,
      attempts: 1,
      error: "Twilio request timed out.",
    }));
  });

  it("records provider error code and HTTP status without returning provider text", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 21211, message: "phone +15550001111 rejected" }), { status: 400 }),
    ));

    const result = await sendTwilioMessageWithRetry({ to: "+15557654321", body: "critical" });
    expect(result).toEqual(expect.objectContaining({ ok: false, httpStatus: 400, providerCode: "21211", attempts: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("+15550001111");
  });

  it("keeps callback transitions monotonic and terminal", () => {
    expect(resolveSmsDeliveryStatusTransition("queued", "sent")).toBe("sent");
    expect(resolveSmsDeliveryStatusTransition("sent", "queued")).toBe("sent");
    expect(resolveSmsDeliveryStatusTransition("delivered", "sent")).toBe("delivered");
    expect(resolveSmsDeliveryStatusTransition("delivered", "failed")).toBe("delivered");
    expect(resolveSmsDeliveryStatusTransition("failed", "queued")).toBe("failed");
    expect(resolveSmsDeliveryStatusTransition("failed", "delivered")).toBe("failed");
  });
});
