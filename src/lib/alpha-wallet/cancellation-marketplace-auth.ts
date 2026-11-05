import "server-only";

import { z } from "zod";
import { WalletAccessError } from "./access";
import type { WalletSql } from "./durable-store";
import { resolveDevelopmentMarketplaceWebPrincipal, type DevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import { developmentMarketplaceMobileCredentialsSchema, resolveDevelopmentMarketplaceMobilePrincipal } from "./marketplace-mobile-auth";
import { assertSimulationRuntime } from "./runtime";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const operationSchema = z.enum(["upgrade", "cancel", "inspect", "pause", "export"]);
export type DevelopmentCancellationMarketplaceAuthOperation = z.infer<typeof operationSchema>;
export const developmentCancellationMarketplaceCredentialsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("web"), sessionToken: z.string().min(1).max(2048) }),
  z.strictObject({ kind: z.literal("mobile"), ...developmentMarketplaceMobileCredentialsSchema.shape }),
]);
export type DevelopmentCancellationMarketplaceCredentials = z.infer<typeof developmentCancellationMarketplaceCredentialsSchema>;
export type DevelopmentCancellationMarketplacePrincipal = Readonly<{
  userId: string;
  actorKind: "buyer" | "seller" | "operator";
  isOwner: boolean;
  sessionExpiresAtMs: number;
  assertFresh(): Promise<void>;
}>;
type Context = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
type RequestRow = Record<string, unknown> & {
  request_id: string; trade_id: string; listing_id: string; seller_id: string; buyer_id: string;
  status: string; request_payload: unknown;
};
type RequestIdentity = Readonly<{ requestId: string; tradeId: string; listingId: string; sellerId: string; buyerId: string }>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function invalidRecord(): never { throw new WalletAccessError("WALLET_AUTH_RECORD_INVALID", 503); }
function publicFailure(error: unknown) {
  if (error instanceof WalletAccessError) return error;
  const code = record(error) ? error.code : undefined;
  if (code === "40001" || code === "40P01") return error;
  return new WalletAccessError("WALLET_AUTH_UNAVAILABLE", 503);
}
function requestIdentity(row: RequestRow, requestId: string): RequestIdentity {
  const payload = row.request_payload;
  if (!record(payload) || row.request_id !== requestId || payload.id !== requestId
    || ![row.request_id, row.trade_id, row.listing_id, row.seller_id, row.buyer_id].every(value => id.safeParse(value).success)
    || payload.tradeId !== row.trade_id || payload.listingId !== row.listing_id
    || payload.sellerId !== row.seller_id || payload.buyerId !== row.buyer_id
    || row.seller_id === row.buyer_id || payload.status !== row.status
    || (row.status !== "accepted" && row.status !== "cancelled")) return invalidRecord();
  return Object.freeze({ requestId: row.request_id, tradeId: row.trade_id, listingId: row.listing_id,
    sellerId: row.seller_id, buyerId: row.buyer_id });
}
function actorKind(principal: DevelopmentMarketplaceWebPrincipal, identity: RequestIdentity,
  operation: DevelopmentCancellationMarketplaceAuthOperation): DevelopmentCancellationMarketplacePrincipal["actorKind"] {
  if (operation !== "cancel") {
    if (!principal.isOwner) throw new WalletAccessError("WALLET_CANCELLATION_OWNER_REQUIRED");
    return "operator";
  }
  if (principal.userId === identity.sellerId) return "seller";
  if (principal.userId === identity.buyerId) return "buyer";
  // An owner/admin label does not replace actual participation in this trade.
  throw new WalletAccessError("WALLET_CANCELLATION_PARTICIPANT_REQUIRED");
}

/**
 * Fixed stored web/mobile bridge for the cancellation successor. The caller
 * first owns the canonical request/global/runtime/listing fences, then resolves
 * this authority, and only then locks the wallet head. No injected resolver,
 * caller identity/role, cache, token rotation or ambient database is consulted.
 *
 * Existing enabled-account, email/phone/adult, session, device and version
 * policies remain unchanged. canBuy/canSell are deliberately not cancellation
 * gates: a retained party can cancel even after selling eligibility changes.
 * Owner upgrade/inspection/pause/export use owner authority, never force-cancel.
 *
 * assertFresh must run after awaited writes and again before returning to the
 * outer transaction owner, including receipt recovery while the wallet is
 * paused. It allows the expected accepted-to-cancelled lifecycle change while
 * retaining exactly the same request/trade/listing/party identities. The
 * canonical participant separately verifies every permitted lifecycle field.
 */
