// @vitest-environment node
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

// Any accidental attempt to discover an ambient database is a test failure.
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database access is forbidden"); } }));

import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { findUserByIdForAuthorization, getAuthenticatedSessionByToken, getAuthenticatedUserBySessionToken,
  invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";

const NOW = "2026-11-04T12:00:00.000Z", DEADLINE = "2026-11-04T12:03:17.000Z";
const TOKEN = "isolated-canonical-session", HASH = createHash("sha256").update(TOKEN).digest("hex");
const user: AlphaExchangeUser = {
  id: "source-user", email: "source-user@example.test", fullName: "Source Fixture", passwordHash: "private-fixture-hash",
  whatsappNumber: "", role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller",
  emailVerified: true, onlineStatus: "offline", availabilityStatus: "available", preferredNetworks: [],
  profilePhotoUrl: "", languages: ["English"], bio: "", createdAt: NOW, updatedAt: NOW,
};
const session = { token: HASH, userId: user.id, createdAt: NOW, expiresAt: DEADLINE };
const fixture = {
  users: [user], authSessions: [session], sellerApplications: [], marketplaceListings: [], purchaseRequests: [],
  commissionRecords: [], auditLogs: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [],
  sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [],
  privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
  __runtimeVersion: 1,
} satisfies AlphaExchangeDb & { __runtimeVersion: number };
const sql = new PGlite();
let readFailure: Error | undefined;
const query = vi.fn((statement: string, values?: unknown[]) => {
  if (readFailure) throw readFailure;
  return sql.query(statement, values);
});
let repository: AlphaExchangeRepository;

beforeAll(async () => {
  await sql.exec(`create schema alpha_exchange;
    create table alpha_exchange.runtime_meta (singleton boolean, version bigint);
    insert into alpha_exchange.runtime_meta values (true, 1);
    create table alpha_exchange.users (id text, email text, sort_index int, payload jsonb);
    create table alpha_exchange.sessions (token_hash text, user_id text, sort_index int, payload jsonb);
    create table alpha_exchange.seller_applications (user_id text, sort_index int, payload jsonb);`);
});
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_USDT_REQUESTS_ENABLED"]) vi.stubEnv(key, undefined);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(NOW));
  readFailure = undefined;
  await sql.exec("truncate alpha_exchange.users, alpha_exchange.sessions, alpha_exchange.seller_applications");
  await sql.query("insert into alpha_exchange.users values ($1,$2,1,$3)", [user.id, user.email, user]);
  await sql.query("insert into alpha_exchange.sessions values ($1,$2,1,$3)", [HASH, user.id, session]);
  globalThis.__alphaExchangeMemorySnapshot = structuredClone(fixture) as never;
  repository = new AlphaExchangeRepository({ query } as unknown as Pool);
  // This fixture owns its minimal SQL schema; runtime schema initialization is
  // separately exercised below with a failing pool and no real connection.
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository);
  invalidateAlphaExchangeStoreCache(); query.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  invalidateAlphaExchangeStoreCache();
});
afterAll(async () => { await sql.close(); });

describe("fresh authentication metadata from the real repository boundary", () => {
  it("gets canonical account and exact stored deadline in one SQL read without exposing the session hash", async () => {
    const resolved = await getAuthenticatedSessionByToken(TOKEN);
    expect(resolved).toMatchObject({ user: { id: user.id, sellerStatus: "approved_seller" }, sessionExpiresAtMs: Date.parse(DEADLINE) });
    expect(Object.keys(resolved!).sort()).toEqual(["sessionExpiresAtMs", "user"]);
    expect(JSON.stringify(resolved)).not.toContain(HASH);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("with matched_session as materialized");
    expect(query.mock.calls[0][1]).toEqual([HASH]);

    await sql.query("update alpha_exchange.users set payload=$1 where id=$2", [{ ...user, disabled: true, sellerStatus: "suspended" }, user.id]);
    expect(await getAuthenticatedSessionByToken(TOKEN)).toBeNull();
    expect(await getAuthenticatedSessionByToken(TOKEN, { includeDisabled: true })).toMatchObject({
      user: { id: user.id, disabled: true, sellerStatus: "suspended" }, sessionExpiresAtMs: Date.parse(DEADLINE),
    });
    expect(await getAuthenticatedUserBySessionToken(TOKEN)).toBeNull();
    expect(await getAuthenticatedUserBySessionToken(TOKEN, { includeDisabled: true })).toMatchObject({ id: user.id, disabled: true });
    expect(await findUserByIdForAuthorization(user.id)).toMatchObject({ id: user.id, disabled: true, sellerStatus: "suspended" });
  });

  it("re-reads stored revocation without accepting the retained active fallback account", async () => {
    expect(await getAuthenticatedSessionByToken(TOKEN)).not.toBeNull();
    await sql.query("delete from alpha_exchange.sessions where token_hash=$1", [HASH]);
    expect(await getAuthenticatedSessionByToken(TOKEN)).toBeNull();
    expect(globalThis.__alphaExchangeMemorySnapshot!.authSessions).toHaveLength(1);
  });

  it("propagates actual query failure and preserves legacy local fallback only for user-only callers", async () => {
    readFailure = new Error("isolated query unavailable");
    await expect(getAuthenticatedSessionByToken(TOKEN)).rejects.toThrow("isolated query unavailable");
    await expect(findUserByIdForAuthorization(user.id)).rejects.toThrow("isolated query unavailable");
    expect(query).toHaveBeenCalledTimes(2);
    expect(await getAuthenticatedUserBySessionToken(TOKEN)).toMatchObject({ id: user.id });
    expect(globalThis.__alphaExchangeMemorySnapshot!.authSessions).toEqual([session]);
  });

  it("rejects initialization fallback from a configured failed pool while preserving the old local behavior", async () => {
    const failingQuery = vi.fn(async () => { throw new Error("isolated initialization unavailable"); });
    repository = new AlphaExchangeRepository({ query: failingQuery } as unknown as Pool);
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository);
    await expect(getAuthenticatedSessionByToken(TOKEN)).rejects.toThrow("Fresh authenticated session storage is unavailable");
    await expect(findUserByIdForAuthorization(user.id)).rejects.toThrow("Fresh authenticated account storage is unavailable");
    expect(failingQuery).toHaveBeenCalledTimes(1);
    expect(await getAuthenticatedUserBySessionToken(TOKEN)).toMatchObject({ id: user.id });
  });

  it("allows an explicitly isolated memory repository and keeps older doubles limited to the user-only API", async () => {
    repository = new AlphaExchangeRepository(null);
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository);
    expect(await getAuthenticatedSessionByToken(TOKEN)).toMatchObject({ sessionExpiresAtMs: Date.parse(DEADLINE) });
    expect(await findUserByIdForAuthorization(user.id)).toMatchObject({ id: user.id });
    Object.defineProperty(repository, "loadAuthenticatedSessionSnapshot", { value: undefined });
    await expect(getAuthenticatedSessionByToken(TOKEN)).rejects.toThrow("Coherent authenticated session lookup is unavailable");
    expect(await getAuthenticatedUserBySessionToken(TOKEN)).toMatchObject({ id: user.id });
    expect(query).not.toHaveBeenCalled();
  });
});
