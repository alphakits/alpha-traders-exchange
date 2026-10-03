import "server-only";

import {
  getBilingualOtpSms,
  getTwilioSmsSender,
  isTwilioOtpSendEnabled,
  normalizeE164,
  sendTwilioMessageWithRetry,
} from "@/lib/notification-platform";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { logEvent } from "@/lib/structured-logging";
import { normalizeIsraeliPhone } from "@/lib/phone-number-normalization";
import type { PhoneVerificationChannel, PhoneVerificationChannels } from "@/lib/phone-verification-channel";
export type { PhoneVerificationChannel } from "@/lib/phone-verification-channel";

export type PhoneVerificationProvider = "disabled" | "twilio" | "whatsapp";
export type PhoneVerificationSupportCode =
  | "OTP_PROVIDER_CONFIGURATION"
  | "OTP_PHONE_INVALID"
  | "OTP_PROVIDER_DELIVERY";

export type PhoneVerificationDeliveryResult =
  | {
    ok: true;
    provider: PhoneVerificationProvider;
    channel: PhoneVerificationChannel;
  }
  | {
    ok: false;
    provider?: PhoneVerificationProvider;
    retryable: boolean;
    error: string;
    supportCode: PhoneVerificationSupportCode;
  };

export function getPhoneVerificationProvider(
  env: NodeJS.ProcessEnv = process.env,
): PhoneVerificationProvider | null {
  if (!isMarketplacePhoneVerificationEnabled(env)) return "disabled";
  const configured = env.ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER?.trim().toLowerCase();
  if (!configured || configured === "disabled") return "disabled";
  if (configured === "whatsapp") return "disabled";
  if (configured === "twilio") return isTwilioOtpSendEnabled(env) ? "twilio" : "disabled";
  return null;
}

function twilioIsConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID?.trim()
    && env.TWILIO_AUTH_TOKEN?.trim()
    && getTwilioSmsSender(env),
  );
}

export function getPhoneVerificationChannels(env: NodeJS.ProcessEnv = process.env): PhoneVerificationChannels {
  const provider = env.ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER?.trim().toLowerCase();
  if (!isMarketplacePhoneVerificationEnabled(env) || provider !== "twilio") return { sms: false, whatsapp: false };
  return { sms: isTwilioOtpSendEnabled(env) && twilioIsConfigured(env), whatsapp: false };
}

export function phoneVerificationDeliveryPreflight(phone: string, channel?: PhoneVerificationChannel): Extract<PhoneVerificationDeliveryResult, { ok: false }> | null {
  const selected = channel ?? "sms";
  const provider = selected === "whatsapp" ? "whatsapp" : "twilio";
  if (!getPhoneVerificationChannels()[selected]) return unavailable(provider);
  const normalized = normalizeIsraeliPhone(phone) ?? normalizeE164(phone);
  const sender = selected === "sms" ? getTwilioSmsSender() : null;
  const sameSmsSender = sender && "From" in sender && normalized === sender.From;
  if (normalized && sameSmsSender) return unavailable(provider);
  return null;
}

function unavailable(provider?: PhoneVerificationProvider): Extract<PhoneVerificationDeliveryResult, { ok: false }> {
  return {
    ok: false,
    provider,
    retryable: false,
    supportCode: "OTP_PROVIDER_CONFIGURATION",
    error: "Phone verification delivery is temporarily unavailable.",
  };
}

/**
 * SMS is the only available verification transport. WhatsApp requests fail
 * before a provider call, including requests from older app clients.
 */
export async function sendPhoneVerificationCode(input: {
  phone: string;
  code: string;
  locale?: "en" | "ar";
  channel?: PhoneVerificationChannel;
}): Promise<PhoneVerificationDeliveryResult> {
  const phone = normalizeE164(input.phone);
  if (!phone) {
    return {
      ok: false,
      retryable: false,
      supportCode: "OTP_PHONE_INVALID",
      error: "Enter a valid international phone number.",
    };
  }
  if (!/^\d{6}$/.test(input.code)) return unavailable();

  const configuredProvider = getPhoneVerificationProvider();
  if (!input.channel && (!configuredProvider || configuredProvider === "disabled")) return unavailable(configuredProvider ?? undefined);
  const provider = input.channel ? (input.channel === "sms" ? "twilio" : "whatsapp") : configuredProvider!;
  const preflight = phoneVerificationDeliveryPreflight(phone, input.channel);
  if (preflight) return preflight;

  if (!twilioIsConfigured()) return unavailable(provider);
  const result = await sendTwilioMessageWithRetry({
    to: phone,
    body: getBilingualOtpSms(input.code),
    purpose: "verification",
    // A timeout may happen after Twilio accepted the message. Resend only on
    // the user's explicit request, avoiding duplicate SMS charges and codes.
    maxAttempts: 1,
  });
  if (result.ok) return { ok: true, provider, channel: "sms" };
  logEvent("warn", {
    event: "phone_verification_delivery_failed",
    outcome: "failed",
    reason: "Twilio verification message rejected or unavailable",
    metadata: {
      provider: "twilio",
      httpStatus: result.httpStatus ?? null,
      providerErrorNumber: /^\d{1,6}$/.test(result.providerCode ?? "") ? Number(result.providerCode) : null,
      attempts: result.attempts,
      retryable: result.retryable,
    },
  });
  return {
    ok: false,
    provider,
    retryable: result.retryable,
    supportCode: result.providerCode === "21266" ? "OTP_PROVIDER_CONFIGURATION" : "OTP_PROVIDER_DELIVERY",
    error: result.providerCode === "21266" ? "SMS verification is temporarily unavailable. Please contact support." : "The verification code could not be delivered. Please try again.",
  };
}
