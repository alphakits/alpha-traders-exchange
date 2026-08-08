import "server-only";

import type { Pool, PoolClient } from "pg";

import { readDiscordConfig } from "@/lib/discord/config";
import type { DiscordListingDiagnostics } from "@/lib/discord/diagnostics";
import {
  DiscordRestListingPublisher,
  hashDiscordListingSnapshot,
  isSafeDiscordImageUrl,
  type DiscordListingPublisher,
  type DiscordListingSnapshot,
} from "@/lib/discord/listing-publisher";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { deriveSellerPresence } from "@/lib/seller-presence";
import { getSiteUrl } from "@/lib/site-url";
import { logEvent } from "@/lib/structured-logging";

const POLL_INTERVAL_MS = 5_000;
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const RECONCILIATION_BATCH_SIZE = 100;

type ListingJob = {
  id: string;
  mappingId: string;
  listingId: string;
  sellerId: string;
  eventVersion: number;
  attempts: number;
  lockToken: string;
};

type AuthoritativeRow = {
  mapping_id: string;
  listing_id: string;
  seller_id: string;
  mapping_state: string;
  event_version: string;
  channel_id: string;
  guild_id: string;
  message_id: string | null;
  snapshot: DiscordListingSnapshot | null;
  snapshot_hash: string | null;
  listing_status: string | null;
  expires_at: Date | null;
  listing_payload: Record<string, unknown> | null;
  seller_status: string | null;
  user_payload: Record<string, unknown> | null;
  trust_payload: Record<string, unknown> | null;
  identity_linked: boolean;
  current_channel_id: string | null;
  current_guild_id: string | null;
  resource_state: string | null;
};

type ListingSyncWorkerDependencies = {
  pool: Pool;
  publisher: DiscordListingPublisher;
  pollIntervalMs?: number;
  reconciliationIntervalMs?: number;
  siteUrl?: string;
};

type DiscordListingLifecycleInput = {
  mappingState: string;
  listingStatus: string | null;
  expiresAt: Date | null;
  listingPayload: Record<string, unknown> | null;
  sellerStatus: string | null;
  userPayload: Record<string, unknown> | null;
  identityLinked: boolean;
};

export type DiscordListingLifecycleAction = "terminal" | "delete" | "sold" | "active";

class DiscordListingWorkerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DiscordListingWorkerError";
    this.code = code;
  }
}

function safeFailureCode(error: unknown): string {
  return error instanceof DiscordListingWorkerError
    ? error.code
    : "discord_api_failure";
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function amountValue(value: unknown): number {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean).slice(0, 3)
    : [];
}

function reliabilityTier(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 90) return "Exceptional reliability";
  if (score >= 80) return "Highly reliable";
  if (score >= 70) return "Reliable";
  return "Developing reliability";
}

export function buildAuthoritativeDiscordListingSnapshot(input: {
  listing: Record<string, unknown>;
  seller: Record<string, unknown>;
  trust: Record<string, unknown> | null;
  sellerStatus: string;
  siteUrl: string;
  now?: number;
}): DiscordListingSnapshot {
  const trustSnapshot = input.trust?.snapshot && typeof input.trust.snapshot === "object"
    ? input.trust.snapshot as Record<string, unknown>
    : null;
  const profilePhoto = input.seller.profilePhotoUrl;
  const fallbackImage = `${input.siteUrl}/images/brand/alpha-traders-logo.png`;
  const paymentMethods = stringArray(input.listing.paymentMethods);
  const primaryPayment = stringValue(input.listing.paymentMethod);
  const presence = deriveSellerPresence({
    onlineStatus: input.seller.onlineStatus === "online" ? "online" : "offline",
    lastActiveAt: stringValue(input.seller.lastActiveAt) || null,
  }, input.now);

  return {
    sellerDisplayName: stringValue(input.listing.sellerDisplayName)
      || stringValue(input.seller.buyerDisplayName)
      || "Alpha Traders Seller",
    sellerLevel: stringValue(trustSnapshot?.level) || null,
    reliabilityTier: reliabilityTier(numberValue(trustSnapshot?.reliabilityScore)),
    approvedSeller: input.sellerStatus === "approved_seller",
    availableAmount: stringValue(input.listing.availableAmount, "0"),
    price: stringValue(input.listing.price, "0"),
    currency: stringValue(input.listing.currency, "ILS"),
    network: stringValue(input.listing.network, "USDT"),
    paymentMethods: paymentMethods.length
      ? paymentMethods
      : (primaryPayment ? [primaryPayment] : ["Contact seller on Alpha Traders"]),
    presenceLabel: presence.label,
    responseTimeMinutes: numberValue(trustSnapshot?.responseTimeMinutes),
    imageUrl: isSafeDiscordImageUrl(profilePhoto) ? profilePhoto : fallbackImage,
    listingUrl: `${input.siteUrl}/en/usdt-exchange`,
  };
}

