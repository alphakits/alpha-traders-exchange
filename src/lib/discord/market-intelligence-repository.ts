import "server-only";

import type { Pool } from "pg";

import type { DiscordMarketIntelligenceDiagnostics } from "@/lib/discord/diagnostics";
import {
  type DiscordMarketContentSnapshot,
  type DiscordMarketPulseSnapshot,
  type DiscordMarketActivitySnapshot,
  type DiscordWeeklyLeaderboardSnapshot,
  normalizeMarketSiteUrl,
} from "@/lib/discord/market-intelligence-publisher";
import type { DiscordPublicSellerProfile } from "@/lib/discord/seller-profile-card";
import { isSafeDiscordImageUrl } from "@/lib/discord/listing-publisher";
import { normalizePublicProfileUsername } from "@/lib/public-profile-username";
import { deriveSellerPresence } from "@/lib/seller-presence";

export const MARKET_PRESENCE_WINDOW_MINUTES = 10;
export const MARKET_ACTIVITY_WINDOW_HOURS = 24;

export type DiscordMarketContentKey =
  | "live_market_pulse"
  | "market_activity_digest"
  | "weekly_top_sellers";

export type DiscordMarketContentClaim = {
  contentKey: DiscordMarketContentKey;
  channelId: string;
  messageId: string | null;
  contentVersion: number;
  leaseFence: number;
  leaseToken: string;
  attempts: number;
};

export interface DiscordMarketContentRepository {
  claimDueContent(): Promise<DiscordMarketContentClaim | null>;
  ownsClaim(claim: DiscordMarketContentClaim): Promise<boolean>;
  buildSnapshot(
    contentKey: DiscordMarketContentKey,
  ): Promise<DiscordMarketContentSnapshot>;
  completeContent(input: {
    claim: DiscordMarketContentClaim;
    messageId: string;
    snapshot: DiscordMarketContentSnapshot;
    snapshotHash: string;
  }): Promise<boolean>;
  failContent(input: {
    claim: DiscordMarketContentClaim;
    errorCode: string;
  }): Promise<void>;
  getDiagnostics(): Promise<DiscordMarketIntelligenceDiagnostics>;
}

type PulseRow = {
  server_time: Date;
  approved_public_sellers: number;
  active_eligible_listings: number;
  total_available_usdt: string;
  average_response_minutes: string | null;
  active_trades: number;
  sellers_online: number;
  buyers_online: number;
};

type ActivityRow = {
  server_time: Date;
  window_started_at: Date;
  approved_listings_added: number;
  completed_trades: number;
  newly_approved_sellers: number;
};

type LeaderboardRow = {
  server_time: Date;
  window_started_at: Date;
  window_ends_at: Date;
  seller_id: string | null;
  display_name: string | null;
  completed_trades: number | null;
  trust_score: string | null;
  rating: string | null;
};

const PUBLIC_SELLER_SQL = `
  users.seller_status = 'approved_seller'
  and coalesce((users.payload ->> 'disabled')::boolean, false) = false
  and coalesce((users.payload ->> 'isProfileHidden')::boolean, false) = false
  and coalesce((users.payload ->> 'allowProfileSearch')::boolean, true) = true
  and nullif(btrim(users.payload ->> 'buyerDisplayName'), '') is not null
`;

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rankWeeklySellers(
  rows: Array<{
    sellerId: string;
    displayName: string;
    completedTrades: number;
    trustScore: number | null;
    rating: number | null;
  }>,
) {
  return [...rows].sort((left, right) =>
    right.completedTrades - left.completedTrades
    || (right.trustScore ?? -1) - (left.trustScore ?? -1)
    || (right.rating ?? -1) - (left.rating ?? -1)
    || left.displayName.localeCompare(right.displayName, "en", { sensitivity: "base" })
    || left.sellerId.localeCompare(right.sellerId));
}

