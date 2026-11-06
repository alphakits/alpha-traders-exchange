import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TradeEvidenceFile } from "@/types/alpha-exchange";
import type { DevelopmentPaymentMarketplaceResult } from "./payment-marketplace-canonical";
import { walletDigest, walletJson } from "./commands";
import { WalletIntegrityError, type DurableExecution } from "./durable";
import type { WalletSql } from "./durable-store";
import type { InitialMarketplaceAcceptance, InitialMarketplaceActivation } from "./initial-marketplace-coordination-store";
import { assertCancellationMarketplaceCoherence, registerCancellationMarketplaceContext,
  type CancellationMarketplaceContext, type CancellationMarketplaceTransition, type CancellationMarketplaceCancellation
} from "./cancellation-marketplace-coordination-store";
import { assertSimulationRuntime } from "./runtime";
import type { V2Checkpoint } from "./v2-commands";
import { parseV5Command, v5CommandKey, type V5Command } from "./v5-commands";
import type { V5Continuation, V5InitialPaymentClaimReceipt, V5InitialDisputeFreezeReceipt } from "./v5-engine";

export const PAYMENT_MARKETPLACE_PROFILE = "canonical-initial-payment-cohort-v1" as const;
export type PaymentMarketplaceOperation = "upgrade" | "claim" | "dispute" | "inspect" | "pause" | "export";
declare const contextBrand: unique symbol;
/** A capability for one certified physical transaction. It is not account authority. */
export type PaymentMarketplaceContext = Readonly<{ [contextBrand]: true }>;
type CanonicalRow = Record<string, unknown> & { payload: Record<string, unknown> };
export type PaymentMarketplaceCanonicalInput = { evidence?: { metadata: TradeEvidenceFile; contentDigest: string }; reason?: string };
export type PaymentMarketplaceCanonicalBasis = {
  request: CanonicalRow; listing: CanonicalRow; trade: CanonicalRow; reminders: CanonicalRow[]; actorRole: string;
  evidence: Array<{ row: CanonicalRow; contentDigest: string }>;
};
export type PaymentMarketplaceCanonicalResult = Omit<DevelopmentPaymentMarketplaceResult, "evidence"> & {
  evidence: Array<{ metadata: TradeEvidenceFile; contentDigest: string }>;
};
/** Bytes have one private canonical home; immutable receipts retain only exact commitments. */
export function paymentMarketplaceCanonicalResult(value: DevelopmentPaymentMarketplaceResult): PaymentMarketplaceCanonicalResult {
  const copy = structuredClone(value);
  return { ...copy, evidence: copy.evidence.map(({ metadata, contentDigest }) => ({ metadata, contentDigest })) };
}
export type PaymentMarketplaceTransition = {
  requestId: string; profile: typeof PAYMENT_MARKETPLACE_PROFILE; actorUserId: string; inputDigest: string;
  sourceStatus: "accepted" | "cancelled";
  walletCheckpoint: V2Checkpoint; walletRevision: number; walletCommandKey: string; walletEventHash: string;
  continuation: V5Continuation; predecessor: Record<string, unknown>;
};
type PaymentMarketplaceAction<Receipt> = {
  actorUserId: string; actorKind: "buyer"; inputDigest: string;
  receipt: Receipt; walletRevision: number; walletCommandKey: string; walletEventHash: string;
  publicationId: string; canonicalBasis: PaymentMarketplaceCanonicalBasis;
  canonicalInput: PaymentMarketplaceCanonicalInput; canonical: PaymentMarketplaceCanonicalResult;
};
export type PaymentMarketplaceClaim = PaymentMarketplaceAction<V5InitialPaymentClaimReceipt>;
export type PaymentMarketplaceDispute = PaymentMarketplaceAction<V5InitialDisputeFreezeReceipt>;
type Registered = {
  tx: WalletSql; transactionId: string; requestId: string; operation: PaymentMarketplaceOperation; actorUserId: string;
  phase: "predecessor" | "successor"; predecessorContext?: CancellationMarketplaceContext; command?: V5Command; canonicalInput?: PaymentMarketplaceCanonicalInput;
};
export type PaymentMarketplaceTransaction = Readonly<Omit<Registered, "predecessorContext">>;
type Row = Record<string, unknown>;
type ContextRow = Row & { transaction_id: string; request_id: string; operation: string; actor_user_id: string;
  planned_command: V5Command | null; planned_command_key: string | null; canonical_input?: PaymentMarketplaceCanonicalInput | null };
