import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { assertRegistrationPhoneAvailable, createUser, upsertUserProfileForAuth, beginProfilePhoneVerification, confirmProfilePhoneVerification, findUserById, invalidateAlphaExchangeStoreCache, updateAccountProfileData } from "@/lib/alpha-exchange-store";

const phone = "+972521234567";
const now = "2026-10-01T12:00:00.000Z";
function account(id: string): AlphaExchangeUser {
  return {
    id, fullName: "Test User", email: `${id}@example.test`, passwordHash: "test-hash", whatsappNumber: "",
    role: "buyer", roles: ["buyer"], sellerStatus: "buyer", emailVerified: true,
    preferredNetworks: [], languages: ["English"], bio: "", profilePhotoUrl: "",
    onlineStatus: "offline", availabilityStatus: "available", createdAt: now, updatedAt: now,
  };
}
function seed() {
  return {
    users: [account("test-one"), account("test-two")], marketplaceListings: [], purchaseRequests: [],
    sellerApplications: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [],
    notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [],
    adminAnnouncementRuns: [], sellerReviews: [], __runtimeVersion: 0,
  } as AlphaExchangeDb & { __runtimeVersion: number };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "");
  globalThis.__alphaExchangeMemorySnapshot = seed() as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => {
  invalidateAlphaExchangeStoreCache();
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  vi.useRealTimers(); vi.unstubAllEnvs();
});

