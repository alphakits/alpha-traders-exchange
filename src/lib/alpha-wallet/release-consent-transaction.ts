import "server-only";

import { types } from "node:util";
import { walletDigest } from "./commands";
import { captureInboxData, captureInboxOptions } from "./deposit-inbox-data";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";

export class ReleaseConsentCoordinatorError extends Error {
  readonly executionAuthority = false;
  readonly releaseAuthority = false;
  constructor(readonly code: string, message = "Release consent did not satisfy the closed development contract") {
    super(message); this.name = "ReleaseConsentCoordinatorError";
  }
}
export function releaseConsentCheck(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ReleaseConsentCoordinatorError(code, message);
}
const safeCodes = new Set(["INVALID_INPUT", "INTEGRITY", "STOPPED", "RESOURCE_LIMIT", "RUNTIME_REFUSED", "BINDING_MISMATCH",
  "STALE_BASIS", "ACTOR_REFUSED", "NOT_ENROLLED", "SOURCE_NOT_PAUSED", "STORAGE_UNAVAILABLE", "40001", "40P01",
  "WALLET_AUTH_RECORD_INVALID", "WALLET_AUTH_UNAVAILABLE", "WALLET_AUTH_CONTEXT_REQUIRED", "WALLET_AUTHORITY_CHANGED",
  "WALLET_SESSION_REQUIRED", "WALLET_ACCOUNT_DISABLED", "WALLET_EMAIL_VERIFICATION_REQUIRED",
  "WALLET_PHONE_VERIFICATION_REQUIRED", "WALLET_ADULT_CONFIRMATION_REQUIRED", "WALLET_MOBILE_UPDATE_REQUIRED",
  "WALLET_RELEASE_SELLER_REQUIRED", "WALLET_RELEASE_OWNER_REQUIRED", "WALLET_RELEASE_PARTICIPANT_REQUIRED",
  "WALLET_RELEASE_AUTH_INPUT_INVALID", "WALLET_RELEASE_REQUEST_REQUIRED"]);
export function releaseConsentFailure(error: unknown): Error {
  // Never invoke an adapter's getter, proxy trap, toJSON or exception message.
  const descriptor = error && typeof error === "object" && !types.isProxy(error)
    ? Object.getOwnPropertyDescriptor(error, "code") : undefined;
  const code: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (code === "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN") {
    return new CommitOutcomeUnknownError(new Error("Development release-consent commit acknowledgement unavailable"));
  }
  return new ReleaseConsentCoordinatorError(typeof code === "string" && safeCodes.has(code) ? code : "STORAGE_UNAVAILABLE");
}
export function captureReleaseConsentStore(value: unknown): WalletStore {
  const captured = captureInboxOptions(value, ["transaction", "close"]);
  releaseConsentCheck(typeof captured.transaction === "function" && typeof captured.close === "function",
    "INVALID_INPUT", "An explicit development store is required");
  const transaction = captured.transaction as WalletStore["transaction"];
  // Capture the capability once; changing the caller's object cannot reroute it.
  return Object.freeze({ transaction: <T>(work: (tx: WalletSql) => Promise<T>) => transaction.call(value, work) as Promise<T>,
    close: async () => { throw new ReleaseConsentCoordinatorError("INVALID_INPUT", "The caller owns this development store"); } });
}
export function releaseConsentClock(supplied: unknown): () => number {
  releaseConsentCheck(typeof supplied === "function", "INVALID_INPUT", "An explicit release-consent clock is required");
  let previous = 0;
  return () => {
    assertSimulationRuntime("simulation-only");
    const at: unknown = supplied();
    releaseConsentCheck(typeof at === "number" && Number.isSafeInteger(at) && at > 0
      && Number.isFinite(new Date(at).getTime()) && at >= previous, "INVALID_INPUT", "Release-consent clock is invalid or regressed");
    previous = at; return at;
  };
}

/** Every nested operation and cleanup belongs to the earliest physical transaction. */
export async function withReleaseConsentTransaction<T>(store: WalletStore, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  let completed: { value: T; digest: string } | undefined;
  try {
    const returned = await store.transaction(async raw => {
      let originalId: string | undefined;
      const assertOwner = async () => {
        const rows = (await raw.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null; timezone: string }>(
          `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
            current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode,
            current_setting('TimeZone') AS timezone /* release consent: original attempt owner */`)).rows;
        const row = rows[0];
        releaseConsentCheck(rows.length === 1 && typeof row?.transaction_id === "string" && /^[1-9][0-9]*$/.test(row.transaction_id)
          && (originalId === undefined || row.transaction_id === originalId), "INTEGRITY", "The original physical release-consent transaction changed or ended");
        originalId ??= row.transaction_id;
        releaseConsentCheck(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only"
          && ["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"].includes(row.timezone),
        "INTEGRITY", "Release consent requires one writable SERIALIZABLE simulation transaction in UTC");
        assertSimulationRuntime("simulation-only");
      };
      const tx: WalletSql = Object.freeze({
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          await assertOwner(); const result = await raw.query<Row>(sql, values); await assertOwner(); return result;
        },
        async exec(sql: string) { await assertOwner(); await raw.exec(sql); await assertOwner(); },
      });
      try {
        await assertOwner(); await assertOwner();
        const value = await work(tx);
        await assertOwner();
        const captured = captureInboxData<T>(value, { maxBytes: 64 * 1_048_576, maxNodes: 100_000, maxDepth: 64 });
        completed = { value: captured, digest: walletDigest(captured) };
        return captured;
      } catch (error) {
        completed = undefined;
        if (originalId !== undefined) {
          try {
            const rows = (await raw.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
            if (rows.length === 1 && rows[0].transaction_id === originalId) await raw.query("SELECT 1 / 0 /* abort failed release-consent attempt */");
          } catch { /* Never poison a replacement; the real owner rolls back. */ }
        }
        throw error;
      }
    });
    releaseConsentCheck(completed !== undefined, "INTEGRITY", "Development store returned without its certified callback");
    const captured = captureInboxData(returned, { maxBytes: 64 * 1_048_576, maxNodes: 100_000, maxDepth: 64 });
    releaseConsentCheck(walletDigest(captured) === completed.digest, "INTEGRITY", "Development store substituted its transaction result");
    assertSimulationRuntime("simulation-only");
    return completed.value;
  } catch (error) { throw releaseConsentFailure(error); }
}
