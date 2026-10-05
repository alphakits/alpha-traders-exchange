import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { createAuthSession, getSessionByToken, invalidateAlphaExchangeStoreCache, listAccountSessions, revokeAccountSession } from "@/lib/alpha-exchange-store";
beforeEach(() => {
  const empty = { users: [], sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], __runtimeVersion: 0 } as unknown as AlphaExchangeDb;
  globalThis.__alphaExchangeMemorySnapshot = empty as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});
describe("owned session persistence", () => {
  it("keeps the existing one-session-per-account policy and leaves other accounts alone", async () => {
    await createAuthSession("buyer-a", "first-a"); await createAuthSession("buyer-b", "token-b"); await createAuthSession("buyer-a", "second-a", 14, "iOS · Safari");
    expect(await getSessionByToken("first-a")).toBeNull();
    expect(await getSessionByToken("token-b")).toBeTruthy();
    const sessions = await listAccountSessions("buyer-a", "second-a");
    expect(sessions).toHaveLength(1); expect(sessions[0].deviceLabel).toBe("iOS · Safari"); expect(sessions[0].isCurrent).toBe(true);
    expect(JSON.stringify(sessions)).not.toContain("second-a");
  });
  it("refuses another account's handle and only deletes the owned session", async () => {
    await createAuthSession("buyer-a", "token-a"); await createAuthSession("buyer-b", "token-b");
    const [a] = await listAccountSessions("buyer-a", "token-a"); const [b] = await listAccountSessions("buyer-b", "token-b");
    expect(await revokeAccountSession("buyer-a", b.id, "token-a")).toBeNull();
    expect(await getSessionByToken("token-b")).toBeTruthy();
    expect(await revokeAccountSession("buyer-a", a.id, "token-a")).toEqual({ revokedId: a.id, currentSessionRevoked: true });
    expect(await getSessionByToken("token-a")).toBeNull(); expect(await getSessionByToken("token-b")).toBeTruthy();
    expect(await revokeAccountSession("buyer-a", a.id, "token-a")).toBeNull();
  });
});
