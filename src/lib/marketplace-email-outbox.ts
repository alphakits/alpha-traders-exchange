import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { isProductionSecurityRuntime } from "@/lib/runtime-safety";
import { logEvent } from "@/lib/structured-logging";

export type PreparedMarketplaceEmail = {
  event: string;
  recipientEmail: string;
  body: string;
  idempotencyKey: string;
  requestId?: string;
  requiredTradeStatuses?: string[];
};

export type EmailProviderResult = { ok: true } | {
  ok: false;
  reason: string;
  providerStatus?: number;
  providerMessage?: string;
  retryAfterMs?: number;
  retryable?: boolean;
  quotaExceeded?: boolean;
};
export type MarketplaceEmailTransport = (email: PreparedMarketplaceEmail) => Promise<EmailProviderResult>;

// No public policies: only the server database role may access delivery data.
// The body is frozen at enqueue time so provider idempotency survives deploys.
export const MARKETPLACE_EMAIL_OUTBOX_SCHEMA = `
create table if not exists alpha_exchange.marketplace_email_outbox (
  id text primary key,
  recipient_id text not null references alpha_exchange.users(id) on delete cascade,
  event text not null,
  recipient_email text,
  request_body text,
  idempotency_key text not null unique,
  request_id text,
  required_trade_statuses text[],
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','suppressed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '23 hours'),
  lease_token text,
  lease_until timestamptz,
  last_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists alpha_exchange.marketplace_email_gate (
  singleton boolean primary key default true check (singleton),
  available_at timestamptz not null default now()
);
insert into alpha_exchange.marketplace_email_gate(singleton) values (true) on conflict do nothing;
alter table alpha_exchange.marketplace_email_outbox enable row level security;
alter table alpha_exchange.marketplace_email_gate enable row level security;
revoke all on alpha_exchange.marketplace_email_outbox, alpha_exchange.marketplace_email_gate from public;
create index if not exists idx_marketplace_email_due on alpha_exchange.marketplace_email_outbox (available_at, created_at)
  where status in ('pending', 'processing');
`;

