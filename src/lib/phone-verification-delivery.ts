import "server-only";

import {
  getBilingualOtpSms,
  isTwilioSendEnabled,
  normalizeE164,
  sendTwilioMessageWithRetry,
} from "@/lib/notification-platform";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import {
  getWhatsAppAuthenticationReadiness,
  sendWhatsAppAuthenticationCodeWithRetry,
  type WhatsAppTemplateLocale,
} from "@/lib/whatsapp-platform";

export type PhoneVerificationProvider = "disabled" | "twilio" | "whatsapp";
export type PhoneVerificationChannel = "sms" | "whatsapp";
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
  if (configured === "whatsapp") return "whatsapp";
  if (configured === "twilio") return isTwilioSendEnabled(env) ? "twilio" : "disabled";
  return null;
}

function twilioIsConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID?.trim()
    && env.TWILIO_AUTH_TOKEN?.trim()
    && normalizeE164(env.TWILIO_PHONE_NUMBER ?? ""),
  );
}

function unavailable(provider?: PhoneVerificationProvider): PhoneVerificationDeliveryResult {
  return {
    ok: false,
    provider,
    retryable: false,
    supportCode: "OTP_PROVIDER_CONFIGURATION",
    error: "Phone verification delivery is temporarily unavailable.",
  };
}

/**
 * Selects one configured transport for a code that was already persisted as a
 * one-way digest. A failed or ambiguous provider call is never retried through
 * the other transport, preventing duplicate codes across channels.
 */
export async function sendPhoneVerificationCode(input: {
  phone: string;
  code: string;
  locale?: WhatsAppTemplateLocale;
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

  const provider = getPhoneVerificationProvider();
  if (!provider || provider === "disabled") return unavailable(provider ?? undefined);

  if (provider === "whatsapp") {
    if (!getWhatsAppAuthenticationReadiness().readyToSend) return unavailable(provider);
    const result = await sendWhatsAppAuthenticationCodeWithRetry({
      to: phone,
      code: input.code,
      locale: input.locale,
      maxAttempts: 1,
    });
    if (result.ok) return { ok: true, provider, channel: "whatsapp" };
    return {
      ok: false,
      provider,
      retryable: result.retryable,
      supportCode: result.reason === "not_ready"
        ? "OTP_PROVIDER_CONFIGURATION"
        : result.reason === "invalid_recipient"
          ? "OTP_PHONE_INVALID"
          : "OTP_PROVIDER_DELIVERY",
      error: result.reason === "invalid_recipient"
        ? "Enter a valid international phone number."
        : result.reason === "not_ready"
          ? "Phone verification delivery is temporarily unavailable."
          : "The verification code could not be delivered. Please try again.",
    };
  }

  if (!twilioIsConfigured()) return unavailable(provider);
  const result = await sendTwilioMessageWithRetry({
    to: phone,
    body: getBilingualOtpSms(input.code),
  });
  if (result.ok) return { ok: true, provider, channel: "sms" };
  return {
    ok: false,
    provider,
    retryable: result.retryable,
    supportCode: "OTP_PROVIDER_DELIVERY",
    error: "The verification code could not be delivered. Please try again.",
  };
}