describe("persisted SMS verification challenges", () => {
  it.each(["0521234567", "+972 (52) 123-4567", "00972521234567", "٠٥٢١٢٣٤٥٦٧"])("rejects an existing verified number expressed as %s", async alternative => {
    globalThis.__alphaExchangeMemorySnapshot!.users[1].verifiedPhone = phone;
    globalThis.__alphaExchangeMemorySnapshot!.users[1].phoneVerifiedAt = now;
    invalidateAlphaExchangeStoreCache();
    await expect(beginProfilePhoneVerification({ userId: "test-one", phone: alternative })).rejects.toThrow("already linked");
  });
  it("prevents registration and profile changes from taking another account's saved contact", async () => {
    globalThis.__alphaExchangeMemorySnapshot!.users[1].whatsappNumber = phone;
    invalidateAlphaExchangeStoreCache();
    const input = { email: "new@example.test", fullName: "Test User", passwordHash: "hash", whatsappNumber: "0521234567" };
    await expect(assertRegistrationPhoneAvailable("٠٥٢١٢٣٤٥٦٧")).rejects.toThrow("already linked");
    await expect(createUser(input)).rejects.toThrow("already linked");
    await expect(upsertUserProfileForAuth(input)).rejects.toThrow("already linked");
    await expect(updateAccountProfileData({ userId: "test-one", whatsappNumber: phone })).rejects.toThrow("already linked");
  });
  it("serializes competing registrations of the same new phone", async () => {
    const results = await Promise.allSettled(["one", "two"].map(name => createUser({
      email: `${name}@new.example.test`, fullName: "Test User", passwordHash: "hash", whatsappNumber: phone,
    })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(globalThis.__alphaExchangeMemorySnapshot!.users.filter(user => user.whatsappNumber === phone)).toHaveLength(1);
  });
  it("normalizes Israeli input, saves only a digest, and preserves verification across a fresh read", async () => {
    const challenge = await beginProfilePhoneVerification({ userId: "test-one", phone: "052-123 4567" });
    expect(challenge.phone).toBe(phone);
    expect(challenge.code).toMatch(/^\d{6}$/);
    const pending = await findUserById("test-one");
    expect(pending?.phoneOtpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pending?.phoneOtpChannel).toBe("sms");
    expect(pending?.verifiedPhone).toBeUndefined();
    await confirmProfilePhoneVerification({ userId: "test-one", phone, code: challenge.code });
    invalidateAlphaExchangeStoreCache();
    const saved = await findUserById("test-one");
    expect(saved).toMatchObject({ verifiedPhone: phone, whatsappNumber: phone, phoneVerifiedAt: now });
    expect(saved?.phoneOtpHash).toBeUndefined();
    await expect(confirmProfilePhoneVerification({ userId: "test-one", phone, code: challenge.code })).rejects.toThrow("expired or invalid");
  });
  it.each([undefined, "whatsapp"] as const)("rejects a pending code from a legacy or unavailable channel %j", async channel => {
    const challenge = await beginProfilePhoneVerification({ userId: "test-one", phone });
    globalThis.__alphaExchangeMemorySnapshot!.users[0].phoneOtpChannel = channel;
    invalidateAlphaExchangeStoreCache();
    await expect(confirmProfilePhoneVerification({ userId: "test-one", phone, code: challenge.code })).rejects.toThrow("expired or invalid");
    expect((await findUserById("test-one"))?.verifiedPhone).toBeUndefined();
  });
  it("rejects an expired code at the ten-minute boundary", async () => {
    const challenge = await beginProfilePhoneVerification({ userId: "test-one", phone });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await expect(confirmProfilePhoneVerification({ userId: "test-one", phone, code: challenge.code })).rejects.toThrow("expired or invalid");
  });
  it("binds a challenge to the account and destination phone", async () => {
    const challenge = await beginProfilePhoneVerification({ userId: "test-one", phone });
    await expect(confirmProfilePhoneVerification({ userId: "test-two", phone, code: challenge.code })).rejects.toThrow("expired or invalid");
    await expect(confirmProfilePhoneVerification({ userId: "test-one", phone: "+972541234567", code: challenge.code })).rejects.toThrow("expired or invalid");
    expect((await findUserById("test-one"))?.verifiedPhone).toBeUndefined();
  });
  it("enforces the resend cooldown across simultaneous requests", async () => {
    const results = await Promise.allSettled([1, 2].map(() => beginProfilePhoneVerification({ userId: "test-one", phone })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await findUserById("test-one"))?.phoneOtpSendsToday).toBe(1);
  });
  it("does not let simultaneous guesses reset the attempt counter", async () => {
    const challenge = await beginProfilePhoneVerification({ userId: "test-one", phone });
    const wrong = challenge.code === "000000" ? "111111" : "000000";
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => confirmProfilePhoneVerification({ userId: "test-one", phone, code: wrong })));
    expect(attempts.every(result => result.status === "rejected")).toBe(true);
    expect((await findUserById("test-one"))?.phoneOtpAttempts).toBe(5);
    await expect(confirmProfilePhoneVerification({ userId: "test-one", phone, code: challenge.code })).rejects.toThrow("expired or invalid");
  });
  it("prevents two accounts from claiming the same number concurrently", async () => {
    const [one, two] = await Promise.all(["test-one", "test-two"].map(userId => beginProfilePhoneVerification({ userId, phone })));
    const results = await Promise.allSettled([
      confirmProfilePhoneVerification({ userId: "test-one", phone, code: one.code }),
      confirmProfilePhoneVerification({ userId: "test-two", phone, code: two.code }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const users = await Promise.all(["test-one", "test-two"].map(findUserById));
    expect(users.filter(user => user?.verifiedPhone === phone)).toHaveLength(1);
  });
  it("requires new verification when the saved contact number changes", async () => {
    const challenge = await beginProfilePhoneVerification({ userId: "test-one", phone });
    await confirmProfilePhoneVerification({ userId: "test-one", phone, code: challenge.code });
    await updateAccountProfileData({ userId: "test-one", whatsappNumber: "+972541234567" });
    const changed = await findUserById("test-one");
    expect(changed?.whatsappNumber).toBe("+972541234567");
    expect(changed?.verifiedPhone).toBeUndefined();
    expect(changed?.phoneVerifiedAt).toBeUndefined();
  });
  it("limits requests for the day and allows them again on the next day", async () => {
    for (let index = 0; index < 5; index++) {
      await beginProfilePhoneVerification({ userId: "test-one", phone });
      vi.setSystemTime(Date.now() + 61_000);
    }
    await expect(beginProfilePhoneVerification({ userId: "test-one", phone })).rejects.toThrow("limit reached");
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    await expect(beginProfilePhoneVerification({ userId: "test-one", phone })).resolves.toHaveProperty("code");
  });
});