async function claimJob(pool: Pool): Promise<ListingJob | null> {
  const result = await pool.query<{
    id: string;
    mapping_id: string;
    listing_id: string;
    seller_id: string;
    event_version: string;
    attempts: number;
    lock_token: string;
  }>(
    `with candidate as (
       select id
         from alpha_exchange.discord_listing_outbox
        where (
          status = 'pending' and available_at <= now()
        ) or (
          status = 'processing' and locked_at < now() - interval '5 minutes'
        )
        order by created_at
        for update skip locked
        limit 1
     )
     update alpha_exchange.discord_listing_outbox job
        set status = 'processing',
            attempts = attempts + 1,
            locked_at = now(),
            lock_token = gen_random_uuid(),
            updated_at = now()
       from candidate
      where job.id = candidate.id
      returning job.id::text, job.mapping_id::text, job.listing_id, job.seller_id,
                job.event_version::text, job.attempts, job.lock_token::text`,
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        mappingId: row.mapping_id,
        listingId: row.listing_id,
        sellerId: row.seller_id,
        eventVersion: Number(row.event_version),
        attempts: row.attempts,
        lockToken: row.lock_token,
      }
    : null;
}

async function ownsClaim(client: PoolClient, job: ListingJob): Promise<boolean> {
  const result = await client.query(
    `select 1
       from alpha_exchange.discord_listing_outbox
      where id = $1::uuid
        and lock_token = $2::uuid
        and status = 'processing'`,
    [job.id, job.lockToken],
  );
  return result.rowCount === 1;
}

async function readAuthoritativeState(
  client: PoolClient,
  job: ListingJob,
): Promise<AuthoritativeRow | null> {
  const result = await client.query<AuthoritativeRow>(
    `select mapping.id::text as mapping_id,
            mapping.listing_id,
            mapping.seller_id,
            mapping.state as mapping_state,
            mapping.event_version::text,
            mapping.channel_id,
            mapping.guild_id,
            mapping.message_id,
            mapping.snapshot,
            mapping.snapshot_hash,
            listing.status as listing_status,
            listing.expires_at,
            listing.payload as listing_payload,
            users.seller_status,
            users.payload as user_payload,
            trust.payload as trust_payload,
            identity.platform_user_id is not null as identity_linked,
            resource.discord_resource_id as current_channel_id,
            resource.guild_id as current_guild_id,
            resource.reconciliation_state as resource_state
       from alpha_exchange.discord_listing_messages mapping
       left join alpha_exchange.listings listing on listing.id = mapping.listing_id
       left join alpha_exchange.users users on users.id = mapping.seller_id
       left join alpha_exchange.trust_snapshots trust on trust.seller_id = mapping.seller_id
       left join alpha_exchange.discord_identities identity
         on identity.platform_user_id = mapping.seller_id
       left join alpha_exchange.discord_managed_resources resource
         on resource.resource_key = 'marketplace_listings'
      where mapping.id = $1::uuid
      for update of mapping`,
    [job.mappingId],
  );
  return result.rows[0] ?? null;
}

