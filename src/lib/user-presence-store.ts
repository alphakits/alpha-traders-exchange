import "server-only";
import { createHash } from "crypto";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { PRESENCE_IDLE_MS, PRESENCE_LEASE_MS, type PresenceUpdate, type UserPresenceData } from "@alpha-traders/contracts";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { isPublicOwnerIdentity } from "@/lib/public-account-identity";

export const PRESENCE_SCHEMA_SQL = `create table if not exists alpha_exchange.user_presence (
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  session_key text not null,
  client_id text not null,
  sequence bigint not null,
  active boolean not null,
  last_seen_at timestamptz,
  last_active_at timestamptz,
  primary key (user_id, session_key, client_id)
)`;

// Presence has its own small rows. It must never rewrite the Exchange snapshot,
// acquire the trade mutation lock, or change a user's profile updatedAt.
export const PRESENCE_UPSERT_SQL = `insert into alpha_exchange.user_presence as presence
  (user_id, session_key, client_id, sequence, active, last_seen_at, last_active_at)
  select $1, $2, $3, $4, $5, case when $5 then now() end, case when $5 and $6 then now() end
  from alpha_exchange.users u
  where u.id = $1 and coalesce(u.payload->>'disabled', 'false') <> 'true'
    and exists (select 1 from alpha_exchange.sessions s
      where s.token_hash = $2 and s.user_id = $1 and s.expires_at > now())
  on conflict (user_id, session_key, client_id) do update set
    sequence = excluded.sequence, active = excluded.active,
    last_seen_at = coalesce(excluded.last_seen_at, presence.last_seen_at),
    last_active_at = coalesce(excluded.last_active_at, presence.last_active_at)
  where excluded.sequence > presence.sequence`;

type MemoryRow = PresenceUpdate & { userId: string; sessionKey: string; lastSeenAt?: string; lastActiveAt?: string };
const memory = new Map<string, MemoryRow>();
let ready: Promise<void> | undefined;

export function presenceSessionKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function presencePool() {
  const pool = getRuntimePostgresPool(); // Production fails closed if durable storage is unavailable.
  if (!pool) return null;
  ready ??= pool.query(PRESENCE_SCHEMA_SQL + "; alter table alpha_exchange.user_presence enable row level security; create index if not exists user_presence_session_key_idx on alpha_exchange.user_presence(session_key)").then(() => undefined).catch((error) => { ready = undefined; throw error; });
  await ready;
  return pool;
}

export async function recordUserPresence(userId: string, sessionKey: string, update: PresenceUpdate) {
  const pool = await presencePool();
  if (pool) {
    await pool.query(PRESENCE_UPSERT_SQL, [userId, sessionKey, update.clientId, update.sequence, update.active, update.activity]);
    return;
  }
  const key = `${userId}:${sessionKey}:${update.clientId}`;
  const previous = memory.get(key);
  if (previous && previous.sequence >= update.sequence) return;
  const now = new Date().toISOString();
  memory.set(key, { ...previous, ...update, userId, sessionKey,
    lastSeenAt: update.active ? now : previous?.lastSeenAt,
    lastActiveAt: update.active && update.activity ? now : previous?.lastActiveAt });
}

export async function endPresenceSession(sessionKey: string) {
  const pool = await presencePool();
  if (pool) {
    await pool.query("update alpha_exchange.user_presence set active = false where session_key = $1 and active", [sessionKey]);
  } else {
    for (const row of memory.values()) if (row.sessionKey === sessionKey) row.active = false;
  }
}

export async function readUserPresence(userIds: string[]): Promise<Record<string, UserPresenceData>> {
  if (!userIds.length) return {};
  const ids = [...new Set(userIds)];
  const result: Record<string, UserPresenceData> = Object.fromEntries(ids.map(id => [id, { onlineStatus: "offline", lastActiveAt: null, lastSeenAt: null }]));
  const pool = await presencePool();
  if (pool) {
    const { rows } = await pool.query<{ user_id: string; online: boolean; last_seen_at: Date | null; last_active_at: Date | null }>(
      `select p.user_id, max(last_seen_at) as last_seen_at, max(last_active_at) as last_active_at,
        bool_or(active and s.expires_at > now() and last_seen_at > now() - ($2::bigint * interval '1 millisecond')
          and last_active_at > now() - ($3::bigint * interval '1 millisecond')) as online
       from alpha_exchange.user_presence p left join alpha_exchange.sessions s on s.token_hash = p.session_key and s.user_id = p.user_id
       where p.user_id = any($1::text[]) group by p.user_id`,
      [ids, PRESENCE_LEASE_MS, PRESENCE_IDLE_MS],
    );
    for (const row of rows) result[row.user_id] = { onlineStatus: row.online ? "online" : "offline", lastSeenAt: row.last_seen_at?.toISOString() ?? null, lastActiveAt: row.last_active_at?.toISOString() ?? null };
  } else {
    const now = Date.now();
    for (const row of memory.values()) {
      const value = result[row.userId];
      if (!value) continue;
      if (row.lastActiveAt && (!value.lastActiveAt || row.lastActiveAt > value.lastActiveAt)) value.lastActiveAt = row.lastActiveAt;
      if (row.lastSeenAt && (!value.lastSeenAt || row.lastSeenAt > value.lastSeenAt)) value.lastSeenAt = row.lastSeenAt;
      if (row.active && now - Date.parse(row.lastSeenAt ?? "") < PRESENCE_LEASE_MS && now - Date.parse(row.lastActiveAt ?? "") < PRESENCE_IDLE_MS) value.onlineStatus = "online";
    }
  }
  return result;
}

