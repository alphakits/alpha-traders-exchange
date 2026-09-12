import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { WhatsAppNotificationEvent } from "@/types/alpha-exchange";

const META_GRAPH_BASE_URL = "https://graph.facebook.com";
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

/** Must match the Meta-approved AUTHENTICATION template in WhatsApp Manager. */
export const WHATSAPP_AUTHENTICATION_TEMPLATE_NAME = "alpha_phone_verification";

const configurationKeys = [
  "META_WHATSAPP_WABA_ID",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_GRAPH_VERSION",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
] as const;

type WhatsAppConfigurationKey = (typeof configurationKeys)[number];

export type WhatsAppEventType = WhatsAppNotificationEvent;

export type WhatsAppTemplateLocale = "ar" | "en";

export type WhatsAppTemplateDefinition = Readonly<{
  name: string;
  languageCodes: Readonly<{ ar: "ar"; en: "en_US" }>;
  previews: Readonly<{ ar: string; en: string }>;
}>;

/**
 * These previews must match the corresponding fixed Utility templates approved
 * in WhatsApp Manager. No transaction details or template variables are sent.
 */
export const WHATSAPP_EVENT_TEMPLATES = Object.freeze({
  new_request: Object.freeze({
    name: "alpha_new_request",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "لديك طلب جديد. افتح Alpha Traders لمراجعته.",
      en: "You have a new request. Open Alpha Traders to review it.",
    }),
  }),
  request_accepted: Object.freeze({
    name: "alpha_request_accepted",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "تم قبول طلبك. افتح Alpha Traders للمتابعة.",
      en: "Your request was accepted. Open Alpha Traders to continue.",
    }),
  }),
  request_declined: Object.freeze({
    name: "alpha_request_declined",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "تم رفض طلبك. افتح Alpha Traders للاطلاع على التفاصيل.",
      en: "Your request was declined. Open Alpha Traders for details.",
    }),
  }),
  trade_update: Object.freeze({
    name: "alpha_trade_update",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "يوجد تحديث جديد في غرفة المتابعة النشطة. افتح Alpha Traders.",
      en: "Your active Trade Room has a new status update. Open Alpha Traders.",
    }),
  }),
  trade_room_message: Object.freeze({
    name: "alpha_trade_room_message",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "توجد رسالة جديدة بانتظارك في غرفة المتابعة النشطة. افتح Alpha Traders لقراءتها.",
      en: "A new message is waiting in your active Trade Room. Open Alpha Traders to read it.",
    }),
  }),
  trade_room_reminder: Object.freeze({
    name: "alpha_trade_room_reminder",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "هناك مشارك بانتظارك في غرفة المتابعة النشطة. افتح Alpha Traders.",
      en: "A participant is waiting in your active Trade Room. Open Alpha Traders.",
    }),
  }),
  trade_completed: Object.freeze({
    name: "alpha_request_completed",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "اكتمل طلبك. افتح Alpha Traders للاطلاع على التفاصيل.",
      en: "Your request is complete. Open Alpha Traders for details.",
    }),
  }),
  trade_cancelled: Object.freeze({
    name: "alpha_request_cancelled",
    languageCodes: Object.freeze({ ar: "ar", en: "en_US" }),
    previews: Object.freeze({
      ar: "تم إلغاء طلبك. افتح Alpha Traders للاطلاع على التفاصيل.",
      en: "Your request was cancelled. Open Alpha Traders for details.",
    }),
  }),
} satisfies Record<WhatsAppEventType, WhatsAppTemplateDefinition>);

export type WhatsAppReadinessRequirement =
  | "send_enabled"
  | "policy_approved"
  | "policy_approval_reference"
  | "waba_id"
  | "phone_number_id"
  | "access_token"
  | "graph_version"
  | "app_secret"
  | "webhook_verify_token";

export type WhatsAppCloudReadiness = Readonly<{
  provider: "meta_whatsapp_cloud";
  configured: boolean;
  outboundConfigured: boolean;
  webhookConfigured: boolean;
  sendEnabled: boolean;
  policyApproved: boolean;
  approvalReferenceRecorded: boolean;
  readyToSend: boolean;
  state: "ready" | "disabled" | "awaiting_policy_approval" | "configuration_incomplete";
  missingRequirements: readonly WhatsAppReadinessRequirement[];
}>;

