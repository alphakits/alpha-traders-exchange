import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  WHATSAPP_AUTHENTICATION_TEMPLATE_NAME,
  WHATSAPP_EVENT_TEMPLATES,
  buildWhatsAppAuthenticationTemplatePayload,
  buildWhatsAppTemplatePayload,
  getWhatsAppAuthenticationReadiness,
  getWhatsAppCloudReadiness,
  isWhatsAppOptOutText,
  isWhatsAppSendingEnabled,
  normalizeWhatsAppE164,
  parseWhatsAppWebhook,
  sendWhatsAppAuthenticationCode,
  sendWhatsAppAuthenticationCodeWithRetry,
  sendWhatsAppTemplate,
  sendWhatsAppTemplateWithRetry,
  validateWhatsAppWebhookSignature,
  validateWhatsAppWebhookVerification,
  validateWhatsAppWebhookVerifyToken,
  verifyWhatsAppWebhookChallenge,
  verifyWhatsAppWebhookSignature,
  type WhatsAppEventType,
} from "../lib/whatsapp-platform";

const ENVIRONMENT_KEYS = [
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

const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>;

function setReadyEnvironment(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  Object.assign(process.env, {
    ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: "true",
    ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: "true",
    ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED: "true",
    ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED: "true",
    ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE: "meta-case-reference",
    META_WHATSAPP_WABA_ID: "123456789012345",
    META_WHATSAPP_PHONE_NUMBER_ID: "987654321098765",
    META_WHATSAPP_ACCESS_TOKEN: "private-access-token",
    META_WHATSAPP_GRAPH_VERSION: "v23.0",
    META_WHATSAPP_APP_SECRET: "private-app-secret",
    META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "private-webhook-token",
    ...overrides,
  });
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  for (const key of ENVIRONMENT_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Meta WhatsApp Cloud readiness", () => {
  it("requires explicit sending and policy gates plus every credential", () => {
    setReadyEnvironment();
    expect(getWhatsAppCloudReadiness()).toEqual(expect.objectContaining({
      configured: true,
      outboundConfigured: true,
      webhookConfigured: true,
      sendEnabled: true,
      policyApproved: true,
      approvalReferenceRecorded: true,
      readyToSend: true,
      state: "ready",
      missingRequirements: [],
    }));
    expect(isWhatsAppSendingEnabled()).toBe(true);

    process.env.ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED = "false";
    expect(getWhatsAppCloudReadiness()).toEqual(expect.objectContaining({
      configured: true,
      policyApproved: false,
      readyToSend: false,
      state: "awaiting_policy_approval",
      missingRequirements: expect.arrayContaining(["policy_approved"]),
    }));
  });

  it("never exposes credentials or the approval reference", () => {
    setReadyEnvironment();
    const serialized = JSON.stringify([
      getWhatsAppCloudReadiness(),
      getWhatsAppAuthenticationReadiness(),
    ]);
    expect(serialized).not.toContain("private-access-token");
    expect(serialized).not.toContain("private-app-secret");
    expect(serialized).not.toContain("private-webhook-token");
    expect(serialized).not.toContain("meta-case-reference");
    expect(serialized).not.toContain("123456789012345");
    expect(serialized).not.toContain("987654321098765");
  });

  it("gates authentication independently from Utility notifications", () => {
    setReadyEnvironment({ ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: "false" });

    expect(getWhatsAppCloudReadiness().readyToSend).toBe(false);
    expect(getWhatsAppAuthenticationReadiness()).toEqual(expect.objectContaining({
      outboundConfigured: true,
      sendEnabled: true,
      policyApproved: true,
      approvalReferenceRecorded: true,
      authenticationTemplateApproved: true,
      readyToSend: true,
      state: "ready",
      missingRequirements: [],
    }));

    process.env.ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED = "false";
    expect(getWhatsAppAuthenticationReadiness()).toEqual(expect.objectContaining({
      readyToSend: false,
      state: "awaiting_template_approval",
      missingRequirements: expect.arrayContaining(["authentication_template_approved"]),
    }));
  });

  it("does not call Meta while the approval gate is closed", async () => {
    setReadyEnvironment({ ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTemplateWithRetry({
      to: "+15551234567",
      event: "new_request",
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: "not_ready",
      retryable: false,
      attempts: 1,
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Meta WhatsApp fixed notification templates", () => {
  it("uses only fixed, neutral templates without transaction details", () => {
    const sensitiveTerms = /\b(?:usdt|crypto(?:currency)?|amount|wallet|bank|payment|buyer|seller|buy|sell)\b/i;
    const events = Object.keys(WHATSAPP_EVENT_TEMPLATES) as WhatsAppEventType[];

    expect(events).toHaveLength(8);
    for (const event of events) {
      const definition = WHATSAPP_EVENT_TEMPLATES[event];
      const englishPayload = buildWhatsAppTemplatePayload({ to: "+1 (555) 123-4567", event, locale: "en" });
      const arabicPayload = buildWhatsAppTemplatePayload({ to: "+1 (555) 123-4567", event, locale: "ar" });
      expect(definition.previews.en).not.toMatch(sensitiveTerms);
      expect(definition.previews.ar).not.toMatch(sensitiveTerms);
      expect(definition.name).not.toMatch(sensitiveTerms);
      expect(JSON.stringify(englishPayload)).not.toMatch(sensitiveTerms);
      expect(JSON.stringify(arabicPayload)).not.toMatch(sensitiveTerms);
      expect(englishPayload).toEqual({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "15551234567",
        type: "template",
        template: {
          name: definition.name,
          language: { code: "en_US" },
        },
      });
      expect(arabicPayload).toEqual({
        ...englishPayload,
        template: {
          name: definition.name,
          language: { code: "ar" },
        },
      });
      expect(englishPayload.template).not.toHaveProperty("components");
      expect(arabicPayload.template).not.toHaveProperty("components");
    }
  });

  it("accepts only valid E.164 recipient numbers", () => {
    expect(normalizeWhatsAppE164(" +972 (54) 123-4567 ")).toBe("+972541234567");
    expect(normalizeWhatsAppE164("0541234567")).toBeNull();
    expect(normalizeWhatsAppE164("+0123456789")).toBeNull();
    expect(normalizeWhatsAppE164("+123")).toBeNull();
  });
});

describe("Meta WhatsApp authentication template", () => {
  it("builds the approved copy-code payload in English and Arabic", () => {
    const english = buildWhatsAppAuthenticationTemplatePayload({
      to: "+15551234567",
      code: "482901",
      locale: "en",
    });
    const arabic = buildWhatsAppAuthenticationTemplatePayload({
      to: "+15551234567",
      code: "482901",
      locale: "ar",
    });

    expect(english).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "15551234567",
      type: "template",
      template: {
        name: WHATSAPP_AUTHENTICATION_TEMPLATE_NAME,
        language: { code: "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "482901" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482901" }] },
        ],
      },
    });
    expect(arabic.template.language.code).toBe("ar");
    expect(arabic.template.components).toEqual(english.template.components);
  });

  it("rejects malformed codes without calling Meta", async () => {
    setReadyEnvironment();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppAuthenticationCode({
      to: "+15551234567",
      code: "12345",
      locale: "en",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "invalid_otp", retryable: false }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("12345");
  });

  it("never automatically retries an ambiguous authentication send", async () => {
    setReadyEnvironment();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 2 } }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppAuthenticationCodeWithRetry({
      to: "+15551234567",
      code: "482901",
      locale: "en",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: "provider_rejected",
      retryable: true,
      attempts: 1,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("482901");
  });
});

describe("Meta WhatsApp delivery", () => {
  it("sends a fixed template to the configured Graph API endpoint", async () => {
    setReadyEnvironment();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.abc123" }] }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTemplate({ to: "+15551234567", event: "trade_room_message" });

    expect(result).toEqual({ ok: true, messageId: "wamid.abc123", status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v23.0/987654321098765/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer private-access-token",
      "Content-Type": "application/json",
    }));
    expect(JSON.parse(String(init.body))).toEqual(buildWhatsAppTemplatePayload({
      to: "+15551234567",
      event: "trade_room_message",
    }));
  });

  it("retries HTTP 429 and every 5xx class response", async () => {
    setReadyEnvironment();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 4 } }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 2 } }, 599))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.retried" }] }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTemplateWithRetry({
      to: "+15551234567",
      event: "trade_update",
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, messageId: "wamid.retried", attempts: 3 }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent provider rejection", async () => {
    setReadyEnvironment();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 131026, error_subcode: 2494010, message: "private provider detail" },
    }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTemplateWithRetry({
      to: "+15551234567",
      event: "request_accepted",
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      retryable: false,
      reason: "provider_rejected",
      httpStatus: 400,
      providerCode: "131026",
      providerSubcode: "2494010",
      attempts: 1,
    }));
    expect(JSON.stringify(result)).not.toContain("private provider detail");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries Meta rate-limit errors returned inside HTTP 400 responses", async () => {
    setReadyEnvironment();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 130429 } }, 400))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.after-rate-limit" }] }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTemplateWithRetry({
      to: "+15551234567",
      event: "trade_update",
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, attempts: 2 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a provider request at the configured timeout", async () => {
    setReadyEnvironment();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTemplate({
      to: "+15551234567",
      event: "trade_completed",
      timeoutMs: 25,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, retryable: true, reason: "timeout" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Meta WhatsApp webhook security and parsing", () => {
  it("validates subscription tokens and returns only a verified challenge", () => {
    setReadyEnvironment();
    expect(validateWhatsAppWebhookVerifyToken("private-webhook-token")).toBe(true);
    expect(validateWhatsAppWebhookVerifyToken("wrong-token")).toBe(false);
    expect(verifyWhatsAppWebhookChallenge({
      mode: "subscribe",
      verifyToken: "private-webhook-token",
      challenge: "challenge-123",
    })).toBe("challenge-123");
    expect(validateWhatsAppWebhookVerification({
      mode: "subscribe",
      verifyToken: "private-webhook-token",
      challenge: "challenge-123",
    })).toBe(true);
    expect(verifyWhatsAppWebhookChallenge({
      mode: "subscribe",
      verifyToken: "wrong-token",
      challenge: "challenge-123",
    })).toBeNull();
  });

  it("verifies the raw webhook body with the app-secret HMAC", () => {
    setReadyEnvironment();
    const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const digest = createHmac("sha256", "private-app-secret").update(rawBody).digest("hex");
    const signature = `sha256=${digest}`;

    expect(verifyWhatsAppWebhookSignature({ rawBody, signature })).toBe(true);
    expect(validateWhatsAppWebhookSignature({ rawBody, signature })).toBe(true);
    expect(verifyWhatsAppWebhookSignature(rawBody, signature)).toBe(true);
    expect(verifyWhatsAppWebhookSignature(`${rawBody} `, signature)).toBe(false);
    expect(verifyWhatsAppWebhookSignature(rawBody, "sha256=invalid")).toBe(false);
  });

  it("parses delivery receipts and privacy-safe opt-out commands", () => {
    setReadyEnvironment();
    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "987654321098765" },
            statuses: [
              { id: "wamid.sent", status: "sent", timestamp: "1700000000" },
              {
                id: "wamid.failed",
                status: "failed",
                timestamp: "1700000001",
                errors: [{ code: 131026, message: "private detail" }],
              },
              { id: "wamid.ignored", status: "unknown", timestamp: "1700000002" },
            ],
            messages: [
              { id: "inbound.stop", from: "15551234567", timestamp: "1700000000", type: "text", text: { body: "STOP!" } },
              { id: "inbound.ar", from: "972541234567", timestamp: "1700000001", type: "text", text: { body: "إلغاء الاشتراك" } },
              { id: "inbound.normal", from: "15557654321", timestamp: "1700000002", type: "text", text: { body: "Hello" } },
            ],
          },
        }],
      }],
    };

    const parsed = parseWhatsAppWebhook(payload);
    expect(parsed.deliveryStatuses).toEqual([
      {
        messageId: "wamid.sent",
        status: "sent",
        timestamp: "1700000000",
        occurredAt: "2023-11-14T22:13:20.000Z",
        failureCode: undefined,
      },
      {
        messageId: "wamid.failed",
        status: "failed",
        timestamp: "1700000001",
        occurredAt: "2023-11-14T22:13:21.000Z",
        failureCode: "131026",
      },
    ]);
    expect(parsed.optOuts).toEqual([
      {
        messageId: "inbound.stop",
        senderPhone: "+15551234567",
        timestamp: "1700000000",
        occurredAt: "2023-11-14T22:13:20.000Z",
      },
      {
        messageId: "inbound.ar",
        senderPhone: "+972541234567",
        timestamp: "1700000001",
        occurredAt: "2023-11-14T22:13:21.000Z",
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("private detail");

    expect(parseWhatsAppWebhook({
      ...payload,
      entry: [{ ...payload.entry[0], id: "999999999999999" }],
    })).toEqual({ deliveryStatuses: [], optOuts: [] });
    expect(parseWhatsAppWebhook({
      ...payload,
      entry: [{
        ...payload.entry[0],
        changes: [{
          ...payload.entry[0].changes[0],
          value: {
            ...payload.entry[0].changes[0].value,
            metadata: { phone_number_id: "111111111111111" },
          },
        }],
      }],
    })).toEqual({ deliveryStatuses: [], optOuts: [] });
  });

  it("recognizes exact opt-out equivalents without treating normal messages as commands", () => {
    expect(isWhatsAppOptOutText("UNSUBSCRIBE")).toBe(true);
    expect(isWhatsAppOptOutText("إيقاف")).toBe(true);
    expect(isWhatsAppOptOutText("הסר")).toBe(true);
    expect(isWhatsAppOptOutText("Please stop when convenient")).toBe(false);
    expect(isWhatsAppOptOutText("I need help")).toBe(false);
  });
});