export function visibleUserPresence(user: AlphaExchangeUser, value: UserPresenceData | undefined, viewer?: AlphaExchangeUser): UserPresenceData {
  const privileged = user.id === viewer?.id || isPublicOwnerIdentity(viewer) || isPublicOwnerIdentity(user);
  if (!privileged && (user.showLastActive === false || user.isProfileHidden === true
    || user.blockedUserIds?.includes(viewer?.id ?? "") || viewer?.blockedUserIds?.includes(user.id))) {
    return { onlineStatus: "offline", lastActiveAt: null, lastSeenAt: null, presenceHidden: true };
  }
  return { ...value, onlineStatus: user.disabled ? "offline" : value?.onlineStatus ?? "offline" };
}


export type OwnerPresenceAnalytics = {
  onlineNow: number;
  activeToday: number;
  activeLast7Days: number;
  activeLast30Days: number;
  onlineUserIds: string[];
  activeTodayUserIds: string[];
};

export async function readOwnerPresenceAnalytics(): Promise<OwnerPresenceAnalytics> {
  const pool = await presencePool();
  if (pool) {
    const { rows } = await pool.query<{
      online_now: string | number;
      active_today: string | number;
      active_7d: string | number;
      active_30d: string | number;
      online_user_ids: string[] | null;
      active_today_user_ids: string[] | null;
    }>(
      `select
        count(distinct user_id) filter (
          where active
            and last_seen_at > now() - ($1::bigint * interval '1 millisecond')
            and last_active_at > now() - ($2::bigint * interval '1 millisecond')
        ) as online_now,
        count(distinct user_id) filter (where last_active_at >= date_trunc('day', now())) as active_today,
        count(distinct user_id) filter (where last_active_at >= now() - interval '7 days') as active_7d,
        count(distinct user_id) filter (where last_active_at >= now() - interval '30 days') as active_30d,
        coalesce(array_agg(distinct user_id) filter (
          where active
            and last_seen_at > now() - ($1::bigint * interval '1 millisecond')
            and last_active_at > now() - ($2::bigint * interval '1 millisecond')
        ), array[]::text[]) as online_user_ids,
        coalesce(array_agg(distinct user_id) filter (
          where last_active_at >= date_trunc('day', now())
        ), array[]::text[]) as active_today_user_ids
       from alpha_exchange.user_presence`,
      [PRESENCE_LEASE_MS, PRESENCE_IDLE_MS],
    );
    const row = rows[0];
    return {
      onlineNow: Number(row?.online_now ?? 0),
      activeToday: Number(row?.active_today ?? 0),
      activeLast7Days: Number(row?.active_7d ?? 0),
      activeLast30Days: Number(row?.active_30d ?? 0),
      onlineUserIds: row?.online_user_ids ?? [],
      activeTodayUserIds: row?.active_today_user_ids ?? [],
    };
  }

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const online = new Set<string>();
  const today = new Set<string>();
  const d7 = new Set<string>();
  const d30 = new Set<string>();
  for (const row of memory.values()) {
    const activeAt = Date.parse(row.lastActiveAt ?? "");
    const seenAt = Date.parse(row.lastSeenAt ?? "");
    if (!Number.isFinite(activeAt)) continue;
    if (activeAt >= startOfToday.getTime()) today.add(row.userId);
    if (activeAt >= now - 7 * 86_400_000) d7.add(row.userId);
    if (activeAt >= now - 30 * 86_400_000) d30.add(row.userId);
    if (row.active && Number.isFinite(seenAt) && now - seenAt < PRESENCE_LEASE_MS && now - activeAt < PRESENCE_IDLE_MS) online.add(row.userId);
  }
  return {
    onlineNow: online.size,
    activeToday: today.size,
    activeLast7Days: d7.size,
    activeLast30Days: d30.size,
    onlineUserIds: [...online],
    activeTodayUserIds: [...today],
  };
}