async function readPulse(
  pool: Pool,
  siteUrl: string,
): Promise<DiscordMarketPulseSnapshot> {
  const result = await pool.query<PulseRow>(`
    with public_sellers as (
      select users.id, users.online_status, users.role, users.payload
        from alpha_exchange.users users
       where ${PUBLIC_SELLER_SQL}
    ), eligible_listings as (
      select listings.id,
             nullif(regexp_replace(coalesce(listings.payload ->> 'availableAmount', ''), '[^0-9.]', '', 'g'), '')::numeric as available_amount,
             nullif(regexp_replace(coalesce(listings.payload ->> 'responseTime', ''), '[^0-9.]', '', 'g'), '')::numeric as response_minutes
        from alpha_exchange.listings listings
        join public_sellers sellers on sellers.id = listings.seller_id
        join alpha_exchange.users users on users.id = listings.seller_id
       where listings.status = 'active'
         and listings.payload ->> 'approvalStatus' = 'approved'
         and (listings.expires_at is null or listings.expires_at > now())
         and users.availability_status <> 'vacation'
         and nullif(regexp_replace(coalesce(listings.payload ->> 'availableAmount', ''), '[^0-9.]', '', 'g'), '')::numeric > 0
         and not exists (
           select 1
             from alpha_exchange.commissions commission
            where commission.seller_id = listings.seller_id
              and commission.payment_status <> 'paid'
         )
    ), active_trade_count as (
      select count(*)::int as count
        from alpha_exchange.purchase_requests
       where status in (
         'pending', 'accepted', 'payment_sent', 'funds_received',
         'usdt_release_pending', 'usdt_sent'
       )
    )
    select now() as server_time,
           (select count(*)::int from public_sellers) as approved_public_sellers,
           (select count(*)::int from eligible_listings) as active_eligible_listings,
           coalesce((select sum(available_amount) from eligible_listings), 0)::text as total_available_usdt,
           (select round(avg(response_minutes))::text from eligible_listings where response_minutes > 0) as average_response_minutes,
           (select count from active_trade_count) as active_trades,
           (
             select count(*)::int
               from public_sellers
              where online_status = 'online'
                and coalesce((payload ->> 'showLastActive')::boolean, true) = true
                and nullif(payload ->> 'lastActiveAt', '')::timestamptz > now() - interval '${MARKET_PRESENCE_WINDOW_MINUTES} minutes'
           ) as sellers_online,
           (
             select count(*)::int
               from alpha_exchange.users users
              where users.seller_status <> 'approved_seller'
                and users.role not in ('admin', 'owner')
                 and coalesce((users.payload ->> 'disabled')::boolean, false) = false
                 and coalesce((users.payload ->> 'isProfileHidden')::boolean, false) = false
                 and coalesce((users.payload ->> 'showLastActive')::boolean, false) = true
                 and users.online_status = 'online'
                and nullif(users.payload ->> 'lastActiveAt', '')::timestamptz > now() - interval '${MARKET_PRESENCE_WINDOW_MINUTES} minutes'
           ) as buyers_online
  `);
  const row = result.rows[0]!;
  return {
    kind: "live_market_pulse",
    generatedAt: row.server_time.toISOString(),
    approvedPublicSellers: row.approved_public_sellers,
    activeEligibleListings: row.active_eligible_listings,
    totalAvailableUsdt: Number(row.total_available_usdt),
    averageResponseMinutes: numberOrNull(row.average_response_minutes),
    activeTrades: row.active_trades,
    sellersOnline: row.sellers_online,
    buyersOnline: row.buyers_online,
    siteUrl,
  };
}

async function readActivity(
  pool: Pool,
  siteUrl: string,
): Promise<DiscordMarketActivitySnapshot> {
  const result = await pool.query<ActivityRow>(`
    with clock as (
      select now() as server_time,
             now() - interval '${MARKET_ACTIVITY_WINDOW_HOURS} hours' as window_started_at
    )
    select clock.server_time,
           clock.window_started_at,
           (
             select count(*)::int
               from alpha_exchange.listings listings
               join alpha_exchange.users users on users.id = listings.seller_id
              where listings.created_at >= clock.window_started_at
                and listings.payload ->> 'approvalStatus' = 'approved'
                and ${PUBLIC_SELLER_SQL}
           ) as approved_listings_added,
           (
             select count(*)::int
               from alpha_exchange.purchase_requests requests
              where requests.completed_at >= clock.window_started_at
           ) as completed_trades,
           (
             select count(distinct applications.user_id)::int
               from alpha_exchange.seller_applications applications
               join alpha_exchange.users users on users.id = applications.user_id
              where applications.status = 'approved'
                and applications.updated_at >= clock.window_started_at
                and ${PUBLIC_SELLER_SQL}
           ) as newly_approved_sellers
      from clock
  `);
  const row = result.rows[0]!;
  return {
    kind: "market_activity_digest",
    generatedAt: row.server_time.toISOString(),
    windowStartedAt: row.window_started_at.toISOString(),
    approvedListingsAdded: row.approved_listings_added,
    completedTrades: row.completed_trades,
    newlyApprovedSellers: row.newly_approved_sellers,
    siteUrl,
  };
}

