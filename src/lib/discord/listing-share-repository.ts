import "server-only";

import type { Pool, PoolClient } from "pg";

import { getRuntimePostgresPool } from "@/lib/postgres-runtime";

const SHARE_COOLDOWN_HOURS = 12;
const CURRENT_MAPPING_STATES = ["queued", "publishing", "active", "update_pending"] as const;

export type DiscordListingMappingState =
  | "queued"
  | "publishing"
  | "active"
  | "update_pending"
  | "delete_pending"
  | "sold"
  | "deleted"
  | "failed";

export type DiscordListingShareState = {
  listingId: string;
  state: DiscordListingMappingState;
  publishedAt: string | null;
  updatedAt: string;
  errorCode: string | null;
};

export type DiscordListingSharingStatus = {
  serverTime: string;
  nextEligibleAt: string | null;
  cooldownSecondsRemaining: number;
  linked: boolean;
  available: boolean;
  listings: DiscordListingShareState[];
};

export class DiscordListingShareError extends Error {
  readonly code: string;
  readonly status: number;
  readonly sharing?: DiscordListingSharingStatus;

  constructor(
    code: string,
    message: string,
    status: number,
    sharing?: DiscordListingSharingStatus,
  ) {
    super(message);
    this.name = "DiscordListingShareError";
    this.code = code;
    this.status = status;
    this.sharing = sharing;
  }
}

type ShareClaimResult = {
  accepted: boolean;
  mappingId: string;
  sharing: DiscordListingSharingStatus;
};

type ListingRow = {
  id: string;
  seller_id: string;
  status: string;
  expires_at: Date | null;
  payload: {
    approvalStatus?: string;
    availableAmount?: string;
  };
};

type MappingRow = {
  id: string;
  listing_id: string;
  state: DiscordListingMappingState;
  published_at: Date | null;
  updated_at: Date;
  last_error_code: string | null;
};

function requirePool(pool?: Pool | null): Pool {
  const resolved = pool ?? getRuntimePostgresPool();
  if (!resolved) {
    throw new DiscordListingShareError(
      "SHARING_UNAVAILABLE",
      "Discord listing sharing is temporarily unavailable.",
      503,
    );
  }
  return resolved;
}

