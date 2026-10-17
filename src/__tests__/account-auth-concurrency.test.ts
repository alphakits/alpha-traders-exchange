// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { consumeEmailVerificationToken, consumePasswordResetToken, createEmailVerificationTokenForUser,
  createPasswordResetToken, hashToken, invalidateAlphaExchangeStoreCache, updateUserPassword,
  confirmAdultEligibility, findUserById, upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";

const current = () => globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
beforeEach(() => {
  const now = new Date().toISOString();
  globalThis.__alphaExchangeMemorySnapshot = {
    users: ["account-a", "account-b"].map(id => ({ id, fullName: id, email: `${id}@example.test`, role: "buyer", roles: ["buyer"],
      sellerStatus: "buyer", passwordHash: "old-hash", emailVerified: false, createdAt: now, updatedAt: now })),
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [],
    sellerReviews: [], smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], __runtimeVersion: 0,
  } as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});

it("keeps concurrent password updates for different accounts", async () => {
  await Promise.all([updateUserPassword("account-a", "new-hash-a"), updateUserPassword("account-b", "new-hash-b")]);
  expect(current().users.map(user => user.passwordHash)).toEqual(["new-hash-a", "new-hash-b"]);
});

it("persists adult confirmation across reloads and retries without changing another account", async () => {
  const first = await confirmAdultEligibility("account-a", true);
  const confirmed = first.ageEligibility;
  expect(confirmed?.method).toBe("self_attestation_v1");
  expect(current().users[1].ageEligibility).toBeUndefined();
  invalidateAlphaExchangeStoreCache();
  expect((await findUserById("account-a"))?.ageEligibility).toEqual(confirmed);
  expect((await confirmAdultEligibility("account-a", true)).ageEligibility).toEqual(confirmed);
  await expect(confirmAdultEligibility("account-b", "true")).rejects.toThrow("Adult confirmation");
});

it("does not approve adult eligibility through unauthenticated profile synchronization", async () => {
  await upsertUserProfileForAuth({ fullName: "account-a", email: "account-a@example.test", whatsappNumber: "", ageConfirmed: true });
  expect(current().users[0].ageEligibility).toBeUndefined();
});

it("rechecks a concurrent account disable before adult confirmation commits", async () => {
  const repository = await getAlphaExchangeRepository();
  const persist = repository.saveSnapshot.bind(repository);
  const save = vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
    const newer = await repository.loadSnapshot(); newer.users[0].disabled = true;
    await persist(newer, { selectedTables: ["users"] }); await persist(incoming, options);
  });
  try {
    await expect(confirmAdultEligibility("account-a", true)).rejects.toThrow("restricted");
    expect(current().users[0].disabled).toBe(true);
    expect(current().users[0].ageEligibility).toBeUndefined();
  } finally { save.mockRestore(); }
});

it("does not undo a security restriction committed while a password write waits", async () => {
  const repository = await getAlphaExchangeRepository();
  const persist = repository.saveSnapshot.bind(repository);
  const save = vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
    const newer = await repository.loadSnapshot();
    newer.users[0].disabled = true;
    await persist(newer, { selectedTables: ["users"] });
    await persist(incoming, options);
  });
  try {
    await updateUserPassword("account-a", "new-hash");
    expect(current().users[0]).toMatchObject({ passwordHash: "new-hash", disabled: true });
  } finally { save.mockRestore(); }
});

it("consumes an email verification token exactly once under concurrent requests", async () => {
  const issued = await createEmailVerificationTokenForUser("account-a");
  const results = await Promise.all([consumeEmailVerificationToken(issued.token), consumeEmailVerificationToken(issued.token)]);
  expect(results.map(result => result.status).sort()).toEqual(["invalid", "verified"]);
  expect(current().users[0].emailVerified).toBe(true);
  expect(current().users[1].emailVerified).toBe(false);
});

it("rejects an old email token replaced while consumption waits to commit", async () => {
  const issued = await createEmailVerificationTokenForUser("account-a");
  const repository = await getAlphaExchangeRepository();
  const persist = repository.saveSnapshot.bind(repository);
  const replacementHash = hashToken("synthetic-replacement-token");
  const save = vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
    const newer = await repository.loadSnapshot();
    newer.users[0].emailVerificationTokenHash = replacementHash;
    await persist(newer, { selectedTables: ["users"] });
    await persist(incoming, options);
  });
  try {
    expect(await consumeEmailVerificationToken(issued.token)).toEqual({ status: "invalid" });
    expect(current().users[0]).toMatchObject({ emailVerified: false, emailVerificationTokenHash: replacementHash });
  } finally { save.mockRestore(); }
});

it("expires an email link at its deadline and refuses reuse", async () => {
  const issued = await createEmailVerificationTokenForUser("account-a");
  current().users[0].emailVerificationTokenExpiresAt = new Date(Date.now() - 1).toISOString();
  invalidateAlphaExchangeStoreCache();
  expect(await consumeEmailVerificationToken(issued.token)).toEqual({ status: "expired" });
  expect(await consumeEmailVerificationToken(issued.token)).toEqual({ status: "invalid" });
  expect(current().users[0].emailVerified).toBe(false);
});

it("keeps password reset requests for different accounts when submitted together", async () => {
  await Promise.all([createPasswordResetToken("account-a", "synthetic-reset-a"), createPasswordResetToken("account-b", "synthetic-reset-b")]);
  expect(current().passwordResetTokens.map(token => token.userId).sort()).toEqual(["account-a", "account-b"]);
});

it("consumes a password reset token only once under concurrent requests", async () => {
  await createPasswordResetToken("account-a", "synthetic-reset-a");
  const results = await Promise.all([consumePasswordResetToken("synthetic-reset-a"), consumePasswordResetToken("synthetic-reset-a")]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(current().passwordResetTokens).toHaveLength(0);
});

it.each(["invalid-date", new Date(0).toISOString()])("rejects an invalid or expired password reset deadline (%s)", async expiresAt => {
  await createPasswordResetToken("account-a", "synthetic-reset-a");
  current().passwordResetTokens[0].expiresAt = expiresAt;
  invalidateAlphaExchangeStoreCache();
  expect(await consumePasswordResetToken("synthetic-reset-a")).toBeNull();
  expect(current().passwordResetTokens).toHaveLength(0);
});