async function readLeaderboard(
  pool: Pool,
  siteUrl: string,
): Promise<DiscordWeeklyLeaderboardSnapshot> {
  const result = await pool.query<LeaderboardRow>(`
    with clock as (
      select now() as server_time,
             date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' as window_started_at
    ), ranked as (
      select requests.seller_id,
             users.payload ->> 'buyerDisplayName' as display_name,
             count(*)::int as completed_trades,
             nullif(trust.payload -> 'snapshot' ->> 'trustScore', '')::numeric as trust_score,
             nullif(trust.payload -> 'snapshot' ->> 'rating', '')::numeric as rating
        from alpha_exchange.purchase_requests requests
        join alpha_exchange.users users on users.id = requests.seller_id
        left join alpha_exchange.trust_snapshots trust on trust.seller_id = requests.seller_id
        cross join clock
       where requests.completed_at >= clock.window_started_at
         and requests.completed_at < clock.window_started_at + interval '7 days'
         and coalesce((users.payload ->> 'showTradeStats')::boolean, true) = true
         and ${PUBLIC_SELLER_SQL}
       group by requests.seller_id, users.payload ->> 'buyerDisplayName',
                trust.payload -> 'snapshot' ->> 'trustScore',
                trust.payload -> 'snapshot' ->> 'rating'
    )
    select clock.server_time,
           clock.window_started_at,
           clock.window_started_at + interval '7 days' as window_ends_at,
           ranked.seller_id,
           ranked.display_name,
           ranked.completed_trades,
           ranked.trust_score::text,
           ranked.rating::text
      from clock
      left join ranked on true
  `);
  const clock = result.rows[0]!;
  const ranked = rankWeeklySellers(result.rows.flatMap((row) =>
    row.seller_id && row.display_name && row.completed_trades
      ? [{
          sellerId: row.seller_id,
          displayName: row.display_name,
          completedTrades: row.completed_trades,
          trustScore: numberOrNull(row.trust_score),
          rating: numberOrNull(row.rating),
        }]
      : []));
  return {
    kind: "weekly_top_sellers",
    generatedAt: clock.server_time.toISOString(),
    windowStartedAt: clock.window_started_at.toISOString(),
    windowEndsAt: clock.window_ends_at.toISOString(),
    timeZoneLabel: "UTC",
    entries: ranked.slice(0, 10).map((entry) => ({
      displayName: entry.displayName,
      completedTrades: entry.completedTrades,
      trustScore: entry.trustScore,
      rating: entry.rating,
    })),
    siteUrl,
  };
}

