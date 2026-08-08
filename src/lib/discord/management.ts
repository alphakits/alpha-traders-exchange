import "server-only";

import type { Pool, PoolClient } from "pg";

import { DISCORD_COMMUNITY_COMMAND_NAMES } from "@/lib/discord/community-commands";
import type { DiscordDiagnostics } from "@/lib/discord/diagnostics";
import {
  DISCORD_MANAGED_RESOURCE_DEFINITIONS,
  readDiscordResourceDisplayNames,
} from "@/lib/discord/resource-manager";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";

const LISTING_STATES = [
  "queued",
  "publishing",
  "active",
  "update_pending",
  "delete_pending",
  "sold",
  "deleted",
  "failed",
] as const;

type ListingState = (typeof LISTING_STATES)[number];
type SafeStatus = "healthy" | "degraded" | "blocked" | "offline";
type OperatorRequestStatus = "pending" | "processing" | "completed" | "dead";

export type DiscordManagementDatabaseDiagnostics = {
  identities: {
    connected: number;
  };
  approvedSellerRoleSync: {
    synced: number;
    pending: number;
    failed: number;
  };
  listings: {
    lifecycle: Record<ListingState, number>;
    activePosts: number;
    cooldownClaims: number;
    jobs: {
      pending: number;
      processing: number;
      completed: number;
      dead: number;
      staleLeases: number;
      failures: number;
    };
  };
  marketContent: Array<{
    key: "live_market_pulse" | "market_activity_digest" | "weekly_top_sellers";
    state: "scheduled" | "processing" | "active" | "dead";
    lastSuccessAt: string | null;
    errorCode: string | null;
  }>;
  notifications: {
    pending: number;
    processing: number;
    completed: number;
    dead: number;
    suppressed: number;
  };
  interactions: {
    accepted24h: number;
    rateLimited24h: number;
    replayed24h: number;
  };
  operatorRequests: {
    pending: number;
    processing: number;
    dead: number;
    staleLeases: number;
    latest: {
      status: OperatorRequestStatus;
      resultCode: string | null;
      updatedAt: string;
    } | null;
  };
  recentErrors: Array<{
    source: "resources" | "listing_messages" | "listing_jobs" | "market_content" | "notifications" | "operator";
    code: string;
    occurredAt: string;
  }>;
};

export type DiscordManagementDiagnostics = {
  generatedAt: string;
  status: SafeStatus;
  worker: {
    status: "healthy" | "degraded";
    connected: boolean;
    ready: boolean;
    readyState: string;
    apiLatencyMs: number | null;
    connectionUptimeMs: number | null;
    deployment: {
      revision: string | null;
      environment: string | null;
    };
    error: {
      code: string;
      message: string;
    } | null;
  };
  resources: {
    status: "ready" | "degraded";
    total: number | null;
    ready: number | null;
    missing: number | null;
    errorCode: string | null;
  };
  database: DiscordManagementDatabaseDiagnostics;
  commands: {
    names: readonly string[];
    registered: number | null;
    expected: number;
    lastReconciledAt: string | null;
    status: "ready" | "degraded";
    errorCode: string | null;
  };
  topology: Array<{
    key: string;
    type: "category" | "text";
    name: string;
  }>;
  privilegedIntents: readonly ["GuildMembers"];
};

type ManagementRow = {
  connected_identities: number;
  role_sync: Record<string, number> | null;
  listing_lifecycle: Record<string, number> | null;
  listing_jobs: Record<string, number> | null;
  cooldown_claims: number;
  market_content: Array<Record<string, unknown>> | null;
  notifications: Record<string, number> | null;
  interactions: Record<string, number> | null;
  operator_requests: Record<string, unknown> | null;
  recent_errors: Array<Record<string, unknown>> | null;
};

function requirePool(pool?: Pool): Pool {
  const resolved = pool ?? getRuntimePostgresPool();
  if (!resolved) {
    throw new Error("Discord management diagnostics require a PostgreSQL connection.");
  }
  return resolved;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value)
    ? value
    : null;
}

function safeTimestamp(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (
    typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value))
  ) {
    return new Date(value).toISOString();
  }
  return null;
}