type TransactionRow = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
const contexts = new WeakMap<object, Registered>();
const identity = /^[A-Za-z0-9_-]{1,80}$/;
const digest = /^[a-f0-9]{64}$/;
const operations = new Set<PaymentMarketplaceOperation>(["upgrade", "claim", "dispute", "inspect", "pause", "export"]);
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
    "Payment marketplace requires a physical transaction identity");
  check(expected === undefined || row.transaction_id === expected, "Payment marketplace transaction identity changed or ended");
  check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only",
    "Payment marketplace requires an explicit writable SERIALIZABLE simulation transaction");
  return row.transaction_id;
}
async function abortSameTransaction(registered: Pick<Registered, "tx" | "transactionId">) {
  try {
    const actual = await registered.tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
    if (actual.rows.length === 1 && actual.rows[0]?.transaction_id === registered.transactionId) {
      await registered.tx.query("SELECT 1 / 0 /* abort failed payment marketplace participant */");
    }
  } catch { /* Preserve the initiating refusal; a replacement transaction is never poisoned. */ }
}
async function assertRegistration(registered: Registered) {
  await transactionIdentity(registered.tx, registered.transactionId);
  const namespace = registered.phase === "predecessor" ? "alpha_wallet_cancellation_marketplace_simulation"
    : "alpha_wallet_payment_marketplace_simulation";
  const rows = (await registered.tx.query<ContextRow>(`SELECT transaction_id,request_id,operation,actor_user_id,
    planned_command,planned_command_key${registered.phase === 'successor' ? ',canonical_input' : ''} FROM ${namespace}.transaction_contexts WHERE transaction_id=$1`, [registered.transactionId])).rows;
  const row = rows[0], command = registered.phase === "successor" ? registered.command : undefined;
  check(rows.length === 1 && row.request_id === registered.requestId && row.actor_user_id === registered.actorUserId
    && row.operation === (registered.phase === "predecessor" ? "inspect" : registered.operation)
    && (command ? walletDigest(row.planned_command) === walletDigest(command) && row.planned_command_key === v5CommandKey(command)
      : row.planned_command === null && row.planned_command_key === null)
    && (registered.phase === "predecessor" || walletDigest(row.canonical_input ?? null) === walletDigest(registered.canonicalInput ?? null)),
  "Payment marketplace capability differs from its immutable same-transaction registration");
}
async function inContext<T, Captured = undefined>(context: PaymentMarketplaceContext,
  work: (registered: Registered, captured: Captured) => Promise<T>, capture?: () => Captured): Promise<T> {
  const registered = context && typeof context === "object" ? contexts.get(context) : undefined;
  check(registered, "A registered opaque payment marketplace context is required");
  try {
    const captured = capture?.() as Captured;
    await assertRegistration(registered);
    const result = await work(registered, captured);
    await assertRegistration(registered);
    return result;
  } catch (error) { await abortSameTransaction(registered); throw error; }
}

