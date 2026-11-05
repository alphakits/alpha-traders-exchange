import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DevelopmentPrepaymentCancellationResult } from "./prepayment-cancellation";
import { walletDigest, walletJson } from "./commands";
import { WalletIntegrityError, type DurableExecution } from "./durable";
import type { WalletSql } from "./durable-store";
import { assertInitialMarketplaceCoherence, registerInitialMarketplaceContext,
  type InitialMarketplaceAcceptance, type InitialMarketplaceActivation,
  type InitialMarketplaceContext } from "./initial-marketplace-coordination-store";
import { assertSimulationRuntime } from "./runtime";
import type { V2Checkpoint } from "./v2-commands";
import { parseV4Command, v4CommandKey, type V4Command } from "./v4-commands";
import type { V4Continuation, V4InitialCancellationReceipt } from "./v4-engine";

export const CANCELLATION_MARKETPLACE_PROFILE = "canonical-initial-cancellation-cohort-v1" as const;
export type CancellationMarketplaceOperation = "upgrade" | "cancel" | "inspect" | "pause" | "export";
declare const contextBrand: unique symbol;
/** A capability for one certified physical transaction. It is not account authority. */
export type CancellationMarketplaceContext = Readonly<{ [contextBrand]: true }>;
type CanonicalRow = Record<string, unknown> & { payload: Record<string, unknown> };
export type CancellationMarketplaceCanonicalBasis = {
  request: CanonicalRow; listing: CanonicalRow; trade: CanonicalRow; reminders: CanonicalRow[]; actorRole: string;
};
export type CancellationMarketplaceTransition = {
  requestId: string; profile: typeof CANCELLATION_MARKETPLACE_PROFILE; actorUserId: string; inputDigest: string;
  walletCheckpoint: V2Checkpoint; walletRevision: number; walletCommandKey: string; walletEventHash: string;
  continuation: V4Continuation; predecessor: Record<string, unknown>;
};
/** Private storage evidence; only explicit safe receipt DTOs may be published. */
export type CancellationMarketplaceCancellation = {
  actorUserId: string; actorKind: "buyer" | "seller"; inputDigest: string;
  receipt: V4InitialCancellationReceipt; walletRevision: number; walletCommandKey: string; walletEventHash: string;
  publicationId: string; canonicalBasis: CancellationMarketplaceCanonicalBasis; canonical: DevelopmentPrepaymentCancellationResult;
};
type Registered = {
  tx: WalletSql; transactionId: string; requestId: string; operation: CancellationMarketplaceOperation; actorUserId: string;
  phase: "predecessor" | "successor"; predecessorContext?: InitialMarketplaceContext; command?: V4Command;
};
export type CancellationMarketplaceTransaction = Readonly<Omit<Registered, "predecessorContext">>;
type Row = Record<string, unknown>;
type ContextRow = Row & { transaction_id: string; request_id: string; operation: string; actor_user_id: string;
  planned_command: V4Command | null; planned_command_key: string | null };