export class PostgresDiscordMarketContentRepository
implements DiscordMarketContentRepository {
  private readonly pool: Pool;
  private readonly siteUrl: string;

  constructor(input: { pool: Pool; siteUrl: string }) {
    this.pool = input.pool;
    this.siteUrl = normalizeMarketSiteUrl(input.siteUrl);
  }

  async claimDueContent(): Promise<DiscordMarketContentClaim | null> {
    const result = await this.pool.query<{
      content_key: DiscordMarketContentKey;
      channel_id: string;
      message_id: string | null;
      content_version: string;
      lease_fence: string;
      lease_token: string;
      attempts: number;
    }>(`
      with candidate as (
        select content.content_key, resource.discord_resource_id
          from alpha_exchange.discord_market_content content
          join alpha_exchange.discord_managed_resources resource
            on resource.resource_key = content.channel_resource_key
         where content.state <> 'dead'
           and content.refresh_after <= now()
           and (
             content.state <> 'processing'
             or content.leased_until < now()
           )
           and resource.reconciliation_state = 'ready'
           and resource.discord_resource_id is not null
         order by content.refresh_after, content.content_key
         for update of content skip locked
         limit 1
      )
      update alpha_exchange.discord_market_content content
         set state = 'processing',
             channel_id = candidate.discord_resource_id,
             content_version = content.content_version + 1,
             lease_fence = content.lease_fence + 1,
             lease_token = gen_random_uuid(),
             leased_until = now() + interval '2 minutes',
             attempts = least(8, content.attempts + 1),
             last_attempt_at = now(),
             updated_at = now()
        from candidate
       where content.content_key = candidate.content_key
      returning content.content_key, content.channel_id, content.message_id,
                content.content_version::text, content.lease_fence::text,
                content.lease_token::text, content.attempts
    `);
    const row = result.rows[0];
    return row
      ? {
          contentKey: row.content_key,
          channelId: row.channel_id,
          messageId: row.message_id,
          contentVersion: Number(row.content_version),
          leaseFence: Number(row.lease_fence),
          leaseToken: row.lease_token,
          attempts: row.attempts,
        }
      : null;
  }

  async buildSnapshot(
    contentKey: DiscordMarketContentKey,
  ): Promise<DiscordMarketContentSnapshot> {
    if (contentKey === "live_market_pulse") {
      return readPulse(this.pool, this.siteUrl);
    }
    if (contentKey === "market_activity_digest") {
      return readActivity(this.pool, this.siteUrl);
    }
    return readLeaderboard(this.pool, this.siteUrl);
  }

  async ownsClaim(claim: DiscordMarketContentClaim): Promise<boolean> {
    const result = await this.pool.query(
      `select 1
         from alpha_exchange.discord_market_content
        where content_key = $1
          and content_version = $2
          and lease_fence = $3
          and lease_token = $4::uuid
          and state = 'processing'
          and leased_until > now()`,
      [
        claim.contentKey,
        claim.contentVersion,
        claim.leaseFence,
        claim.leaseToken,
      ],
    );
    return result.rowCount === 1;
  }

  async completeContent(input: {
    claim: DiscordMarketContentClaim;
    messageId: string;
    snapshot: DiscordMarketContentSnapshot;
    snapshotHash: string;
  }): Promise<boolean> {
    const cadenceMinutes = input.claim.contentKey === "weekly_top_sellers" ? 15 : 5;
    const result = await this.pool.query(
      `with completed as (
         update alpha_exchange.discord_market_content
            set message_id = $5,
                state = 'active',
                attempts = 0,
                snapshot = $6::jsonb,
                snapshot_hash = $7,
                refresh_after = now() + ($8 * interval '1 minute'),
                lease_token = null,
                leased_until = null,
                last_success_at = now(),
                last_error_code = null,
                updated_at = now()
          where content_key = $1
            and content_version = $2
            and lease_fence = $3
            and lease_token = $4::uuid
            and state = 'processing'
         returning content_key
       )
       insert into alpha_exchange.discord_market_content_audit
         (content_key, content_version, lease_fence, outcome, detail_code)
       select content_key, $2, $3, 'success', 'message_reconciled'
         from completed
       returning content_key`,
      [
        input.claim.contentKey,
        input.claim.contentVersion,
        input.claim.leaseFence,
        input.claim.leaseToken,
        input.messageId,
        JSON.stringify(input.snapshot),
        input.snapshotHash,
        cadenceMinutes,
      ],
    );
    return result.rowCount === 1;
  }

  async failContent(input: {
    claim: DiscordMarketContentClaim;
    errorCode: string;
  }): Promise<void> {
    const dead = input.claim.attempts >= 8;
    const delaySeconds = Math.min(300, 5 * (2 ** Math.max(0, input.claim.attempts - 1)));
    await this.pool.query(
      `with failed as (
         update alpha_exchange.discord_market_content
            set state = $5,
                refresh_after = case
                  when $5 = 'dead' then refresh_after
                  else now() + ($6 * interval '1 second')
                end,
                lease_token = null,
                leased_until = null,
                last_error_code = $7,
                updated_at = now()
          where content_key = $1
            and content_version = $2
            and lease_fence = $3
            and lease_token = $4::uuid
            and state = 'processing'
         returning content_key
       )
       insert into alpha_exchange.discord_market_content_audit
         (content_key, content_version, lease_fence, outcome, detail_code)
       select content_key, $2, $3, case when $5 = 'dead' then 'failed' else 'degraded' end, $7
         from failed`,
      [
        input.claim.contentKey,
        input.claim.contentVersion,
        input.claim.leaseFence,
        input.claim.leaseToken,
        dead ? "dead" : "scheduled",
        delaySeconds,
        input.errorCode,
      ],
    );
  }

  async getDiagnostics(): Promise<DiscordMarketIntelligenceDiagnostics> {
    const result = await this.pool.query<{
      active_count: number;
      pending_count: number;
      dead_count: number;
      last_success_at: Date | null;
      error_code: string | null;
    }>(`
      select count(*) filter (where state = 'active')::int as active_count,
             count(*) filter (where state in ('scheduled', 'processing'))::int as pending_count,
             count(*) filter (where state = 'dead')::int as dead_count,
             max(last_success_at) as last_success_at,
             min(last_error_code) filter (where last_error_code is not null) as error_code
        from alpha_exchange.discord_market_content
    `);
    const row = result.rows[0];
    const degraded = (row?.dead_count ?? 0) > 0 || Boolean(row?.error_code);
    return {
      status: degraded ? "degraded" : "ready",
      activeCount: row?.active_count ?? 0,
      pendingCount: row?.pending_count ?? 0,
      deadCount: row?.dead_count ?? 0,
      lastSuccessAt: row?.last_success_at?.toISOString() ?? null,
      errorCode: degraded ? row?.error_code ?? "market_content_dead" : null,
    };
  }
}