export function determineDiscordListingLifecycle(
  input: DiscordListingLifecycleInput,
  now: number,
): DiscordListingLifecycleAction {
  if (["sold", "deleted", "failed"].includes(input.mappingState)) {
    return "terminal";
  }
  if (
    input.mappingState === "delete_pending"
    || !input.listingPayload
    || !input.userPayload
    || input.sellerStatus !== "approved_seller"
    || !input.identityLinked
    || input.userPayload.disabled === true
    || input.listingPayload.approvalStatus !== "approved"
  ) {
    return "delete";
  }
  if (input.listingStatus === "completed") {
    return "sold";
  }
  if (
    input.listingStatus !== "active"
    || (input.expiresAt !== null && input.expiresAt.getTime() <= now)
  ) {
    return "delete";
  }
  return amountValue(input.listingPayload.availableAmount) <= 0 ? "sold" : "active";
}

function assertManagedChannel(row: AuthoritativeRow): void {
  if (
    row.resource_state !== "ready"
    || !row.current_channel_id
    || !row.current_guild_id
    || row.current_channel_id !== row.channel_id
    || row.current_guild_id !== row.guild_id
  ) {
    throw new DiscordListingWorkerError("managed_channel_mismatch");
  }
}

async function completeJob(
  client: PoolClient,
  job: ListingJob,
  detailCode: string,
): Promise<void> {
  await client.query(
    `with completed as (
       update alpha_exchange.discord_listing_outbox
          set status = 'completed',
              completed_at = now(),
              locked_at = null,
              lock_token = null,
              last_error_code = null,
              updated_at = now()
        where id = $1::uuid
          and lock_token = $2::uuid
          and status = 'processing'
       returning mapping_id, listing_id, seller_id
     )
     insert into alpha_exchange.discord_listing_audit
       (mapping_id, listing_id, seller_id, event_type, outcome, detail_code)
     select mapping_id, listing_id, seller_id, 'worker', 'success', $3
       from completed`,
    [job.id, job.lockToken, detailCode],
  );
}

async function failJob(
  client: PoolClient,
  job: ListingJob,
  failureCode: string,
): Promise<void> {
  const dead = job.attempts >= MAX_ATTEMPTS;
  const delaySeconds = Math.min(900, 5 * (2 ** Math.max(0, job.attempts - 1)));
  await client.query(
    `with failed as (
       update alpha_exchange.discord_listing_outbox
          set status = $3,
              available_at = case
                when $3 = 'dead' then available_at
                else now() + ($4 * interval '1 second')
              end,
              locked_at = null,
              lock_token = null,
              last_error_code = $5,
              updated_at = now()
        where id = $1::uuid
          and lock_token = $2::uuid
          and status = 'processing'
       returning mapping_id, listing_id, seller_id
     ), mapping_failure as (
       update alpha_exchange.discord_listing_messages mapping
          set state = case when $3 = 'dead' then 'failed' else mapping.state end,
              last_error_code = $5,
              last_attempt_at = now(),
              updated_at = now()
         from failed
        where mapping.id = failed.mapping_id
          and mapping.event_version = $6
       returning mapping.id
     )
     insert into alpha_exchange.discord_listing_audit
       (mapping_id, listing_id, seller_id, event_type, outcome, detail_code)
     select mapping_id, listing_id, seller_id, 'worker',
            case when $3 = 'dead' then 'failed' else 'degraded' end,
            $5
       from failed`,
    [job.id, job.lockToken, dead ? "dead" : "pending", delaySeconds, failureCode, job.eventVersion],
  );
}

async function markDeleted(
  client: PoolClient,
  job: ListingJob,
  reason: string,
): Promise<void> {
  await client.query(
    `update alpha_exchange.discord_listing_messages
        set state = 'deleted',
            message_id = null,
            deleted_at = now(),
            last_error_code = null,
            last_attempt_at = now(),
            updated_at = now()
      where id = $1::uuid
        and event_version = $2`,
    [job.mappingId, job.eventVersion],
  );
  await completeJob(client, job, reason);
}

