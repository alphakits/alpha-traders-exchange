import "server-only";

import { z } from "zod";
import { withDevelopmentPaymentMarketplaceInTransaction, type DevelopmentPaymentMarketplaceParticipant } from "@/lib/alpha-exchange-repository";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS } from "./backup";
import { walletDigest } from "./commands";
import { captureInboxData, captureInboxOptions } from "./deposit-inbox-data";
import type { WalletSql, WalletStore } from "./durable-store";
import { developmentMarketplaceAccountAuthority, validateDevelopmentMarketplaceAccountRecord,
  type DevelopmentMarketplaceAccountRow } from "./marketplace-account-authority";
import { developmentMarketplaceMobileCredentialsSchema } from "./marketplace-mobile-auth";
import { assertPaymentMarketplaceCoherence, registerPaymentMarketplaceContext, type PaymentMarketplaceContext } from "./payment-marketplace-coordination-store";
import { resolveDevelopmentReleaseConsentPrincipal, type DevelopmentReleaseConsentAuthOperation,
  type DevelopmentReleaseConsentPrincipal } from "./release-consent-auth";
import { createReleaseConsentArchive, inspectReleaseConsent, releaseConsentCurrentBasisFromHistory,
  type ReleaseConsentArchive, type ReleaseConsentCurrentBasis, type ReleaseConsentInspection,
  type ReleaseConsentPublicCommand, type ReleaseConsentReceipt } from "./release-consent-model";
import { appendReleaseConsentOverlay, enrollReleaseConsentOverlay, loadReleaseConsentOverlay } from "./release-consent-store";
import { captureReleaseConsentStore, releaseConsentCheck as check, releaseConsentClock, releaseConsentFailure,
  withReleaseConsentTransaction } from "./release-consent-transaction";
import { assertSimulationRuntime } from "./runtime";
import { captureTrustedPaymentManifest, preparedTrustedPaymentEvidenceSchema } from "./trusted-payment-evidence";
import { createCoordinatedV5DurableWallet, verifyV5History } from "./v5-durable";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const web = { sessionToken: z.string().min(1).max(2048), requestId: id };
const mobile = { ...developmentMarketplaceMobileCredentialsSchema.shape, requestId: id };
const data = {
  enroll: { operationId: id, prepared: preparedTrustedPaymentEvidenceSchema, acknowledgeNonAuthoritativeConsent: z.literal(true) },
  observe: { operationId: id, prepared: preparedTrustedPaymentEvidenceSchema },
  consent: { operationId: id, reviewedBasisSha256: hex },
  revoke: { operationId: id, consentOperationId: id },
  pause: { operationId: id, reasonCode: z.enum(["manual-review", "source-unavailable", "maintenance"]) },
  inspect: {},
  receipt: { operationId: id, expectedPhysicalStoreId: id },
  reconcile: { operationId: id, expectedPhysicalStoreId: id },
};
const webSchemas = {
  enroll: z.strictObject({ ...web, ...data.enroll }), observe: z.strictObject({ ...web, ...data.observe }),
  consent: z.strictObject({ ...web, ...data.consent }), revoke: z.strictObject({ ...web, ...data.revoke }),
  pause: z.strictObject({ ...web, ...data.pause }), inspect: z.strictObject(web),
  receipt: z.strictObject({ ...web, ...data.receipt }), reconcile: z.strictObject({ ...web, ...data.reconcile }),
};
const mobileSchemas = {
  enroll: z.strictObject({ ...mobile, ...data.enroll }), observe: z.strictObject({ ...mobile, ...data.observe }),
  consent: z.strictObject({ ...mobile, ...data.consent }), revoke: z.strictObject({ ...mobile, ...data.revoke }),
  pause: z.strictObject({ ...mobile, ...data.pause }), inspect: z.strictObject(mobile),
  receipt: z.strictObject({ ...mobile, ...data.receipt }), reconcile: z.strictObject({ ...mobile, ...data.reconcile }),
};
type Input = z.infer<(typeof webSchemas)[keyof typeof webSchemas]> | z.infer<(typeof mobileSchemas)[keyof typeof mobileSchemas]>;
export type DevelopmentReleaseConsentOptions = { mode: "simulation-only"; store: WalletStore; sourceStoreId: string; manifest: unknown; clock: () => number };
export type DevelopmentReleaseConsentOutcome = {
  kind: "alpha-wallet-release-consent-outcome-v1"; mode: "simulation-only"; requestId: string;
  sourceStoreId: string; physicalStoreId: string; receipt: ReleaseConsentReceipt; replayed: boolean;
  executionAuthority: false; releaseAuthority: false;
};
export type DevelopmentReleaseConsentInspection = ReleaseConsentInspection & {
  kind: "alpha-wallet-release-consent-inspection-v1"; mode: "simulation-only"; requestId: string; sourceStoreId: string; physicalStoreId: string;
};
export type DevelopmentReleaseConsentReconciliation = {
  kind: "alpha-wallet-release-consent-reconciliation-v1"; mode: "simulation-only"; requestId: string; sourceStoreId: string; physicalStoreId: string;
  status: "recorded" | "unresolved"; receipt: ReleaseConsentReceipt | null; executionAuthority: false; releaseAuthority: false;
};
type Attempt = { tx: WalletSql; participant: DevelopmentPaymentMarketplaceParticipant; context: PaymentMarketplaceContext;
  principal: DevelopmentReleaseConsentPrincipal; currentBasis: ReleaseConsentCurrentBasis; sellerEligible: boolean };
