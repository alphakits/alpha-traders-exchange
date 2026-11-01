import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { rollbackFailedTransaction } from "@/lib/postgres-transaction";
import { weeklyCalendarSchema, type WeeklyCalendar } from "./weekly-schema";
import { immediatelyFollows, type OfficialResult } from "./official-sources";

// Isolated News tables. No trade/user/notification rows or client policies are changed.
export const OFFICIAL_NEWS_SCHEMA = `
create table if not exists alpha_exchange.economic_news_official_results (
 id text primary key, payload jsonb not null, checked_at timestamptz not null,
 source_hash text not null, revisions jsonb not null default '[]'::jsonb
);
create table if not exists alpha_exchange.economic_news_official_sync (
 id boolean primary key default true check(id), lease_token text, lease_until timestamptz,
 checked_at timestamptz, diagnostics jsonb not null default '{}'::jsonb
);
alter table alpha_exchange.economic_news_official_results enable row level security;
alter table alpha_exchange.economic_news_official_sync enable row level security;
revoke all on table alpha_exchange.economic_news_official_results from public, anon, authenticated;
revoke all on table alpha_exchange.economic_news_official_sync from public, anon, authenticated;
`;
let initialized: Promise<void> | undefined;
async function initialize(pool: Pool) {
  if (!initialized) initialized = (async () => {
    const client = await pool.connect();
    let destroy = false;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(2072304)");
      await client.query(OFFICIAL_NEWS_SCHEMA);
      await client.query("commit");
    } catch (error) { destroy = await rollbackFailedTransaction(client, error); throw error; }
    finally { client.release(destroy); }
  })().catch(error => { initialized = undefined; throw error; });
  await initialized;
}
export async function acquireOfficialNewsLease(now: number) {
  const pool = getRuntimePostgresPool();
  if (!pool) return null;
  await initialize(pool);
  const token = randomUUID();
  const lease = await pool.query(`insert into alpha_exchange.economic_news_official_sync(id,lease_token,lease_until) values(true,$1,$2)
    on conflict(id) do update set lease_token=$1,lease_until=$2
    where economic_news_official_sync.lease_until is null or economic_news_official_sync.lease_until < $3 returning id`,
  [token, new Date(now + 55_000), new Date(now)]);
  return lease.rows.length ? { pool, token } : null;
}

export function validatedOfficialResult(calendar: WeeklyCalendar, result: OfficialResult, now: number) {
  const original = calendar.events.find(event => event.id === result.event.id);
  if (!original || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(result.checkedAt) || !Number.isFinite(Date.parse(result.checkedAt))
    || Date.parse(result.checkedAt) > now || Date.parse(result.checkedAt) < Date.parse(original.scheduledAt)
    || !/^[a-f0-9]{64}(?::[a-f0-9]{64})?$/.test(result.sourceHash)) return false;
  for (const key of ["agency", "title", "titleAr", "scheduledAt", "timing", "kind", "reference"] as const) if (result.event[key] !== original[key]) return false;
  if (result.event.actual === null && !result.event.outcome) return false;
  const verified = result.checkedAt > calendar.verifiedAt ? result.checkedAt : calendar.verifiedAt;
  return weeklyCalendarSchema.safeParse({ ...calendar, resultsVerifiedAt: verified, events: [result.event] }).success;
}

