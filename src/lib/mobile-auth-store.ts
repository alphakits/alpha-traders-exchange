import type { PoolClient } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";

export type MobileDeviceSessionRecord = {
  id: string;
  userId: string;
  deviceIdHash: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  refreshGeneration: number;
  platform: "ios" | "android";
  appVersion: string;
  locale: "ar" | "en";
  accessExpiresAt: string;
  refreshExpiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MobileRefreshRotationResult =
  | { status: "rotated"; session: MobileDeviceSessionRecord }
  | { status: "invalid" | "expired" | "revoked" | "reused" | "device_mismatch" };

export interface MobileDeviceSessionStore {
  createOrReplace(session: MobileDeviceSessionRecord): Promise<MobileDeviceSessionRecord>;
  findByAccessTokenHash(accessTokenHash: string): Promise<MobileDeviceSessionRecord | null>;
  rotateByRefreshToken(input: {
    refreshTokenHash: string;
    deviceIdHash: string;
    nextAccessTokenHash: string;
    nextRefreshTokenHash: string;
    nextAccessExpiresAt: string;
    nextRefreshExpiresAt: string;
    platform: "ios" | "android";
    appVersion: string;
    locale: "ar" | "en";
    now: string;
  }): Promise<MobileRefreshRotationResult>;
  revokeByAccessTokenHash(accessTokenHash: string, reason: string, now: string): Promise<boolean>;
  revokeAllForUser(userId: string, reason: string, now: string): Promise<number>;
}

type MobileSessionRow = {
  id: string;
  user_id: string;
  device_id_hash: string;
  access_token_hash: string;
  refresh_token_hash: string;
  token_family_id: string;
  refresh_generation: number;
  platform: "ios" | "android";
  app_version: string;
  locale: "ar" | "en";
  access_expires_at: Date | string;
  refresh_expires_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
  revoke_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapSession(row: MobileSessionRow): MobileDeviceSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceIdHash: row.device_id_hash,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    tokenFamilyId: row.token_family_id,
    refreshGeneration: Number(row.refresh_generation),
    platform: row.platform,
    appVersion: row.app_version,
    locale: row.locale,
    accessExpiresAt: toIso(row.access_expires_at),
    refreshExpiresAt: toIso(row.refresh_expires_at),
    lastSeenAt: toIso(row.last_seen_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    revokeReason: row.revoke_reason,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function requirePool() {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Mobile session storage is unavailable.");
  return pool;
}

async function rollbackQuietly(client: PoolClient) {
  try {
    await client.query("rollback");
  } catch {
    // The original database error is more useful than rollback failure.
  }
}

export class PostgresMobileDeviceSessionStore implements MobileDeviceSessionStore {
  async createOrReplace(session: MobileDeviceSessionRecord) {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<MobileSessionRow>(
        `insert into alpha_exchange.mobile_device_sessions (
           id, user_id, device_id_hash, access_token_hash, refresh_token_hash,
           token_family_id, refresh_generation, platform, app_version, locale,
           access_expires_at, refresh_expires_at, last_seen_at, revoked_at,
           revoke_reason, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, null, null, $14, $15
         )
         on conflict (user_id, device_id_hash) do update set
           access_token_hash = excluded.access_token_hash,
           refresh_token_hash = excluded.refresh_token_hash,
           token_family_id = excluded.token_family_id,
           refresh_generation = excluded.refresh_generation,
           platform = excluded.platform,
           app_version = excluded.app_version,
           locale = excluded.locale,
           access_expires_at = excluded.access_expires_at,
           refresh_expires_at = excluded.refresh_expires_at,
           last_seen_at = excluded.last_seen_at,
           revoked_at = null,
           revoke_reason = null,
           updated_at = excluded.updated_at
         returning *`,
        [
          session.id,
          session.userId,
          session.deviceIdHash,
          session.accessTokenHash,
          session.refreshTokenHash,
          session.tokenFamilyId,
          session.refreshGeneration,
          session.platform,
          session.appVersion,
          session.locale,
          session.accessExpiresAt,
          session.refreshExpiresAt,
          session.lastSeenAt,
          session.createdAt,
          session.updatedAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Mobile session could not be created.");
      await client.query(
        "delete from alpha_exchange.mobile_refresh_token_history where session_id = $1",
        [row.id],
      );
      await client.query("commit");
      return mapSession(row);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findByAccessTokenHash(accessTokenHash: string) {
    const result = await requirePool().query<MobileSessionRow>(
      "select * from alpha_exchange.mobile_device_sessions where access_token_hash = $1 limit 1",
      [accessTokenHash],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async rotateByRefreshToken(input: {
    refreshTokenHash: string;
    deviceIdHash: string;
    nextAccessTokenHash: string;
    nextRefreshTokenHash: string;
    nextAccessExpiresAt: string;
    nextRefreshExpiresAt: string;
    platform: "ios" | "android";
    appVersion: string;
    locale: "ar" | "en";
    now: string;
  }): Promise<MobileRefreshRotationResult> {
    const pool = requirePool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      let result = await client.query<MobileSessionRow>(
        "select * from alpha_exchange.mobile_device_sessions where refresh_token_hash = $1 for update",
        [input.refreshTokenHash],
      );
      let row = result.rows[0];

      if (!row) {
        result = await client.query<MobileSessionRow>(
          `select sessions.*
             from alpha_exchange.mobile_refresh_token_history history
             join alpha_exchange.mobile_device_sessions sessions on sessions.id = history.session_id
            where history.token_hash = $1
            for update of sessions`,
          [input.refreshTokenHash],
        );
        row = result.rows[0];
        if (row) {
          await client.query(
            `update alpha_exchange.mobile_device_sessions
                set revoked_at = coalesce(revoked_at, $2),
                    revoke_reason = 'refresh_token_reuse',
                    updated_at = $2
              where id = $1`,
            [row.id, input.now],
          );
          await client.query("commit");
          return { status: "reused" };
        }
        await client.query("commit");
        return { status: "invalid" };
      }

      if (row.revoked_at) {
        await client.query("commit");
        return { status: "revoked" };
      }
      if (row.device_id_hash !== input.deviceIdHash) {
        await client.query("commit");
        return { status: "device_mismatch" };
      }
      if (new Date(row.refresh_expires_at).getTime() <= new Date(input.now).getTime()) {
        await client.query(
          `update alpha_exchange.mobile_device_sessions
              set revoked_at = $2, revoke_reason = 'refresh_expired', updated_at = $2
            where id = $1`,
          [row.id, input.now],
        );
        await client.query("commit");
        return { status: "expired" };
      }

      await client.query(
        `insert into alpha_exchange.mobile_refresh_token_history
           (token_hash, session_id, generation, used_at, expires_at)
         values ($1, $2, $3, $4, $5)
         on conflict (token_hash) do nothing`,
        [
          row.refresh_token_hash,
          row.id,
          row.refresh_generation,
          input.now,
          row.refresh_expires_at,
        ],
      );
      const rotated = await client.query<MobileSessionRow>(
        `update alpha_exchange.mobile_device_sessions
            set access_token_hash = $2,
                refresh_token_hash = $3,
                refresh_generation = refresh_generation + 1,
                platform = $4,
                app_version = $5,
                locale = $6,
                access_expires_at = $7,
                refresh_expires_at = least(refresh_expires_at, $8),
                last_seen_at = $9,
                updated_at = $9
          where id = $1
          returning *`,
        [
          row.id,
          input.nextAccessTokenHash,
          input.nextRefreshTokenHash,
          input.platform,
          input.appVersion,
          input.locale,
          input.nextAccessExpiresAt,
          input.nextRefreshExpiresAt,
          input.now,
        ],
      );
      const rotatedRow = rotated.rows[0];
      if (!rotatedRow) throw new Error("Mobile session could not be rotated.");
      await client.query("commit");
      return { status: "rotated", session: mapSession(rotatedRow) };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeByAccessTokenHash(accessTokenHash: string, reason: string, now: string) {
    const result = await requirePool().query(
      `update alpha_exchange.mobile_device_sessions
          set revoked_at = coalesce(revoked_at, $3), revoke_reason = $2, updated_at = $3
        where access_token_hash = $1`,
      [accessTokenHash, reason, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllForUser(userId: string, reason: string, now: string) {
    const result = await requirePool().query(
      `update alpha_exchange.mobile_device_sessions
          set revoked_at = coalesce(revoked_at, $3), revoke_reason = $2, updated_at = $3
        where user_id = $1 and revoked_at is null`,
      [userId, reason, now],
    );
    return result.rowCount ?? 0;
  }
}

export const postgresMobileDeviceSessionStore = new PostgresMobileDeviceSessionStore();
