// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISCORD_MANAGED_RESOURCE_DEFINITIONS,
  DiscordResourceOperationError,
  type DiscordManagedResourceKey,
  type DiscordReconciledResource,
  type DiscordResourceManager,
} from "@/lib/discord/resource-manager";
import { DiscordResourceSyncWorker } from "@/lib/discord/resource-sync-worker";

const guildId = "111111111111111111";
const approvedRoleId = "444444444444444444";
const managedResourceCount = 13;
const displayNames = Object.fromEntries(
  DISCORD_MANAGED_RESOURCE_DEFINITIONS.map((definition) => [
    definition.key,
    definition.key === "seller_category"
      ? "ALPHA SELLER SUITE"
      : definition.key.replaceAll("_", "-"),
  ]),
) as Record<DiscordManagedResourceKey, string>;

function result<T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length,
): QueryResult<T> {
  return { command: "", rowCount, oid: 0, fields: [], rows };
}

type StoredRow = {
  resource_key: DiscordManagedResourceKey;
  discord_resource_id: string | null;
  resource_type: "category" | "text_channel";
  display_name: string;
  provisioning_token: string;
  reconciliation_state: "pending" | "ready" | "degraded";
  last_audit_fingerprint: string | null;
};

function databaseFixture() {
  const rows = new Map<DiscordManagedResourceKey, StoredRow>();
  const audits: string[] = [];
  const statements: string[] = [];
  let activeLeaseToken: string | null = null;

  const pool = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push(sql);
      if (
        sql.includes(
          "insert into alpha_exchange.discord_resource_reconciliation_leases",
        )
      ) {
        if (activeLeaseToken) return result([]);
        activeLeaseToken = values![1] as string;
        return result([{ lease_token: activeLeaseToken }]);
      }
      if (
        sql.startsWith(
          "update alpha_exchange.discord_resource_reconciliation_leases",
        )
      ) {
        return result(
          [],
          activeLeaseToken === values![1] ? 1 : 0,
        );
      }
      if (
        sql.startsWith(
          "delete from alpha_exchange.discord_resource_reconciliation_leases",
        )
      ) {
        const ownsLease = activeLeaseToken === values![1];
        if (ownsLease) activeLeaseToken = null;
        return result([], ownsLease ? 1 : 0);
      }
      if (sql.includes("insert into alpha_exchange.discord_managed_resources")) {
        const key = values![0] as DiscordManagedResourceKey;
        if (activeLeaseToken !== values![4]) return result([]);
        const existing = rows.get(key);
        rows.set(key, existing ?? {
          resource_key: key,
          discord_resource_id: null,
          resource_type: values![1] as StoredRow["resource_type"],
          display_name: values![3] as string,
          provisioning_token: "123e4567-e89b-42d3-a456-426614174000",
          reconciliation_state: "pending",
          last_audit_fingerprint: null,
        });
        return result([{ resource_key: key }]);
      }
      if (
        sql.includes("with ownership as")
        && sql.includes("reconciliation_state = 'degraded'")
      ) {
        const failureCode = values![1] as string;
        const fingerprint = values![2] as string;
        const ownsLease = activeLeaseToken === values![3];
        let changed = false;
        if (ownsLease) {
          for (const row of rows.values()) {
            const shouldAudit = row.last_audit_fingerprint !== fingerprint;
            row.reconciliation_state = "degraded";
            row.last_audit_fingerprint = fingerprint;
            changed ||= shouldAudit;
          }
        }
        if (changed) audits.push(`degraded:${failureCode}`);
        return result([{ owns_lease: ownsLease }]);
      }
      if (sql.includes("count(*)::int as total_count")) {
        return result([{
          total_count: rows.size,
          ready_count: [...rows.values()].filter((row) =>
            row.reconciliation_state === "ready"
            && row.discord_resource_id !== null).length,
        }]);
      }
      if (sql.includes("from alpha_exchange.discord_managed_resources")) {
        return result([...rows.values()].map((row) => ({ ...row })));
      }
      if (sql.includes("from alpha_exchange.discord_managed_roles")) {
        return result([{ discord_role_id: approvedRoleId }]);
      }
      if (
        sql.startsWith("update alpha_exchange.discord_managed_resources")
        && sql.includes("reconciliation_state = 'pending'")
      ) {
        const key = values![0] as DiscordManagedResourceKey;
        if (activeLeaseToken !== values![3]) return result([]);
        rows.get(key)!.discord_resource_id = values![1] as string;
        rows.get(key)!.reconciliation_state = "pending";
        return result([{ resource_key: key }]);
      }
      if (sql.startsWith("with updated as")) {
        const key = values![0] as DiscordManagedResourceKey;
        if (activeLeaseToken !== values![9]) return result([]);
        const row = rows.get(key)!;
        row.discord_resource_id = values![1] as string;
        row.resource_type = values![2] as StoredRow["resource_type"];
        row.display_name = values![4] as string;
        row.reconciliation_state = "ready";
        row.last_audit_fingerprint = values![5] as string;
        if (values![7]) audits.push(values![6] as string);
        return result([{ resource_key: key }]);
      }
      return result([]);
    }),
  } as unknown as Pool;
  return {
    pool,
    rows,
    audits,
    statements,
    stealLease: () => {
      activeLeaseToken = "stolen-lease-token";
    },
  };
}

