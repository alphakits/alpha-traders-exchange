import "server-only";
import type { Pool, PoolClient } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { NEWS_STALE_AFTER_MS, shouldAlertForRelease, type NewsEvent, type NewsFeed, type NewsPreferences } from "./model";
import { newsProviderConfigured } from "./provider";

// These tables belong only to News. Exchange snapshots and trade rows are never written here.
const SCHEMA = `
  create table if not exists alpha_exchange.economic_news_events (
    id text primary key, scheduled_at timestamptz not null, payload jsonb not null,
    revisions jsonb not null default '[]'::jsonb
  );
  create index if not exists economic_news_schedule on alpha_exchange.economic_news_events(scheduled_at);
  create table if not exists alpha_exchange.economic_news_sync (
    id boolean primary key default true check (id), synced_at timestamptz not null
  );
  create table if not exists alpha_exchange.economic_news_subscriptions (
    user_id text primary key references alpha_exchange.users(id) on delete cascade,
    in_app boolean not null default false, email boolean not null default false,
    in_app_since timestamptz, email_since timestamptz, updated_at timestamptz not null default now()
  );
  create table if not exists alpha_exchange.economic_news_deliveries (
    id text primary key, event_id text not null, user_id text not null references alpha_exchange.users(id) on delete cascade,
    channel text not null check (channel in ('inApp','email')), payload jsonb not null,
    status text not null default 'pending', attempts integer not null default 0,
    available_at timestamptz not null default now(), lease_until timestamptz, lease_token text,
    created_at timestamptz not null default now(), unique(event_id, user_id, channel)
  );
  create index if not exists economic_news_due_delivery on alpha_exchange.economic_news_deliveries(status, available_at);
  alter table alpha_exchange.economic_news_events enable row level security;
  alter table alpha_exchange.economic_news_sync enable row level security;
  alter table alpha_exchange.economic_news_subscriptions enable row level security;
  alter table alpha_exchange.economic_news_deliveries enable row level security;
`;

let schemaReady: Promise<void> | undefined;

export async function newsPool(): Promise<Pool> {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("News storage unavailable");
  return pool;
}

async function initializeNewsStorage(): Promise<Pool> {
  const pool = await newsPool();
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(2072301)");
        await client.query(SCHEMA);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally { client.release(); }
    })().catch((error) => { schemaReady = undefined; throw error; });
  }
  await schemaReady;
  return pool;
}

export async function readNewsFeed(now = Date.now(), eventId?: string): Promise<NewsFeed> {
  if (!newsProviderConfigured()) return { status: "not_configured", updatedAt: null, provider: null, events: [] };
  try {
    const pool = await newsPool();
    const [sync, rows] = await Promise.all([
      pool.query<{ synced_at: Date }>("select synced_at from alpha_exchange.economic_news_sync where id = true"),
      pool.query<{ payload: NewsEvent }>(`select payload from alpha_exchange.economic_news_events
        where (scheduled_at >= $1 and scheduled_at <= $2) or id=$3 order by scheduled_at limit 500`,
      [new Date(now - 7 * 86_400_000), new Date(now + 7 * 86_400_000), eventId ?? null]),
    ]);
    const updatedAt = sync.rows[0]?.synced_at.toISOString() ?? null;
    return {
      status: !updatedAt ? "unavailable" : now - Date.parse(updatedAt) > NEWS_STALE_AFTER_MS ? "stale" : "ready",
      updatedAt, provider: "Trading Economics", events: rows.rows.map((row) => row.payload),
    };
  } catch { return { status: "unavailable", updatedAt: null, provider: "Trading Economics", events: [] }; }
}

async function queueRelease(client: PoolClient, event: NewsEvent, now: Date) {
  // Channel opt-in must predate this release. Initial imports and old catch-up releases never alert.
  await client.query(`insert into alpha_exchange.economic_news_deliveries(id, event_id, user_id, channel, payload, created_at)
    select $1 || ':' || s.user_id || ':' || c.channel, $1, s.user_id, c.channel, $2::jsonb, $3
    from alpha_exchange.economic_news_subscriptions s join alpha_exchange.users u on u.id=s.user_id
    cross join (values ('inApp'), ('email')) c(channel)
    where (u.payload->>'disabled') is distinct from 'true' and u.payload->>'emailVerified' = 'true'
    and ((c.channel = 'inApp' and s.in_app and s.in_app_since <= $4
      and (u.payload->'notificationPreferences'->>'inApp') is distinct from 'false')
      or (c.channel = 'email' and s.email and s.email_since <= $4
      and u.payload->'notificationPreferences'->>'email' = 'true'))
    on conflict (event_id,user_id,channel) do nothing`,
  [event.id, JSON.stringify(event), now, event.scheduledAt]);
}