export type WhatsAppAuthenticationReadinessRequirement =
  | "auth_send_enabled"
  | "policy_approved"
  | "policy_approval_reference"
  | "authentication_template_approved"
  | "waba_id"
  | "phone_number_id"
  | "access_token"
  | "graph_version";

export type WhatsAppAuthenticationReadiness = Readonly<{
  provider: "meta_whatsapp_cloud";
  outboundConfigured: boolean;
  sendEnabled: boolean;
  policyApproved: boolean;
  approvalReferenceRecorded: boolean;
  authenticationTemplateApproved: boolean;
  readyToSend: boolean;
  state: "ready" | "disabled" | "awaiting_policy_approval" | "awaiting_template_approval" | "configuration_incomplete";
  missingRequirements: readonly WhatsAppAuthenticationReadinessRequirement[];
}>;

type ReadyWhatsAppConfiguration = Record<WhatsAppConfigurationKey, string>;

function environmentValue(env: NodeJS.ProcessEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function environmentFlag(env: NodeJS.ProcessEnv, key: string) {
  return environmentValue(env, key).toLowerCase() === "true";
}

function hasNumericId(value: string) {
  return /^\d+$/.test(value);
}

function hasGraphVersion(value: string) {
  return /^v\d+\.\d+$/.test(value);
}

export function getWhatsAppCloudReadiness(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppCloudReadiness {
  const sendEnabled = environmentFlag(env, "ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED");
  const policyApproved = environmentFlag(env, "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED");
  const approvalReferenceRecorded = Boolean(environmentValue(env, "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE"));
  const values = Object.fromEntries(configurationKeys.map((key) => [key, environmentValue(env, key)])) as ReadyWhatsAppConfiguration;

  const wabaConfigured = hasNumericId(values.META_WHATSAPP_WABA_ID);
  const phoneNumberConfigured = hasNumericId(values.META_WHATSAPP_PHONE_NUMBER_ID);
  const graphVersionConfigured = hasGraphVersion(values.META_WHATSAPP_GRAPH_VERSION);
  const outboundConfigured = wabaConfigured
    && phoneNumberConfigured
    && Boolean(values.META_WHATSAPP_ACCESS_TOKEN)
    && graphVersionConfigured;
  const webhookConfigured = Boolean(values.META_WHATSAPP_APP_SECRET)
    && Boolean(values.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN);
  const configured = outboundConfigured && webhookConfigured;
  const readyToSend = sendEnabled && policyApproved && approvalReferenceRecorded && configured;
  const missingRequirements: WhatsAppReadinessRequirement[] = [];

  if (!sendEnabled) missingRequirements.push("send_enabled");
  if (!policyApproved) missingRequirements.push("policy_approved");
  if (!approvalReferenceRecorded) missingRequirements.push("policy_approval_reference");
  if (!wabaConfigured) missingRequirements.push("waba_id");
  if (!phoneNumberConfigured) missingRequirements.push("phone_number_id");
  if (!values.META_WHATSAPP_ACCESS_TOKEN) missingRequirements.push("access_token");
  if (!graphVersionConfigured) missingRequirements.push("graph_version");
  if (!values.META_WHATSAPP_APP_SECRET) missingRequirements.push("app_secret");
  if (!values.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN) missingRequirements.push("webhook_verify_token");

  const state = readyToSend
    ? "ready"
    : !sendEnabled
      ? "disabled"
      : !policyApproved || !approvalReferenceRecorded
        ? "awaiting_policy_approval"
        : "configuration_incomplete";

  return Object.freeze({
    provider: "meta_whatsapp_cloud",
    configured,
    outboundConfigured,
    webhookConfigured,
    sendEnabled,
    policyApproved,
    approvalReferenceRecorded,
    readyToSend,
    state,
    missingRequirements: Object.freeze(missingRequirements),
  });
}

export function isWhatsAppSendingEnabled(): boolean {
  return getWhatsAppCloudReadiness().readyToSend;
}

export function getWhatsAppAuthenticationReadiness(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppAuthenticationReadiness {
  const sendEnabled = environmentFlag(env, "ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED");
  const policyApproved = environmentFlag(env, "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED");
  const approvalReferenceRecorded = Boolean(environmentValue(env, "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE"));
  const authenticationTemplateApproved = environmentFlag(env, "ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED");
  const wabaConfigured = hasNumericId(environmentValue(env, "META_WHATSAPP_WABA_ID"));
  const phoneNumberConfigured = hasNumericId(environmentValue(env, "META_WHATSAPP_PHONE_NUMBER_ID"));
  const accessTokenConfigured = Boolean(environmentValue(env, "META_WHATSAPP_ACCESS_TOKEN"));
  const graphVersionConfigured = hasGraphVersion(environmentValue(env, "META_WHATSAPP_GRAPH_VERSION"));
  const outboundConfigured = wabaConfigured
    && phoneNumberConfigured
    && accessTokenConfigured
    && graphVersionConfigured;
  const readyToSend = sendEnabled
    && policyApproved
    && approvalReferenceRecorded
    && authenticationTemplateApproved
    && outboundConfigured;
  const missingRequirements: WhatsAppAuthenticationReadinessRequirement[] = [];
  if (!sendEnabled) missingRequirements.push("auth_send_enabled");
  if (!policyApproved) missingRequirements.push("policy_approved");
  if (!approvalReferenceRecorded) missingRequirements.push("policy_approval_reference");
  if (!authenticationTemplateApproved) missingRequirements.push("authentication_template_approved");
  if (!wabaConfigured) missingRequirements.push("waba_id");
  if (!phoneNumberConfigured) missingRequirements.push("phone_number_id");
  if (!accessTokenConfigured) missingRequirements.push("access_token");
  if (!graphVersionConfigured) missingRequirements.push("graph_version");

  const state = readyToSend
    ? "ready"
    : !sendEnabled
      ? "disabled"
      : !policyApproved || !approvalReferenceRecorded
        ? "awaiting_policy_approval"
        : !authenticationTemplateApproved
          ? "awaiting_template_approval"
          : "configuration_incomplete";
  return Object.freeze({
    provider: "meta_whatsapp_cloud",
    outboundConfigured,
    sendEnabled,
    policyApproved,
    approvalReferenceRecorded,
    authenticationTemplateApproved,
    readyToSend,
    state,
    missingRequirements: Object.freeze(missingRequirements),
  });
}

function getReadyConfiguration(): ReadyWhatsAppConfiguration | null {
  if (!getWhatsAppCloudReadiness().readyToSend) return null;
  return Object.fromEntries(configurationKeys.map((key) => [key, environmentValue(process.env, key)])) as ReadyWhatsAppConfiguration;
}

function getReadyAuthenticationConfiguration(): ReadyWhatsAppConfiguration | null {
  if (!getWhatsAppAuthenticationReadiness().readyToSend) return null;
  return Object.fromEntries(configurationKeys.map((key) => [key, environmentValue(process.env, key)])) as ReadyWhatsAppConfiguration;
}

export function isWhatsAppEventType(value: string): value is WhatsAppEventType {
  return Object.prototype.hasOwnProperty.call(WHATSAPP_EVENT_TEMPLATES, value);
}

export function getWhatsAppTemplateDefinition(
  event: WhatsAppEventType,
  locale: WhatsAppTemplateLocale = "en",
) {
  const definition = WHATSAPP_EVENT_TEMPLATES[event];
  return {
    name: definition.name,
    languageCode: definition.languageCodes[locale],
    preview: definition.previews[locale],
  } as const;
}

export function normalizeWhatsAppE164(phone: string): string | null {
  const value = phone.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
}

export type WhatsAppTemplatePayload = Readonly<{
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: Readonly<{
    name: string;
    language: Readonly<{ code: "ar" | "en_US" }>;
  }>;
}>;

type WhatsAppAuthenticationParameter = Readonly<{
  type: "text";
  text: string;
}>;

export type WhatsAppAuthenticationTemplatePayload = Readonly<{
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: Readonly<{
    name: typeof WHATSAPP_AUTHENTICATION_TEMPLATE_NAME;
    language: Readonly<{ code: "ar" | "en_US" }>;
    components: readonly [
      Readonly<{
        type: "body";
        parameters: readonly [WhatsAppAuthenticationParameter];
      }>,
      Readonly<{
        type: "button";
        sub_type: "url";
        index: "0";
        parameters: readonly [WhatsAppAuthenticationParameter];
      }>,
    ];
  }>;
}>;

export function buildWhatsAppTemplatePayload(input: {
  to: string;
  event: WhatsAppEventType;
  locale?: WhatsAppTemplateLocale;
}): WhatsAppTemplatePayload {
  const destination = normalizeWhatsAppE164(input.to);
  if (!destination) throw new Error("Invalid WhatsApp recipient phone number.");
  if (!isWhatsAppEventType(input.event)) throw new Error("Unsupported WhatsApp notification event.");
  const definition = getWhatsAppTemplateDefinition(input.event, input.locale);
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: destination.slice(1),
    type: "template",
    template: {
      name: definition.name,
      language: { code: definition.languageCode },
    },
  };
}

export function buildWhatsAppAuthenticationTemplatePayload(input: {
  to: string;
  code: string;
  locale?: WhatsAppTemplateLocale;
}): WhatsAppAuthenticationTemplatePayload {
  const destination = normalizeWhatsAppE164(input.to);
  if (!destination) throw new Error("Invalid WhatsApp recipient phone number.");
  if (!/^\d{6}$/.test(input.code)) throw new Error("Invalid phone verification code.");
  const languageCode = input.locale === "ar" ? "ar" : "en_US";
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: destination.slice(1),
    type: "template",
    template: {
      name: WHATSAPP_AUTHENTICATION_TEMPLATE_NAME,
      language: { code: languageCode },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: input.code }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: input.code }],
        },
      ],
    },
  };
}