type TransactionRow = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
const contexts = new WeakMap<object, Registered>();
const identity = /^[A-Za-z0-9_-]{1,80}$/;
const digest = /^[a-f0-9]{64}$/;
const operations = new Set<CancellationMarketplaceOperation>(["upgrade", "cancel", "inspect", "pause", "export"]);
const sql = (name: string) => readFileSync(resolve(process.cwd(), "docs/alpha-wallet", name), "utf8");
function check(value: unknown, message: string): asserts value { if (!value) throw new WalletIntegrityError(message); }
async function transactionIdentity(tx: Pick<WalletSql, "query">, expected?: string) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<TransactionRow>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema',true) AS development_mode`);
  assertSimulationRuntime("simulation-only");
  const row = result.rows[0];
  check(result.rows.length === 1 && typeof row?.transaction_id === "string" && /^[1-9][0-9]*$/.test(row.transaction_id),
    "Cancellation marketplace requires a physical transaction identity");
  check(expected === undefined || row.transaction_id === expected, "Cancellation marketplace transaction identity changed or ended");
  check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only",
    "Cancellation marketplace requires an explicit writable SERIALIZABLE simulation transaction");
  return row.transaction_id;
}
async function abortSameTransaction(registered: Pick<Registered, "tx" | "transactionId">) {
  try {
    const actual = await registered.tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
    if (actual.rows.length === 1 && actual.rows[0]?.transaction_id === registered.transactionId) {
      await registered.tx.query("SELECT 1 / 0 /* abort failed cancellation marketplace participant */");
    }
  } catch { /* Preserve the initiating refusal; a replacement transaction is never poisoned. */ }
}
async function assertRegistration(registered: Registered) {
  await transactionIdentity(registered.tx, registered.transactionId);
  const namespace = registered.phase === "predecessor" ? "alpha_wallet_initial_marketplace_simulation"
    : "alpha_wallet_cancellation_marketplace_simulation";
  const rows = (await registered.tx.query<ContextRow>(`SELECT transaction_id,request_id,operation,actor_user_id,
    planned_command,planned_command_key FROM ${namespace}.transaction_contexts WHERE transaction_id=$1`, [registered.transactionId])).rows;
  const row = rows[0], command = registered.phase === "successor" ? registered.command : undefined;
  check(rows.length === 1 && row.request_id === registered.requestId && row.actor_user_id === registered.actorUserId
    && row.operation === (registered.phase === "predecessor" ? "inspect" : registered.operation)
    && (command ? walletDigest(row.planned_command) === walletDigest(command) && row.planned_command_key === v4CommandKey(command)
      : row.planned_command === null && row.planned_command_key === null),
  "Cancellation marketplace capability differs from its immutable same-transaction registration");
}
async function inContext<T, Captured = undefined>(context: CancellationMarketplaceContext,
  work: (registered: Registered, captured: Captured) => Promise<T>, capture?: () => Captured): Promise<T> {
  const registered = context && typeof context === "object" ? contexts.get(context) : undefined;
  check(registered, "A registered opaque cancellation marketplace context is required");
  try {
    const captured = capture?.() as Captured;
    await assertRegistration(registered);
    const result = await work(registered, captured);
    await assertRegistration(registered);
    return result;
  } catch (error) { await abortSameTransaction(registered); throw error; }
}

/** No transaction factory, caller flag, or account claims can create this capability. */
export async function registerCancellationMarketplaceContext(options: {
  mode: "simulation-only"; tx: WalletSql; requestId: string; operation: CancellationMarketplaceOperation; actorUserId: string;
}): Promise<CancellationMarketplaceContext> {
  const { mode, tx, requestId, operation, actorUserId } = options;
  assertSimulationRuntime(mode);
  let certified: string | undefined;
  try {
    const transactionId = await transactionIdentity(tx);
    await transactionIdentity(tx, transactionId);
    certified = transactionId;
    check(typeof requestId === "string" && identity.test(requestId) && typeof actorUserId === "string"
      && identity.test(actorUserId) && operations.has(operation), "Invalid cancellation marketplace context identity or operation");
    const status = (await tx.query<{ predecessor: boolean; successor: boolean; correction: boolean; recovered_predecessor: boolean }>(`SELECT
      to_regnamespace('alpha_wallet_initial_marketplace_simulation') IS NOT NULL AS predecessor,
      to_regnamespace('alpha_wallet_cancellation_marketplace_simulation') IS NOT NULL AS successor,
      to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL AS correction,
      to_regclass('alpha_wallet_initial_marketplace_simulation.recovery_receipts') IS NOT NULL AS recovered_predecessor`)).rows[0];
    check(status?.predecessor && !status.correction && !status.recovered_predecessor,
      "Cancellation marketplace requires the original initial cohort and refuses correction or restored predecessor authority");
    const registered: Registered = { tx, transactionId, requestId, operation, actorUserId,
      phase: status.successor ? "successor" : "predecessor" };
    if (!status.successor) {
      check(operation === "upgrade", "An explicit owner cancellation-profile upgrade is required");
      registered.predecessorContext = await registerInitialMarketplaceContext({ mode, tx, requestId, operation: "inspect", actorUserId });
      await assertInitialMarketplaceCoherence(registered.predecessorContext);
      const counts = (await tx.query<{ activations: string; acceptances: string; publications: string; accepted: boolean }>(`SELECT
        (SELECT count(*)::text FROM alpha_wallet_initial_marketplace_simulation.activations) AS activations,
        (SELECT count(*)::text FROM alpha_wallet_initial_marketplace_simulation.acceptances) AS acceptances,
        (SELECT count(*)::text FROM alpha_wallet_initial_marketplace_simulation.publications) AS publications,
        EXISTS(SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.acceptances a
          JOIN alpha_exchange.purchase_requests r ON r.id=a.request_id WHERE a.request_id=$1 AND r.status='accepted') AS accepted`, [requestId])).rows[0];
      check(counts?.activations === "1" && counts.acceptances === "1" && counts.publications === "1" && counts.accepted,
        "Cancellation upgrade requires exactly one coherent accepted initial mapping");
    } else {
      await tx.query(`INSERT INTO alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
        (transaction_id,request_id,operation,actor_user_id) VALUES ($1,$2,$3,$4)`, [transactionId, requestId, operation, actorUserId]);
    }
    await assertRegistration(registered);
    const context = Object.freeze({}) as CancellationMarketplaceContext;
    contexts.set(context, registered);
    return context;
  } catch (error) { if (certified !== undefined) await abortSameTransaction({ tx, transactionId: certified }); throw error; }
}

