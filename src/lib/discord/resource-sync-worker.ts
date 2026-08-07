import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

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
const LEASE_CONTENTION_RETRY_MS = 10_000;
const RECONCILIATION_LEASE_SECONDS = 5 * 60;

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
  provisioning_token: string;
  reconciliation_state: "pending" | "ready" | "degraded";
  last_audit_fingerprint: string | null;
};
type Queryable = Pick<Pool, "query">;

function safeFailureCode(error: unknown): DiscordResourceOperationErrorCode | "database_operation_failed" {
  return error instanceof DiscordResourceOperationError
    ? error.code
    : "database_operation_failed";
}

async function acquireReconciliationLease(
  pool: Pool,
  guildId: string,
): Promise<string | null> {
  const leaseToken = randomUUID();
  const result = await pool.query<{ lease_token: string }>(
    `insert into alpha_exchange.discord_resource_reconciliation_leases
      (lease_key, guild_id, lease_token, lease_until)
     values ('seller_resources', $1, $2::uuid, now() + ($3 * interval '1 second'))
     on conflict (lease_key) do update set
       guild_id = excluded.guild_id,
       lease_token = excluded.lease_token,
       lease_until = excluded.lease_until,
       updated_at = now()
     where alpha_exchange.discord_resource_reconciliation_leases.lease_until <= now()
     returning lease_token::text`,
    [guildId, leaseToken, RECONCILIATION_LEASE_SECONDS],
  );
  return result.rows[0]?.lease_token ?? null;
}

async function renewReconciliationLease(
  pool: Pool,
  guildId: string,
  leaseToken: string,
): Promise<void> {
  const result = await pool.query(
    `update alpha_exchange.discord_resource_reconciliation_leases
        set lease_until = now() + ($3 * interval '1 second'),
            updated_at = now()
      where guild_id = $1
        and lease_key = 'seller_resources'
        and lease_token = $2::uuid
        and lease_until > now()`,
    [guildId, leaseToken, RECONCILIATION_LEASE_SECONDS],
  );
  if (result.rowCount !== 1) {
    throw new DiscordResourceOperationError("reconciliation_lease_lost");
  }
}

async function releaseReconciliationLease(
  pool: Pool,
  guildId: string,
  leaseToken: string,
): Promise<boolean> {
  const result = await pool.query(
    `delete from alpha_exchange.discord_resource_reconciliation_leases
      where guild_id = $1
        and lease_key = 'seller_resources'
        and lease_token = $2::uuid`,
    [guildId, leaseToken],
  );
  return result.rowCount === 1;
}

async function ensureResourceRows(
  pool: Pool,
  guildId: string,
  displayNames: DiscordResourceDisplayNames,
  leaseToken: string,
): Promise<void> {
  for (const definition of DISCORD_MANAGED_RESOURCE_DEFINITIONS) {
    const result = await pool.query(
      `with ownership as (
         select 1
           from alpha_exchange.discord_resource_reconciliation_leases
          where lease_key = 'seller_resources'
            and guild_id = $3
            and lease_token = $5::uuid
            and lease_until > now()
          for update
       )
       insert into alpha_exchange.discord_managed_resources
        (resource_key, resource_type, guild_id, display_name)
       select $1, $2, $3, $4
        where exists (select 1 from ownership)
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
         provisioning_token = case
           when alpha_exchange.discord_managed_resources.guild_id = excluded.guild_id
             then alpha_exchange.discord_managed_resources.provisioning_token
           else gen_random_uuid()
         end,
         resource_type = excluded.resource_type,
         guild_id = excluded.guild_id,
         display_name = excluded.display_name,
         updated_at = now()
       where exists (select 1 from ownership)
       returning resource_key`,
      [
        definition.key,
        definition.resourceType,
        guildId,
        displayNames[definition.key],
        leaseToken,
      ],
    );
    if (result.rowCount !== 1) {
      throw new DiscordResourceOperationError("reconciliation_lease_lost");
    }
  }
}