export type WhatsAppSendInput = {
  to: string;
  event: WhatsAppEventType;
  locale?: WhatsAppTemplateLocale;
  timeoutMs?: number;
};

export type WhatsAppAuthenticationSendInput = {
  to: string;
  code: string;
  locale?: WhatsAppTemplateLocale;
  timeoutMs?: number;
};

export type WhatsAppSendFailureReason =
  | "not_ready"
  | "invalid_recipient"
  | "invalid_event"
  | "invalid_otp"
  | "provider_rejected"
  | "invalid_response"
  | "timeout"
  | "network_error";

export type WhatsAppSendResult =
  | { ok: true; messageId: string; status: "accepted" }
  | {
    ok: false;
    retryable: boolean;
    error: string;
    reason: WhatsAppSendFailureReason;
    httpStatus?: number;
    providerCode?: string;
    providerSubcode?: string;
    retryAfterMs?: number;
  };

function providerErrorCode(payload: unknown, key: "code" | "error_subcode") {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function providerMessageId(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  const first = messages[0];
  if (!first || typeof first !== "object") return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function isTransientHttpStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

// Meta can report temporary messaging and rate-limit failures inside an HTTP
// 400 response. Authentication, template, policy, and recipient failures are
// intentionally absent so they stay terminal until an operator fixes them.
const TRANSIENT_META_PROVIDER_CODES = new Set([
  "1", "2", "4", "17", "32", "341", "80007", "130429",
  "131000", "131016", "131048", "131056",
]);

function isTransientProviderError(code?: string, subcode?: string) {
  return Boolean(
    (code && TRANSIENT_META_PROVIDER_CODES.has(code))
    || (subcode && TRANSIENT_META_PROVIDER_CODES.has(subcode)),
  );
}

function retryAfterMilliseconds(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, Math.round(seconds * 1_000));
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? Math.min(5_000, Math.max(0, at - Date.now())) : undefined;
}

type WhatsAppOutboundPayload = WhatsAppTemplatePayload | WhatsAppAuthenticationTemplatePayload;

async function sendWhatsAppPayload(input: {
  configuration: ReadyWhatsAppConfiguration;
  payload: WhatsAppOutboundPayload;
  timeoutMs?: number;
}): Promise<WhatsAppSendResult> {
  const controller = new AbortController();
  const timeoutMs = Math.max(25, Math.min(input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS, 15_000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${META_GRAPH_BASE_URL}/${encodeURIComponent(input.configuration.META_WHATSAPP_GRAPH_VERSION)}/${encodeURIComponent(input.configuration.META_WHATSAPP_PHONE_NUMBER_ID)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.configuration.META_WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.payload),
        signal: controller.signal,
      },
    );
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const providerCode = providerErrorCode(json, "code");
      const providerSubcode = providerErrorCode(json, "error_subcode");
      return {
        ok: false,
        retryable: isTransientHttpStatus(response.status)
          || isTransientProviderError(providerCode, providerSubcode),
        reason: "provider_rejected",
        httpStatus: response.status,
        providerCode,
        providerSubcode,
        retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")),
        error: `Meta WhatsApp request failed (HTTP ${response.status}${providerCode ? `, code ${providerCode}` : ""}).`,
      };
    }

    const messageId = providerMessageId(json);
    if (!messageId) {
      return {
        ok: false,
        retryable: false,
        reason: "invalid_response",
        httpStatus: response.status,
        error: "Meta WhatsApp response did not include a message ID.",
      };
    }
    return { ok: true, messageId, status: "accepted" };
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return {
      ok: false,
      retryable: true,
      reason: timedOut ? "timeout" : "network_error",
      error: timedOut ? "Meta WhatsApp request timed out." : "Meta WhatsApp network request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWhatsAppTemplate(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
  const configuration = getReadyConfiguration();
  if (!configuration) {
    return {
      ok: false,
      retryable: false,
      reason: "not_ready",
      error: "WhatsApp sending is not enabled and approved.",
    };
  }

  const destination = normalizeWhatsAppE164(input.to);
  if (!destination) {
    return {
      ok: false,
      retryable: false,
      reason: "invalid_recipient",
      error: "Invalid WhatsApp recipient phone number.",
    };
  }
  if (!isWhatsAppEventType(input.event)) {
    return {
      ok: false,
      retryable: false,
      reason: "invalid_event",
      error: "Unsupported WhatsApp notification event.",
    };
  }

  const payload = buildWhatsAppTemplatePayload({ to: destination, event: input.event, locale: input.locale });
  return sendWhatsAppPayload({ configuration, payload, timeoutMs: input.timeoutMs });
}

/**
 * Sends a user-requested phone verification code through Meta's approved
 * AUTHENTICATION template. Callers must persist a one-way code digest before
 * invoking this function and must never include the code in logs or errors.
 */
export async function sendWhatsAppAuthenticationCode(
  input: WhatsAppAuthenticationSendInput,
): Promise<WhatsAppSendResult> {
  const configuration = getReadyAuthenticationConfiguration();
  if (!configuration) {
    return {
      ok: false,
      retryable: false,
      reason: "not_ready",
      error: "WhatsApp sending is not enabled and approved.",
    };
  }

  const destination = normalizeWhatsAppE164(input.to);
  if (!destination) {
    return {
      ok: false,
      retryable: false,
      reason: "invalid_recipient",
      error: "Invalid WhatsApp recipient phone number.",
    };
  }
  if (!/^\d{6}$/.test(input.code)) {
    return {
      ok: false,
      retryable: false,
      reason: "invalid_otp",
      error: "Invalid phone verification code.",
    };
  }

  const payload = buildWhatsAppAuthenticationTemplatePayload({
    to: destination,
    code: input.code,
    locale: input.locale,
  });
  return sendWhatsAppPayload({ configuration, payload, timeoutMs: input.timeoutMs });
}

function waitForRetry(delayMs: number) {
  return delayMs > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    : Promise.resolve();
}

export async function sendWhatsAppTemplateWithRetry(
  input: WhatsAppSendInput & { maxAttempts?: number; retryDelayMs?: number },
): Promise<WhatsAppSendResult & { attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS));
  const retryDelayMs = Math.max(0, Math.min(input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, 5_000));
  let latest: WhatsAppSendResult = {
    ok: false,
    retryable: false,
    reason: "not_ready",
    error: "WhatsApp request did not run.",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = await sendWhatsAppTemplate({
      to: input.to,
      event: input.event,
      locale: input.locale,
      timeoutMs: input.timeoutMs,
    });
    if (latest.ok || !latest.retryable || attempt === maxAttempts) {
      return { ...latest, attempts: attempt };
    }
    const providerDelay = latest.ok ? undefined : latest.retryAfterMs;
    await waitForRetry(providerDelay ?? retryDelayMs * 2 ** (attempt - 1));
  }

  return { ...latest, attempts: maxAttempts };
}

