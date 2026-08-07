import "server-only";

import type { Pool, PoolClient } from "pg";

import {
  DISCORD_MANAGED_ROLES,
  DiscordRestRoleManager,
  DiscordRoleOperationError,
  type DiscordManagedRoleIds,
  type DiscordManagedRoleKey,
  type DiscordRoleManager,
  type DiscordSellerRoleStatus,
} from "@/lib/discord/role-manager";
import { readDiscordConfig } from "@/lib/discord/config";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { logEvent } from "@/lib/structured-logging";

const POLL_INTERVAL_MS = 5_000;
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const RECONCILIATION_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 8;

type OutboxJob = {
  id: string;
  platformUserId: string;
  discordUserId: string;
  lockToken: string;
  attempts: number;
};

type Queryable = Pick<Pool, "query">;

type RoleSyncWorkerDependencies = {
  pool: Pool;
  manager: DiscordRoleManager;
  pollIntervalMs?: number;
  reconciliationIntervalMs?: number;
};

function safeFailureCode(error: unknown): string {
  if (error instanceof DiscordRoleOperationError) return error.code;
  return "unexpected_failure";
}

async function readPersistedRoleIds(
  client: PoolClient,
): Promise<Partial<DiscordManagedRoleIds>> {
  const result = await client.query<{
    role_key: DiscordManagedRoleKey;
    discord_role_id: string;
  }>(
    `select role_key, discord_role_id
       from alpha_exchange.discord_managed_roles`,
  );
  return Object.fromEntries(
    result.rows.map((row) => [row.role_key, row.discord_role_id]),
  );
}

async function provisionManagedRoles(
  pool: Pool,
  manager: DiscordRoleManager,
): Promise<DiscordManagedRoleIds> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(61422918)");
    const persisted = await readPersistedRoleIds(client);
    const roles = await manager.discoverOrCreateManagedRoles(persisted);
    for (const definition of DISCORD_MANAGED_ROLES) {
      await client.query(
        `insert into alpha_exchange.discord_managed_roles
          (role_key, discord_role_id, role_name)
         values ($1, $2, $3)
         on conflict (role_key) do update set
           discord_role_id = excluded.discord_role_id,
           role_name = excluded.role_name,
           verified_at = now()`,
        [definition.key, roles[definition.key], definition.name],
      );
    }
    await client.query("commit");
    return roles;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function claimJob(pool: Pool): Promise<OutboxJob | null> {
  const result = await pool.query<{
    id: string;
    platform_user_id: string;
    discord_user_id: string;
    lock_token: string;
    attempts: number;
  }>(
    `with candidate as (
       select id
         from alpha_exchange.discord_role_sync_outbox
        where (
          status = 'pending' and available_at <= now()
        ) or (
          status = 'processing' and locked_at < now() - interval '5 minutes'
        )
        order by created_at
        for update skip locked
        limit 1
     )
     update alpha_exchange.discord_role_sync_outbox job
        set status = 'processing',
            attempts = attempts + 1,
            locked_at = now(),
            lock_token = gen_random_uuid(),
            updated_at = now()
       from candidate
      where job.id = candidate.id
      returning job.id::text, job.platform_user_id, job.discord_user_id,
        job.lock_token::text, job.attempts`,
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        platformUserId: row.platform_user_id,
        discordUserId: row.discord_user_id,
        lockToken: row.lock_token,
        attempts: row.attempts,
      }
    : null;
}

async function resolveCurrentDesiredStatus(
  database: Queryable,
  job: OutboxJob,
): Promise<DiscordSellerRoleStatus> {
  const result = await database.query<{
    desired_status: DiscordSellerRoleStatus;
  }>(
    `select alpha_exchange.discord_desired_seller_status(users.seller_status) as desired_status
       from alpha_exchange.discord_identities identity
       join alpha_exchange.users users on users.id = identity.platform_user_id
      where identity.discord_user_id = $1`,
    [job.discordUserId],
  );
  const row = result.rows[0];
  return row?.desired_status ?? "none";
}

