import "server-only";

import type { Pool, PoolClient } from "pg";

import { readDiscordConfig } from "@/lib/discord/config";
import type { DiscordResourceDiagnostics } from "@/lib/discord/diagnostics";
import {
  DISCORD_MANAGED_RESOURCE_DEFINITIONS,
  DISCORD_MANAGED_RESOURCE_KEYS,
  DiscordResourceOperationError,
  DiscordRestResourceManager,
  readDiscordResourceDisplayNames,
  type DiscordManagedResourceKey,
  type DiscordPersistedResource,
  type DiscordResourceDisplayNames,
  type DiscordResourceManager,
  type DiscordResourceOperationErrorCode,
} from "@/lib/discord/resource-manager";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { logEvent } from "@/lib/structured-logging";

const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const RESOURCE_ADVISORY_LOCK_ID = 61422919;

type ResourceSyncWorkerDependencies = {
  pool: Pool;
  manager: DiscordResourceManager;
  guildId: string;
  displayNames: DiscordResourceDisplayNames;
  reconciliationIntervalMs?: number;
};

type PersistedResourceRow = {
  resource_key: DiscordManagedResourceKey;
  discord_resource_id: string | null;
  resource_type: DiscordPersistedResource["resourceType"];
  display_name: string;
  reconciliation_state: "pending" | "ready" | "degraded";
  last_audit_fingerprint: string | null;
};

function safeFailureCode(error: unknown): DiscordResourceOperationErrorCode | "database_operation_failed" {
  return error instanceof DiscordResourceOperationError
    ? error.code
    : "database_operation_failed";
}

async function ensureResourceRows(
  pool: Pool,
  guildId: string,
  displayNames: DiscordResourceDisplayNames,
): Promise<void> {
  for (const definition of DISCORD_MANAGED_RESOURCE_DEFINITIONS) {
    await pool.query(
      `insert into alpha_exchange.discord_managed_resources
        (resource_key, resource_type, guild_id, display_name)
       values ($1, $2, $3, $4)
       on conflict (resource_key) do update set
         discord_resource_id = case
           when alpha_exchange.discord_managed_resources.guild_id = excluded.guild_id
             then alpha_exchange.discord_managed_resources.discord_resource_id
           else null
         end,
         reconciliation_state = case
           when alpha_exchange.discord_managed_resources.guild_id = excluded.guild_id
             then alpha_exchange.discord_managed_resources.reconciliation_state
           else 'pending'
         end,
         provisioned_at = case
           when alpha_exchange.discord_managed_resources.guild_id = excluded.guild_id
             then alpha_exchange.discord_managed_resources.provisioned_at
           else null
         end,
         verified_at = case
           when alpha_exchange.discord_managed_resources.guild_id = excluded.guild_id
             then alpha_exchange.discord_managed_resources.verified_at
           else null
         end,
         last_error_code = case
           when alpha_exchange.discord_managed_resources.guild_id = excluded.guild_id
             then alpha_exchange.discord_managed_resources.last_error_code
           else null
         end,
         last_audit_fingerprint = case
           when alpha_exchange.discord_managed_resources.guild_id = excluded.guild_id
             then alpha_exchange.discord_managed_resources.last_audit_fingerprint
           else null
         end,
         resource_type = excluded.resource_type,
         guild_id = excluded.guild_id,
         display_name = excluded.display_name,
         updated_at = now()`,
      [
        definition.key,
        definition.resourceType,
        guildId,
        displayNames[definition.key],
      ],
    );
  }
}

async function readPersistedResources(
  client: PoolClient,
  guildId: string,
): Promise<{
  persisted: Partial<Record<DiscordManagedResourceKey, DiscordPersistedResource>>;
  rows: Map<DiscordManagedResourceKey, PersistedResourceRow>;
}> {
  const result = await client.query<PersistedResourceRow>(
    `select resource_key, discord_resource_id, resource_type, display_name,
            reconciliation_state, last_audit_fingerprint
       from alpha_exchange.discord_managed_resources
      where guild_id = $1`,
    [guildId],
  );
  const rows = new Map(result.rows.map((row) => [row.resource_key, row]));
  return {
    rows,
    persisted: Object.fromEntries(result.rows.map((row) => [
      row.resource_key,
      {
        discordId: row.discord_resource_id,
        resourceType: row.resource_type,
        displayName: row.display_name,
      },
    ])),
  };
}

async function readApprovedSellerRoleId(client: PoolClient): Promise<string> {
  const result = await client.query<{ discord_role_id: string }>(
    `select discord_role_id
       from alpha_exchange.discord_managed_roles
      where role_key = 'approved_seller'`,
  );
  const roleId = result.rows[0]?.discord_role_id;
  if (!roleId) {
    throw new DiscordResourceOperationError("approved_role_missing");
  }
  return roleId;
}

async function persistReadyResource(
  client: PoolClient,
  input: {
    resource: Awaited<ReturnType<DiscordResourceManager["reconcileResources"]>>[number];
    guildId: string;
    previous: PersistedResourceRow | undefined;
  },
): Promise<void> {
  const { resource, guildId, previous } = input;
  const fingerprint = `ready:${resource.discordId}:${resource.displayName}`;
  const recovered = previous?.reconciliation_state === "degraded";
  const shouldAudit =
    resource.action !== "verified"
    || recovered
    || previous?.last_audit_fingerprint !== fingerprint;

  await client.query(
    `update alpha_exchange.discord_managed_resources
        set discord_resource_id = $2,
            resource_type = $3,
            guild_id = $4,
            display_name = $5,
            reconciliation_state = 'ready',
            last_error_code = null,
            provisioned_at = case
              when discord_resource_id is distinct from $2 then now()
              else coalesce(provisioned_at, now())
            end,
            verified_at = now(),
            last_audit_fingerprint = $6,
            updated_at = now()
      where resource_key = $1`,
    [
      resource.key,
      resource.discordId,
      resource.resourceType,
      guildId,
      resource.displayName,
      fingerprint,
    ],
  );

  if (shouldAudit) {
    await client.query(
      `insert into alpha_exchange.discord_sync_audit
        (event_type, outcome, detail_code)
       values ('resource_reconciliation', 'success', $1)`,
      [`${resource.key}:${recovered && resource.action === "verified" ? "recovered" : resource.action}`],
    );
  }
}

