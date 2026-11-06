import "server-only";

import { isVerified } from "@/lib/verification-bypass";

type RecoveryAccount = {
  id: string;
  disabled?: boolean;
  email?: string;
  verifiedPhone?: string;
  phoneVerifiedAt?: string;
  phoneOtpPhone?: string;
  phoneOtpChannel?: "sms" | "whatsapp";
  phoneOtpHash?: string;
  phoneOtpSalt?: string;
  phoneOtpExpiresAt?: string;
  phoneOtpRequestedAt?: string;
  phoneOtpAttempts?: number;
};

/** Private, current-account display metadata. Never includes the code or its digest. */
export type PhoneVerificationRecovery = {
  accountId: string;
  observedAt: string;
  pendingChallenge: { phone: string; expiresAt: string } | null;
  resendAvailableAt: string | null;
};

/** Resume an existing challenge without sending a new message or granting access. */
export function getPhoneVerificationRecovery(
  user: RecoveryAccount | null | undefined,
  nowMs = Date.now(),
): PhoneVerificationRecovery | null {
  if (!user?.id || user.disabled === true || isVerified(user) || !Number.isFinite(nowMs)) return null;
  const requestedAt = Date.parse(user.phoneOtpRequestedAt ?? "");
  if (!Number.isFinite(requestedAt) || requestedAt <= 0 || requestedAt > nowMs) return null;

  const expiresAt = Date.parse(user.phoneOtpExpiresAt ?? "");
  const attempts = user.phoneOtpAttempts ?? 0;
  const usableChallenge = user.phoneOtpChannel === "sms"
    && /^\+[1-9]\d{7,14}$/.test(user.phoneOtpPhone ?? "")
    && /^[a-f0-9]{64}$/i.test(user.phoneOtpHash ?? "")
    && /^[a-f0-9]{32}$/i.test(user.phoneOtpSalt ?? "")
    && Number.isInteger(attempts) && attempts >= 0 && attempts < 5
    && Number.isFinite(expiresAt) && expiresAt > nowMs
    && expiresAt <= requestedAt + 10 * 60_000;
  const resendAt = requestedAt + 60_000;
  const resendAvailableAt = resendAt > nowMs ? new Date(resendAt).toISOString() : null;
  if (!usableChallenge && !resendAvailableAt) return null;

  return {
    accountId: user.id,
    observedAt: new Date(nowMs).toISOString(),
    pendingChallenge: usableChallenge
      ? { phone: user.phoneOtpPhone!, expiresAt: new Date(expiresAt).toISOString() }
      : null,
    resendAvailableAt,
  };
}