type Finalize<T> = () => T;
type Captured<T> = { input: T } | { error: unknown };
function captured<T>(work: () => T): Captured<T> { try { return { input: work() }; } catch (error) { return { error }; } }
function unpack<T>(value: Captured<T>): T { if ("error" in value) throw value.error; return value.input; }
export const RELEASE_CONSENT_WALLET_HISTORY_SQL = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;
export async function readReleaseConsentWalletHistory(tx: WalletSql) {
  const rows = (await tx.query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,
    coalesce(sum(octet_length(to_jsonb(command)::text)),0)::text AS bytes FROM alpha_wallet_simulation.commands command`)).rows;
  check(rows.length === 1 && /^[0-9]+$/.test(rows[0].count) && /^[0-9]+$/.test(rows[0].bytes)
    && Number(rows[0].count) > 0 && Number(rows[0].count) <= MAX_WALLET_BACKUP_COMMANDS
    && Number(rows[0].bytes) <= MAX_WALLET_BACKUP_BYTES, "RESOURCE_LIMIT", "Current wallet history exceeds the bounded original profile");
  const history = (await tx.query(RELEASE_CONSENT_WALLET_HISTORY_SQL)).rows;
  check(history.length === Number(rows[0].count), "INTEGRITY", "Wallet history capture changed inside its transaction");
  return history;
}
async function sellerAccount(tx: WalletSql, requestId: string) {
  const rows = (await tx.query<{ seller_account: Record<string, unknown> }>(`SELECT to_jsonb(account) AS seller_account
    FROM alpha_exchange.users account JOIN alpha_exchange.purchase_requests request ON request.seller_id=account.id
    WHERE request.id=$1 FOR SHARE OF account` , [requestId])).rows;
  check(rows.length === 1 && rows[0].seller_account, "INTEGRITY", "The retained seller account is required");
  const account = rows[0].seller_account;
  const row: DevelopmentMarketplaceAccountRow = { account_id: account.id as string, account_email: account.email as string,
    account_role: account.role as string, account_seller_status: account.seller_status as string, account_payload: account.payload };
  validateDevelopmentMarketplaceAccountRecord(row, row.account_id);
  let eligible = true;
  try { developmentMarketplaceAccountAuthority(row, row.account_id); }
  catch (error) {
    const safe = releaseConsentFailure(error);
    const code = (safe as { code?: string }).code;
    if (["WALLET_ACCOUNT_DISABLED", "WALLET_EMAIL_VERIFICATION_REQUIRED", "WALLET_PHONE_VERIFICATION_REQUIRED",
      "WALLET_ADULT_CONFIRMATION_REQUIRED"].includes(code ?? "")) eligible = false;
    else throw error;
  }
  return { account, eligible };
}
function accountInspection(archive: ReleaseConsentArchive, attempt: Attempt, at: number): ReleaseConsentInspection {
  const result = inspectReleaseConsent(archive, attempt.currentBasis, at);
  return attempt.sellerEligible ? result : { ...result, currentPreconditionsMatch: false, canConsent: false,
    reasons: [...result.reasons, "seller-account-ineligible"] };
}

/** Fixed stored web/mobile authority; every outcome is revocable preparation with zero financial authority. */
function createCoordinator(supplied: DevelopmentReleaseConsentOptions, kind: "web" | "mobile") {
  const options = captureInboxOptions(supplied, ["mode", "store", "sourceStoreId", "manifest", "clock"]);
  assertSimulationRuntime(options.mode as string);
  const mode = "simulation-only" as const, store = captureReleaseConsentStore(options.store), clock = releaseConsentClock(options.clock);
  const sourceStoreId = id.parse(options.sourceStoreId), admission = captureTrustedPaymentManifest(options.manifest);
  const schemas = kind === "web" ? webSchemas : mobileSchemas;
  const captureInput = <T>(schema: z.ZodType<T>, raw: unknown): Captured<T> => captured(() => {
    const data = captureInboxData(raw, { maxBytes: 32 * 1_048_576, maxNodes: 100_000, maxDepth: 64 });
    const parsed = schema.safeParse(data); check(parsed.success, "INVALID_INPUT", "Closed release-consent input is required"); return parsed.data;
  });
  function identity(requestId: string, physicalStoreId: string) { return { mode, requestId, sourceStoreId, physicalStoreId }; }
  async function run<T>(inputValue: Captured<Input>, operation: DevelopmentReleaseConsentAuthOperation, work: (input: Input, attempt: Attempt) => Promise<Finalize<T>>): Promise<T> {
    return withReleaseConsentTransaction(store, async tx => {
      const input = unpack(inputValue); clock();
      let principal: DevelopmentReleaseConsentPrincipal | undefined, context: PaymentMarketplaceContext | undefined;
      let expectedSellerDigest: string | undefined;
      const finalize = await withDevelopmentPaymentMarketplaceInTransaction({ mode, tx, requestId: input.requestId }, async participant => {
        check(participant.canonical.request.id === input.requestId, "BINDING_MISMATCH", "An exact retained V5 request is required");
        principal = await resolveDevelopmentReleaseConsentPrincipal({ mode, tx, requestId: input.requestId, operation,
          credentials: "sessionToken" in input ? { kind: "web", sessionToken: input.sessionToken }
            : { kind: "mobile", accessToken: input.accessToken, metadata: input.metadata }, clock });
        // Inspect is a transaction capability, not a substitute owner identity.
        // It cannot bind or execute any V5 financial command.
        context = await registerPaymentMarketplaceContext({ mode, tx, requestId: input.requestId, operation: "inspect", actorUserId: principal.userId });
        const snapshot = await createCoordinatedV5DurableWallet({ mode, context, clock }).snapshot();
        await assertPaymentMarketplaceCoherence(context);
        const history = await readReleaseConsentWalletHistory(tx), replay = verifyV5History(history);
        check(replay.revision === snapshot.revision && replay.eventHash === snapshot.eventHash
          && walletDigest(replay.state) === walletDigest(snapshot.state), "INTEGRITY", "Current history and locked wallet head disagree");
        const seller = await sellerAccount(tx, input.requestId); expectedSellerDigest = walletDigest(seller.account);
        const canonicalBasisSha256 = walletDigest({ kind: "alpha-wallet-release-consent-canonical-basis-v1", basis: participant.basis, sellerAccount: seller.account });
        const currentBasis = releaseConsentCurrentBasisFromHistory({ requestId: input.requestId, walletHistory: history, canonicalBasisSha256 });
        const independent = (await tx.query<{ id: string }>("SELECT id FROM alpha_exchange.users WHERE id=ANY($1::text[]) ORDER BY id",
          [admission.manifest.sources.map(source => source.authorityId)])).rows;
        check(independent.length === 0, "ACTOR_REFUSED", "Synthetic source authorities must be independent from every current platform account");
        const finish = await work(input, { tx, participant, context, principal, currentBasis, sellerEligible: seller.eligible });
        await principal.assertFresh(); return finish;
      });
      check(principal && context && expectedSellerDigest, "INTEGRITY", "Release-consent attempt did not retain its complete authority");
      await assertPaymentMarketplaceCoherence(context);
      check(walletDigest((await sellerAccount(tx, input.requestId)).account) === expectedSellerDigest,
        "STALE_BASIS", "Seller account changed during the release-consent attempt");
      await principal.assertFresh();
      return finalize();
    });
  }
  async function load(attempt: Attempt) {
    const loaded = await loadReleaseConsentOverlay({ mode, context: attempt.context, sourceStoreId });
    check(loaded, "NOT_ENROLLED", "The original owner must explicitly enroll this nonauthoritative overlay");
    check(loaded.archive.bootstrap.manifestSha256 === admission.manifestSha256,
      "BINDING_MISMATCH", "The fixed synthetic source admission cannot change after enrollment");
    return loaded;
  }
  function outcome(requestId: string, result: { physicalStoreId: string; receipt: ReleaseConsentReceipt; replayed: boolean }): DevelopmentReleaseConsentOutcome {
    return { kind: "alpha-wallet-release-consent-outcome-v1", ...identity(requestId, result.physicalStoreId),
      receipt: result.receipt, replayed: result.replayed, executionAuthority: false, releaseAuthority: false };
  }
  async function mutate(operation: "observe" | "consent" | "revoke" | "pause", raw: unknown) {
    return run(captureInput(schemas[operation] as z.ZodType<Input>, raw), operation, async (input, attempt) => {
      const loaded = await load(attempt);
      check("operationId" in input, "INVALID_INPUT", "Operation identity is required");
      const common = { operationId: input.operationId, actorUserId: attempt.principal.userId };
      let command: ReleaseConsentPublicCommand;
      if (operation === "observe" && "prepared" in input) command = { type: "observe", ...common, prepared: input.prepared };
      else if (operation === "consent" && "reviewedBasisSha256" in input) {
        const old = loaded.archive.records.find(row => row.operationId === input.operationId && row.command.type === "consent"
          && row.command.actorUserId === common.actorUserId && row.command.reviewedBasisSha256 === input.reviewedBasisSha256);
        const sessionExpiresAtMs = old?.command.type === "consent" ? old.command.sessionExpiresAtMs : attempt.principal.sessionExpiresAtMs;
        command = { type: "consent", ...common, reviewedBasisSha256: input.reviewedBasisSha256, sessionExpiresAtMs };
      } else if (operation === "revoke" && "consentOperationId" in input) command = { type: "revoke", ...common, consentOperationId: input.consentOperationId };
      else if (operation === "pause" && "reasonCode" in input) command = { type: "pause", ...common, reasonCode: input.reasonCode };
      else throw new Error("Closed operation parser disagrees with operation");
      const result = await appendReleaseConsentOverlay({ mode, context: attempt.context, sourceStoreId, command,
        currentBasis: attempt.currentBasis, atMs: clock() });
      return () => {
        const current = accountInspection(result.archive, attempt, clock());
        if (!result.replayed && result.receipt.disposition === "consented") check(current.currentPreconditionsMatch,
          "STALE_BASIS", "Consent freshness expired before the final transaction decision");
        return outcome(input.requestId, result);
      };
    });
  }
  async function receipt(raw: unknown, operation: "receipt" | "reconcile"): Promise<DevelopmentReleaseConsentReconciliation> {
    return run(captureInput(schemas[operation] as z.ZodType<Input>, raw), operation, async (input, attempt) => {
      const loaded = await load(attempt);
      check("expectedPhysicalStoreId" in input && input.expectedPhysicalStoreId === loaded.physicalStoreId,
        "BINDING_MISMATCH", "Receipt recovery requires the original physical source store");
      const matches = loaded.archive.records.filter(row => row.operationId === input.operationId);
      check(matches.every(row => row.receipt.actorUserId === attempt.principal.userId), "ACTOR_REFUSED", "Historical receipt recovery requires the original actor");
      // Conflicting use of an operation can retain multiple negative records;
      // never select one as proof of a successful unique outcome.
      const found = matches.length === 1 ? matches[0].receipt : null;
      return () => ({ kind: "alpha-wallet-release-consent-reconciliation-v1", ...identity(input.requestId, loaded.physicalStoreId),
        status: found ? "recorded" : "unresolved", receipt: found, executionAuthority: false, releaseAuthority: false });
    });
  }
  return Object.freeze({
    async enroll(raw: unknown): Promise<DevelopmentReleaseConsentOutcome> {
      return run(captureInput(schemas.enroll as z.ZodType<Input>, raw), "enroll", async (input, attempt) => {
        check("prepared" in input && "acknowledgeNonAuthoritativeConsent" in input, "INVALID_INPUT", "Explicit nonauthoritative enrollment is required");
        const existing = await loadReleaseConsentOverlay({ mode, context: attempt.context, sourceStoreId });
        if (existing) {
          const original = existing.archive.bootstrap;
          check(original.manifestSha256 === admission.manifestSha256 && original.enrollmentOperationId === input.operationId
            && original.enrollingOwnerId === attempt.principal.userId && walletDigest(original.initialPrepared) === walletDigest(input.prepared),
          "BINDING_MISMATCH", "Enrollment retry must preserve the exact original actor, admission, operation and preparation");
          return () => outcome(input.requestId, { ...existing, receipt: existing.archive.records[0].receipt, replayed: true });
        }
        const archive = createReleaseConsentArchive({ mode, manifest: admission.manifest, sourceStoreId,
          enrollingOwnerId: attempt.principal.userId, enrollmentOperationId: input.operationId,
          prepared: input.prepared, currentBasis: attempt.currentBasis, atMs: clock() });
        const result = await enrollReleaseConsentOverlay({ mode, context: attempt.context, archive, currentBasis: attempt.currentBasis });
        return () => outcome(input.requestId, result);
      });
    },
    observe: (raw: unknown) => mutate("observe", raw), consent: (raw: unknown) => mutate("consent", raw),
    revoke: (raw: unknown) => mutate("revoke", raw), pause: (raw: unknown) => mutate("pause", raw),
    async inspect(raw: unknown): Promise<DevelopmentReleaseConsentInspection> {
      return run(captureInput(schemas.inspect as z.ZodType<Input>, raw), "inspect", async (input, attempt) => {
        const loaded = await load(attempt);
        return () => ({ kind: "alpha-wallet-release-consent-inspection-v1", ...identity(input.requestId, loaded.physicalStoreId),
          ...accountInspection(loaded.archive, attempt, clock()) });
      });
    },
    receipt: (raw: unknown) => receipt(raw, "receipt"), reconcile: (raw: unknown) => receipt(raw, "reconcile"),
  });
}
export const createDevelopmentReleaseConsentCoordinator = (options: DevelopmentReleaseConsentOptions) => createCoordinator(options, "web");
export const createDevelopmentMobileReleaseConsentCoordinator = (options: DevelopmentReleaseConsentOptions) => createCoordinator(options, "mobile");