async function deleteReplacedMessages(
  client: PoolClient,
  publisher: DiscordListingPublisher,
  row: AuthoritativeRow,
): Promise<void> {
  const replaced = await client.query<{
    id: string;
    channel_id: string;
    message_id: string | null;
  }>(
    `select id::text, channel_id, message_id
       from alpha_exchange.discord_listing_messages
      where seller_id = $1
        and id <> $2::uuid
        and state = 'delete_pending'
      order by generation
      for update`,
    [row.seller_id, row.mapping_id],
  );
  for (const old of replaced.rows) {
    if (old.channel_id !== row.current_channel_id) {
      throw new DiscordListingWorkerError("managed_channel_mismatch");
    }
    if (old.message_id) {
      await publisher.deleteMessage({
        channelId: old.channel_id,
        messageId: old.message_id,
      });
    }
    await client.query(
      `update alpha_exchange.discord_listing_messages
          set state = 'deleted',
              message_id = null,
              deleted_at = now(),
              last_error_code = null,
              last_attempt_at = now(),
              updated_at = now()
        where id = $1::uuid
          and state = 'delete_pending'`,
      [old.id],
    );
  }
}

async function reconcileJob(
  client: PoolClient,
  publisher: DiscordListingPublisher,
  job: ListingJob,
  siteUrl: string,
): Promise<void> {
  const row = await readAuthoritativeState(client, job);
  if (!row) {
    await completeJob(client, job, "mapping_missing");
    return;
  }
  if (Number(row.event_version) !== job.eventVersion) {
    await completeJob(client, job, "stale_event");
    return;
  }
  const lifecycle = determineDiscordListingLifecycle({
    mappingState: row.mapping_state,
    listingStatus: row.listing_status,
    expiresAt: row.expires_at,
    listingPayload: row.listing_payload,
    sellerStatus: row.seller_status,
    userPayload: row.user_payload,
    identityLinked: row.identity_linked,
  }, Date.now());
  if (lifecycle === "terminal") {
    await completeJob(client, job, "terminal_mapping");
    return;
  }
  assertManagedChannel(row);

  if (lifecycle === "delete") {
    if (row.message_id) {
      await publisher.deleteMessage({
        channelId: row.channel_id,
        messageId: row.message_id,
      });
    }
    await markDeleted(client, job, "message_deleted");
    return;
  }

  if (lifecycle === "sold") {
    if (!row.message_id || !row.snapshot) {
      await markDeleted(client, job, "sold_before_publish");
      return;
    }
    if (!await publisher.messageExists({
      channelId: row.channel_id,
      messageId: row.message_id,
    })) {
      await markDeleted(client, job, "sold_message_missing");
      return;
    }
    await publisher.updateMessage({
      channelId: row.channel_id,
      messageId: row.message_id,
      snapshot: row.snapshot,
      sold: true,
    });
    await client.query(
      `update alpha_exchange.discord_listing_messages
          set state = 'sold',
              sold_at = coalesce(sold_at, now()),
              last_error_code = null,
              last_attempt_at = now(),
              updated_at = now()
        where id = $1::uuid
          and event_version = $2`,
      [job.mappingId, job.eventVersion],
    );
    await completeJob(client, job, "message_marked_sold");
    return;
  }

  if (!row.listing_payload || !row.user_payload) {
    await markDeleted(client, job, "authoritative_state_missing");
    return;
  }
  const snapshot = buildAuthoritativeDiscordListingSnapshot({
    listing: row.listing_payload,
    seller: row.user_payload,
    trust: row.trust_payload,
    sellerStatus: row.seller_status ?? "",
    siteUrl,
  });
  const snapshotHash = hashDiscordListingSnapshot(snapshot);
  let messageId = row.message_id;
  let exists = messageId
    ? await publisher.messageExists({ channelId: row.channel_id, messageId })
    : false;
  if (!messageId) {
    messageId = await publisher.findMessageByNonce({
      channelId: row.channel_id,
      nonce: row.mapping_id,
    });
    exists = Boolean(messageId);
  }

  if (!exists) {
    await deleteReplacedMessages(client, publisher, row);
    messageId = await publisher.createMessage({
      channelId: row.channel_id,
      nonce: row.mapping_id,
      snapshot,
    });
  } else if (snapshotHash !== row.snapshot_hash || row.mapping_state !== "active") {
    await publisher.updateMessage({
      channelId: row.channel_id,
      messageId: messageId!,
      snapshot,
      sold: false,
    });
  }

  await client.query(
    `update alpha_exchange.discord_listing_messages
        set state = 'active',
            message_id = $3,
            snapshot = $4::jsonb,
            snapshot_hash = $5,
            published_at = coalesce(published_at, now()),
            last_error_code = null,
            last_attempt_at = now(),
            updated_at = now()
      where id = $1::uuid
        and event_version = $2`,
    [job.mappingId, job.eventVersion, messageId, JSON.stringify(snapshot), snapshotHash],
  );
  await completeJob(client, job, exists ? "message_updated" : "message_published");
}

