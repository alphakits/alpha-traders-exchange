import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { IDENTIFIED_TRAFFIC } from "@/lib/traffic-analytics-store";
import { OWNER_ANALYTICS_TIME_ZONE } from "@/lib/owner-analytics-reporting";
import { formatPublicAccountId } from "@/lib/format-id";
import type { OwnerVisitor, VisitorDirectory, VisitorPeriod, VisitorTimeline, VisitorEvent } from "@/lib/owner-visitor-activity";

const PAGE_SIZE = 25;
const TIMELINE_SIZE = 50;
type Cursor = { at: string; key: string };
export function parseVisitorCursor(value?: string | null): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof cursor.at !== "string" || !Number.isFinite(Date.parse(cursor.at))
      || typeof cursor.key !== "string" || cursor.key.length > 300) throw Error();
    return { at: cursor.at, key: cursor.key };
  } catch { throw new Error("Invalid cursor"); }
}
const encodeCursor = (at: string, key: string) => Buffer.from(JSON.stringify({ at, key })).toString("base64url");
const cutoff = `($2::text = 'all' or occurred_at >= date_trunc('day',now(),'${OWNER_ANALYTICS_TIME_ZONE}'))`;

/** Only explicit owner fields are selected; no account payload, contacts or secrets. */
export async function readOwnerVisitorDirectory(startedAt: string, period: VisitorPeriod, cursorValue?: string | null): Promise<VisitorDirectory> {
  const db = getRuntimePostgresPool();
  if (!db) throw Error("Analytics unavailable");
  const cursor = parseVisitorCursor(cursorValue);
  const result = await db.query(`${IDENTIFIED_TRAFFIC}, people as (
    select person_key, min(occurred_at) first_seen, max(occurred_at) last_seen,
      count(distinct coalesce(nullif(regexp_replace(regexp_replace(
        split_part(split_part(path,'?',1),'#',1),'^/(en|ar)(/|$)','/'),'/+$',''),''),'/')) filter(where event_name='page_view')::int pages,
      count(*) filter(where event_name='page_view')::int visits,
      count(distinct session_key)::int sessions, array_agg(distinct platform) platforms
    from identified_traffic where ${cutoff} group by person_key
  ), latest as (
    select distinct on (person_key) person_key,path last_path from identified_traffic
    where ${cutoff} order by person_key,occurred_at desc,id desc
  )
  select p.person_key, first_seen::text, last_seen::text, pages, visits, sessions, platforms, last_path,
    left(u.payload->>'fullName',200) full_name, u.role
  from people p join latest using(person_key) left join alpha_exchange.users u on p.person_key='user:' || u.id
  where $3::timestamptz is null or (last_seen,p.person_key) < ($3::timestamptz,$4::text)
  order by last_seen desc, p.person_key desc limit $5`,
  [startedAt, period, cursor?.at ?? null, cursor?.key ?? null, PAGE_SIZE + 1]);
  const rows = result.rows.slice(0, PAGE_SIZE);
  const visitors: OwnerVisitor[] = rows.map(row => {
    const key = String(row.person_key);
    return { key, accountId: key.startsWith("user:") ? formatPublicAccountId(undefined, key.slice(5)) : null,
      name: row.full_name || null, role: row.role || null,
      firstSeen: String(row.first_seen), lastSeen: String(row.last_seen), pages: Number(row.pages), visits: Number(row.visits),
      sessions: Number(row.sessions), platforms: row.platforms, lastPath: String(row.last_path).split(/[?#]/,1)[0] };
  });
  const last = rows.at(-1);
  return { visitors, nextCursor: result.rows.length > PAGE_SIZE && last ? encodeCursor(String(last.last_seen), String(last.person_key)) : null,
    asOf: new Date().toISOString() };
}

/** The audit actor is authoritative. A target user is never labelled as the actor. */
export async function readOwnerVisitorTimeline(startedAt: string, period: VisitorPeriod, personKey: string, cursorValue?: string | null): Promise<VisitorTimeline> {
  const db = getRuntimePostgresPool();
  if (!db) throw Error("Analytics unavailable");
  const cursor = parseVisitorCursor(cursorValue);
  const result = await db.query(`${IDENTIFIED_TRAFFIC}, timeline as (
    select 'page:' || id as event_id, occurred_at at, 'page' as kind,
      split_part(split_part(path,'?',1),'#',1) label, platform
    from identified_traffic where person_key=$3 and event_name='page_view' and ${cutoff}
    union all
    select 'action:' || id, created_at, 'action', left(action,160), null
    from alpha_exchange.audit_logs where 'user:' || actor_user_id=$3
      and created_at >= $1::timestamptz and created_at <= now()
      and ($2::text='all' or created_at >= date_trunc('day',now(),'${OWNER_ANALYTICS_TIME_ZONE}'))
  )
  select event_id, at::text, kind, label, platform from timeline
  where $4::timestamptz is null or (at,event_id) < ($4::timestamptz,$5::text)
  order by at desc,event_id desc limit $6`,
  [startedAt, period, personKey, cursor?.at ?? null, cursor?.key ?? null, TIMELINE_SIZE + 1]);
  const rows = result.rows.slice(0,TIMELINE_SIZE);
  const events: VisitorEvent[] = rows.map(row => ({ id: String(row.event_id), at: String(row.at),
    kind: row.kind, label: String(row.label), platform: row.platform || null }));
  const last = rows.at(-1);
  return { events, nextCursor: result.rows.length > TIMELINE_SIZE && last ? encodeCursor(String(last.at), String(last.event_id)) : null,
    asOf: new Date().toISOString() };
}