async function completeJob(database: Queryable, job: OutboxJob): Promise<void> {
  await database.query(
    `with completed as (
       update alpha_exchange.discord_role_sync_outbox
          set status = 'completed',
              completed_at = now(),
              locked_at = null,
              last_error = null,
              updated_at = now()
        where id = $1::uuid
          and lock_token = $2::uuid
          and status = 'processing'
        returning id
     ), audited as (
       insert into alpha_exchange.discord_sync_audit
         (platform_user_id, discord_user_id, event_type, outcome, outbox_id)
       select $3, $4, 'role_sync', 'success', id from completed
     )
     update alpha_exchange.discord_identities
        set last_synced_at = now()
      where discord_user_id = $4
        and exists (select 1 from completed)`,
    [job.id, job.lockToken, job.platformUserId, job.discordUserId],
  );
}

async function failJob(
  database: Queryable,
  job: OutboxJob,
  detailCode: string,
): Promise<void> {
  const dead = job.attempts >= MAX_ATTEMPTS;
  const delaySeconds = Math.min(900, 5 * (2 ** Math.max(0, job.attempts - 1)));
  await database.query(
    `with failed as (
       update alpha_exchange.discord_role_sync_outbox
          set status = $3,
              available_at = case when $3 = 'dead' then available_at else now() + ($4 * interval '1 second') end,
              locked_at = null,
              lock_token = null,
              last_error = $5,
              updated_at = now()
        where id = $1::uuid
          and lock_token = $2::uuid
          and status = 'processing'
        returning id
     )
     insert into alpha_exchange.discord_sync_audit
       (platform_user_id, discord_user_id, event_type, outcome, outbox_id, detail_code)
     select $6, $7, 'role_sync', $8, id, $5 from failed`,
    [
      job.id,
      job.lockToken,
      dead ? "dead" : "pending",
      delaySeconds,
      detailCode,
      job.platformUserId,
      job.discordUserId,
      detailCode === "member_not_in_guild" ? "degraded" : "failed",
    ],
  );
}

async function ownsClaim(database: Queryable, job: OutboxJob): Promise<boolean> {
  const result = await database.query(
    `select 1
       from alpha_exchange.discord_role_sync_outbox
      where id = $1::uuid
        and lock_token = $2::uuid
        and status = 'processing'`,
    [job.id, job.lockToken],
  );
  return result.rowCount === 1;
}

async function enqueueReconciliation(pool: Pool): Promise<number> {
  await pool.query(
    `with retryable as (
       select id
         from alpha_exchange.discord_role_sync_outbox
        where status = 'dead'
          and desired_status = 'none'
          and reason = 'identity_deleted'
          and updated_at < now() - interval '15 minutes'
        order by updated_at
        limit $1
        for update skip locked
     )
     update alpha_exchange.discord_role_sync_outbox job
        set status = 'pending',
            attempts = 0,
            available_at = now(),
            lock_token = null,
            last_error = null,
            updated_at = now()
       from retryable
      where job.id = retryable.id`,
    [RECONCILIATION_BATCH_SIZE],
  );
  const result = await pool.query(
    `insert into alpha_exchange.discord_role_sync_outbox
      (platform_user_id, discord_user_id, desired_status, reason, dedupe_key)
     select identity.platform_user_id,
            identity.discord_user_id,
            alpha_exchange.discord_desired_seller_status(users.seller_status),
            'periodic_reconciliation',
            'reconcile:' || identity.platform_user_id || ':' || floor(extract(epoch from now()) / 900)::text
       from alpha_exchange.discord_identities identity
       join alpha_exchange.users users on users.id = identity.platform_user_id
      where (
        identity.last_synced_at is null
        or identity.last_synced_at < now() - interval '15 minutes'
      )
        and not exists (
          select 1
            from alpha_exchange.discord_role_sync_outbox pending
           where pending.platform_user_id = identity.platform_user_id
             and pending.status in ('pending', 'processing')
        )
      order by identity.last_synced_at nulls first, identity.updated_at
      limit $1
     on conflict (dedupe_key) do nothing`,
    [RECONCILIATION_BATCH_SIZE],
  );
  return result.rowCount ?? 0;
}