async function enqueueReconciliation(pool: Pool): Promise<number> {
  const result = await pool.query(
    `with candidates as (
       select mapping.id
         from alpha_exchange.discord_listing_messages mapping
        where mapping.state in ('active', 'update_pending', 'delete_pending', 'publishing')
          and not exists (
            select 1
              from alpha_exchange.discord_listing_outbox job
             where job.mapping_id = mapping.id
               and job.status in ('pending', 'processing')
          )
        order by mapping.updated_at
        limit $1
        for update skip locked
     ), versioned as (
       update alpha_exchange.discord_listing_messages mapping
          set event_version = mapping.event_version + 1,
              state = case when mapping.state = 'active' then 'update_pending' else mapping.state end,
              updated_at = now()
         from candidates
        where mapping.id = candidates.id
       returning mapping.id, mapping.listing_id, mapping.seller_id, mapping.event_version
     )
     insert into alpha_exchange.discord_listing_outbox
       (mapping_id, listing_id, seller_id, event_type, event_version, dedupe_key)
     select id, listing_id, seller_id, 'reconcile', event_version,
            id::text || ':' || event_version::text
       from versioned
     on conflict (dedupe_key) do nothing`,
    [RECONCILIATION_BATCH_SIZE],
  );
  return result.rowCount ?? 0;
}

async function readDiagnostics(pool: Pool): Promise<DiscordListingDiagnostics> {
  const result = await pool.query<{
    pending_jobs: number;
    dead_jobs: number;
    active_mappings: number;
    failed_mappings: number;
    cooldown_claims: number;
  }>(
    `select
       (select count(*)::int from alpha_exchange.discord_listing_outbox where status in ('pending', 'processing')) as pending_jobs,
       (select count(*)::int from alpha_exchange.discord_listing_outbox where status = 'dead') as dead_jobs,
       (select count(*)::int from alpha_exchange.discord_listing_messages where state in ('active', 'update_pending')) as active_mappings,
       (select count(*)::int from alpha_exchange.discord_listing_messages where state = 'failed') as failed_mappings,
       (select count(*)::int from alpha_exchange.discord_listing_share_cooldowns where next_eligible_at > now()) as cooldown_claims`,
  );
  const row = result.rows[0];
  const degraded = (row?.dead_jobs ?? 0) > 0 || (row?.failed_mappings ?? 0) > 0;
  return {
    status: degraded ? "degraded" : "ready",
    pendingJobs: row?.pending_jobs ?? 0,
    deadJobs: row?.dead_jobs ?? 0,
    activeMappings: row?.active_mappings ?? 0,
    failedMappings: row?.failed_mappings ?? 0,
    cooldownClaims: row?.cooldown_claims ?? 0,
    errorCode: degraded ? "listing_delivery_failures" : null,
  };
}