type PublicProfileRow = {
  created_at: Date;
  payload: Record<string, unknown>;
  trust_payload: Record<string, unknown> | null;
};

function publicText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized
    || /@|0x[a-f0-9]{32,}|[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(normalized)
  ) {
    return null;
  }
  return normalized.slice(0, 100);
}

export async function getPublicDiscordSellerProfileByUsername(input: {
  username: string;
  pool: Pool;
  siteUrl: string;
  now?: number;
}): Promise<DiscordPublicSellerProfile | null> {
  const result = await input.pool.query<PublicProfileRow>(`
    select users.created_at,
           users.payload,
           trust.payload as trust_payload
      from alpha_exchange.users users
      join alpha_exchange.discord_identities identity
        on identity.platform_user_id = users.id
      left join alpha_exchange.trust_snapshots trust
        on trust.seller_id = users.id
     where ${PUBLIC_SELLER_SQL}
  `);
  const normalizedUsername = normalizePublicProfileUsername(input.username);
  const row = result.rows.find((candidate) => {
    const displayName = publicText(candidate.payload.buyerDisplayName);
    return displayName
      ? normalizePublicProfileUsername(displayName) === normalizedUsername
      : false;
  });
  if (!row) return null;

  const displayName = publicText(row.payload.buyerDisplayName);
  if (!displayName) return null;
  const siteUrl = normalizeMarketSiteUrl(input.siteUrl);
  const trust = row.trust_payload?.snapshot
    && typeof row.trust_payload.snapshot === "object"
    ? row.trust_payload.snapshot as Record<string, unknown>
    : null;
  const showTradeStats = row.payload.showTradeStats !== false;
  const showLastActive = row.payload.showLastActive !== false;
  const completedTrades = showTradeStats
    ? numberOrNull(trust?.completedTrades as number | string | null)
    : null;
  const presence = showLastActive
    && (row.payload.onlineStatus === "online" || row.payload.onlineStatus === "offline")
    ? deriveSellerPresence({
        onlineStatus: row.payload.onlineStatus,
        lastActiveAt: typeof row.payload.lastActiveAt === "string"
          ? row.payload.lastActiveAt
          : null,
      }, input.now)
    : null;
  const imageUrl = isSafeDiscordImageUrl(row.payload.profilePhotoUrl)
    ? row.payload.profilePhotoUrl
    : null;
  return {
    displayName,
    level: publicText(trust?.level),
    rating: showTradeStats && completedTrades
      ? numberOrNull(trust?.rating as number | string | null)
      : null,
    reliabilityScore: showTradeStats
      ? numberOrNull(trust?.reliabilityScore as number | string | null)
      : null,
    completedTrades,
    publicVolumeRange: showTradeStats ? publicText(trust?.publicVolumeRange) : null,
    memberSince: row.created_at.toISOString(),
    presenceLabel: presence?.label ?? null,
    responseTimeMinutes: showTradeStats
      ? numberOrNull(trust?.responseTimeMinutes as number | string | null)
      : null,
    profileUrl: `${siteUrl}/en/exchange/seller/${encodeURIComponent(normalizedUsername)}`,
    imageUrl,
    siteUrl,
  };
}
