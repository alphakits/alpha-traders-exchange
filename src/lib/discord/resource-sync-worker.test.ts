// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISCORD_MANAGED_RESOURCE_DEFINITIONS,
  DiscordResourceOperationError,
  type DiscordManagedResourceKey,
  type DiscordResourceManager,
} from "@/lib/discord/resource-manager";
import { DiscordResourceSyncWorker } from "@/lib/discord/resource-sync-worker";

const guildId = "111111111111111111";
const approvedRoleId = "444444444444444444";
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
  reconciliation_state: "pending" | "ready" | "degraded";
  last_audit_fingerprint: string | null;
};

function databaseFixture() {
  const rows = new Map<DiscordManagedResourceKey, StoredRow>();
  const audits: string[] = [];
  const statements: string[] = [];
  let locked = false;
  const waiters: Array<() => void> = [];

  async function acquire() {
    if (!locked) {
      locked = true;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    locked = true;
  }
  function unlock() {
    locked = false;
    waiters.shift()?.();
  }

  const pool = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push(sql);
      if (sql.includes("insert into alpha_exchange.discord_managed_resources")) {
        const key = values![0] as DiscordManagedResourceKey;
        const existing = rows.get(key);
        rows.set(key, existing ?? {
          resource_key: key,
          discord_resource_id: null,
          resource_type: values![1] as StoredRow["resource_type"],
          display_name: values![3] as string,
          reconciliation_state: "pending",
          last_audit_fingerprint: null,
        });
        return result([]);
      }
      if (sql.includes("with changed as")) {
        const failureCode = values![1] as string;
        const fingerprint = values![2] as string;
        let changed = false;
        for (const row of rows.values()) {
          if (row.last_audit_fingerprint === fingerprint) continue;
          row.reconciliation_state = "degraded";
          row.last_audit_fingerprint = fingerprint;
          changed = true;
        }
        if (changed) audits.push(`degraded:${failureCode}`);
        return result([]);
      }
      return result([]);
    }),
    connect: vi.fn(async () => {
      let ownsLock = false;
      const client = {
        query: vi.fn(async (sql: string, values?: unknown[]) => {
          statements.push(sql);
          if (sql.startsWith("select pg_advisory_xact_lock")) {
            await acquire();
            ownsLock = true;
            return result([]);
          }
          if (sql === "commit" || sql === "rollback") {
            if (ownsLock) unlock();
            ownsLock = false;
            return result([]);
          }
          if (sql.includes("from alpha_exchange.discord_managed_resources")) {
            return result([...rows.values()].map((row) => ({ ...row })));
          }
          if (sql.includes("from alpha_exchange.discord_managed_roles")) {
            return result([{ discord_role_id: approvedRoleId }]);
          }
          if (sql.startsWith("update alpha_exchange.discord_managed_resources")) {
            const key = values![0] as DiscordManagedResourceKey;
            const row = rows.get(key)!;
            row.discord_resource_id = values![1] as string;
            row.resource_type = values![2] as StoredRow["resource_type"];
            row.display_name = values![4] as string;
            row.reconciliation_state = "ready";
            row.last_audit_fingerprint = values![5] as string;
            return result([]);
          }
          if (sql.includes("insert into alpha_exchange.discord_sync_audit")) {
            audits.push(values![0] as string);
            return result([]);
          }
          return result([]);
        }),
        release: vi.fn(),
      };
      return client as unknown as PoolClient;
    }),
  } as unknown as Pool;
  return { pool, rows, audits, statements };
}

function managerFixture(input: { failOnce?: boolean } = {}) {
  let failed = false;
  let nextId = BigInt("600000000000000000");
  let created = 0;
  const manager: DiscordResourceManager = {
    reconcileResources: vi.fn(async ({ persisted, displayNames: names }) => {
      if (input.failOnce && !failed) {
        failed = true;
        throw new DiscordResourceOperationError("missing_manage_channels");
      }
      return DISCORD_MANAGED_RESOURCE_DEFINITIONS.map((definition) => {
        const existing = persisted[definition.key]?.discordId;
        if (!existing) {
          nextId += BigInt(1);
          created += 1;
        }
        return {
          key: definition.key,
          discordId: existing ?? nextId.toString(),
          resourceType: definition.resourceType,
          displayName: names[definition.key],
          action: existing ? "verified" as const : "created" as const,
        };
      });
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

    expect(manager.created()).toBe(7);
    expect(database.rows.size).toBe(7);
    expect([...database.rows.values()].every((row) =>
      row.reconciliation_state === "ready" && row.discord_resource_id)).toBe(true);
    expect(database.audits).toHaveLength(7);
    expect(database.statements).toContain(
      "select pg_advisory_xact_lock(61422919)",
    );
    expect(first.getDiagnostics()).toEqual({
      status: "ready",
      totalCount: 7,
      readyCount: 7,
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
      missingCount: 7,
      errorCode: "missing_manage_channels",
    });
    expect(database.audits).toEqual(["degraded:missing_manage_channels"]);

    await resourceWorker.reconcile();
    await resourceWorker.shutdown();

    expect(resourceWorker.getDiagnostics()).toMatchObject({
      status: "ready",
      readyCount: 7,
      missingCount: 0,
    });
    expect(database.audits.filter((audit) =>
      audit === "degraded:missing_manage_channels")).toHaveLength(1);
    expect(database.audits).toHaveLength(8);
  });

  it("defines race-safe persistence and constrained reconciliation state", () => {
    const migration = readFileSync(
      resolve("supabase/migrations/20260807190000_discord_seller_resources.sql"),
      "utf8",
    );
    expect(migration).toContain("resource_key text primary key");
    expect(migration).toContain("discord_resource_id text unique");
    expect(migration).toContain("discord_resource_id ~ '^[0-9]{17,20}$'");
    expect(migration).toContain(
      "reconciliation_state in ('pending', 'ready', 'degraded')",
    );
  });
});
