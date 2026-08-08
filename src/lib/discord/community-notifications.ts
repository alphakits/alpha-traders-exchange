import "server-only";

import { createHash } from "node:crypto";

import {
  DiscordAPIError,
  REST,
  Routes,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord.js";
import type { Pool } from "pg";

import type {
  DiscordGatewayClient,
  DiscordGuildMemberJoin,
} from "@/lib/discord/gateway-client";
import {
  DISCORD_MARKET_BRAND_COLOR,
  normalizeMarketSiteUrl,
} from "@/lib/discord/market-intelligence-publisher";
import { logEvent } from "@/lib/structured-logging";

const POLL_INTERVAL_MS = 5_000;
const MAX_DELIVERIES_PER_TICK = 20;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const NONCE_RETRY_WINDOW_MINUTES = 3;

export type DiscordCommunityNotificationDiagnostics = {
  status: "ready" | "degraded";
  pendingCount: number | null;
  deadCount: number | null;
  suppressedCount: number | null;
  lastDeliveredAt: string | null;
  errorCode: string | null;
};

type NotificationType = "welcome" | "approved_seller";

type NotificationClaim = {
  id: string;
  notificationType: NotificationType;
  discordUserId: string;
  leaseToken: string;
  attempts: number;
  sourceKey: string;
};

type Queryable = Pick<Pool, "query">;

export interface DiscordDirectMessagePublisher {
  send(input: {
    discordUserId: string;
    nonce: string;
    body: RESTPostAPIChannelMessageJSONBody;
  }): Promise<void>;
}

export class DiscordDirectMessageError extends Error {
  readonly code:
    | "dm_disabled"
    | "dm_delivery_failed"
    | "dm_delivery_outcome_unknown";

  constructor(code: DiscordDirectMessageError["code"], options?: ErrorOptions) {
    super(code, options);
    this.name = "DiscordDirectMessageError";
    this.code = code;
  }
}

export class DiscordRestDirectMessagePublisher
implements DiscordDirectMessagePublisher {
  private readonly rest: REST;

  constructor(token: string, rest?: REST) {
    this.rest = rest ?? new REST({ version: "10" }).setToken(token);
  }

  async send(input: {
    discordUserId: string;
    nonce: string;
    body: RESTPostAPIChannelMessageJSONBody;
  }): Promise<void> {
    try {
      const channel = await this.rest.post(Routes.userChannels(), {
        body: { recipient_id: input.discordUserId },
      }) as { id?: unknown };
      if (typeof channel.id !== "string") {
        throw new DiscordDirectMessageError("dm_delivery_failed");
      }
      await this.rest.post(Routes.channelMessages(channel.id), {
        body: {
          ...input.body,
          nonce: input.nonce.slice(0, 25),
          enforce_nonce: true,
        },
      });
    } catch (error) {
      if (error instanceof DiscordDirectMessageError) throw error;
      if (error instanceof DiscordAPIError && error.code === 50007) {
        throw new DiscordDirectMessageError("dm_disabled", { cause: error });
      }
      throw new DiscordDirectMessageError(
        "dm_delivery_outcome_unknown",
        { cause: error },
      );
    }
  }
}

export function notificationNonce(sourceKey: string): string {
  return createHash("sha256")
    .update(`alpha-notification:${sourceKey}`)
    .digest("hex")
    .slice(0, 25);
}

export function buildDiscordWelcomeMessage(
  siteUrlInput: string,
): RESTPostAPIChannelMessageJSONBody {
  const siteUrl = normalizeMarketSiteUrl(siteUrlInput);
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "Welcome to Alpha Traders",
      description:
        "Start safely: create or sign in to your official Alpha Traders account, link Discord, then learn the marketplace basics before trading.",
      color: DISCORD_MARKET_BRAND_COLOR,
      fields: [{
        name: "1 · Sign in and link Discord",
        value: "Use the official website to create or sign in to your account, then link Discord and verify every seller, listing, and trade there.",
      }, {
        name: "2 · Learn before trading",
        value: "Once signed in, use Alpha Academy and the Safety Center. Never send funds, passwords, recovery codes, or identity documents through Discord.",
      }, {
        name: "3 · Become an Approved Seller",
        value: "Apply and manage listings on the website. Discord never approves sellers or creates trades.",
      }],
      footer: { text: "Alpha Traders • Trusted community access" },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Verify or Link Account",
        url: `${siteUrl}/en/settings`,
      }, {
        type: 2,
        style: 5,
        label: "Alpha Academy",
        url: `${siteUrl}/en/academy`,
      }, {
        type: 2,
        style: 5,
        label: "Safety Center",
        url: `${siteUrl}/en/safety-trust`,
      }],
    }],
  };
}

