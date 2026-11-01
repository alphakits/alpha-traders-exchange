import "server-only";

import { normalizeE164 } from "@/lib/notification-platform";
import { getSiteUrl } from "@/lib/site-url";
import type { WhatsAppSendResult, WhatsAppTemplateLocale } from "@/lib/whatsapp-platform";

function contentSid(name: string, locale: WhatsAppTemplateLocale, env: NodeJS.ProcessEnv) {
  try {
    const templates: unknown = JSON.parse(env.TWILIO_WHATSAPP_CONTENT_SIDS ?? "{}");
    if (!templates || typeof templates !== "object" || Array.isArray(templates)) return null;
    const template = (templates as Record<string, unknown>)[name];
    if (!template || typeof template !== "object" || Array.isArray(template)) return null;
    const sid = (template as Record<string, unknown>)[locale];
    return typeof sid === "string" && /^HX[0-9a-f]{32}$/i.test(sid) ? sid : null;
  } catch { return null; }
}

export function getTwilioWhatsAppSender(env: NodeJS.ProcessEnv = process.env) {
  return normalizeE164((env.TWILIO_WHATSAPP_FROM ?? "").replace(/^whatsapp:/, ""));
}

export function getTwilioWhatsAppConfigurationStatus(env: NodeJS.ProcessEnv, templateNames: readonly string[]) {
  return {
    credentialsConfigured: /^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID?.trim() ?? "") && Boolean(env.TWILIO_AUTH_TOKEN?.trim()),
    senderConfigured: Boolean(getTwilioWhatsAppSender(env)),
    templatesConfigured: templateNames.every(name => Boolean(contentSid(name, "en", env) && contentSid(name, "ar", env))),
  };
}

export async function sendTwilioWhatsAppTemplate(input: {
  to: string;
  templateName: string;
  locale?: WhatsAppTemplateLocale;
  code?: string;
  timeoutMs?: number;
}): Promise<WhatsAppSendResult> {
  const env = process.env;
  const flag = (key: string) => env[key]?.trim().toLowerCase() === "true";
  const authentication = input.code !== undefined;
  const config = getTwilioWhatsAppConfigurationStatus(env, [input.templateName]);
  const ready = env.ALPHA_EXCHANGE_WHATSAPP_PROVIDER?.trim().toLowerCase() === "twilio"
    && flag(authentication ? "ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED" : "ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED")
    && flag("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED")
    && Boolean(env.ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE?.trim())
    && (!authentication || flag("ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED"))
    && config.credentialsConfigured && config.senderConfigured && config.templatesConfigured;
  const from = getTwilioWhatsAppSender(env);
  const to = normalizeE164(input.to);
  if (!ready || !from || from === to) return { ok: false, retryable: false, reason: "not_ready", error: "WhatsApp delivery is not configured for this number." };
  if (!to) return { ok: false, retryable: false, reason: "invalid_recipient", error: "Enter a valid international phone number." };
  if (authentication && !/^\d{6}$/.test(input.code ?? "")) return { ok: false, retryable: false, reason: "invalid_otp", error: "Invalid verification code." };
  const sid = contentSid(input.templateName, input.locale ?? "en", env)!;
  const payload = new URLSearchParams({
    To: `whatsapp:${to}`, From: `whatsapp:${from}`, ContentSid: sid,
    StatusCallback: new URL("/api/twilio/whatsapp/webhook", getSiteUrl()).toString(),
  });
  if (authentication) payload.set("ContentVariables", JSON.stringify({ "1": input.code }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(250, Math.min(input.timeoutMs ?? 5_000, 5_000)));
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!.trim())}/Messages.json`, {
      method: "POST", headers: {
        Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID!.trim()}:${env.TWILIO_AUTH_TOKEN!.trim()}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      }, body: payload, signal: controller.signal,
    });
    const json = await response.json().catch(() => ({})) as { sid?: string; status?: string; code?: number };
    if (!response.ok || ["failed", "undelivered", "canceled"].includes(json.status ?? "")) return {
      ok: false, retryable: response.status === 429 || response.status >= 500,
      reason: "provider_rejected", httpStatus: response.status,
      providerCode: typeof json.code === "number" ? String(json.code) : undefined,
      error: "WhatsApp provider rejected the message.",
    };
    if (!/^SM[0-9a-f]{32}$/i.test(json.sid ?? "")) return { ok: false, retryable: false, reason: "invalid_response", error: "WhatsApp provider response was incomplete." };
    return { ok: true, messageId: json.sid!, status: "accepted" };
  } catch {
    return { ok: false, retryable: true, reason: controller.signal.aborted ? "timeout" : "network_error", error: "WhatsApp delivery could not be confirmed." };
  } finally { clearTimeout(timeout); }
}