export async function saveOfficialResults(lease: { pool: Pool; token: string }, calendar: WeeklyCalendar, results: OfficialResult[], now: number, diagnostics: Record<string, unknown>) {
  const client = await lease.pool.connect();
  let destroy = false;
  let changed = 0;
  try {
    await client.query("begin");
    const check = await client.query<{ lease_token: string }>("select lease_token from alpha_exchange.economic_news_official_sync where id=true for update");
    if (check.rows[0]?.lease_token !== lease.token) { await client.query("rollback"); return 0; }
    for (const result of results) {
      if (!validatedOfficialResult(calendar, result, now)) continue;
      const saved = await client.query(`insert into alpha_exchange.economic_news_official_results(id,payload,checked_at,source_hash)
        values($1,$2::jsonb,$3,$4) on conflict(id) do update set payload=excluded.payload,checked_at=excluded.checked_at,source_hash=excluded.source_hash,
        revisions=case when economic_news_official_results.payload <> excluded.payload
          then economic_news_official_results.revisions || jsonb_build_array(jsonb_build_object('event',economic_news_official_results.payload,'checkedAt',economic_news_official_results.checked_at,'sourceHash',economic_news_official_results.source_hash))
          else economic_news_official_results.revisions end
        where economic_news_official_results.checked_at < excluded.checked_at
          and (economic_news_official_results.payload <> excluded.payload or economic_news_official_results.source_hash <> excluded.source_hash)
        returning id`, [result.event.id, JSON.stringify(result.event), result.checkedAt, result.sourceHash]);
      changed += saved.rows.length;
    }
    // The lease remains until its expiry to rate-limit duplicate scheduler invocations.
    await client.query("update alpha_exchange.economic_news_official_sync set checked_at=$1,diagnostics=$2::jsonb where id=true", [new Date(now), JSON.stringify(diagnostics)]);
    await client.query("commit");
    return changed;
  } catch (error) { destroy = await rollbackFailedTransaction(client, error); throw error; }
  finally { client.release(destroy); }
}

export function mergeOfficialResults(calendar: WeeklyCalendar, results: OfficialResult[], now: number): WeeklyCalendar {
  const merged = structuredClone(calendar);
  const baseline = Date.parse(calendar.resultsVerifiedAt ?? calendar.verifiedAt);
  for (const result of results) {
    if (!validatedOfficialResult(calendar, result, now)) continue;
    const index = merged.events.findIndex(event => event.id === result.event.id);
    if (Date.parse(result.checkedAt) < baseline && (merged.events[index].actual !== null || merged.events[index].outcome)) continue;
    merged.events[index] = structuredClone(result.event);
    if (result.checkedAt > (merged.resultsVerifiedAt ?? merged.verifiedAt)) merged.resultsVerifiedAt = result.checkedAt;
  }
  // Only the next occurrence of the same series/reference progression gets a comparison.
  const ordered = [...merged.events].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  for (const previous of ordered) {
    if (previous.actual === null) continue;
    const next = ordered.find(event => event.scheduledAt > previous.scheduledAt && immediatelyFollows(previous, event));
    if (next && next.actual === null && Date.parse(next.scheduledAt) > now) next.previous = previous.actual;
  }
  return merged;
}

export async function readOfficialResults(calendar: WeeklyCalendar, now: number) {
  const pool = getRuntimePostgresPool();
  if (!pool) return { calendar, checkedAt: null, available: false, diagnostics: null };
  try {
    const [results, sync] = await Promise.all([
      pool.query<{ payload: OfficialResult["event"]; checked_at: Date; source_hash: string }>("select payload,checked_at,source_hash from alpha_exchange.economic_news_official_results where id=any($1::text[])", [calendar.events.map(event => event.id)]),
      pool.query<{ checked_at: Date | null; diagnostics: { failed?: string[]; pending?: string[]; unsupported?: string[] } }>("select checked_at,diagnostics from alpha_exchange.economic_news_official_sync where id=true"),
    ]);
    return { calendar: mergeOfficialResults(calendar, results.rows.map(row => ({ event: row.payload, checkedAt: row.checked_at.toISOString().replace(/\.\d{3}Z$/, "Z"), sourceHash: row.source_hash })), now),
      checkedAt: sync.rows[0]?.checked_at?.toISOString() ?? null, available: true, diagnostics: sync.rows[0]?.diagnostics ?? null };
  } catch { return { calendar, checkedAt: null, available: false, diagnostics: null }; }
}
