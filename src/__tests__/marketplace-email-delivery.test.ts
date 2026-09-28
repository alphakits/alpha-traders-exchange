import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMarketplaceEmail,
  sendMarketplaceEmail,
  type MarketplaceEmailPayload,
} from "@/lib/marketplace-email-delivery";

const payload: MarketplaceEmailPayload = {
  event: "trade_accepted",
  recipientName: "Mark <Trader>",
  title: { ar: "تم قبول الصفقة", en: "Trade Accepted" },
  message: {
    ar: "وافق البائع على طلبك.",
    en: "The seller accepted your request.",
  },
  actionLabel: { ar: "فتح غرفة الصفقة", en: "Open Trade Room" },
  actionPath: "/trade-room/request-1",
  referenceLabel: "trade-1",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("marketplace email delivery", () => {
  it("builds a branded mobile-friendly transactional email", () => {
    const email = buildMarketplaceEmail(payload);

    expect(email.subject).toBe("تم قبول الصفقة | Trade Accepted | Alpha Traders Academy & Exchange");
    expect(email.text.indexOf("تم قبول الصفقة")).toBeLessThan(email.text.indexOf("Trade Accepted"));
    expect(email.text).toContain("فتح غرفة الصفقة: https://www.alphatraders.co.il/ar/trade-room/request-1");
    expect(email.text).toContain("Open Trade Room");
    expect(email.text).toContain("https://www.alphatraders.co.il/en/trade-room/request-1");
    expect(email.html).toContain("Alpha Exchange");
    expect(email.html).toContain('src="cid:alpha-traders-logo"');
    expect(email.html).toContain('width="120" height="120"');
    expect(email.html).toContain("Alpha Traders Academy &amp; Exchange");
    expect(email.html).toContain("max-width:560px");
    expect(email.html).toContain("Mark &lt;Trader&gt;");
    expect(email.html).not.toContain("Mark <Trader>");
    expect(email.html).toContain('lang="ar" dir="rtl"');
    expect(email.html).toContain('lang="en" dir="ltr"');
  });

  it("supports the dedicated seller prestige promotion email event", () => {
    const email = buildMarketplaceEmail({
      ...payload,
      event: "seller_prestige_promoted",
      title: {
        ar: "تهانينا على رتبتك الجديدة كبائع",
        en: "Congratulations on your new seller rank",
      },
      message: {
        ar: "وصلت إلى رتبة البائع الفضية.",
        en: "You reached silver seller.",
      },
      actionLabel: { ar: "عرض إحصاءات البائع", en: "View Seller Insights" },
      actionPath: "/usdt-exchange#market-overview",
      referenceLabel: "promotion-1",
    });
    expect(email.subject).toBe("تهانينا على رتبتك الجديدة كبائع | Congratulations on your new seller rank | Alpha Traders Academy & Exchange");
    expect(email.text).toContain("View Seller Insights");
    expect(email.text).toContain("promotion-1");
  });

  it("uses one locale and its matching route only when an explicit UI locale is available", () => {
    const email = buildMarketplaceEmail({ ...payload, recipientLocale: "en" });

    expect(email.subject).toBe("Trade Accepted | Alpha Traders Academy & Exchange");
    expect(email.text).toContain("/en/trade-room/request-1");
    expect(email.text).not.toContain("/ar/trade-room/request-1");
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.html).not.toContain('lang="ar" dir="rtl"');
  });

  it("renders only Arabic copy and an Arabic route for an Arabic recipient", () => {
    const email = buildMarketplaceEmail({ ...payload, recipientLocale: "ar" });

    expect(email.subject).toBe("تم قبول الصفقة | Alpha Traders Academy & Exchange");
    expect(email.text).toContain("/ar/trade-room/request-1");
    expect(email.text).not.toContain("/en/trade-room/request-1");
    expect(email.text).not.toContain("Trade Accepted");
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).not.toContain('lang="en" dir="ltr"');
  });

  it("does not call Resend when email delivery is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMarketplaceEmail({ ...payload, to: "mark@example.com", recipientLocale: "en" })).resolves.toEqual({
      ok: false,
      reason: "resend_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the rendered email through Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMarketplaceEmail({ ...payload, to: "mark@example.com", recipientLocale: "en" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-api-key" }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      from: "Alpha Traders Academy & Exchange <notifications@example.com>",
      to: ["mark@example.com"],
      subject: "Trade Accepted | Alpha Traders Academy & Exchange",
      headers: { "BIMI-Selector": "v=BIMI1; s=default;" },
      attachments: [{
        path: "https://www.alphatraders.co.il/images/brand/alpha-traders-logo-192.png?v=c73f7405",
        filename: "alpha-traders-logo.png",
        content_id: "alpha-traders-logo",
      }],
    }));
  });

  it("reports Resend network failures without rejecting the trade side effect", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(sendMarketplaceEmail({ ...payload, to: "mark@example.com", recipientLocale: "en", maxAttempts: 1 })).resolves.toEqual({
      ok: false,
      reason: "resend_network_failed",
      providerMessage: "network unavailable",
    });
  });

  it("surfaces Resend rejection details for production diagnostics", async () => {
    vi.stubEnv("RESEND_API_KEY", "invalid-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: "API key is invalid" })),
    }));

    await expect(sendMarketplaceEmail({ ...payload, to: "mark@example.com", recipientLocale: "en" })).resolves.toEqual({
      ok: false,
      reason: "resend_request_failed",
      providerStatus: 400,
      providerMessage: "API key is invalid",
    });
  });

  it("retries a transient Resend rejection with the same idempotency key", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue(JSON.stringify({ message: "temporarily unavailable" })),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const delivery = sendMarketplaceEmail({
      ...payload,
      to: "mark@example.com",
      recipientLocale: "en",
      idempotencyKey: "trade-lifecycle:request-1:accepted:buyer-1",
      maxAttempts: 2,
      retryDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);

    await expect(delivery).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "trade-lifecycle:request-1:accepted:buyer-1",
        }),
      }));
    }
  });

  it("aborts a stalled Resend request instead of losing the background task to an indefinite wait", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })));

    const delivery = sendMarketplaceEmail({
      ...payload,
      to: "mark@example.com",
      recipientLocale: "en",
      maxAttempts: 1,
      timeoutMs: 250,
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(delivery).resolves.toEqual({
      ok: false,
      reason: "resend_timeout",
      providerMessage: "Resend request timed out.",
    });
  });

  it.each([
    ["seconds", 429, "2", 2_000],
    ["HTTP date", 503, "Wed, 23 Sep 2026 00:00:02 GMT", 2_000],
    ["missing cooldown", 429, null, 1_000],
    ["invalid cooldown", 429, "unknown", 1_000],
  ])("waits for the provider cooldown (%s) before retrying", async (_name, status, header, waitMs) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T00:00:00Z"));
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Please retry later" }), {
        status,
        headers: header ? { "Retry-After": header } : {},
      }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const delivery = sendMarketplaceEmail({
      ...payload, to: "mark@example.com", recipientLocale: "en", maxAttempts: 2,
      idempotencyKey: "cooldown-test", retryDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(waitMs - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(delivery).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers["Idempotency-Key"]).toBe("cooldown-test");
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a long provider cooldown without retrying early or holding the function open", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Try later" }), {
      status: 429, headers: { "Retry-After": "60" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMarketplaceEmail({ ...payload, to: "mark@example.com", recipientLocale: "en" }))
      .resolves.toMatchObject({ ok: false, reason: "resend_request_failed", providerStatus: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["daily_quota_exceeded", "monthly_quota_exceeded"])("does not retry an exhausted %s quota", async (name) => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name, message: "Quota exceeded" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMarketplaceEmail({ ...payload, to: "mark@example.com", recipientLocale: "en" }))
      .resolves.toMatchObject({ ok: false, providerStatus: 429, providerMessage: "Quota exceeded" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["concurrent_idempotent_requests", 2, true],
    ["invalid_idempotent_request", 1, false],
  ])("distinguishes recoverable and permanent idempotency conflicts (%s)", async (name, attempts, ok) => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha <notifications@example.com>");
    const send = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name }), { status: 409 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    expect(await sendMarketplaceEmail({ ...payload, to: "mark@example.com", recipientLocale: "en", retryDelayMs: 0 })).toMatchObject({ ok });
    expect(send).toHaveBeenCalledTimes(attempts);
  });
});