export async function assertCancellationMarketplaceContext(context: CancellationMarketplaceContext, expected: {
  tx: Pick<WalletSql, "query">; requestId: string; operation: CancellationMarketplaceOperation; actorUserId?: string;
}): Promise<void> {
  await inContext(context, async (registered, captured) => {
    check(registered.tx === captured.tx && registered.requestId === captured.requestId && registered.operation === captured.operation
      && (captured.actorUserId === undefined || registered.actorUserId === captured.actorUserId),
    "Cancellation marketplace capability does not authorize this participant identity or operation");
  }, () => ({ ...expected }));
}

/** Internal participants retain the exact certified owner; no nested transaction is opened. */
export async function withCancellationMarketplaceContext<T>(context: CancellationMarketplaceContext,
  work: (registered: CancellationMarketplaceTransaction) => Promise<T>): Promise<T> {
  return inContext(context, registered => work(Object.freeze({ tx: registered.tx, transactionId: registered.transactionId,
    requestId: registered.requestId, operation: registered.operation, actorUserId: registered.actorUserId,
    phase: registered.phase, ...(registered.command ? { command: structuredClone(registered.command) } : {}) })));
}

export async function bindCancellationMarketplaceCommand(context: CancellationMarketplaceContext, input: V4Command): Promise<void> {
  await inContext(context, async (registered, command) => {
    const expected = { upgrade: "continueFromV3", cancel: "cancelInitialTrade", pause: "pause", inspect: null, export: null }[registered.operation];
    check(!registered.command && expected !== null && command.type === expected && command.actor.id === registered.actorUserId,
      "Cancellation marketplace context may bind one exact supported actor command");
    if (command.type === "cancelInitialTrade") {
      check(command.input.terms.platformRequestId === registered.requestId && ["buyer", "seller"].includes(command.actor.kind),
        "Cancellation command targets another request or unsupported actor");
    } else check(command.actor.kind === "operator", "Cancellation profile continuation and pause require the registered operator");
    if (registered.phase === "successor") {
      const result = await registered.tx.query(`UPDATE alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
        SET planned_command=$2::jsonb,planned_command_key=$3 WHERE transaction_id=$1 AND planned_command IS NULL RETURNING transaction_id`,
      [registered.transactionId, JSON.stringify(walletJson(command)), v4CommandKey(command)]);
      check(result.rows.length === 1, "Cancellation marketplace context was already bound or is missing");
    } else check(registered.operation === "upgrade" && command.type === "continueFromV3", "Only explicit upgrade may bind the predecessor context");
    registered.command = command;
  }, () => parseV4Command(structuredClone(input)));
}

/** Used only after original deferred constraints have been flushed by the V4 upgrader. */
export async function prepareCancellationMarketplaceUpgrade(context: CancellationMarketplaceContext): Promise<void> {
  await inContext(context, async registered => {
    check(registered.phase === "predecessor" && registered.operation === "upgrade"
      && registered.command?.type === "continueFromV3" && registered.predecessorContext,
    "Cancellation schema installation requires its bound original predecessor upgrade");
    await assertInitialMarketplaceCoherence(registered.predecessorContext);
    await registered.tx.exec(sql("cancellation-marketplace-tables.sql"));
    await registered.tx.query(`INSERT INTO alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
      (transaction_id,request_id,operation,actor_user_id,planned_command,planned_command_key)
      VALUES ($1,$2,'upgrade',$3,$4::jsonb,$5)`, [registered.transactionId, registered.requestId, registered.actorUserId,
      JSON.stringify(walletJson(registered.command)), v4CommandKey(registered.command)]);
    registered.phase = "successor";
  });
}

