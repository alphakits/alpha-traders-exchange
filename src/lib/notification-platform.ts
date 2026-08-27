import { createHmac, timingSafeEqual } from "crypto";
import type { SmsDeliveryStatus, SmsEventType } from "@/types/alpha-exchange";
import { getSiteUrl } from "@/lib/site-url";

const TWILIO_MESSAGES_URL = "https://api.twilio.com/2010-04-01/Accounts";
const transientStatus = new Set([429, 500, 502, 503, 504]);
const DEFAULT_FETCH_TIMEOUT_MS = 2_000;
const DEFAULT_RETRY_DELAY_MS = 150;

export function normalizeE164(phone: string): string | null {
  const value = phone.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
}

export function maskPhone(phone: string): string {
  if (phone.length < 5) return "••••";
  return `${phone.slice(0, 3)}•••${phone.slice(-2)}`;
}

export function getSmsTemplate(event: SmsEventType, destination?: string): string {
  const templates: Record<SmsEventType, { ar: string; en: string }> = {
    seller_application_submitted: {
      ar: "طلب الانضمام كبائع بانتظار المراجعة.",
      en: "Seller application needs review.",
    },
    trade_requires_admin_review: {
      ar: "الصفقة بحاجة إلى مراجعة الإدارة.",
      en: "Trade needs admin review.",
    },
    purchase_request_created: {
      ar: "لديك طلب شراء جديد.",
      en: "New purchase request.",
    },
    trade_accepted: {
      ar: "وافق البائع على صفقتك.",
      en: "Seller accepted your trade.",
    },
    payment_sent: {
      ar: "تم تحديد الدفع كمُرسل. تحقّق من استلام الأموال.",
      en: "Payment marked sent. Verify funds.",
    },
    funds_received: {
      ar: "تم تأكيد استلام الأموال.",
      en: "Funds confirmed received.",
    },
    usdt_sent: {
      ar: "تم إرسال USDT. أكّد الاستلام.",
      en: "USDT sent. Confirm receipt.",
    },
    trade_completed: {
      ar: "اكتملت الصفقة.",
      en: "Trade completed.",
    },
  };
  const template = templates[event];
  return ["Alpha Traders", template.ar, template.en, destination].filter(Boolean).join("\n");
}

export function getBilingualOtpSms(code: string): string {
  return [
    "Alpha Traders",
    `رمز التحقق / Verification code: ${code}`,
    "صالح لمدة 10 دقائق / Expires in 10 minutes.",
  ].join("\n");
}

function normalizeOutgoingSmsBody(body: string) {
  const legacyOtp = body.match(/^Alpha Traders verification code: (\d{6})\. Expires in 10 minutes\.$/);
  return legacyOtp ? getBilingualOtpSms(legacyOtp[1]) : body;
}

export function isSmsLifecycleEvent(value: string): value is SmsEventType {
  return [
    "seller_application_submitted", "trade_requires_admin_review", "purchase_request_created",
    "trade_accepted", "payment_sent", "funds_received", "usdt_sent", "trade_completed",
  ].includes(value);
}

export type TwilioSendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; retryable: boolean; error: string; httpStatus?: number; providerCode?: string; providerStatus?: string };

type TwilioSendInput = {
  to: string;
  body: string;
  statusCallback?: string;
  timeoutMs?: number;
};

export async function sendTwilioMessage(input: TwilioSendInput): Promise<TwilioSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = normalizeE164(process.env.TWILIO_PHONE_NUMBER ?? "");
  if (!sid || !token || !from) return { ok: false, retryable: false, error: "Twilio SMS is not configured." };
  const destination = normalizeE164(input.to);
  if (!destination) return { ok: false, retryable: false, error: "Invalid recipient phone number." };
  const payload = new URLSearchParams({ To: destination, From: from, Body: normalizeOutgoingSmsBody(input.body) });
  if (input.statusCallback) payload.set("StatusCallback", input.statusCallback);
  const controller = new AbortController();
  const timeoutMs = Math.max(250, Math.min(input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS, 5_000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TWILIO_MESSAGES_URL}/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({})) as { sid?: string; status?: number | string; code?: number | string };
    if (!response.ok || !json.sid) {
      const providerCode = json.code === undefined ? undefined : String(json.code);
      const providerStatus = json.status === undefined ? undefined : String(json.status);
      return {
        ok: false,
        retryable: transientStatus.has(response.status),
        httpStatus: response.status,
        providerCode,
        providerStatus,
        error: `Twilio request failed (HTTP ${response.status}${providerCode ? `, code ${providerCode}` : ""}).`,
      };
    }
    return { ok: true, sid: json.sid, status: typeof json.status === "string" ? json.status : "queued" };
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return { ok: false, retryable: true, error: timedOut ? "Twilio request timed out." : "Twilio network request failed." };
  } finally {
    clearTimeout(timeout);
  }
}

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function sendTwilioMessageWithRetry(
  input: TwilioSendInput & { maxAttempts?: number; retryDelayMs?: number },
): Promise<TwilioSendResult & { attempts: number }> {
  const attempts = Math.max(1, Math.min(input.maxAttempts ?? 2, 2));
  const retryDelayMs = Math.max(25, Math.min(input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, 500));
  let latest: TwilioSendResult = { ok: false, retryable: false, error: "Twilio request did not run." };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    latest = await sendTwilioMessage(input);
    if (latest.ok || !latest.retryable || attempt === attempts) return { ...latest, attempts: attempt };
    await waitForRetry(retryDelayMs * 2 ** (attempt - 1));
  }
  return { ...latest, attempts };
}

export function twilioStatusCallbackUrl(deliveryId?: string): string {
  const url = new URL("/api/twilio/status", getSiteUrl());
  if (deliveryId) url.searchParams.set("deliveryId", deliveryId);
  return url.toString();
}

export function mapTwilioStatus(status: string): SmsDeliveryStatus | null {
  const normalized = status.toLowerCase();
  if (["queued"].includes(normalized)) return "queued";
  if (["accepted", "sending", "sent"].includes(normalized)) return "sent";
  if (normalized === "delivered") return "delivered";
  if (["failed", "undelivered", "canceled"].includes(normalized)) return "failed";
  return null;
}

const terminalSmsStatuses = new Set<SmsDeliveryStatus>(["delivered", "failed"]);
const smsStatusRank: Record<SmsDeliveryStatus, number> = { queued: 0, sent: 1, delivered: 2, failed: 2 };

export function resolveSmsDeliveryStatusTransition(
  current: SmsDeliveryStatus,
  incoming: SmsDeliveryStatus,
): SmsDeliveryStatus {
  if (terminalSmsStatuses.has(current)) return current;
  return smsStatusRank[incoming] >= smsStatusRank[current] ? incoming : current;
}

export function validateTwilioSignature(input: { signature: string | null; url: string; params: Record<string, string> }): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !input.signature) return false;
  const signed = input.url + Object.keys(input.params).sort().map(key => `${key}${input.params[key]}`).join("");
  const expected = createHmac("sha1", token).update(signed).digest("base64");
  const provided = Buffer.from(input.signature);
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

export function createNotificationPlatform() {
  return { sendTwilioMessageWithRetry, getSmsTemplate, twilioStatusCallbackUrl };
}
