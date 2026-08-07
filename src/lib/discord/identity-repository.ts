import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import type { DiscordIdentityProfile } from "@/lib/discord/oauth";

export type DiscordConnection = {
  discordUserId: string;
  username: string;
  globalName: string | null;
  linkedAt: string;
  lastSyncedAt: string | null;
};

export type ConsumedOAuthState = {
  codeChallenge: string;
  locale: "ar" | "en";
};

export class DiscordIdentityConflictError extends Error {
  constructor() {
    super("This Discord account is already connected to another Alpha Traders account.");
    this.name = "DiscordIdentityConflictError";
  }
}

export async function recordDiscordIdentityAudit(input: {
  platformUserId: string;
  discordUserId?: string | null;
  eventType: "identity_link_denied" | "identity_link_failed";
  outcome: "failed" | "degraded";
  detailCode: string;
  pool?: Pool | null;
}): Promise<void> {
  await requirePool(input.pool).query(
    `insert into alpha_exchange.discord_sync_audit
      (platform_user_id, discord_user_id, event_type, outcome, detail_code)
     values ($1, $2, $3, $4, $5)`,
    [
      input.platformUserId,
      input.discordUserId ?? null,
      input.eventType,
      input.outcome,
      input.detailCode,
    ],
  );
}

function requirePool(pool?: Pool | null): Pool {
  const resolved = pool ?? getRuntimePostgresPool();
  if (!resolved) throw new Error("Discord identity persistence is unavailable.");
  return resolved;
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await operation(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function desiredStatus(sellerStatus: string): "approved" | "pending" | "suspended" | "none" {
  if (sellerStatus === "approved_seller") return "approved";
  if (sellerStatus === "pending_seller_approval") return "pending";
  if (sellerStatus === "suspended") return "suspended";
  return "none";
}

export async function createDiscordOAuthStateRecord(input: {
  stateHash: string;
  platformUserId: string;
  codeChallenge: string;
  locale: "ar" | "en";
  expiresAt: Date;
  pool?: Pool | null;
}): Promise<void> {
  const pool = requirePool(input.pool);
  await pool.query(
    `insert into alpha_exchange.discord_oauth_states
      (state_hash, platform_user_id, code_challenge, locale, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [
      input.stateHash,
      input.platformUserId,
      input.codeChallenge,
      input.locale,
      input.expiresAt,
    ],
  );
  await pool.query(
    `delete from alpha_exchange.discord_oauth_states
      where expires_at < now() - interval '1 hour'`,
  );
}

export async function consumeDiscordOAuthState(input: {
  stateHash: string;
  platformUserId: string;
  pool?: Pool | null;
}): Promise<ConsumedOAuthState | null> {
  const result = await requirePool(input.pool).query<{
    code_challenge: string;
    locale: "ar" | "en";
  }>(
    `update alpha_exchange.discord_oauth_states
        set consumed_at = now()
      where state_hash = $1
        and platform_user_id = $2
        and consumed_at is null
        and expires_at > now()
      returning code_challenge, locale`,
    [input.stateHash, input.platformUserId],
  );
  const row = result.rows[0];
  return row ? { codeChallenge: row.code_challenge, locale: row.locale } : null;
}

export async function getDiscordConnection(
  platformUserId: string,
  pool?: Pool | null,
): Promise<DiscordConnection | null> {
  const result = await requirePool(pool).query<{
    discord_user_id: string;
    username: string;
    global_name: string | null;
    linked_at: Date;
    last_synced_at: Date | null;
  }>(
    `select discord_user_id, username, global_name, linked_at, last_synced_at
       from alpha_exchange.discord_identities
      where platform_user_id = $1`,
    [platformUserId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    discordUserId: row.discord_user_id,
    username: row.username,
    globalName: row.global_name,
    linkedAt: row.linked_at.toISOString(),
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
  };
}

export async function linkDiscordIdentity(input: {
  platformUserId: string;
  profile: DiscordIdentityProfile;
  pool?: Pool | null;
}): Promise<void> {
  const pool = requirePool(input.pool);
  try {
    await transaction(pool, async (client) => {
      const seller = await client.query<{ seller_status: string }>(
        `select seller_status from alpha_exchange.users where id = $1 for update`,
        [input.platformUserId],
      );
      if (!seller.rows[0]) throw new Error("Alpha Traders account not found.");

      const current = await client.query<{ discord_user_id: string }>(
        `select discord_user_id
           from alpha_exchange.discord_identities
          where platform_user_id = $1
          for update`,
        [input.platformUserId],
      );
      if (current.rows[0]?.discord_user_id !== undefined
        && current.rows[0].discord_user_id !== input.profile.id) {
        throw new DiscordIdentityConflictError();
      }
      const desired = desiredStatus(seller.rows[0].seller_status);

      await client.query(
        `insert into alpha_exchange.discord_identities
          (platform_user_id, discord_user_id, username, global_name)
         values ($1, $2, $3, $4)
         on conflict (platform_user_id) do update set
           username = excluded.username,
           global_name = excluded.global_name,
           updated_at = now()`,
        [
          input.platformUserId,
          input.profile.id,
          input.profile.username,
          input.profile.globalName,
        ],
      );
      await client.query(
        `insert into alpha_exchange.discord_role_sync_outbox
          (platform_user_id, discord_user_id, desired_status, reason, dedupe_key)
         values ($1, $2, $3, 'identity_linked', $4)
         on conflict (dedupe_key) do nothing`,
        [
          input.platformUserId,
          input.profile.id,
          desired,
          `identity-link:${input.platformUserId}:${randomUUID()}`,
        ],
      );
      await client.query(
        `insert into alpha_exchange.discord_sync_audit
          (platform_user_id, discord_user_id, event_type, outcome)
         values ($1, $2, 'identity_linked', 'success')`,
        [input.platformUserId, input.profile.id],
      );
    });
  } catch (error) {
    if (
      error instanceof DiscordIdentityConflictError
      || (typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: unknown }).code === "23505")
    ) {
      throw new DiscordIdentityConflictError();
    }
    throw error;
  }
}

export async function unlinkDiscordIdentity(input: {
  platformUserId: string;
  pool?: Pool | null;
}): Promise<boolean> {
  return transaction(requirePool(input.pool), async (client) => {
    const existing = await client.query<{ discord_user_id: string }>(
      `select discord_user_id
         from alpha_exchange.discord_identities
        where platform_user_id = $1
        for update`,
      [input.platformUserId],
    );
    const discordUserId = existing.rows[0]?.discord_user_id;
    if (!discordUserId) return false;

    await client.query(
      `delete from alpha_exchange.discord_identities where platform_user_id = $1`,
      [input.platformUserId],
    );
    await client.query(
      `insert into alpha_exchange.discord_sync_audit
        (platform_user_id, discord_user_id, event_type, outcome)
       values ($1, $2, 'identity_unlinked', 'success')`,
      [input.platformUserId, discordUserId],
    );
    return true;
  });
}
