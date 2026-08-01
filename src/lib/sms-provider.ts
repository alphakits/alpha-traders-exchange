import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";
import { logEvent } from "@/lib/structured-logging";

export type SmsProvider = {
  sendOtp: (input: { phone: string }) => Promise<{ ok: true }>;
  verifyOtp: (input: { phone: string; token: string }) => Promise<{ ok: true }>;
};

export type OtpSupportCode =
  | "OTP_PROVIDER_CONFIGURATION"
  | "OTP_PROVIDER_RATE_LIMIT"
  | "OTP_PHONE_INVALID"
  | "OTP_PROVIDER_DELIVERY"
  | "OTP_PROVIDER_UNKNOWN";

export class OtpProviderError extends Error {
  public supportCode: OtpSupportCode;
  public stage: "send" | "verify";
  public provider: "supabase-auth";
  public rawMessage: string;
  public rawCode?: string;
  public rawStatus?: number;

  constructor(input: {
    message: string;
    supportCode: OtpSupportCode;
    stage: "send" | "verify";
    rawMessage: string;
    rawCode?: string;
    rawStatus?: number;
  }) {
    super(input.message);
    this.name = "OtpProviderError";
    this.supportCode = input.supportCode;
    this.stage = input.stage;
    this.provider = "supabase-auth";
    this.rawMessage = input.rawMessage;
    this.rawCode = input.rawCode;
    this.rawStatus = input.rawStatus;
  }
}

// Supabase error messages that should be shown verbatim (they are actionable by the user)
const USER_FACING_OTP_ERRORS = new Set([
  "Invalid phone number format",
  "Phone number already confirmed",
  "Verification code expired. Please request a new code.",
  "Invalid OTP",
  "Token has expired or is invalid",
  "Otp expired",
  "Invalid token",
]);

function classifyOtpError(raw: string): OtpSupportCode {
  const normalized = raw.toLowerCase();
  if (/signups not allowed|provider disabled|sms.*not.*enabled|not configured|twilio|messaging service|verify service|compliance profile|trust hub|kyc|20003/i.test(normalized)) {
    return "OTP_PROVIDER_CONFIGURATION";
  }
  if (/rate.?limit|too many/i.test(normalized)) {
    return "OTP_PROVIDER_RATE_LIMIT";
  }
  if (/invalid.*phone|phone.*invalid|phone number/i.test(normalized)) {
    return "OTP_PHONE_INVALID";
  }
  if (/error sending confirmation sms|delivery|carrier|queued|failed to send sms/i.test(normalized)) {
    return "OTP_PROVIDER_DELIVERY";
  }
  return "OTP_PROVIDER_UNKNOWN";
}

function toUserFacingOtpError(raw: string): string {
  for (const msg of USER_FACING_OTP_ERRORS) {
    if (raw.toLowerCase().includes(msg.toLowerCase())) return msg;
  }
  // "Signups not allowed for otp" and other provider/config errors must never reach end users
  if (/signups not allowed|provider disabled|sms.*not.*enabled|not configured|compliance profile|trust hub|kyc|20003/i.test(raw)) {
    return "Phone verification is temporarily unavailable. Please try again later or contact support.";
  }
  if (/rate.?limit|too many/i.test(raw)) {
    return "Too many verification requests. Please wait a few minutes before trying again.";
  }
  if (/invalid.*phone|phone.*invalid/i.test(raw)) {
    return "Please enter a valid phone number.";
  }
  if (/error sending confirmation sms|delivery|carrier|queued|failed to send sms/i.test(raw)) {
    return "We couldn't deliver the SMS right now. Please try again in a moment.";
  }
  return "Phone verification is temporarily unavailable. Please try again later.";
}

function runtimeOtpDiagnostics() {
  return {
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasTwilioAccountSid: Boolean(process.env.TWILIO_ACCOUNT_SID),
    hasTwilioAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    hasTwilioMessagingServiceSid: Boolean(process.env.TWILIO_MESSAGING_SERVICE_SID),
    hasTwilioVerifyServiceSid: Boolean(process.env.TWILIO_VERIFY_SERVICE_SID),
  };
}

function createSupabaseSmsProvider(): SmsProvider {
  const supabase = createSupabaseAuthClient();
  return {
    async sendOtp(input) {
      const { error } = await supabase.auth.signInWithOtp({
        phone: input.phone,
        options: {
          // shouldCreateUser: true — we use Supabase only for SMS delivery.
          // The app manages its own user accounts; this creates a lightweight
          // Supabase Auth record as a side effect, which is acceptable.
          shouldCreateUser: true,
        },
      });
      if (error) {
        const supportCode = classifyOtpError(error.message);
        logEvent("error", {
          event: "sms_otp_send_error",
          outcome: "failed",
          reason: error.message,
          metadata: {
            supportCode,
            stage: "send",
            provider: "supabase-auth",
            rawCode: (error as { code?: string }).code ?? null,
            rawStatus: (error as { status?: number }).status ?? null,
            phonePrefix: input.phone.startsWith("+972") ? "+972" : "other",
            phoneLength: input.phone.length,
            diagnostics: runtimeOtpDiagnostics(),
          },
        });
        throw new OtpProviderError({
          message: toUserFacingOtpError(error.message),
          supportCode,
          stage: "send",
          rawMessage: error.message,
          rawCode: (error as { code?: string }).code,
          rawStatus: (error as { status?: number }).status,
        });
      }
      return { ok: true };
    },
    async verifyOtp(input) {
      const { error } = await supabase.auth.verifyOtp({
        phone: input.phone,
        token: input.token,
        type: "sms",
      });
      if (error) {
        const supportCode = classifyOtpError(error.message);
        logEvent("error", {
          event: "sms_otp_verify_error",
          outcome: "failed",
          reason: error.message,
          metadata: {
            supportCode,
            stage: "verify",
            provider: "supabase-auth",
            rawCode: (error as { code?: string }).code ?? null,
            rawStatus: (error as { status?: number }).status ?? null,
            phonePrefix: input.phone.startsWith("+972") ? "+972" : "other",
            phoneLength: input.phone.length,
          },
        });
        throw new OtpProviderError({
          message: toUserFacingOtpError(error.message),
          supportCode,
          stage: "verify",
          rawMessage: error.message,
          rawCode: (error as { code?: string }).code,
          rawStatus: (error as { status?: number }).status,
        });
      }
      return { ok: true };
    },
  };
}

export function getSmsProvider(): SmsProvider {
  return createSupabaseSmsProvider();
}