export async function sendWhatsAppAuthenticationCodeWithRetry(
  input: WhatsAppAuthenticationSendInput & { maxAttempts?: 1 },
): Promise<WhatsAppSendResult & { attempts: number }> {
  // Authentication sends are deliberately single-attempt. A timeout can mean
  // Meta accepted the code even when our response was lost; automatic retry
  // could therefore deliver duplicates. The user may request a new code under
  // the route's existing rate limit.
  const maxAttempts = 1;
  let latest: WhatsAppSendResult = {
    ok: false,
    retryable: false,
    reason: "not_ready",
    error: "WhatsApp authentication request did not run.",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = await sendWhatsAppAuthenticationCode({
      to: input.to,
      code: input.code,
      locale: input.locale,
      timeoutMs: input.timeoutMs,
    });
    if (latest.ok || !latest.retryable || attempt === maxAttempts) {
      return { ...latest, attempts: attempt };
    }
  }

  return { ...latest, attempts: maxAttempts };
}

function timingSafeStringEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function validateWhatsAppWebhookVerifyToken(providedToken: string | null | undefined): boolean {
  const expectedToken = environmentValue(process.env, "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  if (!expectedToken || !providedToken) return false;
  return timingSafeStringEqual(expectedToken, providedToken);
}

export function verifyWhatsAppWebhookChallenge(input: {
  mode: string | null | undefined;
  verifyToken: string | null | undefined;
  challenge: string | null | undefined;
}): string | null {
  if (input.mode !== "subscribe" || !input.challenge) return null;
  return validateWhatsAppWebhookVerifyToken(input.verifyToken) ? input.challenge : null;
}

export function validateWhatsAppWebhookVerification(input: {
  mode: string | null | undefined;
  verifyToken: string | null | undefined;
  challenge: string | null | undefined;
}): boolean {
  return verifyWhatsAppWebhookChallenge(input) !== null;
}

export type WhatsAppSignatureInput = {
  rawBody: string | Uint8Array;
  signature: string | null | undefined;
};

export function verifyWhatsAppWebhookSignature(input: WhatsAppSignatureInput): boolean;
export function verifyWhatsAppWebhookSignature(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
): boolean;
export function verifyWhatsAppWebhookSignature(
  inputOrRawBody: WhatsAppSignatureInput | string | Uint8Array,
  providedSignature?: string | null,
): boolean {
  const input: WhatsAppSignatureInput = typeof inputOrRawBody === "object"
    && !(inputOrRawBody instanceof Uint8Array)
    && "rawBody" in inputOrRawBody
    ? inputOrRawBody
    : { rawBody: inputOrRawBody as string | Uint8Array, signature: providedSignature };
  const appSecret = environmentValue(process.env, "META_WHATSAPP_APP_SECRET");
  if (!appSecret || !input.signature) return false;
  const match = /^sha256=([a-f\d]{64})$/i.exec(input.signature.trim());
  if (!match) return false;

  const expected = createHmac("sha256", appSecret).update(input.rawBody).digest();
  const provided = Buffer.from(match[1], "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function validateWhatsAppWebhookSignature(input: WhatsAppSignatureInput): boolean {
  return verifyWhatsAppWebhookSignature(input);
}

export type WhatsAppDeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type WhatsAppDeliveryStatusUpdate = Readonly<{
  messageId: string;
  status: WhatsAppDeliveryStatus;
  timestamp?: string;
  occurredAt?: string;
  failureCode?: string;
}>;

export type WhatsAppInboundOptOut = Readonly<{
  messageId: string;
  senderPhone: string;
  timestamp?: string;
  occurredAt?: string;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoFromUnixSeconds(timestamp: string | null) {
  if (!timestamp || !/^\d+$/.test(timestamp)) return undefined;
  const milliseconds = Number(timestamp) * 1_000;
  if (!Number.isFinite(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function webhookMessageChanges(payload: unknown) {
  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return [];
  const configuredWabaId = environmentValue(process.env, "META_WHATSAPP_WABA_ID");
  const configuredPhoneNumberId = environmentValue(process.env, "META_WHATSAPP_PHONE_NUMBER_ID");
  if (!configuredWabaId || !configuredPhoneNumberId) return [];
  const changes: Record<string, unknown>[] = [];
  for (const entryValue of root.entry) {
    const entry = asRecord(entryValue);
    if (!entry || !Array.isArray(entry.changes)) continue;
    if (nonEmptyString(entry.id) !== configuredWabaId) continue;
    for (const changeValue of entry.changes) {
      const change = asRecord(changeValue);
      if (!change || change.field !== "messages") continue;
      const value = asRecord(change.value);
      if (!value) continue;
      const metadata = asRecord(value.metadata);
      if (nonEmptyString(metadata?.phone_number_id) !== configuredPhoneNumberId) continue;
      changes.push(value);
    }
  }
  return changes;
}

function normalizeDeliveryStatus(value: unknown): WhatsAppDeliveryStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "sent" || normalized === "delivered" || normalized === "read" || normalized === "failed"
    ? normalized
    : null;
}

export function parseWhatsAppDeliveryStatuses(payload: unknown): WhatsAppDeliveryStatusUpdate[] {
  const updates: WhatsAppDeliveryStatusUpdate[] = [];
  for (const value of webhookMessageChanges(payload)) {
    if (!Array.isArray(value.statuses)) continue;
    for (const statusValue of value.statuses) {
      const statusRecord = asRecord(statusValue);
      if (!statusRecord) continue;
      const messageId = nonEmptyString(statusRecord.id);
      const status = normalizeDeliveryStatus(statusRecord.status);
      if (!messageId || !status) continue;
      const timestamp = nonEmptyString(statusRecord.timestamp) ?? undefined;
      const firstError = Array.isArray(statusRecord.errors) ? asRecord(statusRecord.errors[0]) : null;
      const rawFailureCode = firstError?.code;
      const failureCode = typeof rawFailureCode === "string" || typeof rawFailureCode === "number"
        ? String(rawFailureCode)
        : undefined;
      updates.push({
        messageId,
        status,
        timestamp,
        occurredAt: isoFromUnixSeconds(timestamp ?? null),
        failureCode,
      });
    }
  }
  return updates;
}

function normalizedOptOutCommand(text: string) {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.!?,:;،؛؟]+|[\s.!?,:;،؛؟]+$/g, "");
}

const optOutCommands = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "opt out",
  "stop messages",
  "توقف",
  "ايقاف",
  "قف",
  "الغاء",
  "الغاء الاشتراك",
  "وقف الرسائل",
  "لا اريد رسائل",
  "הסר",
  "הסרה",
  "הפסק",
  "הפסק הודעות",
  "ביטול",
]);

export function isWhatsAppOptOutText(text: string): boolean {
  return optOutCommands.has(normalizedOptOutCommand(text));
}

function inboundMessageText(message: Record<string, unknown>) {
  const text = asRecord(message.text);
  const body = nonEmptyString(text?.body);
  if (body) return body;
  const button = asRecord(message.button);
  const buttonText = nonEmptyString(button?.text) ?? nonEmptyString(button?.payload);
  if (buttonText) return buttonText;
  const interactive = asRecord(message.interactive);
  const buttonReply = asRecord(interactive?.button_reply);
  return nonEmptyString(buttonReply?.title) ?? nonEmptyString(buttonReply?.id);
}

function normalizeWebhookSender(value: unknown) {
  const sender = nonEmptyString(value);
  if (!sender) return null;
  return normalizeWhatsAppE164(sender.startsWith("+") ? sender : `+${sender}`);
}

export function parseWhatsAppInboundOptOuts(payload: unknown): WhatsAppInboundOptOut[] {
  const optOuts: WhatsAppInboundOptOut[] = [];
  const seenMessageIds = new Set<string>();
  for (const value of webhookMessageChanges(payload)) {
    if (!Array.isArray(value.messages)) continue;
    for (const messageValue of value.messages) {
      const message = asRecord(messageValue);
      if (!message) continue;
      const messageId = nonEmptyString(message.id);
      const senderPhone = normalizeWebhookSender(message.from);
      const text = inboundMessageText(message);
      if (!messageId || seenMessageIds.has(messageId) || !senderPhone || !text || !isWhatsAppOptOutText(text)) continue;
      seenMessageIds.add(messageId);
      const timestamp = nonEmptyString(message.timestamp) ?? undefined;
      optOuts.push({
        messageId,
        senderPhone,
        timestamp,
        occurredAt: isoFromUnixSeconds(timestamp ?? null),
      });
    }
  }
  return optOuts;
}

export function parseWhatsAppWebhook(payload: unknown) {
  return {
    deliveryStatuses: parseWhatsAppDeliveryStatuses(payload),
    optOuts: parseWhatsAppInboundOptOuts(payload),
  };
}