/** Recovery installs exact immutable rows first; this adds the reviewed successor fences. */
export async function installCancellationMarketplaceGuards(tx: WalletSql): Promise<void> {
  await tx.exec(sql("cancellation-marketplace-guards.sql"));
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol','simulation-v4-cancellation',true)");
}

function activation(row: Row): InitialMarketplaceActivation {
  return structuredClone({ requestId: row.request_id, platformListingId: row.platform_listing_id, platformTradeId: row.platform_trade_id,
    walletListingId: row.wallet_listing_id, walletTradeId: row.wallet_trade_id, buyerId: row.buyer_id, sellerId: row.seller_id,
    assetId: row.asset_id, actorUserId: row.actor_user_id, inputDigest: row.input_digest,
    walletCheckpoint: row.wallet_checkpoint, canonicalBasis: row.canonical_basis }) as InitialMarketplaceActivation;
}
function acceptance(row: Row): InitialMarketplaceAcceptance {
  return structuredClone({ inputDigest: row.input_digest, actorUserId: row.actor_user_id, receipt: row.receipt,
    walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key, walletEventHash: row.wallet_event_hash,
    publicationId: row.publication_id, canonical: row.canonical_result }) as InitialMarketplaceAcceptance;
}
export async function readCancellationMarketplacePredecessor(context: CancellationMarketplaceContext) {
  return inContext(context, async registered => {
    const result = await registered.tx.query<{ activation: Row; acceptance: Row; publication: Row }>(`SELECT
      to_jsonb(v) AS activation,to_jsonb(a) AS acceptance,to_jsonb(p) AS publication
      FROM alpha_wallet_initial_marketplace_simulation.activations v
      JOIN alpha_wallet_initial_marketplace_simulation.acceptances a ON a.request_id=v.request_id
      JOIN alpha_wallet_initial_marketplace_simulation.publications p ON p.acceptance_key=a.acceptance_key WHERE v.request_id=$1`, [registered.requestId]);
    check(result.rows.length === 1, "One exact immutable initial predecessor is required");
    const row = result.rows[0];
    return { activation: activation(row.activation), acceptance: acceptance(row.acceptance),
      publication: structuredClone({ id: row.publication.id as string, acceptanceKey: row.publication.acceptance_key as string,
        payload: row.publication.payload as Record<string, unknown> }) };
  });
}
function transition(row: Row): CancellationMarketplaceTransition {
  return structuredClone({ requestId: row.request_id, profile: row.profile, actorUserId: row.actor_user_id, inputDigest: row.input_digest,
    walletCheckpoint: row.wallet_checkpoint, walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key,
    walletEventHash: row.wallet_event_hash, continuation: row.continuation, predecessor: row.predecessor }) as CancellationMarketplaceTransition;
}
function cancellation(row: Row): CancellationMarketplaceCancellation {
  return structuredClone({ actorUserId: row.actor_user_id, actorKind: row.actor_kind, inputDigest: row.input_digest, receipt: row.receipt,
    walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key, walletEventHash: row.wallet_event_hash,
    publicationId: row.publication_id, canonicalBasis: row.canonical_basis, canonical: row.canonical_result }) as CancellationMarketplaceCancellation;
}
export async function readCancellationMarketplaceTransition(context: CancellationMarketplaceContext): Promise<CancellationMarketplaceTransition | null> {
  return inContext(context, async registered => {
    if (registered.phase === "predecessor") return null;
    const rows = (await registered.tx.query<Row>("SELECT * FROM alpha_wallet_cancellation_marketplace_simulation.transitions WHERE request_id=$1", [registered.requestId])).rows;
    check(rows.length <= 1, "Duplicate cancellation marketplace transition");
    return rows.length ? transition(rows[0]) : null;
  });
}
export async function insertCancellationMarketplaceTransition(context: CancellationMarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V4Continuation>;
}): Promise<CancellationMarketplaceTransition> {
  return inContext(context, async (registered, copy) => {
    const { execution } = copy, result = execution.result;
    check(registered.phase === "successor" && registered.operation === "upgrade" && registered.command?.type === "continueFromV3"
      && execution.replayed === false && execution.commandKey === v4CommandKey(registered.command)
      && result?.commandRevision === execution.revision && result.commandKey === execution.commandKey
      && digest.test(execution.eventHash) && copy.inputDigest === walletDigest({ kind: "alpha-wallet-initial-cancellation-upgrade-v1",
        actorUserId: registered.actorUserId, requestId: registered.requestId }), "Cancellation transition requires its exact new owner continuation");
    const rows = (await registered.tx.query<Row>(`INSERT INTO alpha_wallet_cancellation_marketplace_simulation.transitions
      (request_id,profile,actor_user_id,input_digest,wallet_checkpoint,wallet_command_revision,wallet_command_key,wallet_event_hash,continuation,predecessor)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,alpha_wallet_cancellation_marketplace_simulation.capture_predecessor($1)) RETURNING *`,
    [registered.requestId, CANCELLATION_MARKETPLACE_PROFILE, registered.actorUserId, copy.inputDigest, JSON.stringify(result.checkpoint),
      execution.revision, execution.commandKey, execution.eventHash, JSON.stringify(walletJson(result))])).rows;
    check(rows.length === 1, "Cancellation marketplace transition was not appended");
    return transition(rows[0]);
  }, () => structuredClone(options));
}
export async function readCancellationMarketplaceCancellation(context: CancellationMarketplaceContext): Promise<CancellationMarketplaceCancellation | null> {
  return inContext(context, async registered => {
    if (registered.phase === "predecessor") return null;
    const rows = (await registered.tx.query<Row>("SELECT * FROM alpha_wallet_cancellation_marketplace_simulation.cancellations WHERE request_id=$1", [registered.requestId])).rows;
    check(rows.length <= 1, "Duplicate cancellation marketplace receipt");
    return rows.length ? cancellation(rows[0]) : null;
  });
}
export async function insertCancellationMarketplaceCancellation(context: CancellationMarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V4InitialCancellationReceipt>; canonical: DevelopmentPrepaymentCancellationResult;
}): Promise<CancellationMarketplaceCancellation> {
  return inContext(context, async (registered, copy) => {
    const { execution, canonical } = copy, receipt = execution.result;
    check(registered.operation === "cancel" && registered.command?.type === "cancelInitialTrade" && execution.replayed === false
      && execution.commandKey === v4CommandKey(registered.command) && receipt?.commandRevision === execution.revision
      && receipt.commandKey === execution.commandKey && receipt.platformRequestId === registered.requestId
      && receipt.actorUserId === registered.actorUserId && digest.test(receipt.cancellationKey) && digest.test(execution.eventHash)
      && copy.inputDigest === walletDigest({ kind: "alpha-wallet-initial-cancellation-request-v1", actorUserId: registered.actorUserId,
        requestId: registered.requestId }) && canonical?.request?.id === registered.requestId && canonical.request.status === "cancelled",
    "Cancellation marketplace receipt requires the exact new financial command and canonical cancellation");
    const publicationId = `cancellation-wallet-publication-${receipt.cancellationKey}`;
    const rows = (await registered.tx.query<Row>(`INSERT INTO alpha_wallet_cancellation_marketplace_simulation.cancellations
      (cancellation_key,request_id,actor_user_id,actor_kind,input_digest,wallet_command_revision,wallet_command_key,wallet_event_hash,
       receipt,publication_id,canonical_basis,canonical_result)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,canonical_basis,$11::jsonb
      FROM alpha_wallet_cancellation_marketplace_simulation.transaction_contexts WHERE transaction_id=$12 RETURNING *`,
    [receipt.cancellationKey, registered.requestId, registered.actorUserId, receipt.actorKind, copy.inputDigest, execution.revision,
      execution.commandKey, execution.eventHash, JSON.stringify(walletJson(receipt)), publicationId, JSON.stringify(canonical), registered.transactionId])).rows;
    check(rows.length === 1, "Cancellation marketplace receipt was not appended");
    await registered.tx.query(`INSERT INTO alpha_wallet_cancellation_marketplace_simulation.publications (id,cancellation_key,payload)
      VALUES ($1,$2,alpha_wallet_cancellation_marketplace_simulation.publication_payload($2))`, [publicationId, receipt.cancellationKey]);
    return cancellation(rows[0]);
  }, () => structuredClone(options));
}
export async function assertCancellationMarketplaceCoherence(context: CancellationMarketplaceContext): Promise<void> {
  await inContext(context, async registered => {
    check(registered.phase === "successor", "An explicit cancellation profile transition must commit before returning");
    await registered.tx.query("SELECT alpha_wallet_cancellation_marketplace_simulation.assert_coherence()");
  });
}