function managerFixture(input: { failOnce?: boolean } = {}) {
  let failed = false;
  let nextId = BigInt("600000000000000000");
  let created = 0;
  const manager: DiscordResourceManager = {
    reconcileResources: vi.fn(async ({
      persisted,
      displayNames: names,
      beforeResourceReconcile,
      persistResolvedResource,
      persistReconciledResource,
    }) => {
      if (input.failOnce && !failed) {
        failed = true;
        throw new DiscordResourceOperationError("missing_manage_channels");
      }
      const resources: DiscordReconciledResource[] = [];
      for (const definition of DISCORD_MANAGED_RESOURCE_DEFINITIONS) {
        await beforeResourceReconcile?.();
        const existing = persisted[definition.key]?.discordId;
        if (!existing) {
          nextId += BigInt(1);
          created += 1;
        }
        const resource = {
          key: definition.key,
          discordId: existing ?? nextId.toString(),
          resourceType: definition.resourceType,
          displayName: names[definition.key],
          action: existing ? "verified" as const : "created" as const,
        };
        if (!existing) await persistResolvedResource?.(resource);
        await persistReconciledResource?.(resource);
        resources.push(resource);
      }
      return resources;
    }),
  };
  return { manager, created: () => created };
}

function worker(
  pool: Pool,
  manager: DiscordResourceManager,
): DiscordResourceSyncWorker {
  return new DiscordResourceSyncWorker({
    pool,
    manager,
    guildId,
    displayNames,
    reconciliationIntervalMs: 60_000,
  });
}

