import { describe, expect, it } from "vitest";
import { getPhoneVerificationRecovery } from "./phone-verification-recovery";

type Account = NonNullable<Parameters<typeof getPhoneVerificationRecovery>[0]>;
const now = Date.parse("2026-11-07T00:00:30.000Z");
const requestedAt = now - 30_000;
const account: Account = {
  id: "recovery-buyer", email: "recovery@example.test",
  phoneOtpPhone: "+972501234567", phoneOtpChannel: "sms",
  phoneOtpHash: "a".repeat(64), phoneOtpSalt: "b".repeat(32),
  phoneOtpRequestedAt: new Date(requestedAt).toISOString(),
  phoneOtpExpiresAt: new Date(requestedAt + 600_000).toISOString(),
  phoneOtpAttempts: 0,
};

describe("private phone challenge recovery metadata", () => {
  it("returns only account-bound display metadata, never the code digest or salt", () => {
    const recovery = getPhoneVerificationRecovery(account, now);
    expect(recovery).toEqual({
      accountId: account.id,
      observedAt: new Date(now).toISOString(),
      pendingChallenge: { phone: account.phoneOtpPhone, expiresAt: account.phoneOtpExpiresAt },
      resendAvailableAt: new Date(requestedAt + 60_000).toISOString(),
    });
    expect(JSON.stringify(recovery)).not.toContain(account.phoneOtpHash);
    expect(JSON.stringify(recovery)).not.toContain(account.phoneOtpSalt);
  });

  it("keeps a usable code after the resend cooldown has ended", () => {
    expect(getPhoneVerificationRecovery(account, requestedAt + 60_000)).toMatchObject({
      pendingChallenge: { phone: account.phoneOtpPhone }, resendAvailableAt: null,
    });
  });

  it("accepts the server's absent attempt counter as zero without changing the account", () => {
    const source = { ...account, phoneOtpAttempts: undefined };
    const before = structuredClone(source);
    expect(getPhoneVerificationRecovery(source, now)?.pendingChallenge).toBeTruthy();
    expect(source).toEqual(before);
  });

  it.each([
    { phoneOtpAttempts: 5 },
    { phoneOtpAttempts: -1 },
    { phoneOtpAttempts: 0.5 },
    { phoneOtpAttempts: NaN },
    { phoneOtpChannel: "whatsapp" as const },
    { phoneOtpChannel: undefined },
    { phoneOtpPhone: "0501234567" },
    { phoneOtpPhone: undefined },
    { phoneOtpHash: undefined },
    { phoneOtpHash: "not-a-digest" },
    { phoneOtpSalt: undefined },
    { phoneOtpSalt: "not-a-salt" },
    { phoneOtpExpiresAt: "not-a-date" },
    { phoneOtpExpiresAt: new Date(now).toISOString() },
    { phoneOtpExpiresAt: new Date(requestedAt + 600_001).toISOString() },
  ])("does not restore unusable challenge %j, while preserving account resend cooldown", patch => {
    expect(getPhoneVerificationRecovery({ ...account, ...patch }, now)).toEqual({
      accountId: account.id,
      observedAt: new Date(now).toISOString(),
      pendingChallenge: null,
      resendAvailableAt: new Date(requestedAt + 60_000).toISOString(),
    });
  });

  it("returns no stale metadata at the exact expiry deadline", () => {
    expect(getPhoneVerificationRecovery(account, requestedAt + 600_000)).toBeNull();
  });

  it.each([
    { id: "" },
    { disabled: true },
    { verifiedPhone: "+972501234567", phoneVerifiedAt: new Date(requestedAt).toISOString() },
    { phoneOtpRequestedAt: undefined },
    { phoneOtpRequestedAt: "not-a-date" },
    { phoneOtpRequestedAt: new Date(now + 1).toISOString() },
  ])("does not resume disabled, verified or malformed account state %j", patch => {
    expect(getPhoneVerificationRecovery({ ...account, ...patch }, now)).toBeNull();
  });

  it("does not return metadata without a current account or a valid observation time", () => {
    expect(getPhoneVerificationRecovery(null, now)).toBeNull();
    expect(getPhoneVerificationRecovery(undefined, now)).toBeNull();
    expect(getPhoneVerificationRecovery(account, NaN)).toBeNull();
    expect(getPhoneVerificationRecovery(account, Infinity)).toBeNull();
  });
});