function toAmount(value: unknown): number {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function isListingEligible(listing: ListingRow, now: Date): boolean {
  return listing.status === "active"
    && listing.payload.approvalStatus === "approved"
    && toAmount(listing.payload.availableAmount) > 0
    && (!listing.expires_at || listing.expires_at.getTime() > now.getTime());
}

function serializeStatus(input: {
  now: Date;
  nextEligibleAt: Date | null;
  linked: boolean;
  mappings: MappingRow[];
}): DiscordListingSharingStatus {
  const remaining = input.nextEligibleAt
    ? Math.max(0, Math.ceil((input.nextEligibleAt.getTime() - input.now.getTime()) / 1000))
    : 0;
  return {
    serverTime: input.now.toISOString(),
    nextEligibleAt: remaining > 0 ? input.nextEligibleAt?.toISOString() ?? null : null,
    cooldownSecondsRemaining: remaining,
    linked: input.linked,
    available: true,
    listings: input.mappings.map((mapping) => ({
      listingId: mapping.listing_id,
      state: mapping.state,
      publishedAt: mapping.published_at?.toISOString() ?? null,
      updatedAt: mapping.updated_at.toISOString(),
      errorCode: mapping.last_error_code,
    })),
  };
}

async function readStatus(
  database: Pick<Pool | PoolClient, "query">,
  sellerId: string,
): Promise<DiscordListingSharingStatus> {
  const result = await database.query<{
    server_time: Date;
    next_eligible_at: Date | null;
    linked: boolean;
  }>(
    `select now() as server_time,
            cooldown.next_eligible_at,
            exists (
              select 1
                from alpha_exchange.discord_identities identity
               where identity.platform_user_id = $1
            ) as linked
       from (select 1) base
       left join alpha_exchange.discord_listing_share_cooldowns cooldown
         on cooldown.seller_id = $1`,
    [sellerId],
  );
  const mappings = await database.query<MappingRow>(
    `select distinct on (listing_id)
            id::text, listing_id, state, published_at, updated_at, last_error_code
       from alpha_exchange.discord_listing_messages
      where seller_id = $1
      order by listing_id, generation desc`,
    [sellerId],
  );
  const row = result.rows[0];
  const now = row?.server_time ?? new Date();
  return serializeStatus({
    now,
    nextEligibleAt: row?.next_eligible_at ?? null,
    linked: row?.linked === true,
    mappings: mappings.rows,
  });
}

export async function getDiscordListingSharingStatus(
  sellerId: string,
  pool?: Pool | null,
): Promise<DiscordListingSharingStatus> {
  return readStatus(requirePool(pool), sellerId);
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    if (error instanceof DiscordListingShareError) {
      await client.query("commit");
    } else {
      await client.query("rollback");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function deny(
  client: PoolClient,
  sellerId: string,
  listingId: string,
  code: string,
  message: string,
  status: number,
): Promise<never> {
  await client.query(
    `insert into alpha_exchange.discord_listing_audit
      (listing_id, seller_id, event_type, outcome, detail_code)
     values ($1, $2, 'share_request', 'denied', $3)`,
    [listingId, sellerId, code.toLowerCase()],
  );
  throw new DiscordListingShareError(
    code,
    message,
    status,
    await readStatus(client, sellerId),
  );
}

export async function claimDiscordListingShare(input: {
  sellerId: string;
  listingId: string;
  requestKey: string;
  pool?: Pool | null;
}): Promise<ShareClaimResult> {
  if (!/^[A-Za-z0-9:_-]{16,160}$/.test(input.requestKey)) {
    throw new DiscordListingShareError(
      "INVALID_REQUEST_KEY",
      "The share request could not be validated.",
      400,
    );
  }

  return transaction(requirePool(input.pool), async (client) => {
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      [`discord-listing-share:${input.sellerId}`],
    );

    const actor = await client.query<{
      seller_status: string;
      disabled: boolean;
      profile_hidden: boolean;
      linked: boolean;
    }>(
      `select users.seller_status,
              coalesce((users.payload ->> 'disabled')::boolean, false) as disabled,
              coalesce(users.payload ->> 'isProfileHidden', 'false') = 'true' as profile_hidden,
              exists (
                select 1 from alpha_exchange.discord_identities identity
                 where identity.platform_user_id = users.id
              ) as linked
         from alpha_exchange.users users
        where users.id = $1
        for update`,
      [input.sellerId],
    );
    const seller = actor.rows[0];
    if (!seller || seller.disabled || seller.seller_status !== "approved_seller") {
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "SELLER_INELIGIBLE",
        "Only approved active sellers can share listings to Discord.",
        403,
      );
    }
    if (seller.profile_hidden) {
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "SELLER_PROFILE_PRIVATE",
        "Make your public seller profile visible before sharing a listing to Discord.",
        409,
      );
    }
    if (!seller.linked) {
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "DISCORD_IDENTITY_REQUIRED",
        "Connect your Discord account before sharing a listing.",
        409,
      );
    }

    const listingResult = await client.query<ListingRow>(
      `select id, seller_id, status, expires_at, payload
         from alpha_exchange.listings
        where id = $1
        for update`,
      [input.listingId],
    );
    const listing = listingResult.rows[0];
    if (!listing) {
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "LISTING_NOT_FOUND",
        "Listing not found.",
        404,
      );
    }
    if (listing.seller_id !== input.sellerId) {
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "LISTING_NOT_OWNED",
        "You can share only your own listings.",
        403,
      );
    }

    const clock = await client.query<{ server_time: Date }>("select now() as server_time");
    const now = clock.rows[0]?.server_time ?? new Date();
    if (!isListingEligible(listing, now)) {
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "LISTING_INELIGIBLE",
        "Only approved active listings with available USDT can be shared.",
        409,
      );
    }

    const channelResult = await client.query<{
      guild_id: string;
      discord_resource_id: string;
    }>(
      `select guild_id, discord_resource_id
         from alpha_exchange.discord_managed_resources
        where resource_key = 'marketplace_listings'
          and reconciliation_state = 'ready'
          and discord_resource_id is not null
        for share`,
    );
    const channel = channelResult.rows[0];
    if (!channel) {
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "MARKETPLACE_CHANNEL_UNAVAILABLE",
        "Discord marketplace publishing is temporarily unavailable.",
        503,
      );
    }

    const repeated = await client.query<{ mapping_id: string }>(
      `select message.id::text as mapping_id
         from alpha_exchange.discord_listing_share_cooldowns cooldown
         join alpha_exchange.discord_listing_messages message
           on message.seller_id = cooldown.seller_id
          and message.listing_id = cooldown.listing_id
        where cooldown.request_key = $1
          and cooldown.seller_id = $2
          and cooldown.listing_id = $3
        order by message.generation desc
        limit 1`,
      [input.requestKey, input.sellerId, input.listingId],
    );
    if (repeated.rows[0]) {
      return {
        accepted: false,
        mappingId: repeated.rows[0].mapping_id,
        sharing: await readStatus(client, input.sellerId),
      };
    }

    const cooldown = await client.query<{ next_eligible_at: Date }>(
      `select next_eligible_at
         from alpha_exchange.discord_listing_share_cooldowns
        where seller_id = $1
        for update`,
      [input.sellerId],
    );
    const currentMapping = await client.query<MappingRow>(
      `select id::text, listing_id, state, published_at, updated_at, last_error_code
         from alpha_exchange.discord_listing_messages
        where seller_id = $1
          and state = any($2::text[])
        order by generation desc
        limit 1
        for update`,
      [input.sellerId, CURRENT_MAPPING_STATES],
    );
    const current = currentMapping.rows[0];
    if (cooldown.rows[0]?.next_eligible_at.getTime() > now.getTime()) {
      if (current?.listing_id === input.listingId) {
        return {
          accepted: false,
          mappingId: current.id,
          sharing: await readStatus(client, input.sellerId),
        };
      }
      return deny(
        client,
        input.sellerId,
        input.listingId,
        "SHARE_COOLDOWN_ACTIVE",
        "You can share one listing to Discord every 12 hours.",
        429,
      );
    }

    let mappingId: string;
    if (current?.listing_id === input.listingId) {
      await client.query(
        "select alpha_exchange.enqueue_discord_listing_mapping($1::uuid, 'reconcile')",
        [current.id],
      );
      mappingId = current.id;
    } else {
      const replaced = await client.query<{
        id: string;
        listing_id: string;
        event_version: string;
      }>(
        `update alpha_exchange.discord_listing_messages
            set state = 'delete_pending',
                event_version = event_version + 1,
                updated_at = now()
          where seller_id = $1
            and state = any($2::text[])
        returning id::text, listing_id, event_version::text`,
        [input.sellerId, CURRENT_MAPPING_STATES],
      );
      for (const row of replaced.rows) {
        await client.query(
          `insert into alpha_exchange.discord_listing_outbox
            (mapping_id, listing_id, seller_id, event_type, event_version, dedupe_key)
           values ($1::uuid, $2, $3, 'reconcile', $4::bigint, $1 || ':' || $4)
           on conflict (dedupe_key) do nothing`,
          [row.id, row.listing_id, input.sellerId, row.event_version],
        );
      }

      const inserted = await client.query<{ id: string }>(
        `insert into alpha_exchange.discord_listing_messages (
           listing_id,
           seller_id,
           generation,
           guild_id,
           channel_id,
           state,
           event_version
         )
         values (
           $1,
           $2,
           coalesce((
             select max(generation) + 1
               from alpha_exchange.discord_listing_messages
              where listing_id = $1
           ), 1),
           $3,
           $4,
           'queued',
           1
         )
         returning id::text`,
        [input.listingId, input.sellerId, channel.guild_id, channel.discord_resource_id],
      );
      mappingId = inserted.rows[0]!.id;
      await client.query(
        `insert into alpha_exchange.discord_listing_outbox
          (mapping_id, listing_id, seller_id, event_type, event_version, dedupe_key)
         values ($1::uuid, $2, $3, 'publish', 1, $1 || ':1')`,
        [mappingId, input.listingId, input.sellerId],
      );
    }

    await client.query(
      `insert into alpha_exchange.discord_listing_share_cooldowns (
         seller_id,
         listing_id,
         claim_token,
         request_key,
         last_claimed_at,
         next_eligible_at
       )
       values ($1, $2, gen_random_uuid(), $3, now(), now() + interval '${SHARE_COOLDOWN_HOURS} hours')
       on conflict (seller_id) do update set
         listing_id = excluded.listing_id,
         claim_token = excluded.claim_token,
         request_key = excluded.request_key,
         last_claimed_at = excluded.last_claimed_at,
         next_eligible_at = excluded.next_eligible_at,
         updated_at = now()`,
      [input.sellerId, input.listingId, input.requestKey],
    );
    await client.query(
      `insert into alpha_exchange.discord_listing_audit
        (mapping_id, listing_id, seller_id, event_type, outcome, detail_code)
       values ($1::uuid, $2, $3, 'share_request', 'accepted', 'cooldown_claimed')`,
      [mappingId, input.listingId, input.sellerId],
    );

    return {
      accepted: true,
      mappingId,
      sharing: await readStatus(client, input.sellerId),
    };
  });
}
