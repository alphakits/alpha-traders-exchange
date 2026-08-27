import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBilingualOtpSms, getSmsTemplate, isSmsLifecycleEvent, mapTwilioStatus, normalizeE164, resolveSmsDeliveryStatusTransition, sendTwilioMessageWithRetry, validateTwilioSignature } from "@/lib/notification-platform";

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
  });

  it.each([
    ["seller_application_submitted", "طلب الانضمام كبائع بانتظار المراجعة.", "Seller application needs review."],
    ["trade_requires_admin_review", "الصفقة بحاجة إلى مراجعة الإدارة.", "Trade needs admin review."],
    ["purchase_request_created", "لديك طلب شراء جديد.", "New purchase request."],
    ["trade_accepted", "وافق البائع على صفقتك.", "Seller accepted your trade."],
    ["payment_sent", "تم تحديد الدفع كمُرسل. تحقّق من استلام الأموال.", "Payment marked sent. Verify funds."],
    ["funds_received", "تم تأكيد استلام الأموال.", "Funds confirmed received."],
    ["usdt_sent", "تم إرسال USDT. أكّد الاستلام.", "USDT sent. Confirm receipt."],
    ["trade_completed", "اكتملت الصفقة.", "Trade completed."],
  ] as const)("renders %s SMS in Arabic first and English second", (event, arabic, english) => {
    const destination = "https://alphatraders.co.il/trade-room/123";
    expect(getSmsTemplate(event, destination).split("\n")).toEqual([
      "Alpha Traders",
      arabic,
      english,
      destination,
    ]);
  });

  it("keeps brand, code, and expiry clear in the compact bilingual OTP", () => {
    expect(getBilingualOtpSms("482901").split("\n")).toEqual([
      "Alpha Traders",
      "رمز التحقق / Verification code: 482901",
      "صالح لمدة 10 دقائق / Expires in 10 minutes.",
    ]);
  });

  it("upgrades legacy OTP callers before the provider request is sent", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const payload = new URLSearchParams(String(init?.body ?? ""));
      expect(payload.get("Body")).toBe(getBilingualOtpSms("482901"));
      return Promise.resolve(new Response(JSON.stringify({ sid: "SM1", status: "queued" }), { status: 201 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTwilioMessageWithRetry({
      to: "+15557654321",
      body: "Alpha Traders verification code: 482901. Expires in 10 minutes.",
    })).resolves.toEqual(expect.objectContaining({ ok: true }));
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