export function buildDiscordApprovedSellerMessage(input: {
  siteUrl: string;
  sellerLoungeChannelId: string | null;
}): RESTPostAPIChannelMessageJSONBody {
  const siteUrl = normalizeMarketSiteUrl(input.siteUrl);
  const channelReference = input.sellerLoungeChannelId
    ? `<#${input.sellerLoungeChannelId}>`
    : "the private Seller Lounge";
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "Approved Seller access unlocked",
      description:
        `Congratulations — your authoritative Alpha Traders approval is active. You can now access ${channelReference} and the approved seller community channels.`,
      color: DISCORD_MARKET_BRAND_COLOR,
      fields: [{
        name: "Manage listings safely",
        value:
          "Create, edit, and share listings only from the website. Discord commands never publish or modify listing data.",
      }, {
        name: "Keep every trade on-platform",
        value:
          "Confirm buyers, listings, payment steps, and trade status on the official website. Ignore unsolicited Discord DMs.",
      }],
      footer: { text: "Alpha Traders • Approved Seller" },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Open Seller Dashboard",
        url: `${siteUrl}/en/dashboard/seller`,
      }, {
        type: 2,
        style: 5,
        label: "Open Marketplace",
        url: `${siteUrl}/en/usdt-exchange`,
      }, {
        type: 2,
        style: 5,
        label: "Seller Academy",
        url: `${siteUrl}/en/academy`,
      }],
    }],
  };
}

export async function enqueueDiscordWelcome(
  database: Queryable,
  event: DiscordGuildMemberJoin,
): Promise<boolean> {
  if (event.isBot) return false;
  const joinedAt = new Date(event.joinedAt);
  if (!Number.isFinite(joinedAt.getTime())) return false;
  const sourceKey =
    `welcome:${event.guildId}:${event.discordUserId}:${joinedAt.toISOString()}`;
  const result = await database.query(
    `insert into alpha_exchange.discord_notification_deliveries
       (notification_type, discord_user_id, source_key)
     values ('welcome', $1, $2)
     on conflict (source_key) do nothing`,
    [event.discordUserId, sourceKey],
  );
  return result.rowCount === 1;
}

async function claimNotification(pool: Pool): Promise<NotificationClaim | null> {
  const result = await pool.query<{
    id: string;
    notification_type: NotificationType;
    discord_user_id: string;
    lease_token: string;
    attempts: number;
    source_key: string;
  }>(`
    with indeterminate as (
      update alpha_exchange.discord_notification_deliveries
         set status = 'dead',
             lease_token = null,
             leased_until = null,
             last_error_code = 'dm_delivery_indeterminate',
             updated_at = now()
       where (
         status = 'processing'
         and leased_until < now()
         and updated_at < now()
           - ($1 * interval '1 minute')
       ) or (
         status = 'pending'
         and last_error_code = 'dm_delivery_outcome_unknown'
         and updated_at < now()
           - ($1 * interval '1 minute')
       )
      returning notification_type
    ),
    indeterminate_audit as (
      insert into alpha_exchange.discord_notification_audit
        (notification_type, outcome, detail_code)
      select notification_type, 'dead', 'dm_delivery_indeterminate'
        from indeterminate
    ),
    candidate as (
      select id
        from alpha_exchange.discord_notification_deliveries
       where (
         status = 'pending'
         and available_at <= now()
         and not (
           last_error_code = 'dm_delivery_outcome_unknown'
           and updated_at < now()
             - ($1 * interval '1 minute')
         )
       ) or (
         status = 'processing'
         and leased_until < now()
         and updated_at >= now()
           - ($1 * interval '1 minute')
       )
       order by created_at
       for update skip locked
       limit 1
    )
    update alpha_exchange.discord_notification_deliveries delivery
       set status = 'processing',
           attempts = least(5, attempts + 1),
           lease_token = gen_random_uuid(),
           leased_until = now() + interval '2 minutes',
           updated_at = now()
      from candidate
     where delivery.id = candidate.id
    returning delivery.id::text, delivery.notification_type,
              delivery.discord_user_id, delivery.lease_token::text,
              delivery.attempts, delivery.source_key
  `, [NONCE_RETRY_WINDOW_MINUTES]);
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        notificationType: row.notification_type,
        discordUserId: row.discord_user_id,
        leaseToken: row.lease_token,
        attempts: row.attempts,
        sourceKey: row.source_key,
      }
    : null;
}

