import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { walletJson } from "./commands";
import { WalletIntegrityError, type DurableExecution } from "./durable";
import type { WalletSql, WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { parseV2Command, versionedCommandKey, WALLET_V2_ENGINE_VERSION, type V2Command } from "./v2-commands";
import { isV2State, type V2AcceptanceReceipt, type V2TermsBinding } from "./v2-engine";
import { createVersionedDurableWallet } from "./versioned-durable";

export type MarketplaceOperation = "inspect" | "enroll" | "accept" | "pause";
declare const contextBrand: unique symbol;
/** Opaque, same-transaction storage context. It is not user authentication. */
export type MarketplaceContext = Readonly<{ [contextBrand]: true }>;
export type MarketplaceEnrollment = {
  inputDigest: string; actorUserId: string; binding: V2TermsBinding;
  walletRevision: number; walletCommandKey: string; walletEventHash: string;
};
export type MarketplaceAcceptance = {
  inputDigest: string; actorUserId: string; receipt: V2AcceptanceReceipt;
  walletRevision: number; walletCommandKey: string; walletEventHash: string; publicationId: string;
};
type Registered = {
  tx: WalletSql; transactionId: string; requestId: string; operation: MarketplaceOperation;
  actorUserId: string; command?: V2Command;
};
type Transaction = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
type EnrollmentRow = Record<string, unknown> & {
  input_digest: string; actor_user_id: string; binding: V2TermsBinding;
  wallet_command_revision: number; wallet_command_key: string; wallet_event_hash: string;
};
type AcceptanceRow = Record<string, unknown> & {
  input_digest: string; actor_user_id: string; receipt: V2AcceptanceReceipt;
  wallet_command_revision: number; wallet_command_key: string; wallet_event_hash: string; publication_id: string;
};
const contexts = new WeakMap<object, Registered>();
const id = /^[A-Za-z0-9_-]{1,80}$/;
const digest = /^[a-f0-9]{64}$/;
const operations = new Set<MarketplaceOperation>(["inspect", "enroll", "accept", "pause"]);
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });

function check(value: unknown, message: string): asserts value {
  if (!value) throw new WalletIntegrityError(message);
}

