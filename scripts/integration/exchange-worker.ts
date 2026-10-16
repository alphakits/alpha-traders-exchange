import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { getAuditQueryTimings, getRuntimePostgresPool } from "./postgres-runtime";
import { beginBuyerVerification, broadcastNotificationByAdmin, changeUserRoleByAdmin, consumeEmailVerificationToken, consumePasswordResetToken, createEmailVerificationTokenForUser, createPasswordResetToken, disableUserAccountByAdmin, getTradeRoomData, invalidateAlphaExchangeStoreCache, issueSellerCommissionByAdmin, reconcilePendingTradeTrust, recordBuyerVerificationAttempt, setSellerVacationModeByAdmin, updatePurchaseRequestStatus, updateTradeTerms, updateUserPassword, uploadTradeEvidence } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

// External delivery is deliberately outside this database test. The child
// environment contains no provider credentials, and outbound HTTP fails closed.
globalThis.fetch = async () => { throw new Error("External HTTP is disabled in the isolated database audit"); };

type Command = { id: number; operation: string; input: unknown };
async function execute(operation: string, input: unknown) {
  const repository = await getAlphaExchangeRepository();
  if (operation === "ready") {
    await repository.healthCheck();
    const version = await getRuntimePostgresPool().query("select version() as version");
    return { pid: process.pid, database: version.rows[0].version };
  }
  if (operation === "seed") {
    const baseline = await repository.loadSnapshot();
    await repository.saveSnapshot({ ...baseline, ...(input as Partial<AlphaExchangeDb>) });
    invalidateAlphaExchangeStoreCache();
    return { seeded: true };
  }
  if (operation === "snapshot") return repository.loadSnapshot();
  if (operation === "query-timings") return getAuditQueryTimings();
  if (operation === "reconcile-trust") return reconcilePendingTradeTrust();
  if (operation === "auth-password") {
    const action = input as { userId: string; passwordHash: string };
    await updateUserPassword(action.userId, action.passwordHash);
    return { updated: true };
  }
  if (operation === "auth-email-issue") return createEmailVerificationTokenForUser(input as string);
  if (operation === "auth-email-consume") return consumeEmailVerificationToken(input as string);
  if (operation === "auth-reset-issue") {
    const action = input as { userId: string; token: string };
    return createPasswordResetToken(action.userId, action.token);
  }
  if (operation === "auth-reset-consume") return consumePasswordResetToken(input as string);
  if (operation === "admin-role") return changeUserRoleByAdmin(input as Parameters<typeof changeUserRoleByAdmin>[0]);
  if (operation === "admin-disable") return disableUserAccountByAdmin(input as Parameters<typeof disableUserAccountByAdmin>[0]);
  if (operation === "admin-vacation") return setSellerVacationModeByAdmin(input as Parameters<typeof setSellerVacationModeByAdmin>[0]);
  if (operation === "admin-broadcast") return broadcastNotificationByAdmin(input as Parameters<typeof broadcastNotificationByAdmin>[0]);
  if (operation === "phone-attempt") return recordBuyerVerificationAttempt(input as string);
  if (operation === "phone-challenge") return beginBuyerVerification(input as Parameters<typeof beginBuyerVerification>[0]);
  if (operation === "status" || operation === "status-with-lost-follow-up") {
    const actionStarted = performance.now();
    const result = await updatePurchaseRequestStatus(input as Parameters<typeof updatePurchaseRequestStatus>[0]);
    const actionElapsedMs = performance.now() - actionStarted;
    const backgroundStarted = performance.now();
    if (operation === "status") await result.deferredTrustWrite?.();
    return { request: result.request, statusChanged: result.statusChanged, metrics: result.metrics,
      actionElapsedMs, backgroundElapsedMs: performance.now() - backgroundStarted };
  }
  if (operation === "terms") return updateTradeTerms(input as Parameters<typeof updateTradeTerms>[0]);
  if (operation === "manual-commission") return issueSellerCommissionByAdmin(input as Parameters<typeof issueSellerCommissionByAdmin>[0]);
  if (operation === "evidence") return uploadTradeEvidence(input as Parameters<typeof uploadTradeEvidence>[0]);
  if (operation === "room") return getTradeRoomData(input as Parameters<typeof getTradeRoomData>[0]);
  if (operation === "hold-uncommitted-write") {
    const client = await getRuntimePostgresPool().connect();
    await client.query("begin");
    const changed = await client.query("update alpha_exchange.listings set payload = jsonb_set(payload, '{availableAmount}', '\"1\"') where id = $1", [input]);
    if (changed.rowCount !== 1) throw new Error("Controlled rollback listing was not found");
    // Intentionally retain the connection. The controller kills this process
    // and verifies that PostgreSQL rolls the unfinished transaction back.
    return { holding: true, pid: process.pid };
  }
  throw new Error(`Unknown audit operation: ${operation}`);
}

process.on("message", async ({ id, operation, input }: Command) => {
  const started = performance.now();
  try {
    const result = await execute(operation, input);
    process.send?.({ id, ok: true, result, elapsedMs: performance.now() - started });
  } catch (error) {
    process.send?.({ id, ok: false, error: error instanceof Error ? error.message : String(error),
      code: (error as { code?: string }).code, details: (error as { details?: unknown }).details, elapsedMs: performance.now() - started });
  }
});
