import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DevelopmentInitialAcceptanceResult } from "@/lib/alpha-exchange-repository";
import type { AssetId } from "./amounts";
import { walletDigest, walletJson } from "./commands";
import { WalletIntegrityError, type DurableExecution } from "./durable";
import type { WalletSql, WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { v2CheckpointSchema, type V2Checkpoint } from "./v2-commands";
import { parseV3Command, v3CommandKey, type V3Command } from "./v3-commands";
import { createV3DurableWallet } from "./v3-durable";
import { isV3State, type V3InitialAcceptanceReceipt } from "./v3-engine";

export type InitialMarketplaceOperation = "activate" | "accept" | "inspect" | "pause";
declare const contextBrand: unique symbol;
/** A same-transaction storage capability; it never authenticates an account. */
export type InitialMarketplaceContext = Readonly<{ [contextBrand]: true }>;
export type InitialMarketplaceMapping = { assetId: AssetId; walletListingId: string; walletTradeId: string };
type CanonicalRow = Record<string, unknown> & { payload: Record<string, unknown> };
export type InitialMarketplaceCanonicalBasis = {
  request: CanonicalRow; listing: CanonicalRow; trade: CanonicalRow | null; siblings: CanonicalRow[];
};
/** Private storage evidence. Never include canonicalBasis in a public receipt. */
export type InitialMarketplaceActivation = InitialMarketplaceMapping & {
  requestId: string; platformListingId: string; platformTradeId: string; buyerId: string; sellerId: string;
  actorUserId: string; inputDigest: string; walletCheckpoint: V2Checkpoint;
  canonicalBasis: InitialMarketplaceCanonicalBasis;
};
/** Private receipt; the command descriptor and canonical data are not public DTOs. */
export type InitialMarketplaceAcceptance = {
  inputDigest: string; actorUserId: string; receipt: V3InitialAcceptanceReceipt;
  walletRevision: number; walletCommandKey: string; walletEventHash: string; publicationId: string;
  canonical: DevelopmentInitialAcceptanceResult;
};
type Registered = {
  tx: WalletSql; transactionId: string; requestId: string; operation: InitialMarketplaceOperation;
  actorUserId: string; command?: V3Command;
};
type Transaction = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
type ActivationRow = Record<string, unknown> & {
  request_id: string; platform_listing_id: string; platform_trade_id: string; wallet_listing_id: string; wallet_trade_id: string;
  buyer_id: string; seller_id: string; asset_id: AssetId; actor_user_id: string; input_digest: string;
  wallet_checkpoint: V2Checkpoint; canonical_basis: InitialMarketplaceCanonicalBasis;
};
type AcceptanceRow = Record<string, unknown> & {
  input_digest: string; actor_user_id: string; receipt: V3InitialAcceptanceReceipt;
  wallet_command_revision: number; wallet_command_key: string; wallet_event_hash: string; publication_id: string;
  canonical_result: DevelopmentInitialAcceptanceResult;
};
const contexts = new WeakMap<object, Registered>();
const id = /^[A-Za-z0-9_-]{1,80}$/;
const digest = /^[a-f0-9]{64}$/;
const operations = new Set<InitialMarketplaceOperation>(["activate", "accept", "inspect", "pause"]);
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });

function check(value: unknown, message: string): asserts value {
  if (!value) throw new WalletIntegrityError(message);
}
async function transactionIdentity(tx: WalletSql, expected?: string) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<Transaction>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode`);
  assertSimulationRuntime("simulation-only");
  const current = result.rows[0];
  check(result.rows.length === 1 && typeof current?.transaction_id === "string" && /^[1-9][0-9]*$/.test(current.transaction_id),
    "Initial marketplace storage requires a transaction identity");
  check(expected === undefined || current.transaction_id === expected, "Initial marketplace transaction identity changed or ended");
  check(current.isolation === "serializable" && current.read_only === "off" && current.development_mode === "simulation-only",
    "Initial marketplace storage requires an explicit writable SERIALIZABLE simulation transaction");
  return current.transaction_id;
}
async function abortSameTransaction(tx: WalletSql, identity: string) {
  try {
    // Runtime refusal is itself a reason to abort. Cleanup must not invoke that
    // guard again and thereby allow earlier financial work to survive a catch.
    const actual = await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
    if (actual.rows.length === 1 && actual.rows[0]?.transaction_id === identity) {
      await tx.query("SELECT 1 / 0 /* abort failed initial marketplace coordination participant */");
    }
  } catch { /* Preserve the original rejection; never poison a foreign transaction. */ }
}
async function inContext<T, Captured = undefined>(context: InitialMarketplaceContext,
  work: (registered: Registered, captured: Captured) => Promise<T>, capture?: () => Captured): Promise<T> {
  const registered = context && typeof context === "object" ? contexts.get(context) : undefined;
  check(registered, "A registered opaque initial marketplace context is required");
  try {
    // Copy/parse before the first await, inside the certified context's failure
    // boundary: caller mutation cannot race validation, and clone errors abort.
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
 * Explicit disposable DEVELOPMENT initialization, never a registered production
 * migration or automatic upgrade. The existing correction cohort is incompatible.
 * No backup/restore format includes this namespace yet; old exports fail closed.
 */
export async function initializeInitialMarketplaceCoordination(options: {
  mode: "simulation-only"; store: WalletStore; acknowledgeDevelopmentSchema: true;
}): Promise<void> {
  assertSimulationRuntime(options.mode);
  check(options.acknowledgeDevelopmentSchema === true, "Explicit initial marketplace schema acknowledgement is required");
  const schemas = ["initial-marketplace-schema.sql", "initial-marketplace-tables.sql", "initial-marketplace-guards.sql"]
    .map(name => readFileSync(resolve(process.cwd(), "docs/alpha-wallet", name), "utf8"));
  await options.store.transaction(async tx => {
    let certified: string | undefined;
    try {
      const identity = await transactionIdentity(tx);
      await transactionIdentity(tx, identity);
      certified = identity;
      const existing = await tx.query(`SELECT nspname FROM pg_namespace
        WHERE nspname IN ('alpha_wallet_marketplace_simulation','alpha_wallet_initial_marketplace_simulation')`);
      check(existing.rows.length === 0, "Initial marketplace requires a fresh namespace and refuses every existing coordination namespace");
      const snapshot = await createV3DurableWallet({ mode: options.mode, store: bound(tx) }).snapshot();
      check(isV3State(snapshot.state) && snapshot.state.initialBindings.size === 0 && snapshot.state.initialAcceptanceReceipts.size === 0,
        "Initial marketplace requires a verified v3 wallet without prior initial acceptance");
      check(snapshot.state.haltReason === null && [...snapshot.state.payouts.values()].every(payout => ["confirmed", "failed_final"].includes(payout.state)),
        "Initial marketplace requires an unpaused wallet without unfinished payouts");
      for (const schema of schemas) await tx.exec(schema);
      await transactionIdentity(tx, identity);
    } catch (error) {
      if (certified !== undefined) await abortSameTransaction(tx, certified);
      throw error;
    }
  });
}

/** Register only after the canonical fences and freshly locked stored authority. */
export async function registerInitialMarketplaceContext(options: {
  mode: "simulation-only"; tx: WalletSql; requestId: string; operation: InitialMarketplaceOperation; actorUserId: string;
}): Promise<InitialMarketplaceContext> {
  assertSimulationRuntime(options.mode);
  let certified: string | undefined;
  try {
    const transactionId = await transactionIdentity(options.tx);
    await transactionIdentity(options.tx, transactionId);
    certified = transactionId;
    check(typeof options.requestId === "string" && id.test(options.requestId)
      && typeof options.actorUserId === "string" && id.test(options.actorUserId) && operations.has(options.operation),
    "Invalid initial marketplace context identity or operation");
    await options.tx.query(`INSERT INTO alpha_wallet_initial_marketplace_simulation.transaction_contexts
      (transaction_id,request_id,operation,actor_user_id) VALUES ($1,$2,$3,$4)`,
    [transactionId, options.requestId, options.operation, options.actorUserId]);
    await transactionIdentity(options.tx, transactionId);
    const context = Object.freeze({}) as InitialMarketplaceContext;
    contexts.set(context, { tx: options.tx, transactionId, requestId: options.requestId,
      operation: options.operation, actorUserId: options.actorUserId });
    return context;
  } catch (error) {
    if (certified !== undefined) await abortSameTransaction(options.tx, certified);
    throw error;
  }
}

export async function bindInitialMarketplaceCommand(context: InitialMarketplaceContext, input: V3Command): Promise<void> {
  // Validate inside the certified scope: even a caught malformed command must
  // poison a transaction that may already have changed canonical or wallet rows.
  await inContext(context, async (registered, command) => {
    const expected = { activate: null, accept: "acceptInitialSellerRequest", pause: "pause", inspect: null }[registered.operation];
    check(!registered.command && expected !== null && command.type === expected
      && command.actor.id === registered.actorUserId
      && command.actor.kind === (registered.operation === "accept" ? "seller" : "operator"),
    "Initial marketplace context may bind one exact supported actor command");
    if (command.type === "acceptInitialSellerRequest") check(command.input.terms.platformRequestId === registered.requestId,
      "Initial acceptance command targets another canonical request");
    const result = await registered.tx.query(`UPDATE alpha_wallet_initial_marketplace_simulation.transaction_contexts
      SET planned_command=$2::jsonb,planned_command_key=$3 WHERE transaction_id=$1 AND planned_command IS NULL RETURNING transaction_id`,
    [registered.transactionId, JSON.stringify(walletJson(command)), v3CommandKey(command)]);
    check(result.rows.length === 1, "Initial marketplace context was already bound or is missing");
    registered.command = command;
  }, () => parseV3Command(structuredClone(input)));
}

function activation(row: ActivationRow): InitialMarketplaceActivation {
  return structuredClone({ requestId: row.request_id, platformListingId: row.platform_listing_id, platformTradeId: row.platform_trade_id,
    walletListingId: row.wallet_listing_id, walletTradeId: row.wallet_trade_id, buyerId: row.buyer_id, sellerId: row.seller_id,
    assetId: row.asset_id, actorUserId: row.actor_user_id, inputDigest: row.input_digest,
    walletCheckpoint: row.wallet_checkpoint, canonicalBasis: row.canonical_basis });
}
function acceptance(row: AcceptanceRow): InitialMarketplaceAcceptance {
  return structuredClone({ inputDigest: row.input_digest, actorUserId: row.actor_user_id, receipt: row.receipt,
    walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key, walletEventHash: row.wallet_event_hash,
    publicationId: row.publication_id, canonical: row.canonical_result });
}
export async function readInitialMarketplaceActivation(context: InitialMarketplaceContext): Promise<InitialMarketplaceActivation | null> {
  return inContext(context, async registered => {
    const result = await registered.tx.query<ActivationRow>(
      "SELECT * FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=$1", [registered.requestId]);
    check(result.rows.length <= 1, "Duplicate initial marketplace activation identity");
    return result.rows.length ? activation(result.rows[0]) : null;
  });
}
export async function insertInitialMarketplaceActivation(context: InitialMarketplaceContext, options: {
  inputDigest: string; mapping: InitialMarketplaceMapping; walletCheckpoint: V2Checkpoint;
}): Promise<InitialMarketplaceActivation> {
  return inContext(context, async (registered, copy) => {
    check(registered.operation === "activate" && !registered.command, "Activation requires an unbound activation context");
    check(typeof copy.inputDigest === "string" && digest.test(copy.inputDigest), "Invalid initial activation public input digest");
    check(copy.mapping && Object.keys(copy.mapping).sort().join(",") === "assetId,walletListingId,walletTradeId"
      && ["tron-sim-usdt", "bsc-sim-binance-peg-usdt"].includes(copy.mapping.assetId)
      && typeof copy.mapping.walletListingId === "string" && typeof copy.mapping.walletTradeId === "string"
      && id.test(copy.mapping.walletListingId) && id.test(copy.mapping.walletTradeId), "Invalid initial activation mapping");
    const checkpoint = v2CheckpointSchema.parse(copy.walletCheckpoint);
    check(walletDigest(checkpoint) === walletDigest(copy.walletCheckpoint), "Invalid initial activation checkpoint shape");
    const result = await registered.tx.query<ActivationRow>(`INSERT INTO alpha_wallet_initial_marketplace_simulation.activations
      (request_id,platform_listing_id,platform_trade_id,wallet_listing_id,wallet_trade_id,buyer_id,seller_id,asset_id,
       actor_user_id,input_digest,wallet_checkpoint,canonical_basis)
      SELECT r.id,r.listing_id,r.trade_id,$2,$3,r.buyer_id,r.seller_id,$4,$5,$6,$7::jsonb,
        alpha_wallet_initial_marketplace_simulation.capture_canonical_basis(r.id)
      FROM alpha_exchange.purchase_requests r WHERE r.id=$1 RETURNING *`,
    [registered.requestId, copy.mapping.walletListingId, copy.mapping.walletTradeId, copy.mapping.assetId,
      registered.actorUserId, copy.inputDigest, JSON.stringify(checkpoint)]);
    check(result.rows.length === 1, "Initial marketplace activation was not appended");
    return activation(result.rows[0]);
  }, () => structuredClone(options));
}
export async function readInitialMarketplaceAcceptance(context: InitialMarketplaceContext): Promise<InitialMarketplaceAcceptance | null> {
  return inContext(context, async registered => {
    const result = await registered.tx.query<AcceptanceRow>(
      "SELECT * FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE request_id=$1", [registered.requestId]);
    check(result.rows.length <= 1, "Duplicate initial marketplace acceptance identity");
    return result.rows.length ? acceptance(result.rows[0]) : null;
  });
}
export async function insertInitialMarketplaceAcceptance(context: InitialMarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V3InitialAcceptanceReceipt>; canonical: DevelopmentInitialAcceptanceResult;
}): Promise<InitialMarketplaceAcceptance> {
  return inContext(context, async (registered, copy) => {
    const { execution, canonical } = copy, receipt = execution.result;
    check(registered.operation === "accept" && registered.command?.type === "acceptInitialSellerRequest",
      "Initial marketplace acceptance requires its bound seller command");
    check(typeof copy.inputDigest === "string" && digest.test(copy.inputDigest) && execution.replayed === false
      && Number.isSafeInteger(execution.revision) && execution.revision > 0
      && execution.commandKey === v3CommandKey(registered.command) && digest.test(execution.eventHash)
      && receipt?.platformRequestId === registered.requestId && receipt.actorUserId === registered.actorUserId
      && digest.test(receipt.acceptanceKey), "Initial marketplace receipt requires the exact newly executed financial command");
    check(canonical?.request?.id === registered.requestId && canonical.request.status === "accepted"
      && canonical.trade.id === receipt.platformTradeId && canonical.request.tradeId === receipt.platformTradeId,
    "Initial marketplace canonical result targets another request or trade");
    const publicationId = `initial-wallet-publication-${receipt.acceptanceKey}`;
    const result = await registered.tx.query<AcceptanceRow>(`INSERT INTO alpha_wallet_initial_marketplace_simulation.acceptances
      (acceptance_key,request_id,actor_user_id,input_digest,wallet_command_revision,wallet_command_key,
       wallet_event_hash,receipt,publication_id,canonical_result)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb) RETURNING *`,
    [receipt.acceptanceKey, registered.requestId, registered.actorUserId, copy.inputDigest,
      execution.revision, execution.commandKey, execution.eventHash, JSON.stringify(walletJson(receipt)), publicationId,
      JSON.stringify(walletJson(canonical))]);
    await registered.tx.query(`INSERT INTO alpha_wallet_initial_marketplace_simulation.publications (id,acceptance_key,payload)
      VALUES ($1,$2,alpha_wallet_initial_marketplace_simulation.publication_payload($2))`, [publicationId, receipt.acceptanceKey]);
    check(result.rows.length === 1, "Initial marketplace acceptance was not appended");
    return acceptance(result.rows[0]);
  }, () => structuredClone(options));
}

/** Run after real canonical persistence. Independent deferred SQL repeats this. */
export async function assertInitialMarketplaceCoherence(context: InitialMarketplaceContext): Promise<void> {
  await inContext(context, async registered => {
    await registered.tx.query("SELECT alpha_wallet_initial_marketplace_simulation.assert_coherence()");
  });
}