export async function persistNewsSnapshot(events: NewsEvent[], now = new Date()) {
  const pool = await initializeNewsStorage();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const lock = await client.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(2072302) as acquired");
    if (!lock.rows[0]?.acquired) { await client.query("rollback"); return { synced: false, releases: 0 }; }
    const sync = await client.query<{ synced_at: Date }>("select synced_at from alpha_exchange.economic_news_sync where id=true");
    // A slow older run cannot overwrite a more recent completed snapshot.
    if (sync.rows[0] && sync.rows[0].synced_at.getTime() >= now.getTime()) {
      await client.query("rollback"); return { synced: false, releases: 0 };
    }
    const old = await client.query<{ id: string; payload: NewsEvent }>(
      "select id,payload from alpha_exchange.economic_news_events where id = any($1::text[])", [events.map((e) => e.id)],
    );
    const prior = new Map(old.rows.map((row) => [row.id, row.payload]));
    let releases = 0;
    for (const incoming of events) {
      const before = prior.get(incoming.id);
      if (before && before.providerUpdatedAt > incoming.providerUpdatedAt) continue;
      const changed = Boolean(before && (before.actual !== incoming.actual || before.previous !== incoming.previous
        || before.scheduledAt !== incoming.scheduledAt || before.revised !== incoming.revised));
      const corrected = Boolean(before?.corrected || (before?.actual != null && changed));
      const event = { ...incoming, corrected };
      await client.query(`insert into alpha_exchange.economic_news_events(id,scheduled_at,payload) values ($1,$2,$3::jsonb)
        on conflict(id) do update set scheduled_at=excluded.scheduled_at, payload=excluded.payload,
        revisions=case when $4 then alpha_exchange.economic_news_events.revisions || jsonb_build_array(alpha_exchange.economic_news_events.payload)
          else alpha_exchange.economic_news_events.revisions end`, [event.id, event.scheduledAt, JSON.stringify(event), changed]);
      if (shouldAlertForRelease(before, event, now.getTime(), Boolean(sync.rows.length))) {
        await queueRelease(client, event, now);
        releases++;
      }
    }
    await client.query(`insert into alpha_exchange.economic_news_sync(id,synced_at) values(true,$1)
      on conflict(id) do update set synced_at=excluded.synced_at`, [now]);
    // Expiry is isolated to News rows; completed delivery keys are retained to prevent duplicates.
    await client.query(`update alpha_exchange.economic_news_deliveries set status='expired'
      where status in ('pending','processing') and created_at < $1`, [new Date(now.getTime() - 60 * 60_000)]);
    await client.query("commit");
    return { synced: true, releases };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function readNewsPreferences(userId: string): Promise<NewsPreferences> {
  if (!newsProviderConfigured()) return { inApp: false, email: false };
  const pool = await newsPool();
  const result = await pool.query<{ in_app: boolean; email: boolean }>(
    "select in_app,email from alpha_exchange.economic_news_subscriptions where user_id=$1", [userId],
  );
  return { inApp: result.rows[0]?.in_app ?? false, email: result.rows[0]?.email ?? false };
}

export async function saveNewsPreferences(userId: string, preferences: NewsPreferences) {
  if (!newsProviderConfigured()) throw new Error("News is not configured");
  const pool = await newsPool();
  await pool.query(`insert into alpha_exchange.economic_news_subscriptions(user_id,in_app,email,in_app_since,email_since)
    values($1,$2,$3,case when $2 then now() end,case when $3 then now() end)
    on conflict(user_id) do update set in_app=$2,email=$3,
      in_app_since=case when not $2 then null when not economic_news_subscriptions.in_app then now() else economic_news_subscriptions.in_app_since end,
      email_since=case when not $3 then null when not economic_news_subscriptions.email then now() else economic_news_subscriptions.email_since end,
      updated_at=now()`, [userId, preferences.inApp, preferences.email]);
  return preferences;
}