const schemaReady = new WeakMap<Pool, Promise<void>>();
async function ensureSchema(pool: Pool) {
  let ready = schemaReady.get(pool);
  if (!ready) {
    ready = (async () => {
      const result = await pool.query("select to_regclass('alpha_exchange.idx_marketplace_email_due') as ready");
      if (result.rows[0]?.ready) return;
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(61422919)");
        await client.query(MARKETPLACE_EMAIL_OUTBOX_SCHEMA);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => { schemaReady.delete(pool); throw error; });
    schemaReady.set(pool, ready);
  }
  await ready;
}

type Job = {
  id: string; event: string; recipient_email: string; request_body: string;
  idempotency_key: string; attempts: number; lease_token: string;
};

async function claim(pool: Pool, id?: string): Promise<{ job?: Job; waitMs?: number }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // A transaction-pooler-safe row lock serializes sends across all instances.
    const gate = await client.query<{ wait_ms: number }>(
      `select greatest(0, extract(epoch from (available_at - clock_timestamp())) * 1000)::int as wait_ms
       from alpha_exchange.marketplace_email_gate where singleton = true for update`,
    );
    if (!gate.rows[0]) throw new Error("Email delivery gate is unavailable.");
    if (gate.rows[0].wait_ms > 0) {
      await client.query("commit");
      return { waitMs: gate.rows[0].wait_ms };
    }
    const jobs = await client.query<Job>(
      `with candidate as (
         select id from alpha_exchange.marketplace_email_outbox
         where ($1::text is null or id = $1) and available_at <= now() and expires_at > now() and attempts < 32
           and (status = 'pending' or (status = 'processing' and lease_until < now()))
         order by case when event in ('new_listing_published','economic_news_released') then 1 else 0 end, created_at
         limit 1 for update skip locked
       )
       update alpha_exchange.marketplace_email_outbox job
       set status = 'processing', attempts = attempts + 1, lease_token = $2,
           lease_until = now() + interval '60 seconds', updated_at = now()
       from candidate where job.id = candidate.id returning job.*`,
      [id ?? null, randomUUID()],
    );
    if (jobs.rows[0]) await client.query(
      "update alpha_exchange.marketplace_email_gate set available_at = clock_timestamp() + interval '1100 milliseconds' where singleton = true",
    );
    await client.query("commit");
    return { job: jobs.rows[0] };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finish(pool: Pool, job: Job, status: "sent" | "failed" | "suppressed" | "pending", reason: string, delayMs = 0) {
  const result = await pool.query(
    `update alpha_exchange.marketplace_email_outbox
     set status = $3, last_reason = $4, available_at = now() + $5::double precision * interval '1 millisecond',
         request_body = case when $3 = 'pending' then request_body else null end,
         recipient_email = case when $3 = 'pending' then recipient_email else null end,
         lease_token = null, lease_until = null, updated_at = now()
     where id = $1 and lease_token = $2 and status = 'processing' returning id`,
    [job.id, job.lease_token, status, reason, delayMs],
  );
  if (result.rowCount === 1) logEvent(status === "failed" ? "error" : "info", {
    event: "marketplace_email_outbox", resourceId: job.id,
    outcome: status === "failed" ? "failed" : "success", reason,
    metadata: { status, emailEvent: job.event, attempts: job.attempts },
  });
}

async function attempt(pool: Pool, job: Job, send: MarketplaceEmailTransport) {
  // Resolve current account state on every attempt. Never send a stored message
  // to an address that is no longer attached to the original account.
  const eligibility = await pool.query<{ eligible: boolean }>(
    `select exists (
       select 1 from alpha_exchange.marketplace_email_outbox job
       join alpha_exchange.users account on account.id = job.recipient_id
       where job.id = $1 and job.lease_token = $2 and job.status = 'processing'
         and lower(account.email) = lower(job.recipient_email)
         and coalesce(account.payload->>'disabled', 'false') <> 'true'
         and (job.required_trade_statuses is null or exists (
           select 1 from alpha_exchange.purchase_requests trade
           where trade.id = job.request_id and trade.status = any(job.required_trade_statuses)
         ))
     ) as eligible`, [job.id, job.lease_token],
  );
  if (!eligibility.rows[0]?.eligible) {
    await finish(pool, job, "suppressed", "recipient_no_longer_eligible");
    return "suppressed" as const;
  }
  const result = await send({ event: job.event, recipientEmail: job.recipient_email,
    body: job.request_body, idempotencyKey: job.idempotency_key });
  if (result.ok) {
    await finish(pool, job, "sent", "provider_accepted");
    return "sent" as const;
  }
  const retryable = result.retryable !== false || result.quotaExceeded
    || [401, 403].includes(result.providerStatus ?? 0) || result.reason === "resend_not_configured";
  const delay = Math.max(
    Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts - 1, 7)),
    Math.min(86_400_000, result.retryAfterMs ?? 0),
    result.quotaExceeded ? 3_600_000 : 0,
    [401, 403].includes(result.providerStatus ?? 0) ? 900_000 : 0,
  );
  if (result.providerStatus === 429 || (result.retryAfterMs ?? 0) > 0 || result.quotaExceeded) {
    await pool.query(
      `update alpha_exchange.marketplace_email_gate
       set available_at = greatest(available_at, clock_timestamp() + $1::double precision * interval '1 millisecond')
       where singleton = true`, [delay],
    );
  }
  const status = retryable && job.attempts < 32 ? "pending" : "failed";
  await finish(pool, job, status, result.reason, delay);
  return status;
}

