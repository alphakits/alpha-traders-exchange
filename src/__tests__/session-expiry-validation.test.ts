import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));

import {
  createAuthSession,
  getAuthenticatedUserBySessionToken,
  getSessionByToken,
  invalidateAlphaExchangeStoreCache,
} from "@/lib/alpha-exchange-store";

const NOW = "2026-10-22T04:00:00.000Z";
const FUTURE = "2026-10-23T04:00:00.000Z";
const TOKEN = "isolated-expiry-session";

function seed() {
  const users = ["expiry-buyer", "other-buyer"].map((id): AlphaExchangeUser => ({
    id, email: `${id}@example.test`, fullName: "Expiry Test Buyer", passwordHash: "",
    whatsappNumber: "", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
    emailVerified: true, onlineStatus: "offline", availabilityStatus: "available",
    preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "",
    createdAt: NOW, updatedAt: NOW,
  }));
  return {
    users, sellerApplications: [], marketplaceListings: [], purchaseRequests: [],
    commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [],
    notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [],
    trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [],
    betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
    __runtimeVersion: 0,
  } satisfies AlphaExchangeDb & { __runtimeVersion: number };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  globalThis.__alphaExchangeMemorySnapshot = seed() as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
  await createAuthSession("expiry-buyer", TOKEN);
  await createAuthSession("other-buyer", "unrelated-session");
});

afterEach(() => {
  invalidateAlphaExchangeStoreCache();
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  vi.useRealTimers();
});

describe.each([
  ["direct session lookup", getSessionByToken],
  ["canonical session principal", getAuthenticatedUserBySessionToken],
] as const)("session expiry validation through %s", (_label, readSession) => {
  it.each([
    ["malformed date", "not-a-date"],
    ["empty date", ""],
    ["missing date", undefined],
    ["null date", null],
    ["object date", {}],
    ["array date", [FUTURE]],
    ["numeric date", Date.parse(FUTURE)],
    ["exact deadline", NOW],
    ["expired date", "2026-10-21T04:00:00.000Z"],
  ])("rejects and removes a %s without affecting another account", async (_case, expiresAt) => {
    const target = globalThis.__alphaExchangeMemorySnapshot!.authSessions.find(session => session.userId === "expiry-buyer")!;
    // Simulate malformed retained JSON without going through the writer's
    // date constructor. Production authorization consumes this payload too.
    (target as { expiresAt: unknown }).expiresAt = expiresAt;
    invalidateAlphaExchangeStoreCache();

    expect(await readSession(TOKEN)).toBeNull();
    expect(globalThis.__alphaExchangeMemorySnapshot!.authSessions.some(session => session.userId === "expiry-buyer")).toBe(false);
    expect(await getSessionByToken("unrelated-session")).toMatchObject({ userId: "other-buyer" });
  });

  it("preserves a valid future session without replacing or extending it", async () => {
    const target = globalThis.__alphaExchangeMemorySnapshot!.authSessions.find(session => session.userId === "expiry-buyer")!;
    target.expiresAt = FUTURE;
    const before = structuredClone(target);
    invalidateAlphaExchangeStoreCache();
    expect(await readSession(TOKEN)).not.toBeNull();
    expect(globalThis.__alphaExchangeMemorySnapshot!.authSessions.find(session => session.userId === "expiry-buyer")).toEqual(before);
  });
});