async function transactionIdentity(tx: WalletSql, expected?: string, full = true) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<Transaction>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode`);
  assertSimulationRuntime("simulation-only");
  const current = result.rows[0];
  check(result.rows.length === 1 && typeof current?.transaction_id === "string" && /^[1-9][0-9]*$/.test(current.transaction_id),
    "Marketplace storage requires a transaction identity");
  check(expected === undefined || current.transaction_id === expected, "Marketplace storage transaction identity changed or ended");
  if (full) check(current.isolation === "serializable" && current.read_only === "off" && current.development_mode === "simulation-only",
    "Marketplace storage requires an explicit writable SERIALIZABLE simulation transaction");
  return current.transaction_id;
}

async function abortSameTransaction(tx: WalletSql, identity: string) {
  try {
    // A swallowed semantic failure must not commit previously appended money
    // or canonical facts. Never poison an unknown/replaced transaction.
    const rows = (await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
    if (rows.length === 1 && rows[0]?.transaction_id === identity) {
      await tx.query("SELECT 1 / 0 /* abort failed marketplace coordination participant */");
    }
  } catch { /* Preserve the original rejection. */ }
}

async function inContext<T, Captured = undefined>(context: MarketplaceContext,
  work: (registered: Registered, captured: Captured) => Promise<T>, capture?: () => Captured): Promise<T> {
  const registered = context && typeof context === "object" ? contexts.get(context) : undefined;
  check(registered, "A registered opaque marketplace context is required");
  try {
    // Capture before the first await, but inside the certified context's failure
    // boundary. An uncloneable input must not leave earlier work committable.
    const captured = capture?.() as Captured;
    await transactionIdentity(registered.tx, registered.transactionId);
    const result = await work(registered, captured);
    await transactionIdentity(registered.tx, registered.transactionId);
    return result;
  } catch (error) {
    await abortSameTransaction(registered.tx, registered.transactionId);
    throw error;
  }
}

/**
 * Explicit disposable DEVELOPMENT initializer. No existing namespace is reused,
 * no v1/v2 engine is changed, and no live repository invokes this function.
 * The complete pre-enrollment wallet is replayed before installing its fences.
 */
export async function initializeMarketplaceCoordination(options: {
  mode: "simulation-only"; store: WalletStore; acknowledgeDevelopmentSchema: true;
}): Promise<void> {
  assertSimulationRuntime(options.mode);
  check(options.acknowledgeDevelopmentSchema === true, "Explicit development marketplace schema acknowledgement is required");
  const schemas = ["marketplace-coordination-schema.sql", "marketplace-coordination-tables.sql", "marketplace-coordination-guards.sql"]
    .map(name => readFileSync(resolve(process.cwd(), "docs/alpha-wallet", name), "utf8"));
  await options.store.transaction(async tx => {
    let certified: string | undefined;
    try {
      const identity = await transactionIdentity(tx);
      await transactionIdentity(tx, identity);
      certified = identity;
      const existing = await tx.query("SELECT 1 FROM pg_namespace WHERE nspname='alpha_wallet_marketplace_simulation'");
      check(existing.rows.length === 0, "Marketplace coordination schema already exists; explicit fresh initialization is required");
      const snapshot = await createVersionedDurableWallet({ mode: options.mode, store: bound(tx) }).snapshot();
      check(snapshot.engineVersion === WALLET_V2_ENGINE_VERSION && isV2State(snapshot.state)
        && snapshot.state.termsBindings.size === 0 && snapshot.state.acceptanceReceipts.size === 0,
      "Marketplace coordination requires a verified v2 wallet without prior terms enrollment");
      for (const schema of schemas) await tx.exec(schema);
      await transactionIdentity(tx, identity);
    } catch (error) {
      if (certified !== undefined) await abortSameTransaction(tx, certified);
      throw error;
    }
  });
}

/** Register after canonical/auth fences, before touching the wallet head. */
export async function registerMarketplaceContext(options: {
  mode: "simulation-only"; tx: WalletSql; requestId: string; operation: MarketplaceOperation; actorUserId: string;
}): Promise<MarketplaceContext> {
  // Preserve the handle that will be certified as well as the scalar identity.
  // Caller mutation after an await must not redirect either writes or cleanup.
  const { mode, tx, requestId, operation, actorUserId } = options;
  assertSimulationRuntime(mode);
  let certified: string | undefined;
  try {
    const transactionId = await transactionIdentity(tx);
    await transactionIdentity(tx, transactionId);
    certified = transactionId;
    check(typeof requestId === "string" && id.test(requestId)
      && typeof actorUserId === "string" && id.test(actorUserId) && operations.has(operation),
    "Invalid marketplace context identity or operation");
    await tx.query(`INSERT INTO alpha_wallet_marketplace_simulation.transaction_contexts
      (transaction_id,request_id,operation,actor_user_id) VALUES ($1,$2,$3,$4)`,
    [transactionId, requestId, operation, actorUserId]);
    await transactionIdentity(tx, transactionId);
    const context = Object.freeze({}) as MarketplaceContext;
    contexts.set(context, { tx, transactionId, requestId, operation, actorUserId });
    return context;
  } catch (error) {
    if (certified !== undefined) await abortSameTransaction(tx, certified);
    throw error;
  }
}

/** Binding a plan cannot execute it or confer marketplace/account authority. */
export async function bindMarketplaceCommand(context: MarketplaceContext, input: V2Command): Promise<void> {
  await inContext<void, V2Command>(context, async (registered, command) => {
    const expected = { enroll: "enrollReservedTrade", accept: "acceptAmountCorrection", pause: "pause", inspect: null }[registered.operation];
    check(!registered.command && expected !== null && command.type === expected
      && command.actor.id === registered.actorUserId
      && command.actor.kind === (registered.operation === "accept" ? "buyer" : "operator"),
    "Marketplace context may bind one exact supported actor command");
    if (command.type === "enrollReservedTrade") check(command.input.terms.platformRequestId === registered.requestId,
      "Enrollment command targets another canonical request");
    if (command.type === "acceptAmountCorrection") check(command.input.platformRequestId === registered.requestId,
      "Acceptance command targets another canonical request");
    const result = await registered.tx.query(`UPDATE alpha_wallet_marketplace_simulation.transaction_contexts
      SET planned_command=$2::jsonb,planned_command_key=$3 WHERE transaction_id=$1 AND planned_command IS NULL RETURNING transaction_id`,
    [registered.transactionId, JSON.stringify(walletJson(command)), versionedCommandKey(command)]);
    check(result.rows.length === 1, "Marketplace context was already bound or is missing");
    registered.command = command;
  }, () => parseV2Command(structuredClone(input)));
}

function enrollment(row: EnrollmentRow): MarketplaceEnrollment {
  return structuredClone({ inputDigest: row.input_digest, actorUserId: row.actor_user_id, binding: row.binding,
    walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key, walletEventHash: row.wallet_event_hash });
}
function acceptance(row: AcceptanceRow): MarketplaceAcceptance {
  return structuredClone({ inputDigest: row.input_digest, actorUserId: row.actor_user_id, receipt: row.receipt,
    walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key,
    walletEventHash: row.wallet_event_hash, publicationId: row.publication_id });
}

export async function readMarketplaceEnrollment(context: MarketplaceContext): Promise<MarketplaceEnrollment | null> {
  return inContext(context, async registered => {
    const result = await registered.tx.query<EnrollmentRow>("SELECT * FROM alpha_wallet_marketplace_simulation.enrollments WHERE request_id=$1", [registered.requestId]);
    check(result.rows.length <= 1, "Duplicate marketplace enrollment identity");
    return result.rows.length ? enrollment(result.rows[0]) : null;
  });
}

export async function readMarketplaceAcceptance(context: MarketplaceContext, proposalId: string): Promise<MarketplaceAcceptance | null> {
  return inContext(context, async registered => {
    check(typeof proposalId === "string" && id.test(proposalId), "Invalid marketplace proposal identity");
    const result = await registered.tx.query<AcceptanceRow>(`SELECT * FROM alpha_wallet_marketplace_simulation.acceptances
      WHERE request_id=$1 AND proposal_id=$2`, [registered.requestId, proposalId]);
    check(result.rows.length <= 1, "Duplicate marketplace acceptance identity");
    return result.rows.length ? acceptance(result.rows[0]) : null;
  });
}

function newExecution(registered: Registered, inputDigest: string, execution: DurableExecution) {
  check(typeof inputDigest === "string" && digest.test(inputDigest), "Invalid public marketplace input digest");
  check(registered.command && execution.replayed === false && Number.isSafeInteger(execution.revision) && execution.revision > 0
    && execution.commandKey === versionedCommandKey(registered.command) && digest.test(execution.eventHash),
  "New marketplace records require the exact newly executed wallet command");
}

export async function insertMarketplaceEnrollment(context: MarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V2TermsBinding>;
}): Promise<MarketplaceEnrollment> {
  return inContext<MarketplaceEnrollment, typeof options>(context, async (registered, copy) => {
    check(registered.operation === "enroll", "Enrollment needs an enrollment context");
    newExecution(registered, copy.inputDigest, copy.execution);
    const { execution } = copy, binding = execution.result;
    check(binding && binding.platformRequestId === registered.requestId, "Enrollment result targets another request");
    const result = await registered.tx.query<EnrollmentRow>(`INSERT INTO alpha_wallet_marketplace_simulation.enrollments
      (request_id,platform_listing_id,platform_trade_id,wallet_listing_id,wallet_trade_id,buyer_id,seller_id,asset_id,
       actor_user_id,input_digest,wallet_command_revision,wallet_command_key,wallet_event_hash,binding)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
    [registered.requestId, binding.platformListingId, binding.terms.platformTradeId, binding.walletListingId,
      binding.walletTradeId, binding.terms.buyerId, binding.terms.sellerId, binding.assetId, registered.actorUserId,
      copy.inputDigest, execution.revision, execution.commandKey, execution.eventHash, JSON.stringify(walletJson(binding))]);
    // The enrollment SQL trigger also physically versions the canonical listing,
    // all sibling requests, and runtime_meta to fence pre-activation snapshots.
    check(result.rows.length === 1, "Marketplace enrollment was not appended");
    return enrollment(result.rows[0]);
  }, () => structuredClone(options));
}