export async function enqueueMarketplaceEmail(email: PreparedMarketplaceEmail, send: MarketplaceEmailTransport) {
  try {
    const pool = getRuntimePostgresPool();
    // Explicit local/test runtimes preserve the existing transport test seam.
    if (!pool && !isProductionSecurityRuntime()) return null;
    if (!pool) throw new Error("Durable email storage is unavailable.");
    await ensureSchema(pool);
    const inserted = await pool.query<{ id: string; status: string }>(
      `insert into alpha_exchange.marketplace_email_outbox
         (id, recipient_id, event, recipient_email, request_body, idempotency_key, request_id, required_trade_statuses)
       select $1, id, $2, email, $3, $4, $6, $7::text[] from alpha_exchange.users
       where lower(email) = lower($5) and coalesce(payload->>'disabled', 'false') <> 'true'
       order by id limit 1 on conflict (idempotency_key) do nothing returning id, status`,
      [randomUUID(), email.event, email.body, email.idempotencyKey, email.recipientEmail, email.requestId ?? null, email.requiredTradeStatuses ?? null],
    );
    const existing = inserted.rows[0] ?? (await pool.query<{ id: string; status: string }>(
      "select id, status from alpha_exchange.marketplace_email_outbox where idempotency_key = $1", [email.idempotencyKey],
    )).rows[0];
    if (!existing) return { ok: false as const, reason: "email_recipient_unavailable" };
    if (existing.status === "failed" || existing.status === "suppressed") {
      return { ok: false as const, reason: "email_delivery_terminal" };
    }
    // Persist before any provider request. A killed function leaves a leased
    // job that the scheduler can reclaim with the identical provider request.
    if (existing.status !== "sent") {
      const { job } = await claim(pool, existing.id);
      if (job) {
        try {
          const outcome = await attempt(pool, job, send);
          if (outcome === "failed" || outcome === "suppressed") {
            return { ok: false as const, reason: "email_delivery_terminal" };
          }
        } catch {
          logEvent("error", { event: "marketplace_email_outbox", resourceId: existing.id,
            outcome: "failed", reason: "attempt_interrupted_retry_preserved" });
        }
      }
    }
    return { ok: true as const, queued: true as const };
  } catch {
    // Do not silently bypass durability when the database is unavailable.
    logEvent("error", { event: "marketplace_email_outbox", outcome: "failed", reason: "email_storage_unavailable" });
    return { ok: false as const, reason: "email_storage_unavailable" };
  }
}

export async function runMarketplaceEmailSweep(send: MarketplaceEmailTransport) {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Durable email storage is unavailable.");
  await ensureSchema(pool);
  // Retain deduplication records; erase message content after delivery/expiry.
  const expired = await pool.query(
    `update alpha_exchange.marketplace_email_outbox set status = 'failed', last_reason = 'retry_window_expired',
       request_body = null, recipient_email = null, lease_token = null, lease_until = null, updated_at = now()
     where status in ('pending','processing') and (expires_at <= now() or attempts >= 32)
       and (status <> 'processing' or lease_until < now()) returning id`,
  );
  if (expired.rowCount) logEvent("error", { event: "marketplace_email_outbox", outcome: "failed",
    reason: "retry_window_expired", metadata: { count: expired.rowCount } });
  const summary = { sent: 0, pending: 0, failed: expired.rowCount ?? 0, suppressed: 0 };
  const deadline = Date.now() + 45_000;
  for (let work = 0; work < 40 && Date.now() < deadline;) {
    const { job, waitMs } = await claim(pool);
    if (!job) {
      if (waitMs && waitMs <= 1_200 && Date.now() + waitMs < deadline) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      break;
    }
    work += 1;
    const outcome = await attempt(pool, job, send);
    summary[outcome] += 1;
  }
  const counts = await pool.query<{ pending: number; failed: number }>(
    `select count(*) filter (where status in ('pending','processing'))::int as pending,
       count(*) filter (where status = 'failed')::int as failed from alpha_exchange.marketplace_email_outbox`,
  );
  return { ...summary, backlog: counts.rows[0]?.pending ?? 0, failedTotal: counts.rows[0]?.failed ?? 0 };
}
