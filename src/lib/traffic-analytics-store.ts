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
export type OwnerTrafficAnalytics={visitorsToday:number;sessionsToday:number;pageViewsToday:number;webToday:number;iosToday:number;androidToday:number;mobileToday:number;desktopToday:number;topPages:Array<{path:string;views:number}>;sources:Array<{source:string;sessions:number}>};
export async function readOwnerTrafficAnalytics():Promise<OwnerTrafficAnalytics>{const db=await pool();const empty={visitorsToday:0,sessionsToday:0,pageViewsToday:0,webToday:0,iosToday:0,androidToday:0,mobileToday:0,desktopToday:0,topPages:[],sources:[]};if(!db)return empty;const [a,b,c]=await Promise.all([db.query(`select count(distinct visitor_key)::int visitors_today,count(distinct session_key)::int sessions_today,count(*) filter(where event_name='page_view')::int page_views_today,count(distinct session_key) filter(where platform='web')::int web_today,count(distinct session_key) filter(where platform='ios')::int ios_today,count(distinct session_key) filter(where platform='android')::int android_today,count(distinct session_key) filter(where device_type='mobile')::int mobile_today,count(distinct session_key) filter(where device_type='desktop')::int desktop_today from alpha_exchange.traffic_events where occurred_at>=date_trunc('day',now(),'${OWNER_ANALYTICS_TIME_ZONE}')`),db.query(`select path,count(*)::int views from alpha_exchange.traffic_events where occurred_at>=date_trunc('day',now(),'${OWNER_ANALYTICS_TIME_ZONE}') and event_name='page_view' group by path order by views desc limit 8`),db.query(`select coalesce(nullif(referrer_host,''),'Direct') source,count(distinct session_key)::int sessions from alpha_exchange.traffic_events where occurred_at>=date_trunc('day',now(),'${OWNER_ANALYTICS_TIME_ZONE}') group by 1 order by sessions desc limit 8`)]);const s=a.rows[0]??{};return{visitorsToday:Number(s.visitors_today??0),sessionsToday:Number(s.sessions_today??0),pageViewsToday:Number(s.page_views_today??0),webToday:Number(s.web_today??0),iosToday:Number(s.ios_today??0),androidToday:Number(s.android_today??0),mobileToday:Number(s.mobile_today??0),desktopToday:Number(s.desktop_today??0),topPages:b.rows.map(r=>({path:String(r.path),views:Number(r.views)})),sources:c.rows.map(r=>({source:String(r.source),sessions:Number(r.sessions)}))}}
