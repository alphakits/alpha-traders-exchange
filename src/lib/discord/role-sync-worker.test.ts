// @vitest-environment node

import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DiscordRoleOperationError,
  type DiscordManagedRoleIds,
  type DiscordRoleManager,
} from "@/lib/discord/role-manager";
import { DiscordRoleSyncWorker } from "@/lib/discord/role-sync-worker";

function result<T>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: "", rowCount, oid: 0, fields: [], rows };
}

const roleIds: DiscordManagedRoleIds = {
  approved_seller: "444444444444444444",
  pending_seller: "555555555555555555",
  suspended_seller: "666666666666666666",
};

function workerFixture(input: {
  provisionError?: Error;
  syncError?: Error;
  currentDesiredStatus?: "approved" | "pending" | "suspended" | "none";
  linkedDiscordUserId?: string | null;
  ownsClaim?: boolean;
  approvedRoleGranted?: boolean;
  reason?: string;
} = {}) {
  const clientStatements: string[] = [];
  const clientQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      clientStatements.push(sql);
      clientQueries.push({ sql, values });
      if (sql.includes("select role_key")) return result([]);
      if (sql.includes("and lock_token = $2::uuid") && sql.includes("select 1")) {
        return result(input.ownsClaim === false ? [] : [{ "?column?": 1 }]);
      }
      if (sql.includes("where identity.discord_user_id = $1")) {
        return result([{
          desired_status: input.currentDesiredStatus ?? "approved",
        }].filter(() => input.linkedDiscordUserId !== null));
      }
      return result([]);
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  let claimed = false;
  const poolQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      poolQueries.push({ sql, values });
      if (
        sql.includes("with candidate as")
        && sql.includes("update alpha_exchange.discord_role_sync_outbox job")
      ) {
        if (claimed) return result([]);
        claimed = true;
        return result([{
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          platform_user_id: "alpha-user",
          discord_user_id: "777777777777777777",
          lock_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          attempts: 1,
          desired_status: "approved",
          reason: input.reason ?? "seller_status_changed",
        }]);
      }
      return result([], sql.includes("periodic_reconciliation") ? 0 : 1);
    }),
  } as unknown as Pool;
  const manager: DiscordRoleManager = {
    discoverOrCreateManagedRoles: vi.fn(async () => {
      if (input.provisionError) throw input.provisionError;
      return roleIds;
    }),
    synchronizeMemberRoles: vi.fn(async () => {
      if (input.syncError) throw input.syncError;
      return { approvedRoleGranted: input.approvedRoleGranted === true };
    }),
  };
  const worker = new DiscordRoleSyncWorker({
    pool,
    manager,
    pollIntervalMs: 60_000,
    reconciliationIntervalMs: 60_000,
  });
  return { worker, manager, clientStatements, clientQueries, poolQueries };
}

