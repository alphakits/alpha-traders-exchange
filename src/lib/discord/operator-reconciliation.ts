import "server-only";

import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { logEvent } from "@/lib/structured-logging";

const POLL_INTERVAL_MS = 5_000;
const LEASE_SECONDS = 5 * 60;
const MAX_REQUESTS_PER_TICK = 1;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

type ReconciliationClaim = {
  id: string;
  leaseToken: string;
  leaseFence: number;
  attempts: number;
  stage: "initial" | "draining";
};

type OperatorReconciliationDependencies = {
  pool: Pool;
  resources: {
    reconcile(): Promise<boolean>;
  };
  listings: {
    reconcile(): Promise<void>;
    processAvailableJobs(): Promise<void>;
    getDiagnostics(): {
      status: "ready" | "degraded";
      pendingJobs: number | null;
      deadJobs: number | null;
      failedMappings: number | null;
    };
  };
  marketIntelligence: {
    tick(): Promise<void>;
    getDiagnostics(): {
      status: "ready" | "degraded";
      pendingCount: number | null;
      deadCount: number | null;
    };
  };
  commands: {
    reconcile(): Promise<void>;
  };
  onboardingContent?: {
    reconcile(): Promise<void>;
  };
  pollIntervalMs?: number;
};

function safeFailureCode(error: unknown): string {
  if (
    error instanceof Error
    && /^[a-z0-9_]{1,64}$/.test(error.message)
  ) {
    return error.message;
  }
  return "operator_reconciliation_failed";
}

async function claimRequest(pool: Pool): Promise<ReconciliationClaim | null> {
  const leaseToken = randomUUID();
  const result = await pool.query<{
    id: string;
    lease_fence: number;
    attempts: number;
    result_code: string | null;
  }>(
    `with exhausted as (
       update alpha_exchange.discord_operator_requests
          set status = 'dead',
              lease_token = null,
              leased_until = null,
              last_error_code = 'operator_attempts_exhausted',
              updated_at = now()
        where status = 'processing'
          and leased_until <= now()
          and attempts >= 3
        returning id
     ),
     exhausted_audit as (
       insert into alpha_exchange.discord_operator_audit
         (request_id, action, event_type, detail_code)
       select id, 'reconcile_managed_integration', 'dead', 'operator_attempts_exhausted'
         from exhausted
     ),
     candidate as (
       select id
         from alpha_exchange.discord_operator_requests
        where (
          (status = 'pending' and attempts < 3)
          or (status = 'processing' and leased_until <= now() and attempts < 3)
        )
          and available_at <= now()
        order by created_at
        limit 1
        for update skip locked
     ),
     claimed as (
       update alpha_exchange.discord_operator_requests request
          set status = 'processing',
              attempts = request.attempts + 1,
              lease_fence = request.lease_fence + 1,
              lease_token = $1::uuid,
              leased_until = now() + ($2 * interval '1 second'),
              last_error_code = null,
              updated_at = now()
         from candidate
        where request.id = candidate.id
        returning request.id, request.lease_fence, request.attempts, request.result_code
     ),
     audited as (
       insert into alpha_exchange.discord_operator_audit
         (request_id, action, event_type, detail_code)
       select id, 'reconcile_managed_integration', 'processing', 'worker_claimed'
         from claimed
     )
     select id, lease_fence, attempts, result_code from claimed`,
    [leaseToken, LEASE_SECONDS],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        leaseToken,
        leaseFence: row.lease_fence,
        attempts: row.attempts,
        stage: row.result_code === "downstream_processing"
          ? "draining"
          : "initial",
      }
    : null;
}

async function completeRequest(
  pool: Pool,
  claim: ReconciliationClaim,
): Promise<void> {
  const result = await pool.query(
    `with completed as (
       update alpha_exchange.discord_operator_requests
          set status = 'completed',
              lease_token = null,
              leased_until = null,
              result_code = 'reconciliation_completed',
              completed_at = now(),
              updated_at = now()
        where id = $1::uuid
          and status = 'processing'
          and lease_token = $2::uuid
          and lease_fence = $3
          and leased_until > now()
        returning id
     )
     insert into alpha_exchange.discord_operator_audit
       (request_id, action, event_type, detail_code)
     select id, 'reconcile_managed_integration', 'completed', 'reconciliation_completed'
       from completed`,
    [claim.id, claim.leaseToken, claim.leaseFence],
  );
  if (result.rowCount !== 1) throw new Error("stale_operator_lease");
}

async function deferRequest(
  pool: Pool,
  claim: ReconciliationClaim,
): Promise<void> {
  const result = await pool.query(
    `with deferred as (
       update alpha_exchange.discord_operator_requests
          set status = 'pending',
              attempts = greatest(attempts - 1, 0),
              lease_token = null,
              leased_until = null,
              result_code = 'downstream_processing',
              available_at = now() + interval '5 seconds',
              updated_at = now()
        where id = $1::uuid
          and status = 'processing'
          and lease_token = $2::uuid
          and lease_fence = $3
        returning id
     )
     insert into alpha_exchange.discord_operator_audit
       (request_id, action, event_type, detail_code)
     select id, 'reconcile_managed_integration', 'retry_scheduled', 'downstream_processing'
       from deferred`,
    [claim.id, claim.leaseToken, claim.leaseFence],
  );
  if (result.rowCount !== 1) throw new Error("stale_operator_lease");
}

