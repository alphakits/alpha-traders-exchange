import { createHash } from "node:crypto";
import {
  MOBILE_ACCESS_TOKEN_TTL_SECONDS,
  MOBILE_CURRENT_APP_VERSION,
  MOBILE_REFRESH_TOKEN_TTL_SECONDS,
} from "@alpha-traders/contracts";
import type { MobileClientMetadata } from "@/lib/mobile-api";
import type { MobileDeviceSessionRecord } from "@/lib/mobile-auth-store";
import type { WalletSql } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";

const MODE = "simulation-only" as const;
const userIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

/** Public synthetic credentials, never production tokens or account creation. */
export type MarketplaceMobileFixtureCredentials = {
  accessToken: string;
  metadata: MobileClientMetadata;
};

/**
 * Add the exact mobile session/history table shapes to an existing disposable
 * canonical fixture. All credentials are deterministic public test values; no
 * ambient database lookup, live session issuer or external service is used.
 * The caller owns the same writable SERIALIZABLE simulation transaction.
 */
export async function createMarketplaceMobileAuthFixture(options: {
  mode: "simulation-only";
  tx: WalletSql;
  userIds: readonly string[];
  atMs: number;
  platform?: "ios" | "android";
  locale?: "ar" | "en";
}) {
  assertSimulationRuntime(options.mode);
  const { tx, atMs } = options;
  const platform = options.platform ?? "ios", locale = options.locale ?? "en";
  if (!Array.isArray(options.userIds) || options.userIds.length === 0 || options.userIds.length > 100
    || options.userIds.some(id => typeof id !== "string" || !userIdPattern.test(id))
    || new Set(options.userIds).size !== options.userIds.length
    || !Number.isSafeInteger(atMs) || atMs < 0
    || (platform !== "ios" && platform !== "android") || (locale !== "ar" && locale !== "en")) {
    throw new Error("Mobile development fixture requires explicit valid identities, metadata and time");
  }
  const userIds = [...options.userIds];
  const expiresAtMs = atMs + MOBILE_ACCESS_TOKEN_TTL_SECONDS * 1000;
  const refreshExpiresAtMs = atMs + MOBILE_REFRESH_TOKEN_TTL_SECONDS * 1000;
  if (![atMs, expiresAtMs, refreshExpiresAtMs].every(at => Number.isSafeInteger(at) && Number.isFinite(new Date(at).getTime()))) {
    throw new Error("Mobile development fixture time is outside the supported range");
  }
  const createdAt = new Date(atMs).toISOString();
  const accessExpiresAt = new Date(expiresAtMs).toISOString();
  const refreshExpiresAt = new Date(refreshExpiresAtMs).toISOString();
  let transactionId: string | undefined, certified = false;
  const context = async (full = true) => {
    assertSimulationRuntime(options.mode);
    const result = await tx.query<{
      transaction_id: string; isolation: string; read_only: string; development_mode: string | null;
    }>(`SELECT txid_current()::text AS transaction_id,
      current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
      current_setting('alpha_wallet.development_schema',true) AS development_mode`);
    assertSimulationRuntime(options.mode);
    const row = result.rows[0];
    if (result.rows.length !== 1 || typeof row?.transaction_id !== "string" || !/^[1-9][0-9]*$/.test(row.transaction_id)
      || (transactionId !== undefined && row.transaction_id !== transactionId)
      || (full && (row.isolation !== "serializable" || row.read_only !== "off" || row.development_mode !== MODE))) {
      throw new Error("Mobile development fixture requires one owned SERIALIZABLE simulation transaction");
    }
    return row.transaction_id;
  };
  try {
    transactionId = await context();
    await context();
    certified = true;
    const existing = await tx.query<{ sessions: string | null; history: string | null; accounts: string | null }>(
      `SELECT to_regclass('alpha_exchange.mobile_device_sessions')::text AS sessions,
        to_regclass('alpha_exchange.mobile_refresh_token_history')::text AS history,
        to_regclass('alpha_exchange.users')::text AS accounts`);
    await context();
    if (existing.rows.length !== 1 || existing.rows[0].sessions !== null || existing.rows[0].history !== null
      || existing.rows[0].accounts !== "alpha_exchange.users") {
      throw new Error("Mobile development fixture requires existing users and absent mobile session tables");
    }
    const accounts = await tx.query<{ id: string }>("SELECT id FROM alpha_exchange.users WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE", [userIds]);
    await context();
    if (accounts.rows.length !== userIds.length || accounts.rows.some(row => !userIds.includes(row.id))) {
      throw new Error("Mobile development fixture does not create missing accounts");
    }

    // Same columns, nullability, key/check constraints and indexes as the
    // retained mobile migration. No IF NOT EXISTS: existing tables are refused.
    await tx.exec(`
      CREATE TABLE alpha_exchange.mobile_device_sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
        device_id_hash text NOT NULL,
        access_token_hash text NOT NULL UNIQUE,
        refresh_token_hash text NOT NULL UNIQUE,
        token_family_id text NOT NULL,
        refresh_generation integer NOT NULL DEFAULT 0 CHECK (refresh_generation >= 0),
        platform text NOT NULL CHECK (platform IN ('ios','android')),
        app_version text NOT NULL,
        locale text NOT NULL CHECK (locale IN ('ar','en')),
        access_expires_at timestamptz NOT NULL,
        refresh_expires_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        revoked_at timestamptz,
        revoke_reason text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE (user_id,device_id_hash)
      );
      CREATE TABLE alpha_exchange.mobile_refresh_token_history (
        token_hash text PRIMARY KEY,
        session_id text NOT NULL REFERENCES alpha_exchange.mobile_device_sessions(id) ON DELETE CASCADE,
        generation integer NOT NULL CHECK (generation >= 0),
        used_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX idx_alpha_exchange_mobile_sessions_user_active
        ON alpha_exchange.mobile_device_sessions (user_id,updated_at DESC) WHERE revoked_at IS NULL;
      CREATE INDEX idx_alpha_exchange_mobile_sessions_access_expiry
        ON alpha_exchange.mobile_device_sessions (access_expires_at) WHERE revoked_at IS NULL;
      CREATE INDEX idx_alpha_exchange_mobile_sessions_refresh_expiry
        ON alpha_exchange.mobile_device_sessions (refresh_expires_at) WHERE revoked_at IS NULL;
      CREATE INDEX idx_alpha_exchange_mobile_refresh_history_session
        ON alpha_exchange.mobile_refresh_token_history (session_id,used_at DESC);
    `);
    await context();
    const credentials = Object.create(null) as Record<string, MarketplaceMobileFixtureCredentials>;
    const sessions = Object.create(null) as Record<string, MobileDeviceSessionRecord>;
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    for (const userId of userIds) {
      const suffix = digest(`public-mobile-fixture-user:${userId}`).slice(0, 32);
      const accessToken = `atr_at_v1.${createHash("sha256").update(`public-mobile-fixture-access:${userId}`).digest("base64url")}`;
      const refreshToken = `atr_rt_v1.${createHash("sha384").update(`public-mobile-fixture-refresh:${userId}`).digest("base64url")}`;
      const metadata: MobileClientMetadata = { deviceId: `fixture-mobile-device-${suffix}`, platform,
        appVersion: MOBILE_CURRENT_APP_VERSION, locale };
      const session: MobileDeviceSessionRecord = {
        id: `mobile-session-fixture-${suffix}`, userId, deviceIdHash: digest(`device:${metadata.deviceId}`),
        accessTokenHash: digest(accessToken), refreshTokenHash: digest(refreshToken),
        tokenFamilyId: `mobile-family-fixture-${suffix}`, refreshGeneration: 0,
        platform, appVersion: metadata.appVersion, locale, accessExpiresAt, refreshExpiresAt,
        lastSeenAt: createdAt, revokedAt: null, revokeReason: null, createdAt, updatedAt: createdAt,
      };
      await tx.query(`INSERT INTO alpha_exchange.mobile_device_sessions
        (id,user_id,device_id_hash,access_token_hash,refresh_token_hash,token_family_id,refresh_generation,
          platform,app_version,locale,access_expires_at,refresh_expires_at,last_seen_at,revoked_at,revoke_reason,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13::timestamptz,NULL,NULL,$14::timestamptz,$15::timestamptz)`,
      [session.id, userId, session.deviceIdHash, session.accessTokenHash, session.refreshTokenHash,
        session.tokenFamilyId, session.refreshGeneration, platform, session.appVersion, locale,
        accessExpiresAt, refreshExpiresAt, session.lastSeenAt, createdAt, createdAt]);
      await context();
      credentials[userId] = { accessToken, metadata };
      sessions[userId] = session;
    }
    return { credentials, sessions, expiresAtMs };
  } catch (error) {
    if (certified) {
      try {
        await context(false);
        await tx.query("SELECT 1 / 0 /* abort incomplete mobile development fixture */");
      } catch { /* Preserve the first failure; the caller owns rollback. */ }
    }
    throw error;
  }
}