async function completeNotification(
  pool: Pool,
  claim: NotificationClaim,
): Promise<boolean> {
  const result = await pool.query(
    `with completed as (
       update alpha_exchange.discord_notification_deliveries
          set status = 'delivered',
              delivered_at = now(),
              lease_token = null,
              leased_until = null,
              last_error_code = null,
              updated_at = now()
        where id = $1::uuid
          and lease_token = $2::uuid
          and status = 'processing'
       returning notification_type
     )
     insert into alpha_exchange.discord_notification_audit
       (notification_type, outcome, detail_code)
     select notification_type, 'delivered', 'dm_delivered' from completed`,
    [claim.id, claim.leaseToken],
  );
  return result.rowCount === 1;
}

async function failNotification(
  pool: Pool,
  claim: NotificationClaim,
  code: DiscordDirectMessageError["code"],
): Promise<void> {
  const suppressed = code === "dm_disabled";
  const dead = !suppressed && claim.attempts >= 5;
  const status = suppressed ? "suppressed" : dead ? "dead" : "pending";
  const outcome = suppressed ? "suppressed" : dead ? "dead" : "retry";
  const delaySeconds = Math.min(900, 15 * (2 ** Math.max(0, claim.attempts - 1)));
  await pool.query(
    `with failed as (
       update alpha_exchange.discord_notification_deliveries
          set status = $3,
              available_at = case when $3 = 'pending'
                then now() + ($4 * interval '1 second')
                else available_at
              end,
              lease_token = null,
              leased_until = null,
              last_error_code = $5,
              updated_at = now()
        where id = $1::uuid
          and lease_token = $2::uuid
          and status = 'processing'
       returning notification_type
     )
     insert into alpha_exchange.discord_notification_audit
       (notification_type, outcome, detail_code)
     select notification_type, $6, $5 from failed`,
    [claim.id, claim.leaseToken, status, delaySeconds, code, outcome],
  );
}

export class DiscordCommunityNotificationWorker {
  private readonly pool: Pool;
  private readonly gateway: DiscordGatewayClient;
  private readonly publisher: DiscordDirectMessagePublisher;
  private readonly siteUrl: string;
  private readonly guildId: string;
  private readonly pollIntervalMs: number;
  private readonly maintenanceIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeMemberJoin: (() => void) | null = null;
  private activeTick: Promise<void> | null = null;
  private diagnostics: DiscordCommunityNotificationDiagnostics = {
    status: "degraded",
    pendingCount: null,
    deadCount: null,
    suppressedCount: null,
    lastDeliveredAt: null,
    errorCode: "not_started",
  };

  constructor(input: {
    pool: Pool;
    gateway: DiscordGatewayClient;
    publisher: DiscordDirectMessagePublisher;
    siteUrl: string;
    guildId: string;
    pollIntervalMs?: number;
    maintenanceIntervalMs?: number;
  }) {
    this.pool = input.pool;
    this.gateway = input.gateway;
    this.publisher = input.publisher;
    this.siteUrl = normalizeMarketSiteUrl(input.siteUrl);
    this.guildId = input.guildId;
    this.pollIntervalMs = input.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.maintenanceIntervalMs =
      input.maintenanceIntervalMs ?? MAINTENANCE_INTERVAL_MS;
  }

  getDiagnostics(): DiscordCommunityNotificationDiagnostics {
    return { ...this.diagnostics };
  }

