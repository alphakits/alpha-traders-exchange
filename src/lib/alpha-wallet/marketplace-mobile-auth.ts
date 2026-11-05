import "server-only";
import { z } from "zod";
import { hashMobileDeviceId, hashMobileSecret, isMobileAccessToken } from "@/lib/mobile-auth";
import { resolveMobileVersionPolicy } from "@/lib/mobile-version-policy";
import { WalletAccessError } from "./access";
import type { WalletSql } from "./durable-store";
import {
  developmentMarketplaceAccountAuthority, validateDevelopmentMarketplaceAccountRecord,
  type DevelopmentMarketplaceAccountRow,
} from "./marketplace-account-authority";
import type { DevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import { assertSimulationRuntime } from "./runtime";

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const APP_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,49}$/;
const HASH = /^[a-f0-9]{64}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,160}$/;

export const developmentMarketplaceMobileCredentialsSchema = z.strictObject({
  accessToken: z.string().max(160).refine(isMobileAccessToken).refine(value => !/[\s\x00-\x1f\x7f]/.test(value)),
  metadata: z.strictObject({
    deviceId: z.string().regex(DEVICE_ID), platform: z.enum(["ios", "android"]),
    appVersion: z.string().regex(APP_VERSION), locale: z.enum(["ar", "en"]),
  }),
});
export type DevelopmentMarketplaceMobileCredentials = z.infer<typeof developmentMarketplaceMobileCredentialsSchema>;
export type DevelopmentMarketplaceMobilePrincipal = DevelopmentMarketplaceWebPrincipal;

type Context = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
type AuthRow = Record<string, unknown> & DevelopmentMarketplaceAccountRow & {
  session_id: string; session_user_id: string; device_id_hash: string; access_token_hash: string;
  refresh_token_hash: string; token_family_id: string; refresh_generation: number;
  platform: string; app_version: string; locale: string;
  access_expires_at_ms: string; refresh_expires_at_ms: string; last_seen_at_ms: string;
  revoked_at_ms: string | null; revoke_reason: string | null; created_at_ms: string; updated_at_ms: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function invalidRecord(): never { throw new WalletAccessError("WALLET_AUTH_RECORD_INVALID", 503); }
function denied(): never { throw new WalletAccessError("WALLET_SESSION_REQUIRED", 401); }
function databaseTimestamp(value: unknown) {
  // The issuer writes Date.toISOString() millisecond timestamps. Do not let a
  // driver round a contradictory sub-millisecond deadline into authorization.
  if (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value)) return invalidRecord();
  const at = Number(value);
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(new Date(at).getTime())) return invalidRecord();
  return at;
}
function publicFailure(error: unknown) {
  if (error instanceof WalletAccessError) return error;
  const code = record(error) ? error.code : undefined;
  if (code === "40001" || code === "40P01") return error;
  return new WalletAccessError("WALLET_AUTH_UNAVAILABLE", 503);
}

function authority(row: AuthRow, credentials: DevelopmentMarketplaceMobileCredentials, now: number) {
  const tokenHash = hashMobileSecret(credentials.accessToken), deviceHash = hashMobileDeviceId(credentials.metadata.deviceId);
  if (typeof row.session_id !== "string" || !SESSION_ID.test(row.session_id)
    || typeof row.token_family_id !== "string" || !SESSION_ID.test(row.token_family_id)
    || !Number.isSafeInteger(row.refresh_generation) || row.refresh_generation < 0
    || typeof row.access_token_hash !== "string" || !HASH.test(row.access_token_hash) || row.access_token_hash !== tokenHash
    || typeof row.device_id_hash !== "string" || !HASH.test(row.device_id_hash)
    || typeof row.refresh_token_hash !== "string" || !HASH.test(row.refresh_token_hash)
    || (row.platform !== "ios" && row.platform !== "android") || (row.locale !== "ar" && row.locale !== "en")
    || typeof row.app_version !== "string" || !APP_VERSION.test(row.app_version)
    || (row.revoke_reason !== null && typeof row.revoke_reason !== "string")) return invalidRecord();
  validateDevelopmentMarketplaceAccountRecord(row, row.session_user_id);
  const accessExpires = databaseTimestamp(row.access_expires_at_ms), refreshExpires = databaseTimestamp(row.refresh_expires_at_ms);
  const created = databaseTimestamp(row.created_at_ms), updated = databaseTimestamp(row.updated_at_ms);
  const lastSeen = databaseTimestamp(row.last_seen_at_ms);
  if (row.revoked_at_ms !== null) { databaseTimestamp(row.revoked_at_ms); return denied(); }
  if (row.revoke_reason !== null || accessExpires <= created || refreshExpires <= created
    || updated < created || lastSeen < created || lastSeen > updated || accessExpires <= updated) return invalidRecord();
  if (row.device_id_hash !== deviceHash || row.platform !== credentials.metadata.platform
    || created > now || updated > now || lastSeen > now || accessExpires <= now) return denied();
  // Access-token validity is independent of refresh expiry: the final valid
  // refresh may issue an access token whose deadline extends beyond its family.
  const principal = Object.freeze({ ...developmentMarketplaceAccountAuthority(row, row.session_user_id),
    sessionExpiresAtMs: accessExpires });
  // Bind every retained session field, without returning any of them publicly.
  // A replacement may reuse the same row ID, so identity alone is insufficient.
  const binding = JSON.stringify([row.session_id, row.session_user_id, row.device_id_hash, row.access_token_hash,
    row.refresh_token_hash, row.token_family_id, row.refresh_generation, row.platform, row.app_version, row.locale,
    accessExpires, refreshExpires, lastSeen, row.revoked_at_ms, row.revoke_reason, created, updated]);
  return { principal, binding };
}