async function readPersistedResources(
  client: Queryable,
  guildId: string,
): Promise<{
  persisted: Partial<Record<DiscordManagedResourceKey, DiscordPersistedResource>>;
  rows: Map<DiscordManagedResourceKey, PersistedResourceRow>;
}> {
  const result = await client.query<PersistedResourceRow>(
    `select resource_key, discord_resource_id, resource_type, display_name,
            provisioning_token, reconciliation_state, last_audit_fingerprint
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
        provisioningToken: row.provisioning_token,
      },
    ])),
  };
}

async function readApprovedSellerRoleId(client: Queryable): Promise<string> {
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
  client: Queryable,
  input: {
    resource: Awaited<ReturnType<DiscordResourceManager["reconcileResources"]>>[number];
    guildId: string;
    leaseToken: string;
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

  const result = await client.query(
    `with updated as (
       update alpha_exchange.discord_managed_resources
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
      where resource_key = $1
        and guild_id = $9
        and exists (
          select 1
            from alpha_exchange.discord_resource_reconciliation_leases lease
           where lease.guild_id = $9
             and lease.lease_key = 'seller_resources'
             and lease.lease_token = $10::uuid
             and lease.lease_until > now()
           for update
        )
      returning resource_key
     ), audited as (
     insert into alpha_exchange.discord_sync_audit
       (event_type, outcome, detail_code)
     select 'resource_reconciliation', 'success', $7
       from updated
      where $8::boolean
     )
     select resource_key from updated`,
    [
      resource.key,
      resource.discordId,
      resource.resourceType,
      guildId,
      resource.displayName,
      fingerprint,
      `${resource.key}:${recovered && resource.action === "verified" ? "recovered" : resource.action}`,
      shouldAudit,
      guildId,
      input.leaseToken,
    ],
  );
  if (result.rowCount !== 1) {
    throw new DiscordResourceOperationError("reconciliation_lease_lost");
  }
}

async function persistResolvedResource(
  client: Queryable,
  resource: Awaited<
    ReturnType<DiscordResourceManager["reconcileResources"]>
  >[number],
  guildId: string,
  leaseToken: string,
): Promise<void> {
  const result = await client.query(
    `update alpha_exchange.discord_managed_resources
        set discord_resource_id = $2,
            provisioned_at = case
              when discord_resource_id is distinct from $2 then now()
              else coalesce(provisioned_at, now())
            end,
            reconciliation_state = 'pending',
            last_error_code = null,
            updated_at = now()
      where resource_key = $1
        and guild_id = $3
        and exists (
          select 1
            from alpha_exchange.discord_resource_reconciliation_leases lease
           where lease.guild_id = $3
             and lease.lease_key = 'seller_resources'
             and lease.lease_token = $4::uuid
             and lease.lease_until > now()
           for update
        )
      returning resource_key`,
    [resource.key, resource.discordId, guildId, leaseToken],
  );
  if (result.rowCount !== 1) {
    throw new DiscordResourceOperationError("reconciliation_lease_lost");
  }
}

async function persistDegradedResources(
  pool: Pool,
  guildId: string,
  failureCode: string,
  leaseToken: string,
): Promise<boolean> {
  const fingerprint = `degraded:${failureCode}`;
  const result = await pool.query<{ owns_lease: boolean }>(
    `with ownership as (
       select 1
         from alpha_exchange.discord_resource_reconciliation_leases
        where guild_id = $1
          and lease_key = 'seller_resources'
          and lease_token = $4::uuid
          and lease_until > now()
        for update
     ), candidates as (
       select resource_key,
              last_audit_fingerprint is distinct from $3 as should_audit
         from alpha_exchange.discord_managed_resources
        where guild_id = $1
          and exists (select 1 from ownership)
        for update
     ), changed as (
       update alpha_exchange.discord_managed_resources
          set reconciliation_state = 'degraded',
              last_error_code = $2,
              last_audit_fingerprint = $3,
              updated_at = now()
         from candidates
        where alpha_exchange.discord_managed_resources.resource_key =
              candidates.resource_key
        returning candidates.should_audit
     ), audited as (
     insert into alpha_exchange.discord_sync_audit
       (event_type, outcome, detail_code)
     select 'resource_reconciliation', 'degraded', $2
      where exists (select 1 from changed where should_audit)
      returning id
     )
     select exists (select 1 from ownership) as owns_lease`,
    [guildId, failureCode, fingerprint, leaseToken],
  );
  return result.rows[0]?.owns_lease === true;
}

async function readDurableResourceDiagnostics(
  pool: Pool,
  guildId: string,
): Promise<DiscordResourceDiagnostics> {
  const result = await pool.query<{
    total_count: number;
    ready_count: number;
  }>(
    `select count(*)::int as total_count,
            count(*) filter (
              where reconciliation_state = 'ready'
                and discord_resource_id is not null
            )::int as ready_count
       from alpha_exchange.discord_managed_resources
      where guild_id = $1`,
    [guildId],
  );
  const totalCount = DISCORD_MANAGED_RESOURCE_KEYS.length;
  const persistedTotal = result.rows[0]?.total_count ?? 0;
  const readyCount = result.rows[0]?.ready_count ?? 0;
  const ready = persistedTotal === totalCount && readyCount === totalCount;
  return {
    status: ready ? "ready" : "degraded",
    totalCount,
    readyCount,
    missingCount: totalCount - readyCount,
    errorCode: ready ? null : "reconciliation_lease_held",
  };
}

export class DiscordResourceSyncWorker {
  private readonly pool: Pool;
  private readonly manager: DiscordResourceManager;
  private readonly guildId: string;
  private readonly displayNames: DiscordResourceDisplayNames;
  private readonly reconciliationIntervalMs: number;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private leaseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private activeReconciliation: Promise<boolean> | null = null;
  private stopped = false;
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
    if (this.reconciliationTimer || this.stopped) return;
    try {
      if (!await this.reconcile()) this.scheduleLeaseRetry();
    } catch (error) {
      if (!(error instanceof DiscordResourceOperationError)) throw error;
      logEvent("warn", {
        event: "discord_resource_sync_start",
        outcome: "failed",
        reason: error.code,
      });
    }
    if (this.stopped) return;
    this.reconciliationTimer = setInterval(() => {
      void this.reconcile()
        .then((completed) => {
          if (!completed) this.scheduleLeaseRetry();
        })
        .catch((error: unknown) => {
          logEvent("error", {
            event: "discord_resource_reconciliation",
            outcome: "failed",
            reason: safeFailureCode(error),
          });
        });
    }, this.reconciliationIntervalMs);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    if (this.leaseRetryTimer) clearTimeout(this.leaseRetryTimer);
    this.reconciliationTimer = null;
    this.leaseRetryTimer = null;
    await this.activeReconciliation?.catch(() => undefined);
  }

  async reconcile(): Promise<boolean> {
    if (this.stopped) return false;
    if (this.activeReconciliation) return this.activeReconciliation;
    this.activeReconciliation = this.performReconcile().finally(() => {
      this.activeReconciliation = null;
    });
    return this.activeReconciliation;
  }

  private async performReconcile(): Promise<boolean> {
    let leaseToken: string | null = null;
    try {
      leaseToken = await acquireReconciliationLease(this.pool, this.guildId);
      if (!leaseToken) {
        this.diagnostics = await readDurableResourceDiagnostics(
          this.pool,
          this.guildId,
        );
        logEvent("info", {
          event: "discord_resource_reconciliation_skipped",
          outcome: "success",
          reason: "lease_held",
        });
        return false;
      }
      const activeLeaseToken = leaseToken;
      await ensureResourceRows(
        this.pool,
        this.guildId,
        this.displayNames,
        activeLeaseToken,
      );
      const { persisted, rows } = await readPersistedResources(
        this.pool,
        this.guildId,
      );
      const approvedSellerRoleId = await readApprovedSellerRoleId(this.pool);
      const resources = await this.manager.reconcileResources({
        persisted,
        approvedSellerRoleId,
        displayNames: this.displayNames,
        beforeResourceReconcile: () =>
          renewReconciliationLease(this.pool, this.guildId, activeLeaseToken),
        persistResolvedResource: async (resource) => {
          await renewReconciliationLease(
            this.pool,
            this.guildId,
            activeLeaseToken,
          );
          await persistResolvedResource(
            this.pool,
            resource,
            this.guildId,
            activeLeaseToken,
          );
        },
        persistReconciledResource: async (resource) => {
          await renewReconciliationLease(
            this.pool,
            this.guildId,
            activeLeaseToken,
          );
          await persistReadyResource(this.pool, {
            resource,
            guildId: this.guildId,
            leaseToken: activeLeaseToken,
            previous: rows.get(resource.key),
          });
        },
      });
      this.diagnostics = {
        status: "ready",
        totalCount: resources.length,
        readyCount: resources.length,
        missingCount: 0,
        errorCode: null,
      };
      return true;
    } catch (error) {
      const failureCode = safeFailureCode(error);
      this.diagnostics = {
        status: "degraded",
        totalCount: DISCORD_MANAGED_RESOURCE_KEYS.length,
        readyCount: 0,
        missingCount: DISCORD_MANAGED_RESOURCE_KEYS.length,
        errorCode: failureCode,
      };
      if (failureCode !== "reconciliation_lease_lost" && leaseToken) {
        let persistedWhileOwned: boolean;
        try {
          persistedWhileOwned = await persistDegradedResources(
            this.pool,
            this.guildId,
            failureCode,
            leaseToken,
          );
        } catch (persistenceError) {
          throw new AggregateError(
            [error, persistenceError],
            "Discord resource reconciliation and degradation persistence failed.",
          );
        }
        if (!persistedWhileOwned) {
          const leaseError = new DiscordResourceOperationError(
            "reconciliation_lease_lost",
            { cause: error },
          );
          this.diagnostics = {
            ...this.diagnostics,
            errorCode: leaseError.code,
          };
          throw leaseError;
        }
      }
      throw error;
    } finally {
      if (leaseToken) {
        try {
          const released = await releaseReconciliationLease(
            this.pool,
            this.guildId,
            leaseToken,
          );
          if (!released) {
            logEvent("warn", {
              event: "discord_resource_lock_release",
              outcome: "failed",
              reason: "reconciliation_lease_lost",
            });
          }
        } catch (error) {
          logEvent("warn", {
            event: "discord_resource_lock_release",
            outcome: "failed",
            reason: "database_operation_failed",
            metadata: {
              errorType: error instanceof Error ? error.name : typeof error,
            },
          });
        }
      }
    }
  }

  private scheduleLeaseRetry(): void {
    if (this.stopped || this.leaseRetryTimer) return;
    this.leaseRetryTimer = setTimeout(() => {
      this.leaseRetryTimer = null;
      if (this.stopped) return;
      void this.reconcile()
        .then((completed) => {
          if (!completed) this.scheduleLeaseRetry();
        })
        .catch((error: unknown) => {
          logEvent("error", {
            event: "discord_resource_lease_retry",
            outcome: "failed",
            reason: safeFailureCode(error),
          });
        });
    }, LEASE_CONTENTION_RETRY_MS);
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