/** No transaction factory, caller flag, or account claims can create this capability. */
export async function registerPaymentMarketplaceContext(options: {
  mode: "simulation-only"; tx: WalletSql; requestId: string; operation: PaymentMarketplaceOperation; actorUserId: string;
}): Promise<PaymentMarketplaceContext> {
  const { mode, tx, requestId, operation, actorUserId } = options;
  assertSimulationRuntime(mode);
  let certified: string | undefined;
  try {
    const transactionId = await transactionIdentity(tx);
    await transactionIdentity(tx, transactionId);
    certified = transactionId;
    check(typeof requestId === "string" && identity.test(requestId) && typeof actorUserId === "string"
      && identity.test(actorUserId) && operations.has(operation), "Invalid payment marketplace context identity or operation");
    const status = (await tx.query<{ predecessor: boolean; successor: boolean; correction: boolean; recovered_predecessor: boolean; recovered_initial: boolean }>(`SELECT
      to_regnamespace('alpha_wallet_cancellation_marketplace_simulation') IS NOT NULL AS predecessor,
      to_regnamespace('alpha_wallet_payment_marketplace_simulation') IS NOT NULL AS successor,
      to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL AS correction,
      to_regclass('alpha_wallet_cancellation_marketplace_simulation.recovery_receipts') IS NOT NULL AS recovered_predecessor,
      to_regclass('alpha_wallet_initial_marketplace_simulation.recovery_receipts') IS NOT NULL AS recovered_initial`)).rows[0];
    check(status?.predecessor && !status.correction && !status.recovered_predecessor && !status.recovered_initial,
      "Payment marketplace requires the original initial cohort and refuses correction or restored predecessor authority");
    const registered: Registered = { tx, transactionId, requestId, operation, actorUserId,
      phase: status.successor ? "successor" : "predecessor" };
    if (!status.successor) {
      check(operation === "upgrade", "An explicit owner payment-profile upgrade is required");
      registered.predecessorContext = await registerCancellationMarketplaceContext({ mode, tx, requestId, operation: "inspect", actorUserId });
      await assertCancellationMarketplaceCoherence(registered.predecessorContext);
      const counts = (await tx.query<{ activations: string; acceptances: string; publications: string; accepted: boolean }>(`SELECT
        (SELECT count(*)::text FROM alpha_wallet_initial_marketplace_simulation.activations) AS activations,
        (SELECT count(*)::text FROM alpha_wallet_initial_marketplace_simulation.acceptances) AS acceptances,
        (SELECT count(*)::text FROM alpha_wallet_initial_marketplace_simulation.publications) AS publications,
        EXISTS(SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.acceptances a
          JOIN alpha_exchange.purchase_requests r ON r.id=a.request_id WHERE a.request_id=$1 AND r.status IN ('accepted','cancelled')) AS accepted`, [requestId])).rows[0];
      check(counts?.activations === "1" && counts.acceptances === "1" && counts.publications === "1" && counts.accepted,
        "Payment upgrade requires exactly one coherent original accepted or cancelled V4 mapping");
    } else {
      await tx.query(`INSERT INTO alpha_wallet_payment_marketplace_simulation.transaction_contexts
        (transaction_id,request_id,operation,actor_user_id) VALUES ($1,$2,$3,$4)`, [transactionId, requestId, operation, actorUserId]);
    }
    await assertRegistration(registered);
    const context = Object.freeze({}) as PaymentMarketplaceContext;
    contexts.set(context, registered);
    return context;
  } catch (error) { if (certified !== undefined) await abortSameTransaction({ tx, transactionId: certified }); throw error; }
}

export async function assertPaymentMarketplaceContext(context: PaymentMarketplaceContext, expected: {
  tx: Pick<WalletSql, "query">; requestId: string; operation: PaymentMarketplaceOperation; actorUserId?: string;
}): Promise<void> {
  await inContext(context, async (registered, captured) => {
    check(registered.tx === captured.tx && registered.requestId === captured.requestId && registered.operation === captured.operation
      && (captured.actorUserId === undefined || registered.actorUserId === captured.actorUserId),
    "Payment marketplace capability does not authorize this participant identity or operation");
  }, () => ({ ...expected }));
}

/** Internal participants retain the exact certified owner; no nested transaction is opened. */
export async function withPaymentMarketplaceContext<T>(context: PaymentMarketplaceContext,
  work: (registered: PaymentMarketplaceTransaction) => Promise<T>): Promise<T> {
  return inContext(context, registered => work(Object.freeze({ tx: registered.tx, transactionId: registered.transactionId,
    requestId: registered.requestId, operation: registered.operation, actorUserId: registered.actorUserId,
    phase: registered.phase, ...(registered.command ? { command: structuredClone(registered.command) } : {}) })));
}

export async function bindPaymentMarketplaceCommand(context: PaymentMarketplaceContext, input: V5Command,
  canonicalInput?: PaymentMarketplaceCanonicalInput): Promise<void> {
  await inContext(context, async (registered, captured) => {
    const { command, privateInput } = captured;
    const expected = { upgrade: "continueFromV4", claim: "claimInitialPayment", dispute: "freezeInitialDispute", pause: "pause", inspect: null, export: null }[registered.operation];
    check(!registered.command && expected !== null && command.type === expected && command.actor.id === registered.actorUserId,
      "Payment marketplace context may bind one exact supported actor command");
    if (command.type === "claimInitialPayment" || command.type === "freezeInitialDispute") {
      check(command.input.terms.platformRequestId === registered.requestId && command.actor.kind === "buyer" && privateInput !== undefined,
        "Payment command targets another request or unsupported actor");
    } else check(command.actor.kind === "operator" && privateInput === undefined,
      "Payment continuation and pause require the registered operator without private action input");
    if (registered.phase === "successor") {
      const result = await registered.tx.query(`UPDATE alpha_wallet_payment_marketplace_simulation.transaction_contexts
        SET planned_command=$2::jsonb,planned_command_key=$3,canonical_input=$4::jsonb
        WHERE transaction_id=$1 AND planned_command IS NULL RETURNING transaction_id`,
      [registered.transactionId, JSON.stringify(walletJson(command)), v5CommandKey(command), privateInput === undefined ? null : JSON.stringify(privateInput)]);
      check(result.rows.length === 1, "Payment marketplace context was already bound or is missing");
    } else check(registered.operation === "upgrade" && command.type === "continueFromV4", "Only explicit upgrade may bind the predecessor context");
    registered.command = command;
    registered.canonicalInput = privateInput;
  }, () => ({ command: parseV5Command(structuredClone(input)), privateInput: canonicalInput === undefined ? undefined : structuredClone(canonicalInput) }));
}