  async start(): Promise<void> {
    if (this.timer || this.unsubscribeMemberJoin) return;
    this.unsubscribeMemberJoin = this.gateway.subscribeGuildMemberJoin((event) => {
      if (event.guildId !== this.guildId) return;
      void enqueueDiscordWelcome(this.pool, event).catch((error: unknown) => {
        logEvent("error", {
          event: "discord_welcome_enqueue",
          outcome: "failed",
          reason: "database_operation_failed",
          metadata: { errorType: error instanceof Error ? error.name : typeof error },
        });
      });
    });
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_notification_tick",
          outcome: "failed",
          reason: "notification_worker_failed",
          metadata: { errorType: error instanceof Error ? error.name : typeof error },
        });
      });
    }, this.pollIntervalMs);
    await this.runMaintenance();
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance();
    }, this.maintenanceIntervalMs);
    await this.tick();
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.timer = null;
    this.maintenanceTimer = null;
    this.unsubscribeMemberJoin?.();
    this.unsubscribeMemberJoin = null;
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
    for (let processed = 0; processed < MAX_DELIVERIES_PER_TICK; processed += 1) {
      const claim = await claimNotification(this.pool);
      if (!claim) break;
      const sellerLoungeChannelId = claim.notificationType === "approved_seller"
        ? await this.readSellerLoungeChannelId()
        : null;
      const body = claim.notificationType === "welcome"
        ? buildDiscordWelcomeMessage(this.siteUrl)
        : buildDiscordApprovedSellerMessage({
            siteUrl: this.siteUrl,
            sellerLoungeChannelId,
          });
      try {
        await this.publisher.send({
          discordUserId: claim.discordUserId,
          nonce: notificationNonce(claim.sourceKey),
          body,
        });
      } catch (error) {
        const code = error instanceof DiscordDirectMessageError
          ? error.code
          : "dm_delivery_outcome_unknown";
        await failNotification(this.pool, claim, code);
        continue;
      }
      try {
        const completed = await completeNotification(this.pool, claim);
        if (!completed) {
          logEvent("warn", {
            event: "discord_notification_completion",
            outcome: "failed",
            reason: "stale_notification_lease",
          });
        }
      } catch (error) {
        logEvent("error", {
          event: "discord_notification_completion",
          outcome: "failed",
          reason: "notification_completion_failed",
          metadata: {
            errorType: error instanceof Error ? error.name : typeof error,
          },
        });
      }
    }
    await this.refreshDiagnostics();
  }

  private async readSellerLoungeChannelId(): Promise<string | null> {
    const result = await this.pool.query<{ discord_resource_id: string | null }>(
      `select discord_resource_id
         from alpha_exchange.discord_managed_resources
        where resource_key = 'seller_lounge'
          and reconciliation_state = 'ready'`,
    );
    return result.rows[0]?.discord_resource_id ?? null;
  }

  private async refreshDiagnostics(): Promise<void> {
    const result = await this.pool.query<{
      pending_count: number;
      dead_count: number;
      suppressed_count: number;
      last_delivered_at: Date | null;
      error_code: string | null;
    }>(`
      select count(*) filter (where status in ('pending', 'processing'))::int as pending_count,
             count(*) filter (where status = 'dead')::int as dead_count,
             count(*) filter (where status = 'suppressed')::int as suppressed_count,
             max(delivered_at) as last_delivered_at,
             min(last_error_code) filter (where status = 'dead') as error_code
        from alpha_exchange.discord_notification_deliveries
    `);
    const row = result.rows[0];
    const deadCount = row?.dead_count ?? 0;
    this.diagnostics = {
      status: deadCount > 0 ? "degraded" : "ready",
      pendingCount: row?.pending_count ?? 0,
      deadCount,
      suppressedCount: row?.suppressed_count ?? 0,
      lastDeliveredAt: row?.last_delivered_at?.toISOString() ?? null,
      errorCode: deadCount > 0
        ? row?.error_code ?? "notification_delivery_dead"
        : null,
    };
  }

  private async runMaintenance(): Promise<void> {
    try {
      await this.pool.query(`
        select case
          when pg_try_advisory_xact_lock(61422919)
          then (
            select row_to_json(cleanup)
              from alpha_exchange.cleanup_discord_community_state() cleanup
          )
          else null
        end as cleanup_result
      `);
    } catch (error) {
      logEvent("error", {
        event: "discord_community_retention",
        outcome: "failed",
        reason: "community_retention_failed",
        metadata: {
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
    }
  }
}
