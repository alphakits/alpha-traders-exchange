import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";
import { logEvent } from "@/lib/structured-logging";

export type SmsProvider = {
  sendOtp: (input: { phone: string }) => Promise<{ ok: true }>;
  verifyOtp: (input: { phone: string; token: string }) => Promise<{ ok: true }>;
};

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

function toUserFacingOtpError(raw: string): string {
  for (const msg of USER_FACING_OTP_ERRORS) {
    if (raw.toLowerCase().includes(msg.toLowerCase())) return msg;
  }
  // "Signups not allowed for otp" and other provider/config errors must never reach end users
  if (/signups not allowed|provider disabled|sms.*not.*enabled|not configured/i.test(raw)) {
    return "Phone verification is temporarily unavailable. Please try again later or contact support.";
  }
  if (/rate.?limit|too many/i.test(raw)) {
    return "Too many verification requests. Please wait a few minutes before trying again.";
  }
  if (/invalid.*phone|phone.*invalid/i.test(raw)) {
    return "Please enter a valid phone number.";
  }
  return "Failed to send verification code. Please try again.";
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
        logEvent("warn", { event: "sms_otp_send_error", outcome: "failed", reason: error.message });
        throw new Error(toUserFacingOtpError(error.message));
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
        logEvent("warn", { event: "sms_otp_verify_error", outcome: "failed", reason: error.message });
        throw new Error(toUserFacingOtpError(error.message));
      }
      return { ok: true };
    },
  };
}

export function getSmsProvider(): SmsProvider {
  return createSupabaseSmsProvider();
}
