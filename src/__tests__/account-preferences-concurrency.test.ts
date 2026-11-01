// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { activateBuyerOnboardingWithoutPhone, beginBuyerVerification, completeBuyerVerification, grantStudentRole,
  invalidateAlphaExchangeStoreCache, recordBuyerVerificationAttempt, selectGuestOnboarding,
  updateNotificationPreferences } from "@/lib/alpha-exchange-store";
import { formatIsraelCalendarDateKey } from "@/lib/israel-calendar";

const current = () => globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
const phone = "+972501234567";
const actions = [
  { name: "student onboarding", run: () => grantStudentRole("account") },
  { name: "guest onboarding", run: () => selectGuestOnboarding("account") },
  { name: "buyer onboarding", run: () => activateBuyerOnboardingWithoutPhone({ userId: "account", firstName: "Controlled", lastName: "Account" }) },
  { name: "phone challenge", run: () => beginBuyerVerification({ userId: "account", firstName: "Controlled", lastName: "Account", phone }) },
  { name: "phone completion", run: () => completeBuyerVerification({ userId: "account", phone }) },
  { name: "phone attempt", run: () => recordBuyerVerificationAttempt("account") },
  { name: "notification preferences", run: () => updateNotificationPreferences({ userId: "account", preferences: { email: false } }) },
];
beforeEach(() => {
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "0");
  const now = new Date().toISOString();
  globalThis.__alphaExchangeMemorySnapshot = { users: [{ id: "account", fullName: "Controlled Account", email: "account@example.test",
    role: "buyer", roles: ["buyer"], sellerStatus: "buyer", passwordHash: "old-hash", emailVerified: true, verifiedPhone: phone,
    phoneVerifiedAt: now, createdAt: now, updatedAt: now, notificationPreferences: { inApp: false, email: false, sms: false } }],
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [],
    sellerReviews: [], smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], __runtimeVersion: 0 } as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function whileWaiting(change: (db: AlphaExchangeDb) => void) {
  const repository = await getAlphaExchangeRepository();
  const persist = repository.saveSnapshot.bind(repository);
  vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
    const latest = await repository.loadSnapshot();
    change(latest);
    await persist(latest, { selectedTables: ["users"] });
    await persist(incoming, options);
  });
}

it.each(actions)("$name preserves a password change committed while it waits", async action => {
  await whileWaiting(db => { db.users[0].passwordHash = "canonical-password"; });
  await action.run();
  expect(current().users[0].passwordHash).toBe("canonical-password");
});

it.each(actions)("$name cannot restore or mutate an account disabled before commit", async action => {
  await whileWaiting(db => { db.users[0].disabled = true; });
  await expect(action.run()).rejects.toThrow(/restricted|disabled/i);
  expect(current().users[0].disabled).toBe(true);
  expect(current().activityLog).toHaveLength(0);
});

it("counts simultaneous incorrect phone attempts independently", async () => {
  await Promise.all([recordBuyerVerificationAttempt("account"), recordBuyerVerificationAttempt("account")]);
  expect(current().users[0].buyerVerificationAttempts).toBe(2);
});

it("allows only the final daily phone resend when two requests race", async () => {
  current().users[0].buyerOtpSendsToday = 4;
  current().users[0].buyerOtpSendsDate = formatIsraelCalendarDateKey(Date.now());
  const results = await Promise.allSettled([actions[3].run(), actions[3].run()]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(current().users[0].buyerOtpSendsToday).toBe(5);
});
