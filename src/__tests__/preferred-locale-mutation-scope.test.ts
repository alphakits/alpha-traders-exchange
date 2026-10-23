// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { getAuditLogsForAdmin, invalidateAlphaExchangeStoreCache, updateUserPreferredLocale } from "@/lib/alpha-exchange-store";

type Snapshot = AlphaExchangeDb & { __runtimeVersion: number };
const current = () => globalThis.__alphaExchangeMemorySnapshot as unknown as Snapshot;
const updatedAt = "2026-10-22T00:00:00.000Z";
const readTables = ["users", "seller_applications"];

beforeEach(() => {
  globalThis.__alphaExchangeMemorySnapshot = {
    users: ["account", "other"].map(id => ({ id, fullName: id, email: `${id}@example.test`,
      role: "buyer", roles: ["buyer"], sellerStatus: "buyer", passwordHash: "old-hash", emailVerified: true,
      preferredLocale: "en", createdAt: updatedAt, updatedAt })),
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [],
    sellerReviews: [], smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], __runtimeVersion: 0,
  } as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => { vi.restoreAllMocks(); invalidateAlphaExchangeStoreCache(); });

async function repositoryForScopedRead() {
  const repository = await getAlphaExchangeRepository();
  // The compatibility repository returns a full memory snapshot. Declare the
  // production read dependency set explicitly and make full reads unavailable.
  vi.spyOn(repository, "loadSelectedSnapshot").mockImplementation(async () => structuredClone(current()) as never);
  return repository;
}

describe("preferred locale canonical mutation", () => {
  it.each(["ar", "en"] as const)("persists %s when unrelated exchange tables are unavailable", async preferredLocale => {
    current().users[0].preferredLocale = preferredLocale === "ar" ? "en" : "ar";
    const repository = await repositoryForScopedRead();
    const full = vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("Unrelated full snapshot unavailable"));
    const save = vi.spyOn(repository, "saveSnapshot");
    const result = await updateUserPreferredLocale({ userId: "account", preferredLocale });
    expect(result.preferredLocale).toBe(preferredLocale);
    expect(current().users[0].preferredLocale).toBe(preferredLocale);
    expect(current().users[1].preferredLocale).toBe("en");
    expect(full).not.toHaveBeenCalled();
    expect(repository.loadSelectedSnapshot).toHaveBeenCalledExactlyOnceWith(readTables);
    expect(save.mock.calls[0][1]).toEqual(expect.objectContaining({
      selectedTables: ["users"], rebaseTables: readTables, rebaseOnLatest: expect.any(Function),
    }));
    // A partial account snapshot must never be returned as the complete store.
    full.mockResolvedValue(structuredClone(current()) as never);
    await getAuditLogsForAdmin();
    expect(full).toHaveBeenCalledTimes(1);
  });

  it("preserves concurrent password, account and session changes while rebasing the preference", async () => {
    const repository = await repositoryForScopedRead();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
      current().users[0].passwordHash = "canonical-password";
      current().users[1].preferredLocale = "ar";
      current().authSessions.push({ userId: "account", token: "concurrent-session", createdAt: updatedAt, expiresAt: "2030-01-01T00:00:00Z" });
      current().__runtimeVersion += 1;
      await persist(incoming, options);
    });
    const result = await updateUserPreferredLocale({ userId: "account", preferredLocale: "ar" });
    expect(result).toMatchObject({ preferredLocale: "ar", passwordHash: "canonical-password" });
    expect(current().users[0]).toMatchObject({ preferredLocale: "ar", passwordHash: "canonical-password" });
    expect(current().users[1].preferredLocale).toBe("ar");
    expect(current().authSessions).toContainEqual(expect.objectContaining({ token: "concurrent-session" }));
  });

  it("does not recreate an account removed before the canonical commit", async () => {
    const repository = await repositoryForScopedRead();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
      current().users = current().users.filter(user => user.id !== "account");
      current().__runtimeVersion += 1;
      await persist(incoming, options);
    });
    await expect(updateUserPreferredLocale({ userId: "account", preferredLocale: "ar" })).rejects.toThrow("User not found.");
    expect(current().users.some(user => user.id === "account")).toBe(false);
  });

  it("propagates a failed durable write without changing stored preferences", async () => {
    const repository = await repositoryForScopedRead();
    const before = structuredClone(current());
    vi.spyOn(repository, "saveSnapshot").mockRejectedValueOnce(new Error("Durable commit rejected"));
    await expect(updateUserPreferredLocale({ userId: "account", preferredLocale: "ar" })).rejects.toThrow("Durable commit rejected");
    expect(current()).toEqual(before);
    const full = vi.spyOn(repository, "loadSnapshot").mockResolvedValue(structuredClone(current()) as never);
    await getAuditLogsForAdmin();
    expect(full).toHaveBeenCalledTimes(1);
  });

  it("preserves the existing timestamp when the requested preference is unchanged", async () => {
    await repositoryForScopedRead();
    const result = await updateUserPreferredLocale({ userId: "account", preferredLocale: "en" });
    expect(result.updatedAt).toBe(updatedAt);
    expect(current().users[0].updatedAt).toBe(updatedAt);
  });
});
