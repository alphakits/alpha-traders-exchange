// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeDb, AuthSession } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));

const now = "2026-10-24T00:00:00.000Z";
let database: PGlite;
let repository: AlphaExchangeRepository;
let beforeAccountWrite: (() => Promise<void>) | undefined;

function session(token: string, userId = "account"): AuthSession {
  return { token, userId, createdAt: now, expiresAt: "2030-01-01T00:00:00.000Z" };
}

async function storedSessions() {
  return (await database.query<{ payload: AuthSession }>("select payload from alpha_exchange.sessions order by token_hash")).rows.map(row => row.payload);
}

beforeAll(async () => {
  // Bound cold WASM compilation separately; each test still gets a fresh database.
  // PGlite caches compiled modules across instances, including after close().
  const warmup = await PGlite.create();
  await warmup.close();
}, 30_000);

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  database = new PGlite();
  await database.exec(await readFile("supabase/migrations/20260720160000_alpha_exchange_runtime.sql", "utf8"));
  await database.exec(await readFile("supabase/migrations/20260905223000_alpha_exchange_runtime_schema_parity.sql", "utf8"));
  await database.exec(await readFile("supabase/migrations/20261024024258_usdt_buy_requests.sql", "utf8"));
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      // Force an auth change after the snapshot's session read but before its
      // account write. PGlite exercises real SQL with this controlled schedule;
      // the separate PostgreSQL harness covers independent concurrent processes.
      if (beforeAccountWrite && sql.startsWith("delete from alpha_exchange.users")) {
        const change = beforeAccountWrite;
        beforeAccountWrite = undefined;
        await change();
      }
      return database.query(sql, values);
    },
    release() {},
  };
  repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  const fixture = {
    users: ["account", "other", "new-account"].map(id => ({ id, email: `${id}@example.test`, fullName: `Synthetic ${id}`, role: "buyer", sellerStatus: "buyer",
      availabilityStatus: "available", onlineStatus: "offline", createdAt: now, updatedAt: now })),
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [],
    sellerReviews: [], smsDeliveries: [], __runtimeVersion: 0,
  } as unknown as AlphaExchangeDb;
  await repository.saveSnapshot(fixture);
  await repository.upsertAuthSession(session("existing"));
  await repository.upsertAuthSession(session("other-session", "other"));
});

afterEach(async () => {
  beforeAccountWrite = undefined;
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await database.close();
});

describe.each([false, true])("session preservation with stale snapshot=%s", stale => {
  describe.each(["users", "full"] as const)("%s snapshot writes", scope => {
    it.each(["new-login", "rotation", "logout", "owned-revocation", "all-revoked"] as const)("preserves %s committed before the account write", async action => {
      const snapshot = await repository.loadSnapshot();
      const changeLocale = (current: AlphaExchangeDb) => {
        current.users.find(user => user.id === "account")!.preferredLocale = "ar";
        return current;
      };
      changeLocale(snapshot);
      if (stale) await database.exec("update alpha_exchange.runtime_meta set version = version + 1");
      let expected: AuthSession[] = [];
      beforeAccountWrite = async () => {
        if (action === "new-login") {
          await repository.upsertAuthSession(session("new-session", "new-account"));
        } else if (action === "rotation") {
          await repository.upsertAuthSession(session("rotated"));
        } else if (action === "logout") {
          await repository.deleteAuthSession("existing");
        } else if (action === "owned-revocation") {
          expect(await repository.deleteOwnedAuthSession("account", "existing")).toBe(true);
        } else {
          await repository.deleteAuthSessionsForUser("account");
        }
        expected = await storedSessions();
      };
      await repository.saveSnapshot(snapshot, {
        ...(scope === "users" ? { selectedTables: ["users"] as const, rebaseTables: ["users"] as const } : {}),
        rebaseOnLatest: changeLocale,
      });
      expect(beforeAccountWrite).toBeUndefined();
      expect(await storedSessions()).toEqual(expected);
      expect((await repository.loadSnapshot()).users.find(user => user.id === "account")!.preferredLocale).toBe("ar");
    });
  });
});

it("removes only a deleted account's sessions through the database foreign key", async () => {
  const snapshot = await repository.loadSnapshot();
  snapshot.users = snapshot.users.filter(user => user.id !== "account");
  await repository.saveSnapshot(snapshot, { selectedTables: ["users"] });
  expect(await storedSessions()).toEqual([session("other-session", "other")]);
});

it("does not restore a session from an explicit stale snapshot session collection", async () => {
  const snapshot = await repository.loadSnapshot();
  await repository.deleteAuthSessionsForUser("account");
  snapshot.authSessions.push(session("forged"));
  await repository.saveSnapshot(snapshot, { selectedTables: ["sessions"] });
  expect(await storedSessions()).toEqual([session("other-session", "other")]);
});
