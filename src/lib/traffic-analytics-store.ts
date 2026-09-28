import "server-only";
import { createHash, randomUUID } from "crypto";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { OWNER_ANALYTICS_TIME_ZONE } from "@/lib/owner-analytics-reporting";
const SQL = `create table if not exists alpha_exchange.traffic_events (id text primary key, occurred_at timestamptz not null default now(), visitor_key text not null, session_key text not null, user_id text, event_name text not null, path text not null, platform text not null, device_type text not null, referrer_host text); alter table alpha_exchange.traffic_events enable row level security; create index if not exists traffic_events_occurred_idx on alpha_exchange.traffic_events(occurred_at desc); create index if not exists traffic_events_visitor_idx on alpha_exchange.traffic_events(visitor_key, occurred_at desc);`;
let ready: Promise<void> | undefined;
async function pool(){const v=getRuntimePostgresPool();if(!v)return null;ready??=v.query(SQL).then(()=>undefined).catch(e=>{ready=undefined;throw e});await ready;return v}
export function analyticsKey(value:string){return createHash("sha256").update(value).digest("hex")}
export async function recordTrafficEvent(i: {
  visitorKey: string;
  sessionKey: string;
  userId?: string | null;
  eventName: string;
  path: string;
  platform: string;
  deviceType: string;
  referrerHost?: string | null;
}): Promise<boolean> {
  const db = await pool();
  if (!db) return false;
  const result = await db.query(
    `insert into alpha_exchange.traffic_events (id,visitor_key,session_key,user_id,event_name,path,platform,device_type,referrer_host) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), i.visitorKey, i.sessionKey, i.userId ?? null, i.eventName, i.path.slice(0, 240), i.platform, i.deviceType, i.referrerHost?.slice(0, 180) ?? null],
  );
  // An HTTP success must mean a row was inserted, not a missing database no-op.
  return result.rowCount === 1;
}
export type OwnerTrafficAnalytics = {
  visitorsToday: number;
  sessionsToday: number;
  pageViewsToday: number;
  webToday: number;
  iosToday: number;
  androidToday: number;
  mobileToday: number;
  desktopToday: number;
  topPages: Array<{ path: string; uniqueVisitors: number; views: number }>;
  allTimePages: Array<{ path: string; uniqueVisitors: number; views: number }>;
  sources: Array<{ source: string; sessions: number }>;
};

// Resolve identity at read time within the current reporting period only.
// Account IDs come from the verified server session, never the event payload.
// A browser used by several accounts cannot safely identify signed-out visits:
// keep those anonymous, without merging distinct signed-in accounts together.
const IDENTIFIED_TRAFFIC = `with visitor_accounts as (
  select visitor_key, min(nullif(user_id,'')) as user_id
  from alpha_exchange.traffic_events
  where occurred_at <= now() and ($1::timestamptz is null or occurred_at >= $1::timestamptz)
  group by visitor_key having count(distinct nullif(user_id,'')) = 1
), identified_traffic as (
  select e.*, coalesce('user:' || nullif(e.user_id,''), 'user:' || a.user_id,
    'visitor:' || e.visitor_key) as person_key
  from alpha_exchange.traffic_events e
  left join visitor_accounts a on a.visitor_key = e.visitor_key
  where e.occurred_at <= now() and ($1::timestamptz is null or e.occurred_at >= $1::timestamptz)
)`;

export async function readOwnerTrafficAnalytics(startedAt?: string): Promise<OwnerTrafficAnalytics> {
  const db = await pool();
  if (!db) return { visitorsToday: 0, sessionsToday: 0, pageViewsToday: 0,
    webToday: 0, iosToday: 0, androidToday: 0, mobileToday: 0, desktopToday: 0,
    topPages: [], allTimePages: [], sources: [] };
  const today = `date_trunc('day',now(),'${OWNER_ANALYTICS_TIME_ZONE}')`;
  const [summary, sections, sources] = await Promise.all([
    db.query(`select * from (${IDENTIFIED_TRAFFIC}
      select count(distinct person_key)::int visitors_today,
        count(distinct session_key)::int sessions_today,
        count(*) filter(where event_name='page_view')::int page_views_today,
        count(distinct session_key) filter(where platform='web')::int web_today,
        count(distinct session_key) filter(where platform='ios')::int ios_today,
        count(distinct session_key) filter(where platform='android')::int android_today,
        count(distinct session_key) filter(where device_type='mobile')::int mobile_today,
        count(distinct session_key) filter(where device_type='desktop')::int desktop_today
      from identified_traffic where occurred_at >= ${today}
    ) as daily_summary`, [startedAt ?? null]),
    db.query(`select * from (${IDENTIFIED_TRAFFIC}, section_visits as (
      select person_key, occurred_at,
        '/' || split_part(trim(both '/' from regexp_replace(
          split_part(split_part(path,'?',1),'#',1), '^/(en|ar)(/|$)', '/')), '/', 1) as section_path
      from identified_traffic where event_name='page_view'
    )
      select section_path as path,
        count(distinct person_key)::int unique_visitors,
        count(*)::int views,
        count(distinct person_key) filter(where occurred_at >= ${today})::int unique_today,
        count(*) filter(where occurred_at >= ${today})::int views_today
      from section_visits group by section_path
    ) as section_totals order by unique_visitors desc, path`, [startedAt ?? null]),
    db.query(`select coalesce(nullif(referrer_host,''),'Direct') source,
      count(distinct session_key)::int sessions from alpha_exchange.traffic_events
      where occurred_at >= ${today} and occurred_at <= now()
        and ($1::timestamptz is null or occurred_at >= $1::timestamptz)
      group by 1 order by sessions desc, source limit 8`, [startedAt ?? null]),
  ]);
  const s = summary.rows[0] ?? {};
  return {
    visitorsToday: Number(s.visitors_today ?? 0),
    sessionsToday: Number(s.sessions_today ?? 0),
    pageViewsToday: Number(s.page_views_today ?? 0),
    webToday: Number(s.web_today ?? 0),
    iosToday: Number(s.ios_today ?? 0),
    androidToday: Number(s.android_today ?? 0),
    mobileToday: Number(s.mobile_today ?? 0),
    desktopToday: Number(s.desktop_today ?? 0),
    topPages: sections.rows.filter((r) => Number(r.views_today) > 0)
      .map((r) => ({ path: String(r.path), uniqueVisitors: Number(r.unique_today), views: Number(r.views_today) }))
      .sort((a, b) => b.uniqueVisitors - a.uniqueVisitors || a.path.localeCompare(b.path)).slice(0, 8),
    allTimePages: sections.rows.slice(0, 100)
      .map((r) => ({ path: String(r.path), uniqueVisitors: Number(r.unique_visitors), views: Number(r.views) })),
    sources: sources.rows.map((r) => ({ source: String(r.source), sessions: Number(r.sessions) })),
  };
}
