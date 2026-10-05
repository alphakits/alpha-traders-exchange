import { allowsTestOnlyRuntime } from "@/lib/runtime-safety";
import { isAccountPhoneVerificationExempt } from "@/lib/phone-verification-exemptions";

function parseBypassEmails(raw: string | undefined) {
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export function isPhotoVerificationBypassed(email: string | null | undefined) {
  if (!allowsTestOnlyRuntime()) return false;
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const bypassEmails = parseBypassEmails(process.env.PHOTO_VERIFICATION_BYPASS_EMAILS);
  return bypassEmails.has(normalizedEmail);
}

type VerificationState = {
  id?: string | null;
  disabled?: boolean;
  email?: string | null;
  verifiedPhone?: string | null;
  phoneVerifiedAt?: string | null;
};

/** Public verification claims require actual OTP evidence, never an access exemption. */
export function hasVerifiedPhone(user: VerificationState | null | undefined) {
  if (!user || user.disabled === true) return false;
  return Boolean(
    /^\+[1-9]\d{7,14}$/.test(user.verifiedPhone ?? "")
    && user.phoneVerifiedAt
    && Number.isFinite(Date.parse(user.phoneVerifiedAt)),
  );
}

export function isVerified(user: VerificationState | null | undefined) {
  if (!user || user.disabled === true) return false;
  if (isAccountPhoneVerificationExempt(user)) return true;
  if (isPhotoVerificationBypassed(user.email)) return true;
  return hasVerifiedPhone(user);
}