/** Used only after original deferred constraints have been flushed by the V5 upgrader. */
export async function preparePaymentMarketplaceUpgrade(context: PaymentMarketplaceContext): Promise<void> {
  await inContext(context, async registered => {
    check(registered.phase === "predecessor" && registered.operation === "upgrade"
      && registered.command?.type === "continueFromV4" && registered.predecessorContext,
    "Payment schema installation requires its bound original predecessor upgrade");
    await assertCancellationMarketplaceCoherence(registered.predecessorContext);
    await registered.tx.exec(sql("payment-marketplace-tables.sql"));
    await registered.tx.query(`INSERT INTO alpha_wallet_payment_marketplace_simulation.transaction_contexts
      (transaction_id,request_id,operation,actor_user_id,planned_command,planned_command_key)
      VALUES ($1,$2,'upgrade',$3,$4::jsonb,$5)`, [registered.transactionId, registered.requestId, registered.actorUserId,
      JSON.stringify(walletJson(registered.command)), v5CommandKey(registered.command)]);
    registered.phase = "successor";
  });
}

/** Recovery installs exact immutable rows first; this adds the reviewed successor fences. */
export async function installPaymentMarketplaceGuards(tx: WalletSql): Promise<void> {
  await tx.exec(sql("payment-marketplace-reason.sql"));
  await tx.exec(sql("payment-marketplace-guards.sql"));
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol','simulation-v5-payment',true)");
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
export async function readPaymentMarketplacePredecessor(context: PaymentMarketplaceContext) {
  return inContext(context, async registered => {
    const rows = (await registered.tx.query<{ activation: Row; acceptance: Row; publication: Row; transition: Row; cancellation: Row | null; cancellation_publication: Row | null }>(`SELECT
      to_jsonb(v) AS activation,to_jsonb(a) AS acceptance,to_jsonb(p) AS publication,to_jsonb(t) AS transition,
      to_jsonb(c) AS cancellation,to_jsonb(cp) AS cancellation_publication
      FROM alpha_wallet_initial_marketplace_simulation.activations v
      JOIN alpha_wallet_initial_marketplace_simulation.acceptances a ON a.request_id=v.request_id
      JOIN alpha_wallet_initial_marketplace_simulation.publications p ON p.acceptance_key=a.acceptance_key
      JOIN alpha_wallet_cancellation_marketplace_simulation.transitions t ON t.request_id=v.request_id
      LEFT JOIN alpha_wallet_cancellation_marketplace_simulation.cancellations c ON c.request_id=v.request_id
      LEFT JOIN alpha_wallet_cancellation_marketplace_simulation.publications cp ON cp.cancellation_key=c.cancellation_key
      WHERE v.request_id=$1`, [registered.requestId])).rows;
    check(rows.length === 1, "One exact immutable original V4 predecessor is required");
    const row = rows[0], t = row.transition, c = row.cancellation;
    return { activation: activation(row.activation), acceptance: acceptance(row.acceptance),
      publication: structuredClone({ id: row.publication.id as string, acceptanceKey: row.publication.acceptance_key as string,
        payload: row.publication.payload as Record<string, unknown> }),
      transition: structuredClone({ requestId: t.request_id, profile: t.profile, actorUserId: t.actor_user_id, inputDigest: t.input_digest,
        walletCheckpoint: t.wallet_checkpoint, walletRevision: t.wallet_command_revision, walletCommandKey: t.wallet_command_key,
        walletEventHash: t.wallet_event_hash, continuation: t.continuation, predecessor: t.predecessor }) as CancellationMarketplaceTransition,
      cancellation: c === null ? null : structuredClone({ actorUserId: c.actor_user_id, actorKind: c.actor_kind, inputDigest: c.input_digest,
        receipt: c.receipt, walletRevision: c.wallet_command_revision, walletCommandKey: c.wallet_command_key, walletEventHash: c.wallet_event_hash,
        publicationId: c.publication_id, canonicalBasis: c.canonical_basis, canonical: c.canonical_result }) as CancellationMarketplaceCancellation,
      cancellationPublication: structuredClone(row.cancellation_publication),
    };
  });
}
function transition(row: Row): PaymentMarketplaceTransition {
  return structuredClone({ requestId: row.request_id, profile: row.profile, actorUserId: row.actor_user_id, inputDigest: row.input_digest,
    walletCheckpoint: row.wallet_checkpoint, walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key,
    walletEventHash: row.wallet_event_hash, continuation: row.continuation, predecessor: row.predecessor, sourceStatus: row.source_status }) as PaymentMarketplaceTransition;
}
function action<Receipt>(row: Row): PaymentMarketplaceAction<Receipt> {
  return structuredClone({ actorUserId: row.actor_user_id, actorKind: row.actor_kind, inputDigest: row.input_digest, receipt: row.receipt,
    walletRevision: row.wallet_command_revision, walletCommandKey: row.wallet_command_key, walletEventHash: row.wallet_event_hash,
    publicationId: row.publication_id, canonicalBasis: row.canonical_basis, canonicalInput: row.canonical_input,
    canonical: row.canonical_result }) as PaymentMarketplaceAction<Receipt>;
}
export async function readPaymentMarketplaceTransition(context: PaymentMarketplaceContext): Promise<PaymentMarketplaceTransition | null> {
  return inContext(context, async registered => {
    if (registered.phase === "predecessor") return null;
    const rows = (await registered.tx.query<Row>("SELECT * FROM alpha_wallet_payment_marketplace_simulation.transitions WHERE request_id=$1", [registered.requestId])).rows;
    check(rows.length <= 1, "Duplicate payment marketplace transition");
    return rows.length ? transition(rows[0]) : null;
  });
}
export async function insertPaymentMarketplaceTransition(context: PaymentMarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V5Continuation>;
}): Promise<PaymentMarketplaceTransition> {
  return inContext(context, async (registered, copy) => {
    const { execution } = copy, result = execution.result;
    check(registered.phase === "successor" && registered.operation === "upgrade" && registered.command?.type === "continueFromV4"
      && execution.replayed === false && execution.commandKey === v5CommandKey(registered.command)
      && result?.commandRevision === execution.revision && result.commandKey === execution.commandKey
      && digest.test(execution.eventHash) && copy.inputDigest === walletDigest({ kind: "alpha-wallet-initial-payment-upgrade-v1",
        actorUserId: registered.actorUserId, requestId: registered.requestId }), "Payment transition requires its exact new owner continuation");
    const rows = (await registered.tx.query<Row>(`INSERT INTO alpha_wallet_payment_marketplace_simulation.transitions
      (request_id,profile,actor_user_id,input_digest,wallet_checkpoint,wallet_command_revision,wallet_command_key,wallet_event_hash,continuation,predecessor,source_status)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,alpha_wallet_payment_marketplace_simulation.capture_predecessor($1),(SELECT status FROM alpha_exchange.purchase_requests WHERE id=$1)) RETURNING *`,
    [registered.requestId, PAYMENT_MARKETPLACE_PROFILE, registered.actorUserId, copy.inputDigest, JSON.stringify(result.checkpoint),
      execution.revision, execution.commandKey, execution.eventHash, JSON.stringify(walletJson(result))])).rows;
    check(rows.length === 1, "Payment marketplace transition was not appended");
    return transition(rows[0]);
  }, () => structuredClone(options));
}
async function readAction<Receipt>(context: PaymentMarketplaceContext, table: "claims" | "dispute_freezes"): Promise<PaymentMarketplaceAction<Receipt> | null> {
  return inContext(context, async registered => {
    if (registered.phase === "predecessor") return null;
    const rows = (await registered.tx.query<Row>(`SELECT * FROM alpha_wallet_payment_marketplace_simulation.${table} WHERE request_id=$1`, [registered.requestId])).rows;
    check(rows.length <= 1, "Duplicate payment marketplace receipt");
    return rows.length ? action<Receipt>(rows[0]) : null;
  });
}
export const readPaymentMarketplaceClaim = (context: PaymentMarketplaceContext) => readAction<V5InitialPaymentClaimReceipt>(context, "claims");
export const readPaymentMarketplaceDispute = (context: PaymentMarketplaceContext) => readAction<V5InitialDisputeFreezeReceipt>(context, "dispute_freezes");
async function insertAction<Receipt extends V5InitialPaymentClaimReceipt | V5InitialDisputeFreezeReceipt>(context: PaymentMarketplaceContext,
  kind: "claim" | "dispute", options: { inputDigest: string; execution: DurableExecution<Receipt>; canonical: DevelopmentPaymentMarketplaceResult;
}): Promise<PaymentMarketplaceAction<Receipt>> {
  return inContext(context, async (registered, copy) => {
    const { execution } = copy, receipt = execution.result;
    const canonical = paymentMarketplaceCanonicalResult(copy.canonical);
    const commandType = kind === "claim" ? "claimInitialPayment" : "freezeInitialDispute";
    const key = kind === "claim" ? (receipt as V5InitialPaymentClaimReceipt).claimKey : (receipt as V5InitialDisputeFreezeReceipt).disputeKey;
    check(registered.operation === kind && registered.command?.type === commandType && execution.replayed === false
      && execution.commandKey === v5CommandKey(registered.command) && receipt?.commandRevision === execution.revision
      && receipt.commandKey === execution.commandKey && receipt.platformRequestId === registered.requestId
      && receipt.actorUserId === registered.actorUserId && receipt.actorKind === "buyer" && digest.test(key) && digest.test(execution.eventHash)
      && digest.test(copy.inputDigest) && canonical.kind === kind && canonical.request.id === registered.requestId
      && canonical.request.status === "payment_sent", "Payment receipt requires its exact new no-money command and canonical result");
    const table = kind === "claim" ? "claims" : "dispute_freezes", column = kind === "claim" ? "claim_key" : "dispute_key";
    const publicationId = `payment-${kind}-publication-${key}`;
    const rows = (await registered.tx.query<Row>(`INSERT INTO alpha_wallet_payment_marketplace_simulation.${table}
      (${column},request_id,actor_user_id,actor_kind,input_digest,wallet_command_revision,wallet_command_key,wallet_event_hash,
       receipt,publication_id,canonical_basis,canonical_input,canonical_result)
      SELECT $1,$2,$3,'buyer',$4,$5,$6,$7,$8::jsonb,$9,canonical_basis,canonical_input,$10::jsonb
      FROM alpha_wallet_payment_marketplace_simulation.transaction_contexts WHERE transaction_id=$11 RETURNING *`,
    [key, registered.requestId, registered.actorUserId, copy.inputDigest, execution.revision, execution.commandKey,
      execution.eventHash, JSON.stringify(walletJson(receipt)), publicationId, JSON.stringify(canonical), registered.transactionId])).rows;
    check(rows.length === 1, "Payment marketplace receipt was not appended");
    await registered.tx.query(`INSERT INTO alpha_wallet_payment_marketplace_simulation.publications (id,operation,action_key,payload)
      VALUES ($1,$2,$3,alpha_wallet_payment_marketplace_simulation.publication_payload($2,$3))`, [publicationId, kind, key]);
    return action<Receipt>(rows[0]);
  }, () => structuredClone(options));
}
export const insertPaymentMarketplaceClaim = (context: PaymentMarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V5InitialPaymentClaimReceipt>; canonical: DevelopmentPaymentMarketplaceResult;
}) => insertAction(context, "claim", options);
export const insertPaymentMarketplaceDispute = (context: PaymentMarketplaceContext, options: {
  inputDigest: string; execution: DurableExecution<V5InitialDisputeFreezeReceipt>; canonical: DevelopmentPaymentMarketplaceResult;
}) => insertAction(context, "dispute", options);
export async function assertPaymentMarketplaceCoherence(context: PaymentMarketplaceContext): Promise<void> {
  await inContext(context, async registered => {
    check(registered.phase === "successor", "An explicit payment profile transition must commit before returning");
    await registered.tx.query("SELECT alpha_wallet_payment_marketplace_simulation.assert_coherence()");
  });
}