export async function resolveDevelopmentCancellationMarketplacePrincipal(options: {
  mode: "simulation-only"; tx: WalletSql; requestId: string;
  operation: DevelopmentCancellationMarketplaceAuthOperation;
  credentials: DevelopmentCancellationMarketplaceCredentials; clock: () => number;
}): Promise<DevelopmentCancellationMarketplacePrincipal> {
  const { mode, tx, requestId, operation, clock } = options;
  assertSimulationRuntime(mode);
  // Capture transport data synchronously, but surface any capture failure only
  // inside the certified failure boundary so a swallowed failure cannot rescue
  // already-written companion work on this same transaction.
  let captured: unknown, captureFailure: unknown;
  try { captured = structuredClone(options.credentials); }
  catch (error) { captureFailure = error; }
  let transactionId: string | undefined, certified = false;
  const context = async () => {
    assertSimulationRuntime(mode);
    const result = await tx.query<Context>(`SELECT txid_current()::text AS transaction_id,
      current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only,
      current_setting('alpha_wallet.development_schema',true) AS development_mode`);
    assertSimulationRuntime(mode);
    const current = result.rows[0];
    if (result.rows.length !== 1 || typeof current?.transaction_id !== "string" || !/^[1-9][0-9]*$/.test(current.transaction_id)
      || (transactionId !== undefined && transactionId !== current.transaction_id)
      || current.isolation !== "serializable" || current.read_only !== "off" || current.development_mode !== mode) {
      throw new WalletAccessError("WALLET_AUTH_CONTEXT_REQUIRED", 503);
    }
    return current.transaction_id;
  };
  const fail = async (error: unknown): Promise<never> => {
    if (certified) {
      try {
        // Cleanup intentionally avoids runtime/contract checks. Only this
        // original physical transaction may be poisoned, never a replacement.
        const current = await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
        if (current.rows.length === 1 && current.rows[0].transaction_id === transactionId) {
          await tx.query("SELECT 1 / 0 /* abort failed cancellation marketplace authority */");
        }
      } catch { /* Preserve the initiating error and whole-transaction retry codes. */ }
    }
    throw publicFailure(error);
  };
  // The fixed reader has its own transaction certificate. Bind every one of
  // its reads to this earlier certificate too: a replacement between the two
  // initial certifications must never become a new authority/cleanup owner.
  const scoped: WalletSql = {
    async exec(sql) { await context(); await tx.exec(sql); await context(); },
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      await context(); const result = await tx.query<Row>(sql, values); await context(); return result;
    },
  };
  try {
    transactionId = await context(); await context(); certified = true;
    const parsed = developmentCancellationMarketplaceCredentialsSchema.safeParse(captured);
    if (captureFailure || !parsed.success || !id.safeParse(requestId).success || !operationSchema.safeParse(operation).success) {
      throw new WalletAccessError("WALLET_CANCELLATION_AUTH_INPUT_INVALID", 400);
    }
    const credentials = parsed.data;
    const principal = credentials.kind === "web"
      ? await resolveDevelopmentMarketplaceWebPrincipal({ mode, tx: scoped, token: credentials.sessionToken, clock })
      : await resolveDevelopmentMarketplaceMobilePrincipal({ mode, tx: scoped, accessToken: credentials.accessToken, metadata: credentials.metadata, clock });
    const readRequest = async () => {
      await context();
      const result = await tx.query<RequestRow>(`SELECT request.id AS request_id,request.trade_id,request.listing_id,
          request.seller_id,request.buyer_id,request.status,request.payload AS request_payload
        FROM alpha_exchange.purchase_requests AS request WHERE request.id=$1 FOR SHARE OF request
        /* cancellation marketplace authority: retained request identity */`, [requestId]);
      await context();
      if (result.rows.length !== 1) throw new WalletAccessError("WALLET_CANCELLATION_REQUEST_REQUIRED", 404);
      return requestIdentity(result.rows[0], requestId);
    };
    const initialRequest = await readRequest();
    const kind = actorKind(principal, initialRequest, operation);
    await principal.assertFresh(); // Expiry/version after the final awaited identity read.
    return Object.freeze({ userId: principal.userId, actorKind: kind, isOwner: principal.isOwner,
      sessionExpiresAtMs: principal.sessionExpiresAtMs, async assertFresh() {
        try {
          await principal.assertFresh();
          const currentRequest = await readRequest();
          if (JSON.stringify(currentRequest) !== JSON.stringify(initialRequest)
            || actorKind(principal, currentRequest, operation) !== kind) {
            throw new WalletAccessError("WALLET_AUTHORITY_CHANGED");
          }
          await principal.assertFresh();
        } catch (error) { await fail(error); }
      } });
  } catch (error) { return fail(error); }
}