describe("Discord seller resource sync worker", () => {
  it("serializes concurrent provisioning, persists IDs, and suppresses repeat audits", async () => {
    const database = databaseFixture();
    const manager = managerFixture();
    const first = worker(database.pool, manager.manager);
    const second = worker(database.pool, manager.manager);

    await Promise.all([first.reconcile(), second.reconcile()]);
    await first.reconcile();

    expect(manager.created()).toBe(managedResourceCount);
    expect(database.rows.size).toBe(managedResourceCount);
    expect([...database.rows.values()].every((row) =>
      row.reconciliation_state === "ready" && row.discord_resource_id)).toBe(true);
    expect(database.audits).toHaveLength(managedResourceCount);
    expect(database.statements.some((sql) =>
      sql.includes("discord_resource_reconciliation_leases"))).toBe(true);
    expect(database.statements.some((sql) =>
      sql.startsWith(
        "delete from alpha_exchange.discord_resource_reconciliation_leases",
      ))).toBe(true);
    expect(database.statements.findIndex((sql) =>
      sql.includes("discord_resource_reconciliation_leases"))).toBeLessThan(
      database.statements.findIndex((sql) =>
        sql.includes("insert into alpha_exchange.discord_managed_resources")),
    );
    expect(first.getDiagnostics()).toEqual({
      status: "ready",
      totalCount: managedResourceCount,
      readyCount: managedResourceCount,
      missingCount: 0,
      errorCode: null,
    });
  });

  it("records durable non-noisy degradation and recovers on reconciliation", async () => {
    const database = databaseFixture();
    const manager = managerFixture({ failOnce: true });
    const resourceWorker = worker(database.pool, manager.manager);

    await expect(resourceWorker.start()).resolves.toBeUndefined();
    expect(resourceWorker.getDiagnostics()).toMatchObject({
      status: "degraded",
      missingCount: managedResourceCount,
      errorCode: "missing_manage_channels",
    });

    expect(database.audits).toEqual(["degraded:missing_manage_channels"]);

    await resourceWorker.reconcile();
    await resourceWorker.shutdown();

    expect(resourceWorker.getDiagnostics()).toMatchObject({
      status: "ready",
      readyCount: managedResourceCount,
      missingCount: 0,
    });
    expect(database.audits.filter((audit) =>
      audit === "degraded:missing_manage_channels")).toHaveLength(1);
    expect(database.audits).toHaveLength(managedResourceCount + 1);
  });

  it("reapplies degraded state without duplicating the same audit", async () => {
    const database = databaseFixture();
    const manager: DiscordResourceManager = {
      reconcileResources: vi.fn(async () => {
        throw new DiscordResourceOperationError("missing_manage_channels");
      }),
    };
    const resourceWorker = worker(database.pool, manager);
    await resourceWorker.start();
    const row = database.rows.get("seller_category")!;
    row.reconciliation_state = "pending";

    await expect(resourceWorker.reconcile())
      .rejects.toMatchObject({ code: "missing_manage_channels" });
    await resourceWorker.shutdown();

    expect(row.reconciliation_state).toBe("degraded");
    expect(database.audits.filter((audit) =>
      audit === "degraded:missing_manage_channels")).toHaveLength(1);
  });

  it("reports durable readiness while another worker owns the lease", async () => {
    const database = databaseFixture();
    const manager = managerFixture();
    await worker(database.pool, manager.manager).reconcile();
    database.stealLease();
    const contender = worker(database.pool, manager.manager);

    await contender.start();
    expect(contender.getDiagnostics()).toEqual({
      status: "ready",
      totalCount: managedResourceCount,
      readyCount: managedResourceCount,
      missingCount: 0,
      errorCode: null,
    });
    await contender.shutdown();
  });

  it("keeps a resolved Discord ID durable when a later resource fails", async () => {
    const database = databaseFixture();
    const manager: DiscordResourceManager = {
      reconcileResources: vi.fn(async ({
        displayNames: names,
        persistResolvedResource: persist,
      }) => {
        const definition = DISCORD_MANAGED_RESOURCE_DEFINITIONS[0]!;
        await persist?.({
          key: definition.key,
          discordId: "600000000000000001",
          resourceType: definition.resourceType,
          displayName: names[definition.key],
          action: "created",
        });
        throw new DiscordResourceOperationError("api_failure");
      }),
    };

    await expect(worker(database.pool, manager).reconcile())
      .rejects.toMatchObject({ code: "api_failure" });

    expect(database.rows.get("seller_category")).toMatchObject({
      discord_resource_id: "600000000000000001",
      reconciliation_state: "degraded",
    });
  });

  it("does not let a stale lease loser overwrite shared readiness", async () => {
    const database = databaseFixture();
    const manager: DiscordResourceManager = {
      reconcileResources: vi.fn(async () => {
        database.stealLease();
        throw new DiscordResourceOperationError("api_failure");
      }),
    };
    const resourceWorker = worker(database.pool, manager);

    await expect(resourceWorker.reconcile())
      .rejects.toMatchObject({ code: "reconciliation_lease_lost" });

    expect(resourceWorker.getDiagnostics()).toMatchObject({
      status: "degraded",
      errorCode: "reconciliation_lease_lost",
    });
    expect(database.audits).toEqual([]);
    expect([...database.rows.values()].every((row) =>
      row.reconciliation_state === "pending")).toBe(true);
  });

  it("does not re-arm timers when shutdown overlaps reconciliation", async () => {
    vi.useFakeTimers();
    try {
      const database = databaseFixture();
      let releaseReconciliation!: () => void;
      let markStarted!: () => void;
      const reconciliationGate = new Promise<void>((resolve) => {
        releaseReconciliation = resolve;
      });
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const manager: DiscordResourceManager = {
        reconcileResources: vi.fn(async () => {
          markStarted();
          await reconciliationGate;
          return [];
        }),
      };
      const resourceWorker = worker(database.pool, manager);

      const startPromise = resourceWorker.start();
      await started;
      const shutdownPromise = resourceWorker.shutdown();
      releaseReconciliation();
      await Promise.all([startPromise, shutdownPromise]);
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

      expect(manager.reconcileResources).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defines race-safe persistence and constrained reconciliation state", () => {
    const migration = readFileSync(
      resolve("supabase/migrations/20260807190000_discord_seller_resources.sql"),
      "utf8",
    );
    const leaseMigration = readFileSync(
      resolve(
        "supabase/migrations/20260807210000_discord_resource_reconciliation_lease.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("resource_key text primary key");
    expect(migration).toContain("discord_resource_id text unique");
    expect(leaseMigration).toContain("provisioning_token uuid");
    expect(leaseMigration).toContain(
      "discord_resource_reconciliation_leases",
    );
    expect(leaseMigration).toContain(
      "lease_key text primary key",
    );
    expect(migration).toContain("discord_resource_id ~ '^[0-9]{17,20}$'");
    expect(migration).toContain(
      "reconciliation_state in ('pending', 'ready', 'degraded')",
    );
  });
});