export async function readDiscordManagementDatabaseDiagnostics(
  pool?: Pool,
): Promise<DiscordManagementDatabaseDiagnostics> {
  const result = await requirePool(pool).query<ManagementRow>(`
    with latest_approved_role_sync as (
      select distinct on (platform_user_id) platform_user_id, status
        from alpha_exchange.discord_role_sync_outbox
       where desired_status = 'approved'
       order by platform_user_id, created_at desc
    ),
    listing_lifecycle as (
      select coalesce(jsonb_object_agg(state, state_count), '{}'::jsonb) as value
        from (
          select state, count(*)::int as state_count
            from alpha_exchange.discord_listing_messages
           group by state
        ) counts
    ),
    safe_errors as (
      select 'resources'::text as source, last_error_code as code, updated_at as occurred_at
        from alpha_exchange.discord_managed_resources
       where last_error_code is not null
      union all
      select 'listing_messages', last_error_code, updated_at
        from alpha_exchange.discord_listing_messages
       where last_error_code is not null
      union all
      select 'listing_jobs', last_error_code, updated_at
        from alpha_exchange.discord_listing_outbox
       where last_error_code is not null
      union all
      select 'market_content', last_error_code, updated_at
        from alpha_exchange.discord_market_content
       where last_error_code is not null
      union all
      select 'notifications', last_error_code, updated_at
        from alpha_exchange.discord_notification_deliveries
       where last_error_code is not null
      union all
      select 'operator', last_error_code, updated_at
        from alpha_exchange.discord_operator_requests
       where last_error_code is not null
    )
    select
      (select count(*)::int from alpha_exchange.discord_identities) as connected_identities,
      (select jsonb_build_object(
        'synced', count(*) filter (where status = 'completed')::int,
        'pending', count(*) filter (where status in ('pending', 'processing'))::int,
        'failed', count(*) filter (where status = 'dead')::int
      ) from latest_approved_role_sync) as role_sync,
      (select value from listing_lifecycle) as listing_lifecycle,
      (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending')::int,
        'processing', count(*) filter (where status = 'processing')::int,
        'completed', count(*) filter (where status = 'completed')::int,
        'dead', count(*) filter (where status = 'dead')::int,
        'staleLeases', count(*) filter (
          where status = 'processing' and locked_at < now() - interval '5 minutes'
        )::int,
        'failures', count(*) filter (where last_error_code is not null)::int
      ) from alpha_exchange.discord_listing_outbox) as listing_jobs,
      (select count(*)::int from alpha_exchange.discord_listing_share_cooldowns) as cooldown_claims,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'key', content_key,
        'state', state,
        'lastSuccessAt', last_success_at,
        'errorCode', last_error_code
      ) order by content_key), '[]'::jsonb) from alpha_exchange.discord_market_content) as market_content,
      (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending')::int,
        'processing', count(*) filter (where status = 'processing')::int,
        'completed', count(*) filter (where status = 'delivered')::int,
        'dead', count(*) filter (where status = 'dead')::int,
        'suppressed', count(*) filter (where status = 'suppressed')::int
      ) from alpha_exchange.discord_notification_deliveries) as notifications,
      (select jsonb_build_object(
        'accepted24h', count(*) filter (
          where outcome = 'accepted' and created_at >= now() - interval '24 hours'
        )::int,
        'rateLimited24h', count(*) filter (
          where outcome = 'rate_limited' and created_at >= now() - interval '24 hours'
        )::int,
        'replayed24h', count(*) filter (
          where outcome = 'replayed' and created_at >= now() - interval '24 hours'
        )::int
      ) from alpha_exchange.discord_interaction_audit) as interactions,
      (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending')::int,
        'processing', count(*) filter (where status = 'processing')::int,
        'dead', count(*) filter (where status = 'dead')::int,
        'staleLeases', count(*) filter (
          where status = 'processing' and leased_until <= now()
        )::int,
        'latest', (
          select jsonb_build_object(
            'status', latest.status,
            'resultCode', latest.result_code,
            'updatedAt', latest.updated_at
          )
            from alpha_exchange.discord_operator_requests latest
           order by latest.created_at desc
           limit 1
        )
      ) from alpha_exchange.discord_operator_requests) as operator_requests,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'source', source,
        'code', code,
        'occurredAt', occurred_at
      ) order by occurred_at desc), '[]'::jsonb)
         from (
           select source, code, occurred_at
             from safe_errors
            order by occurred_at desc
            limit 8
         ) latest_errors) as recent_errors
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Discord management diagnostics query returned no data.");

  const lifecycle = Object.fromEntries(
    LISTING_STATES.map((state) => [state, count(row.listing_lifecycle?.[state])]),
  ) as Record<ListingState, number>;
  const marketContent: DiscordManagementDatabaseDiagnostics["marketContent"] =
    (row.market_content ?? []).flatMap((item) => {
    const key = item.key;
    const state = item.state;
    if (
      (key !== "live_market_pulse"
        && key !== "market_activity_digest"
        && key !== "weekly_top_sellers")
      || (state !== "scheduled"
        && state !== "processing"
        && state !== "active"
        && state !== "dead")
    ) {
      return [];
    }
      return [{
        key: key as DiscordManagementDatabaseDiagnostics["marketContent"][number]["key"],
        state: state as DiscordManagementDatabaseDiagnostics["marketContent"][number]["state"],
        lastSuccessAt: safeTimestamp(item.lastSuccessAt),
        errorCode: safeCode(item.errorCode),
      }];
    });
  const latest = row.operator_requests?.latest;
  let latestOperator: DiscordManagementDatabaseDiagnostics["operatorRequests"]["latest"] = null;
  if (latest && typeof latest === "object") {
    const candidate = latest as Record<string, unknown>;
    const updatedAt = safeTimestamp(candidate.updatedAt);
    if (
      updatedAt
      && (
        candidate.status === "pending"
        || candidate.status === "processing"
        || candidate.status === "completed"
        || candidate.status === "dead"
      )
    ) {
      latestOperator = {
        status: candidate.status,
        resultCode: safeCode(candidate.resultCode),
        updatedAt,
      };
    }
  }
  const allowedErrorSources = new Set([
    "resources",
    "listing_messages",
    "listing_jobs",
    "market_content",
    "notifications",
    "operator",
  ]);
  const recentErrors = (row.recent_errors ?? []).flatMap((item) => {
    const source = item.source;
    const code = safeCode(item.code);
    const occurredAt = safeTimestamp(item.occurredAt);
    if (typeof source !== "string" || !allowedErrorSources.has(source) || !code || !occurredAt) {
      return [];
    }
    return [{
      source: source as DiscordManagementDatabaseDiagnostics["recentErrors"][number]["source"],
      code,
      occurredAt,
    }];
  });

  return {
    identities: { connected: count(row.connected_identities) },
    approvedSellerRoleSync: {
      synced: count(row.role_sync?.synced),
      pending: count(row.role_sync?.pending),
      failed: count(row.role_sync?.failed),
    },
    listings: {
      lifecycle,
      activePosts: lifecycle.active,
      cooldownClaims: count(row.cooldown_claims),
      jobs: {
        pending: count(row.listing_jobs?.pending),
        processing: count(row.listing_jobs?.processing),
        completed: count(row.listing_jobs?.completed),
        dead: count(row.listing_jobs?.dead),
        staleLeases: count(row.listing_jobs?.staleLeases),
        failures: count(row.listing_jobs?.failures),
      },
    },
    marketContent,
    notifications: {
      pending: count(row.notifications?.pending),
      processing: count(row.notifications?.processing),
      completed: count(row.notifications?.completed),
      dead: count(row.notifications?.dead),
      suppressed: count(row.notifications?.suppressed),
    },
    interactions: {
      accepted24h: count(row.interactions?.accepted24h),
      rateLimited24h: count(row.interactions?.rateLimited24h),
      replayed24h: count(row.interactions?.replayed24h),
    },
    operatorRequests: {
      pending: count(row.operator_requests?.pending),
      processing: count(row.operator_requests?.processing),
      dead: count(row.operator_requests?.dead),
      staleLeases: count(row.operator_requests?.staleLeases),
      latest: latestOperator,
    },
    recentErrors,
  };
}

async function rollback(client: PoolClient, cause: unknown): Promise<void> {
  try {
    await client.query("rollback");
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      "Discord operator request rollback failed.",
    );
  }
}

export async function enqueueDiscordOperatorReconciliation(input: {
  actorUserId: string;
  idempotencyKey: string;
  pool?: Pool;
}): Promise<{
  disposition: "accepted" | "coalesced" | "replayed";
  status: OperatorRequestStatus;
  acceptedAt: string;
  resultCode: string | null;
}> {
  const pool = requirePool(input.pool);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext('discord-operator-reconcile'))",
    );
    const replay = await client.query<{
      id: string;
      status: OperatorRequestStatus;
      result_code: string | null;
      created_at: Date;
    }>(
      `select id, status, result_code, created_at
         from alpha_exchange.discord_operator_requests
        where idempotency_key = $1::uuid
        for update`,
      [input.idempotencyKey],
    );
    const replayed = replay.rows[0];
    if (replayed) {
      await client.query(
        `insert into alpha_exchange.discord_operator_audit
           (request_id, action, actor_user_id, event_type, detail_code)
         values ($1, 'reconcile_managed_integration', $2, 'coalesced', 'idempotency_replayed')`,
        [replayed.id, input.actorUserId],
      );
      await client.query("commit");
      return {
        disposition: "replayed",
        status: replayed.status,
        acceptedAt: replayed.created_at.toISOString(),
        resultCode: safeCode(replayed.result_code),
      };
    }
    const existing = await client.query<{
      id: string;
      status: "pending" | "processing";
      created_at: Date;
    }>(
      `select id, status, created_at
         from alpha_exchange.discord_operator_requests
        where action = 'reconcile_managed_integration'
          and status in ('pending', 'processing')
        order by created_at
        limit 1
        for update`,
    );
    const active = existing.rows[0];
    if (active) {
      await client.query(
        `insert into alpha_exchange.discord_operator_audit
           (request_id, action, actor_user_id, event_type, detail_code)
         values ($1, 'reconcile_managed_integration', $2, 'coalesced', 'active_request_reused')`,
        [active.id, input.actorUserId],
      );
      await client.query("commit");
      return {
        disposition: "coalesced",
        status: active.status,
        acceptedAt: active.created_at.toISOString(),
        resultCode: null,
      };
    }

    const inserted = await client.query<{
      id: string;
      status: "pending";
      created_at: Date;
    }>(
      `insert into alpha_exchange.discord_operator_requests (
         action,
         request_reason,
         requested_by_user_id,
         idempotency_key
       )
       values ('reconcile_managed_integration', 'operator_dashboard', $1, $2::uuid)
       returning id, status, created_at`,
      [input.actorUserId, input.idempotencyKey],
    );
    const request = inserted.rows[0];
    if (!request) throw new Error("Discord operator request was not persisted.");
    await client.query(
      `insert into alpha_exchange.discord_operator_audit
         (request_id, action, actor_user_id, event_type, detail_code)
       values ($1, 'reconcile_managed_integration', $2, 'accepted', 'operator_confirmed')`,
      [request.id, input.actorUserId],
    );
    await client.query("commit");
    return {
      disposition: "accepted",
      status: request.status,
      acceptedAt: request.created_at.toISOString(),
      resultCode: null,
    };
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
}

const managementResourceDisplayNames = readDiscordResourceDisplayNames();

export const DISCORD_MANAGEMENT_TOPOLOGY = DISCORD_MANAGED_RESOURCE_DEFINITIONS.map(
  (resource) => ({
    key: resource.key,
    type: resource.resourceType === "category" ? "category" as const : "text" as const,
    name: managementResourceDisplayNames[resource.key],
  }),
);

export const DISCORD_MANAGEMENT_COMMANDS = [...DISCORD_COMMUNITY_COMMAND_NAMES];

export function buildDiscordManagementDiagnostics(input: {
  worker: DiscordDiagnostics;
  database: DiscordManagementDatabaseDiagnostics;
  now?: Date;
}): DiscordManagementDiagnostics {
  const workerUnavailable = input.worker.error?.code.startsWith("worker_") ?? false;
  const databaseBlocked =
    input.database.operatorRequests.dead > 0
    || input.database.operatorRequests.staleLeases > 0;
  const databaseDegraded =
    input.database.approvedSellerRoleSync.failed > 0
    || input.database.listings.jobs.dead > 0
    || input.database.listings.jobs.failures > 0
    || input.database.notifications.dead > 0
    || input.database.marketContent.some((content) => content.state === "dead");
  const status: SafeStatus = workerUnavailable
    ? "offline"
    : databaseBlocked
      ? "blocked"
      : input.worker.status === "degraded" || databaseDegraded
        ? "degraded"
        : "healthy";
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    status,
    worker: {
      status: input.worker.status,
      connected: input.worker.connected,
      ready:
        input.worker.status === "healthy"
        && input.worker.connected
        && input.worker.readyState === "ready",
      readyState: input.worker.readyState,
      apiLatencyMs: input.worker.apiLatencyMs,
      connectionUptimeMs: input.worker.connectionUptimeMs,
      deployment: {
        revision: input.worker.deployment?.revision ?? null,
        environment: input.worker.deployment?.environment ?? null,
      },
      error: input.worker.error
        ? {
            code: input.worker.error.code,
            message: input.worker.error.message,
          }
        : null,
    },
    resources: {
      status: input.worker.resources?.status ?? "degraded",
      total: input.worker.resources?.totalCount ?? null,
      ready: input.worker.resources?.readyCount ?? null,
      missing: input.worker.resources?.missingCount ?? null,
      errorCode: input.worker.resources?.errorCode ?? "diagnostics_unavailable",
    },
    database: input.database,
    commands: {
      names: DISCORD_MANAGEMENT_COMMANDS,
      registered: input.worker.commands?.registeredCount ?? null,
      expected: DISCORD_MANAGEMENT_COMMANDS.length,
      lastReconciledAt: input.worker.commands?.lastReconciledAt ?? null,
      status: input.worker.commands?.status ?? "degraded",
      errorCode: input.worker.commands?.errorCode ?? "diagnostics_unavailable",
    },
    topology: DISCORD_MANAGEMENT_TOPOLOGY,
    privilegedIntents: ["GuildMembers"],
  };
}