export async function insertMarketplaceAcceptance(context: MarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V2AcceptanceReceipt>;
  publication: { notificationIds: string[]; auditId: string; messageId: string };
}): Promise<MarketplaceAcceptance> {
  return inContext<MarketplaceAcceptance, typeof options>(context, async (registered, copy) => {
    check(registered.operation === "accept", "Acceptance needs an acceptance context");
    newExecution(registered, copy.inputDigest, copy.execution);
    const { execution, publication } = copy, receipt = execution.result;
    check(receipt && receipt.platformRequestId === registered.requestId && digest.test(receipt.acceptanceKey),
      "Acceptance result targets another request");
    check(publication.notificationIds.length === 1 && publication.notificationIds[0] === `wallet-notification-${receipt.acceptanceKey}`
      && publication.auditId === `wallet-audit-${receipt.acceptanceKey}` && publication.messageId === `wallet-message-${receipt.acceptanceKey}`,
    "Marketplace publication identities must be deterministic acceptance identities");
    const publicationId = `wallet-publication-${receipt.acceptanceKey}`;
    const result = await registered.tx.query<AcceptanceRow>(`INSERT INTO alpha_wallet_marketplace_simulation.acceptances
      (acceptance_key,request_id,proposal_id,actor_user_id,input_digest,wallet_command_revision,
       wallet_command_key,wallet_event_hash,receipt,publication_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
    [receipt.acceptanceKey, registered.requestId, receipt.proposalId, registered.actorUserId, copy.inputDigest,
      execution.revision, execution.commandKey, execution.eventHash, JSON.stringify(walletJson(receipt)), publicationId]);
    await registered.tx.query(`INSERT INTO alpha_wallet_marketplace_simulation.publications (id,acceptance_key,payload)
      VALUES ($1,$2,alpha_wallet_marketplace_simulation.publication_payload($2))`, [publicationId, receipt.acceptanceKey]);
    check(result.rows.length === 1, "Marketplace acceptance was not appended");
    return acceptance(result.rows[0]);
  }, () => structuredClone(options));
}

/** Call after actual focused persistence; deferred SQL repeats it at commit. */
export async function assertMarketplaceCoherence(context: MarketplaceContext): Promise<void> {
  await inContext(context, async registered => {
    await registered.tx.query("SELECT alpha_wallet_marketplace_simulation.assert_coherence()");
  });
}