export class DiscordListingSyncWorker {
  private readonly pool: Pool;
  private readonly publisher: DiscordListingPublisher;
  private readonly pollIntervalMs: number;
  private readonly reconciliationIntervalMs: number;
  private readonly siteUrl: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private reconciling = false;
  private diagnostics: DiscordListingDiagnostics = {
    status: "degraded",
    pendingJobs: null,
    deadJobs: null,
    activeMappings: null,
    failedMappings: null,
    cooldownClaims: null,
    errorCode: "not_reconciled",
  };

  constructor({
    pool,
    publisher,
    pollIntervalMs = POLL_INTERVAL_MS,
    reconciliationIntervalMs = RECONCILIATION_INTERVAL_MS,
    siteUrl = getSiteUrl(),
  }: ListingSyncWorkerDependencies) {
    this.pool = pool;
    this.publisher = publisher;
    this.pollIntervalMs = pollIntervalMs;
    this.reconciliationIntervalMs = reconciliationIntervalMs;
    this.siteUrl = siteUrl;
  }

  getDiagnostics(): DiscordListingDiagnostics {
    return { ...this.diagnostics };
  }

  async start(): Promise<void> {
    if (this.pollTimer) return;
    await this.reconcile();
    this.pollTimer = setInterval(() => {
      void this.processAvailableJobs().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_listing_sync_poll",
          outcome: "failed",
          reason: safeFailureCode(error),
        });
      });
    }, this.pollIntervalMs);
    this.reconciliationTimer = setInterval(() => {
      void this.reconcile().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_listing_reconciliation",
          outcome: "failed",
          reason: safeFailureCode(error),
        });
      });
    }, this.reconciliationIntervalMs);
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.pollTimer = null;
    this.reconciliationTimer = null;
  }

  async processAvailableJobs(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (let processed = 0; processed < 25; processed += 1) {
        const job = await claimJob(this.pool);
        if (!job) break;
        const client = await this.pool.connect();
        let destroyClient = false;
        try {
          await client.query("begin");
          await client.query(
            "select pg_advisory_xact_lock(hashtext($1))",
            [`discord-listing-seller:${job.sellerId}`],
          );
          if (!await ownsClaim(client, job)) {
            await client.query("commit");
            continue;
          }
          try {
            await reconcileJob(client, this.publisher, job, this.siteUrl);
            await client.query("commit");
          } catch (error) {
            const failureCode = safeFailureCode(error);
            await failJob(client, job, failureCode);
            await client.query("commit");
            logEvent("error", {
              event: "discord_listing_sync",
              targetUserId: job.sellerId,
              outcome: "failed",
              reason: failureCode,
              metadata: {
                mappingId: job.mappingId,
                attempts: job.attempts,
              },
            });
          }
        } catch (error) {
          try {
            await client.query("rollback");
          } catch (rollbackError) {
            destroyClient = true;
            throw new AggregateError(
              [error, rollbackError],
              "Discord listing synchronization rollback failed.",
            );
          }
          throw error;
        } finally {
          client.release(destroyClient);
        }
      }
      this.diagnostics = await readDiagnostics(this.pool);
    } finally {
      this.processing = false;
    }
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await enqueueReconciliation(this.pool);
      await this.processAvailableJobs();
      this.diagnostics = await readDiagnostics(this.pool);
    } finally {
      this.reconciling = false;
    }
  }
}

export function createDiscordListingSyncWorker(): DiscordListingSyncWorker {
  const pool = getRuntimePostgresPool();
  if (!pool) {
    throw new Error(
      "Discord listing synchronization requires DATABASE_URL or SUPABASE_DB_URL.",
    );
  }
  const config = readDiscordConfig();
  return new DiscordListingSyncWorker({
    pool,
    publisher: new DiscordRestListingPublisher(config.token),
  });
}