export class DiscordRoleSyncWorker {
  private readonly pool: Pool;
  private readonly manager: DiscordRoleManager;
  private readonly pollIntervalMs: number;
  private readonly reconciliationIntervalMs: number;
  private roleIds: DiscordManagedRoleIds | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private reconciling = false;

  constructor({
    pool,
    manager,
    pollIntervalMs = POLL_INTERVAL_MS,
    reconciliationIntervalMs = RECONCILIATION_INTERVAL_MS,
  }: RoleSyncWorkerDependencies) {
    this.pool = pool;
    this.manager = manager;
    this.pollIntervalMs = pollIntervalMs;
    this.reconciliationIntervalMs = reconciliationIntervalMs;
  }

  async start(): Promise<void> {
    if (this.pollTimer) return;
    try {
      await this.reconcile();
    } catch (error) {
      if (!(error instanceof DiscordRoleOperationError)) throw error;
      logEvent("warn", {
        event: "discord_role_sync_start",
        outcome: "failed",
        reason: error.code,
      });
    }
    this.pollTimer = setInterval(
      () => {
        void this.processAvailableJobs().catch((error: unknown) => {
          logEvent("error", {
            event: "discord_role_sync_poll",
            outcome: "failed",
            reason: "database_operation_failed",
            metadata: {
              errorType: error instanceof Error ? error.name : typeof error,
            },
          });
        });
      },
      this.pollIntervalMs,
    );
    this.reconciliationTimer = setInterval(
      () => {
        void this.reconcile().catch((error: unknown) => {
          logEvent("error", {
            event: "discord_role_reconciliation",
            outcome: "failed",
            reason: safeFailureCode(error),
          });
        });
      },
      this.reconciliationIntervalMs,
    );
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.pollTimer = null;
    this.reconciliationTimer = null;
  }

  async processAvailableJobs(): Promise<void> {
    if (this.processing || !this.roleIds) return;
    this.processing = true;
    try {
      for (let processed = 0; processed < 25; processed += 1) {
        const job = await claimJob(this.pool);
        if (!job) break;
        const lockClient = await this.pool.connect();
        let destroyClient = false;
        try {
          await lockClient.query("begin");
          await lockClient.query(
            "select pg_advisory_xact_lock(hashtext($1))",
            [job.discordUserId],
          );
          if (!await ownsClaim(lockClient, job)) {
            await lockClient.query("commit");
            continue;
          }
          try {
            const currentDesiredStatus = await resolveCurrentDesiredStatus(
              lockClient,
              job,
            );
            await this.manager.synchronizeMemberRoles({
              discordUserId: job.discordUserId,
              desiredStatus: currentDesiredStatus,
              roleIds: this.roleIds,
            });
            await completeJob(lockClient, job);
            await lockClient.query("commit");
          } catch (error) {
            const failureCode = safeFailureCode(error);
            try {
              await failJob(lockClient, job, failureCode);
              await lockClient.query("commit");
            } catch (persistenceError) {
              throw new AggregateError(
                [error, persistenceError],
                "Discord role synchronization and failure persistence failed.",
              );
            }
            logEvent(failureCode === "member_not_in_guild" ? "warn" : "error", {
              event: "discord_role_sync",
              targetUserId: job.platformUserId,
              outcome: "failed",
              reason: failureCode,
              metadata: { outboxId: job.id, attempts: job.attempts },
            });
          }
        } catch (error) {
          try {
            await lockClient.query("rollback");
          } catch (rollbackError) {
            destroyClient = true;
            throw new AggregateError(
              [error, rollbackError],
              "Discord role synchronization transaction rollback failed.",
            );
          }
          throw error;
        } finally {
          lockClient.release(destroyClient);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      this.roleIds = await provisionManagedRoles(this.pool, this.manager);
      await enqueueReconciliation(this.pool);
      await this.processAvailableJobs();
    } finally {
      this.reconciling = false;
    }
  }
}

export function createDiscordRoleSyncWorker(): DiscordRoleSyncWorker {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Discord role synchronization requires DATABASE_URL or SUPABASE_DB_URL.");
  const config = readDiscordConfig();
  return new DiscordRoleSyncWorker({
    pool,
    manager: new DiscordRestRoleManager({
      token: config.token,
      guildId: config.guildId,
    }),
  });
}