async function failRequest(
  pool: Pool,
  claim: ReconciliationClaim,
  errorCode: string,
): Promise<void> {
  const dead = claim.attempts >= 3;
  const result = await pool.query(
    `with failed as (
       update alpha_exchange.discord_operator_requests
          set status = $4,
              lease_token = null,
              leased_until = null,
              last_error_code = $5,
              available_at = case
                when $4 = 'pending'
                  then now() + (least(attempts, 3) * interval '1 minute')
                else available_at
              end,
              updated_at = now()
        where id = $1::uuid
          and status = 'processing'
          and lease_token = $2::uuid
          and lease_fence = $3
        returning id
     )
     insert into alpha_exchange.discord_operator_audit
       (request_id, action, event_type, detail_code)
     select id, 'reconcile_managed_integration', $6, $5
       from failed`,
    [
      claim.id,
      claim.leaseToken,
      claim.leaseFence,
      dead ? "dead" : "pending",
      errorCode,
      dead ? "dead" : "retry_scheduled",
    ],
  );
  if (result.rowCount !== 1) throw new Error("stale_operator_lease");
}

export class DiscordOperatorReconciliationWorker {
  private readonly pool: Pool;
  private readonly resources: OperatorReconciliationDependencies["resources"];
  private readonly listings: OperatorReconciliationDependencies["listings"];
  private readonly marketIntelligence:
    OperatorReconciliationDependencies["marketIntelligence"];
  private readonly commands: OperatorReconciliationDependencies["commands"];
  private readonly onboardingContent:
    OperatorReconciliationDependencies["onboardingContent"];
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private activeTick: Promise<void> | null = null;

  constructor(input: OperatorReconciliationDependencies) {
    this.pool = input.pool;
    this.resources = input.resources;
    this.listings = input.listings;
    this.marketIntelligence = input.marketIntelligence;
    this.commands = input.commands;
    this.onboardingContent = input.onboardingContent;
    this.pollIntervalMs = input.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_operator_reconciliation_poll",
          outcome: "failed",
          reason: safeFailureCode(error),
        });
      });
    }, this.pollIntervalMs);
    await this.performMaintenance();
    this.maintenanceTimer = setInterval(() => {
      void this.performMaintenance().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_management_retention",
          outcome: "failed",
          reason: safeFailureCode(error),
        });
      });
    }, MAINTENANCE_INTERVAL_MS);
    await this.tick();
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.timer = null;
    this.maintenanceTimer = null;
    await this.activeTick;
  }

  tick(): Promise<void> {
    if (this.activeTick) return this.activeTick;
    this.activeTick = this.performTick().finally(() => {
      this.activeTick = null;
    });
    return this.activeTick;
  }

  private async performTick(): Promise<void> {
    for (let processed = 0; processed < MAX_REQUESTS_PER_TICK; processed += 1) {
      const claim = await claimRequest(this.pool);
      if (!claim) break;
      try {
        if (claim.stage === "initial") {
          const resourcesCompleted = await this.resources.reconcile();
          if (!resourcesCompleted) throw new Error("resource_reconciliation_busy");
          await this.commands.reconcile();
          await this.onboardingContent?.reconcile();
          await this.listings.reconcile();
          await this.pool.query(
            `update alpha_exchange.discord_market_content
                set refresh_after = now(),
                    updated_at = now()
              where state <> 'dead'`,
          );
        } else {
          await this.listings.processAvailableJobs();
        }
        const listingDiagnostics = this.listings.getDiagnostics();
        if (
          listingDiagnostics.status !== "ready"
          ||
          (listingDiagnostics.deadJobs ?? 0) > 0
          || (listingDiagnostics.failedMappings ?? 0) > 0
        ) {
          throw new Error("listing_reconciliation_degraded");
        }
        await this.marketIntelligence.tick();
        const marketDiagnostics = this.marketIntelligence.getDiagnostics();
        if (
          marketDiagnostics.status !== "ready"
          || (marketDiagnostics.deadCount ?? 0) > 0
        ) {
          throw new Error("market_content_reconciliation_degraded");
        }
        if (
          (listingDiagnostics.pendingJobs ?? 0) > 0
          || (marketDiagnostics.pendingCount ?? 0) > 0
        ) {
          await deferRequest(this.pool, claim);
          continue;
        }
        await completeRequest(this.pool, claim);
      } catch (error) {
        const errorCode = safeFailureCode(error);
        await failRequest(this.pool, claim, errorCode);
        logEvent("error", {
          event: "discord_operator_reconciliation",
          outcome: "failed",
          reason: errorCode,
          metadata: { attempt: claim.attempts },
        });
      }
    }
  }

  private async performMaintenance(): Promise<void> {
    await this.pool.query(
      "select * from alpha_exchange.cleanup_discord_management_state()",
    );
  }
}
