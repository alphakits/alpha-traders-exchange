import "server-only";
import { createHash } from "node:crypto";
import { WalletAccessError } from "./access";
import type { WalletSql } from "./durable-store";
import { developmentMarketplaceAccountAuthority, validateDevelopmentMarketplaceAccountRecord } from "./marketplace-account-authority";
import { assertSimulationRuntime } from "./runtime";

type Authority = Readonly<{
  userId: string;
  canBuy: boolean;
  isOwner: boolean;
  sessionExpiresAtMs: number;
}>;

/** Server-only authority bound to its original transaction, never a receipt. */
export type DevelopmentMarketplaceWebPrincipal = Authority & Readonly<{
  assertFresh(): Promise<void>;
}>;

type Context = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
type AuthRow = Record<string, unknown> & {
  token_hash: string;
  user_id: string;
  session_expires_at_ms: string;
  session_created_at_ms: string;
  session_payload: unknown;
  account_id: string;
  account_email: string;
  account_role: string;
  account_seller_status: string;
  account_payload: unknown;
};

const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidRecord(): never { throw new WalletAccessError("WALLET_AUTH_RECORD_INVALID", 503); }

function timestamp(value: unknown) {
  if (typeof value !== "string") return invalidRecord();
  const parsed = Date.parse(value);
  // createAuthSession persists Date.toISOString(), with UTC millisecond precision.
  // Do not normalize a retained malformed session into valid authorization.
  if (!Number.isSafeInteger(parsed) || parsed < 0 || new Date(parsed).toISOString() !== value) return invalidRecord();
  return parsed;
}

function databaseTimestamp(value: unknown) {
  // PostgreSQL NUMERIC is returned as a string. Preserve the precision check:
  // a scalar timestamp with sub-millisecond data cannot match a JSON deadline.
  if (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value)) return invalidRecord();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return invalidRecord();
  return parsed;
}

function authority(row: AuthRow, tokenHash: string, now: number): Authority {
  const session = row.session_payload;
  if (!record(session)
    || row.token_hash !== tokenHash || session.token !== tokenHash
    || typeof row.user_id !== "string" || !USER_ID.test(row.user_id)
    || session.userId !== row.user_id) return invalidRecord();
  validateDevelopmentMarketplaceAccountRecord(row, row.user_id);

  const expiresAt = timestamp(session.expiresAt), createdAt = timestamp(session.createdAt);
  if (databaseTimestamp(row.session_expires_at_ms) !== expiresAt
    || databaseTimestamp(row.session_created_at_ms) !== createdAt || expiresAt <= createdAt) return invalidRecord();
  if (createdAt > now || expiresAt <= now) throw new WalletAccessError("WALLET_SESSION_REQUIRED", 401);

  return Object.freeze({ ...developmentMarketplaceAccountAuthority(row, row.user_id), sessionExpiresAtMs: expiresAt });
}

function publicFailure(error: unknown) {
  if (error instanceof WalletAccessError) return error;
  // The outer owner must retry the entire canonical/auth/wallet decision.
  const code = record(error) ? error.code : undefined;
  if (code === "40001" || code === "40P01") return error;
  // No driver errors, credentials, account payloads or private causes escape.
  return new WalletAccessError("WALLET_AUTH_UNAVAILABLE", 503);
}

/**
 * Explicit DEVELOPMENT web authentication on the caller's WalletSql only.
 * It neither opens a connection nor reads cookies, caches, mobile sessions or
 * client-supplied identity/roles. SHA-256 matches createAuthSession/hashToken.
 *
 * The coordinator first obtains its request/global/runtime locks, then calls
 * this reader before the wallet head lock. Session and account FOR SHARE locks
 * remain held until the single outer owner commits or rolls back. A concurrent
 * revocation/account update is ordered against that transaction; it does not
 * retroactively cancel a transaction that obtained these locks first.
 *
 * Call assertFresh after awaited persistence and before returning to the owner,
 * including historical receipt recovery. Expiry is checked at those checkpoints;
 * this is not a claim that COMMIT itself must arrive before the wall-clock expiry.
 */
export async function resolveDevelopmentMarketplaceWebPrincipal(options: {
  mode: "simulation-only"; tx: WalletSql; token: string; clock: () => number;
}): Promise<DevelopmentMarketplaceWebPrincipal> {
  const { mode, tx, token, clock } = options;
  assertSimulationRuntime(mode);
  let transactionId: string | undefined, certified = false, lastCheckedAt: number | undefined;

  const context = async (requireContract = true) => {
    assertSimulationRuntime(mode);
    const result = await tx.query<Context>(`SELECT txid_current()::text AS transaction_id,
      current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
      current_setting('alpha_wallet.development_schema', true) AS development_mode`);
    assertSimulationRuntime(mode);
    const current = result.rows[0];
    if (result.rows.length !== 1 || typeof current?.transaction_id !== "string" || !/^[1-9][0-9]*$/.test(current.transaction_id)
      || (transactionId !== undefined && current.transaction_id !== transactionId)
      || (requireContract && (current.isolation !== "serializable" || current.read_only !== "off" || current.development_mode !== mode))) {
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
        // Even a swallowed semantic failure cannot commit earlier financial work.
        // Never poison an unknown or replaced transaction.
        await context(false);
        await tx.query("SELECT 1 / 0 /* abort failed development marketplace authentication */");
      } catch { /* Preserve the original failure, including whole-transaction retry codes. */ }
    }
    throw publicFailure(error);
  };

  try {
    transactionId = await context();
    await context(); // Two round trips reject autocommit before authoritative reads.
    certified = true;
    if (typeof token !== "string" || !token || token.length > 2048 || /[\s\x00-\x1f\x7f]/.test(token)) {
      throw new WalletAccessError("WALLET_SESSION_REQUIRED", 401);
    }
    checkedTime();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const read = async () => {
      await context();
      const result = await tx.query<AuthRow>(`SELECT session.token_hash, session.user_id,
          (EXTRACT(EPOCH FROM session.expires_at) * 1000)::text AS session_expires_at_ms,
          (EXTRACT(EPOCH FROM session.created_at) * 1000)::text AS session_created_at_ms,
          session.payload AS session_payload, account.id AS account_id, account.email AS account_email,
          account.role AS account_role, account.seller_status AS account_seller_status, account.payload AS account_payload
        FROM alpha_exchange.sessions AS session
        JOIN alpha_exchange.users AS account ON account.id = session.user_id
        WHERE session.token_hash = $1
        FOR SHARE OF session, account`, [tokenHash]);
      await context();
      const now = checkedTime(); // Clock after the final awaited read, not before it.
      if (result.rows.length === 0) throw new WalletAccessError("WALLET_SESSION_REQUIRED", 401);
      if (result.rows.length !== 1) return invalidRecord();
      return authority(result.rows[0], tokenHash, now);
    };
    const initial = await read();
    return Object.freeze({ ...initial, async assertFresh() {
      try {
        const current = await read();
        if (current.userId !== initial.userId || current.canBuy !== initial.canBuy || current.isOwner !== initial.isOwner
          || current.sessionExpiresAtMs !== initial.sessionExpiresAtMs) {
          throw new WalletAccessError("WALLET_AUTHORITY_CHANGED", 403);
        }
      } catch (error) { await fail(error); }
    } });
  } catch (error) { return fail(error); }
}