async function persistDegradedResources(
  pool: Pool,
  guildId: string,
  failureCode: string,
): Promise<void> {
  const fingerprint = `degraded:${failureCode}`;
  await pool.query(
    `with changed as (
       update alpha_exchange.discord_managed_resources
          set reconciliation_state = 'degraded',
              last_error_code = $2,
              last_audit_fingerprint = $3,
              updated_at = now()
        where guild_id = $1
          and last_audit_fingerprint is distinct from $3
        returning resource_key
     )
     insert into alpha_exchange.discord_sync_audit
       (event_type, outcome, detail_code)
     select 'resource_reconciliation', 'degraded', $2
      where exists (select 1 from changed)`,
    [guildId, failureCode, fingerprint],
  );
}

export class DiscordResourceSyncWorker {
  private readonly pool: Pool;
  private readonly manager: DiscordResourceManager;
  private readonly guildId: string;
  private readonly displayNames: DiscordResourceDisplayNames;
  private readonly reconciliationIntervalMs: number;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private reconciling = false;
  private diagnostics: DiscordResourceDiagnostics = {
    status: "degraded",
    totalCount: DISCORD_MANAGED_RESOURCE_KEYS.length,
    readyCount: 0,
    missingCount: DISCORD_MANAGED_RESOURCE_KEYS.length,
    errorCode: "not_reconciled",
  };

  constructor({
    pool,
    manager,
    guildId,
    displayNames,
    reconciliationIntervalMs = RECONCILIATION_INTERVAL_MS,
  }: ResourceSyncWorkerDependencies) {
    this.pool = pool;
    this.manager = manager;
    this.guildId = guildId;
    this.displayNames = displayNames;
    this.reconciliationIntervalMs = reconciliationIntervalMs;
  }

  getDiagnostics(): DiscordResourceDiagnostics {
    return { ...this.diagnostics };
  }

  async start(): Promise<void> {
    if (this.reconciliationTimer) return;
    try {
      await this.reconcile();
    } catch (error) {
      if (!(error instanceof DiscordResourceOperationError)) throw error;
      logEvent("warn", {
        event: "discord_resource_sync_start",
        outcome: "failed",
        reason: error.code,
      });
    }
    this.reconciliationTimer = setInterval(() => {
      void this.reconcile().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_resource_reconciliation",
          outcome: "failed",
          reason: safeFailureCode(error),
        });
      });
    }, this.reconciliationIntervalMs);
  }

  async shutdown(): Promise<void> {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = null;
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    let client: PoolClient | null = null;
    let transactionOpen = false;
    try {
      await ensureResourceRows(this.pool, this.guildId, this.displayNames);
      client = await this.pool.connect();
      await client.query("begin");
      transactionOpen = true;
      await client.query(`select pg_advisory_xact_lock(${RESOURCE_ADVISORY_LOCK_ID})`);
      const { persisted, rows } = await readPersistedResources(
        client,
        this.guildId,
      );
      const approvedSellerRoleId = await readApprovedSellerRoleId(client);
      const resources = await this.manager.reconcileResources({
        persisted,
        approvedSellerRoleId,
        displayNames: this.displayNames,
      });
      for (const resource of resources) {
        await persistReadyResource(client, {
          resource,
          guildId: this.guildId,
          previous: rows.get(resource.key),
        });
      }
      await client.query("commit");
      transactionOpen = false;
      this.diagnostics = {
        status: "ready",
        totalCount: resources.length,
        readyCount: resources.length,
        missingCount: 0,
        errorCode: null,
      };
    } catch (error) {
      const failureCode = safeFailureCode(error);
      this.diagnostics = {
        status: "degraded",
        totalCount: DISCORD_MANAGED_RESOURCE_KEYS.length,
        readyCount: 0,
        missingCount: DISCORD_MANAGED_RESOURCE_KEYS.length,
        errorCode: failureCode,
      };
      if (transactionOpen && client) {
        try {
          await client.query("rollback");
          transactionOpen = false;
        } catch (rollbackError) {
          client.release(true);
          client = null;
          throw new AggregateError(
            [error, rollbackError],
            "Discord resource reconciliation rollback failed.",
          );
        }
      }
      try {
        await persistDegradedResources(this.pool, this.guildId, failureCode);
      } catch (persistenceError) {
        throw new AggregateError(
          [error, persistenceError],
          "Discord resource reconciliation and degradation persistence failed.",
        );
      }
      throw error;
    } finally {
      client?.release();
      this.reconciling = false;
    }
  }
}

export function createDiscordResourceSyncWorker(): DiscordResourceSyncWorker {
  const pool = getRuntimePostgresPool();
  if (!pool) {
    throw new Error(
      "Discord resource synchronization requires DATABASE_URL or SUPABASE_DB_URL.",
    );
  }
  const config = readDiscordConfig();
  return new DiscordResourceSyncWorker({
    pool,
    guildId: config.guildId,
    displayNames: readDiscordResourceDisplayNames(),
    manager: new DiscordRestResourceManager({
      token: config.token,
      guildId: config.guildId,
    }),
  });
}