describe("Discord role sync worker", () => {
  it("serializes provisioning, reconciles, and completes one idempotent outbox job", async () => {
    const fixture = workerFixture();
    await fixture.worker.start();
    await fixture.worker.shutdown();

    expect(fixture.clientStatements).toContain("select pg_advisory_xact_lock(61422918)");
    expect(fixture.poolQueries.some(({ sql }) =>
      sql.includes("periodic_reconciliation"))).toBe(true);
    expect(fixture.poolQueries.some(({ sql }) =>
      sql.includes("status = 'dead'"))).toBe(true);
    expect(fixture.manager.synchronizeMemberRoles).toHaveBeenCalledWith({
      discordUserId: "777777777777777777",
      desiredStatus: "approved",
      roleIds,
    });
    expect(fixture.clientQueries.some(({ sql }) =>
      sql.includes("status = 'completed'"))).toBe(true);
  });

  it("records member absence as degraded and schedules a bounded retry", async () => {
    const fixture = workerFixture(
      { syncError: new DiscordRoleOperationError("member_not_in_guild") },
    );
    await fixture.worker.start();
    await fixture.worker.shutdown();

    const failure = fixture.clientQueries.find(({ sql }) =>
      sql.includes("with failed as"));
    expect(failure?.values).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "pending",
      5,
      "member_not_in_guild",
      "alpha-user",
      "777777777777777777",
      "degraded",
    ]);
  });

  it("fences a stale claim before any Discord mutation", async () => {
    const fixture = workerFixture({ ownsClaim: false });
    await fixture.worker.start();
    await fixture.worker.shutdown();

    expect(fixture.manager.synchronizeMemberRoles).not.toHaveBeenCalled();
    expect(fixture.clientQueries.some(({ sql }) =>
      sql.includes("status = 'completed'"))).toBe(false);
  });

  it("keeps Phase 1 online and retries when Discord role permissions are degraded", async () => {
    const fixture = workerFixture({
      provisionError: new DiscordRoleOperationError("missing_manage_roles"),
    });

    await expect(fixture.worker.start()).resolves.toBeUndefined();
    await fixture.worker.shutdown();

    expect(fixture.manager.discoverOrCreateManagedRoles).toHaveBeenCalledOnce();
    expect(fixture.manager.synchronizeMemberRoles).not.toHaveBeenCalled();
  });

  it("revalidates seller status and identity mapping instead of applying stale jobs", async () => {
    const fixture = workerFixture({ currentDesiredStatus: "suspended" });
    await fixture.worker.start();
    await fixture.worker.shutdown();
    expect(fixture.manager.synchronizeMemberRoles).toHaveBeenCalledWith({
      discordUserId: "777777777777777777",
      desiredStatus: "suspended",
      roleIds,
    });
  });

  it("removes managed roles for an unlink job after the mapping is deleted", async () => {
    const fixture = workerFixture({
      currentDesiredStatus: "approved",
      linkedDiscordUserId: null,
    });
    await fixture.worker.start();
    await fixture.worker.shutdown();
    expect(fixture.manager.synchronizeMemberRoles).toHaveBeenCalledWith({
      discordUserId: "777777777777777777",
      desiredStatus: "none",
      roleIds,
    });
  });

  it("does not let an old unlink retry override a newer relink", async () => {
    const fixture = workerFixture({
      currentDesiredStatus: "approved",
      linkedDiscordUserId: "777777777777777777",
    });

    await fixture.worker.start();
    await fixture.worker.shutdown();
    expect(fixture.manager.synchronizeMemberRoles).toHaveBeenCalledWith({
      discordUserId: "777777777777777777",
      desiredStatus: "approved",
      roleIds,
    });
  });

  it("enqueues one approval DM from the authoritative approval generation", async () => {
    const fixture = workerFixture({ approvedRoleGranted: true });
    await fixture.worker.start();
    await fixture.worker.shutdown();

    const completion = fixture.clientQueries.find(({ sql }) =>
      sql.includes("discord_notification_deliveries"));
    expect(completion?.sql).toContain("'approved-status:' || transition.id::text");
    expect(completion?.values?.slice(4)).toEqual([
      "approved",
    ]);
  });

  it("uses the authoritative approval transition as the durable generation", async () => {
    const reconciliation = workerFixture({
      approvedRoleGranted: true,
      reason: "periodic_reconciliation",
    });
    await reconciliation.worker.start();
    await reconciliation.worker.shutdown();
    const periodic = reconciliation.clientQueries.find(({ sql }) =>
      sql.includes("discord_notification_deliveries"));
    expect(periodic?.values?.slice(4)).toEqual(["approved"]);
    expect(periodic?.sql).toContain("source.reason = 'seller_status_changed'");
    expect(periodic?.sql).toContain(
      "'approved-status:' || transition.id::text",
    );
    expect(periodic?.sql).toContain("on conflict (source_key) do nothing");

    const unchanged = workerFixture({ approvedRoleGranted: false });
    await unchanged.worker.start();
    await unchanged.worker.shutdown();
    const noGrant = unchanged.clientQueries.find(({ sql }) =>
      sql.includes("discord_notification_deliveries"));
    expect(noGrant?.values?.[4]).toBe("approved");
  });

  it("retries the durable approval notification after role grant completion fails", async () => {
    let firstClaimed = false;
    let retryClaimed = false;
    let allowRetry = false;
    let completionAttempts = 0;
    const clientQueries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        clientQueries.push({ sql, values });
        if (sql.includes("select role_key")) return result([]);
        if (sql.includes("and lock_token = $2::uuid") && sql.includes("select 1")) {
          return result([{ "?column?": 1 }]);
        }
        if (sql.includes("where identity.discord_user_id = $1")) {
          return result([{ desired_status: "approved" }]);
        }
        if (sql.includes("discord_notification_deliveries")) {
          completionAttempts += 1;
          if (completionAttempts === 1) {
            throw new Error("completion_write_failed");
          }
        }
        return result([], 1);
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => {
        if (
          sql.includes("with candidate as")
          && sql.includes("returning job.id::text")
        ) {
          if (!firstClaimed) {
            firstClaimed = true;
            return result([{
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                platform_user_id: "alpha-user",
                discord_user_id: "777777777777777777",
                lock_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                attempts: 1,
              }]);
          }
          if (allowRetry && !retryClaimed) {
            retryClaimed = true;
            return result([{
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              platform_user_id: "alpha-user",
              discord_user_id: "777777777777777777",
              lock_token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              attempts: 2,
            }]);
          }
          return result([]);
        }
        return result([]);
      }),
    } as unknown as Pool;
    const manager: DiscordRoleManager = {
      discoverOrCreateManagedRoles: vi.fn(async () => roleIds),
      synchronizeMemberRoles: vi.fn()
        .mockResolvedValueOnce({ approvedRoleGranted: true })
        .mockResolvedValueOnce({ approvedRoleGranted: false }),
    };
    const worker = new DiscordRoleSyncWorker({
      pool,
      manager,
      pollIntervalMs: 60_000,
      reconciliationIntervalMs: 60_000,
    });

    await worker.start();
    allowRetry = true;
    await worker.processAvailableJobs();
    await worker.shutdown();

    expect(manager.synchronizeMemberRoles).toHaveBeenCalledTimes(2);
    const completions = clientQueries.filter(({ sql }) =>
      sql.includes("discord_notification_deliveries"));
    expect(completions).toHaveLength(2);
    expect(completions.every(({ values }) => values?.[4] === "approved")).toBe(
      true,
    );
    expect(completions[1]?.sql).toContain(
      "on conflict (source_key) do nothing",
    );
  });
});