/**
 * Fixed DEVELOPMENT mobile bearer/device reader on the caller's transaction.
 * No MobileAuthService/store method, pool, cache, HTTP request or token rotation
 * is invoked. Request/global/runtime locks precede this reader; the wallet head
 * follows it. FOR SHARE locks on device session and account last until the
 * single outer transaction commits or rolls back, ordering logout/revocation.
 *
 * Call assertFresh after awaited work and actual canonical persistence. Version
 * policy and expiry are checked at those checkpoints, not at COMMIT arrival.
 */
export async function resolveDevelopmentMarketplaceMobilePrincipal(options: {
  mode: "simulation-only"; tx: WalletSql; accessToken: string;
  metadata: DevelopmentMarketplaceMobileCredentials["metadata"]; clock: () => number;
}): Promise<DevelopmentMarketplaceMobilePrincipal> {
  const { mode, tx, clock } = options;
  assertSimulationRuntime(mode);
  // Capture the caller's values before any await. Zod creates an isolated copy;
  // changing the caller's metadata object later cannot change this authority.
  const parsed = developmentMarketplaceMobileCredentialsSchema.safeParse({ accessToken: options.accessToken, metadata: options.metadata });
  let transactionId: string | undefined, certified = false, lastCheckedAt: number | undefined;
  const context = async () => {
    assertSimulationRuntime(mode);
    const result = await tx.query<Context>(`SELECT txid_current()::text AS transaction_id,
      current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
      current_setting('alpha_wallet.development_schema', true) AS development_mode`);
    assertSimulationRuntime(mode);
    const current = result.rows[0];
    if (result.rows.length !== 1 || typeof current?.transaction_id !== "string" || !/^[1-9][0-9]*$/.test(current.transaction_id)
      || (transactionId !== undefined && current.transaction_id !== transactionId)
      || current.isolation !== "serializable" || current.read_only !== "off" || current.development_mode !== mode) {
      throw new WalletAccessError("WALLET_AUTH_CONTEXT_REQUIRED", 503);
    }
    return current.transaction_id;
  };
  const checkedTime = () => {
    const now = typeof clock === "function" ? clock() : NaN;
    if (!Number.isSafeInteger(now) || now < 0 || (lastCheckedAt !== undefined && now < lastCheckedAt)) {
      throw new WalletAccessError("WALLET_CLOCK_INVALID", 503);
    }
    lastCheckedAt = now;
    return now;
  };
  const fail = async (error: unknown): Promise<never> => {
    if (certified) {
      try {
        // Check only physical identity here: the runtime/contract refusal is a
        // reason to abort, never permission to commit earlier financial work.
        const current = await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
        if (current.rows.length === 1 && current.rows[0]?.transaction_id === transactionId) {
          await tx.query("SELECT 1 / 0 /* abort failed development marketplace mobile authentication */");
        }
      } catch { /* Preserve the original failure and whole-transaction retry classification. */ }
    }
    throw publicFailure(error);
  };

  try {
    transactionId = await context();
    await context();
    certified = true;
    if (!parsed.success) return denied();
    const credentials = parsed.data;
    const policy = () => {
      assertSimulationRuntime(mode);
      if (resolveMobileVersionPolicy(credentials.metadata.platform, credentials.metadata.appVersion).updateRequired) {
        throw new WalletAccessError("WALLET_APP_UPDATE_REQUIRED", 426);
      }
    };
    policy();
    checkedTime();
    const read = async () => {
      policy();
      await context();
      policy();
      const result = await tx.query<AuthRow>(`SELECT session.id AS session_id, session.user_id AS session_user_id,
          session.device_id_hash, session.access_token_hash, session.refresh_token_hash, session.token_family_id,
          session.refresh_generation, session.platform, session.app_version, session.locale,
          (EXTRACT(EPOCH FROM session.access_expires_at) * 1000)::text AS access_expires_at_ms,
          (EXTRACT(EPOCH FROM session.refresh_expires_at) * 1000)::text AS refresh_expires_at_ms,
          (EXTRACT(EPOCH FROM session.last_seen_at) * 1000)::text AS last_seen_at_ms,
          (EXTRACT(EPOCH FROM session.revoked_at) * 1000)::text AS revoked_at_ms, session.revoke_reason,
          (EXTRACT(EPOCH FROM session.created_at) * 1000)::text AS created_at_ms,
          (EXTRACT(EPOCH FROM session.updated_at) * 1000)::text AS updated_at_ms,
          account.id AS account_id, account.email AS account_email, account.role AS account_role,
          account.seller_status AS account_seller_status, account.payload AS account_payload
        FROM alpha_exchange.mobile_device_sessions AS session
        JOIN alpha_exchange.users AS account ON account.id = session.user_id
        WHERE session.access_token_hash = $1
        FOR SHARE OF session, account`, [hashMobileSecret(credentials.accessToken)]);
      policy();
      await context();
      const now = checkedTime();
      policy();
      if (result.rows.length === 0) return denied();
      if (result.rows.length !== 1) return invalidRecord();
      return authority(result.rows[0], credentials, now);
    };
    const initial = await read();
    return Object.freeze({ ...initial.principal, async assertFresh() {
      try {
        const current = await read();
        if (current.binding !== initial.binding || current.principal.userId !== initial.principal.userId
          || current.principal.canBuy !== initial.principal.canBuy || current.principal.canSell !== initial.principal.canSell
          || current.principal.isOwner !== initial.principal.isOwner
          || current.principal.sessionExpiresAtMs !== initial.principal.sessionExpiresAtMs) {
          throw new WalletAccessError("WALLET_AUTHORITY_CHANGED", 403);
        }
      } catch (error) { await fail(error); }
    } });
  } catch (error) { return fail(error); }
}
