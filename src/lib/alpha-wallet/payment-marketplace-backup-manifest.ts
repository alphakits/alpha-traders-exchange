import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { PurchaseRequest, TradeEvidenceFile } from "@/types/alpha-exchange";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS, WALLET_BACKUP_FORMAT, WalletBackupError } from "./backup";
import { walletDigest } from "./commands";
import { cancellationMarketplaceCanonicalRowsSchema, cancellationMarketplaceCoordinationRowsSchema,
  cancellationMarketplacePredecessorRowsSchema } from "./cancellation-marketplace-backup-manifest";
import { initialMarketplaceCoordinationRowsSchema } from "./initial-marketplace-backup-manifest";
import { assertDevelopmentPaymentEvidence, paymentCanonicalCommitment, planDevelopmentPaymentClaim, planDevelopmentPaymentDispute,
  type DevelopmentPaymentMarketplace, type DevelopmentPaymentMarketplaceResult } from "./payment-marketplace-canonical";
import { canonicalIdentities, checkJsonTree, sameRow, timestampMicros, verifyPaymentMarketplacePredecessor } from "./payment-marketplace-predecessor-verification";
import { assertSimulationRuntime } from "./runtime";
import { verifyV4History } from "./v4-durable";
import { isV4State } from "./v4-engine";
import { parseV5Command, v5PaymentClaimInputSchema, v5DisputeFreezeInputSchema, WALLET_V5_ENGINE_VERSION } from "./v5-commands";
import { verifyV5History } from "./v5-durable";
import { isV5State, type V5State } from "./v5-engine";

export const PAYMENT_MARKETPLACE_WALLET_BACKUP_FORMAT = "alpha-wallet-payment-marketplace-simulation-backup" as const;
export const PAYMENT_MARKETPLACE_WALLET_BACKUP_SCHEMA = "canonical-initial-payment-cohort-v1" as const;
export const PAYMENT_MARKETPLACE_WALLET_LEDGER_SCOPE = "payment-marketplace-v5-ledger" as const;
export const MAX_PAYMENT_MARKETPLACE_BACKUP_ROWS_PER_TABLE = 1_000;
export const MAX_PAYMENT_MARKETPLACE_BACKUP_ROWS = 10_000;
export const paymentMarketplaceCanonicalRowsSchema = cancellationMarketplaceCanonicalRowsSchema;
export const paymentMarketplacePredecessorRowsSchema = z.strictObject({
  initial: cancellationMarketplacePredecessorRowsSchema,
  cancellation: cancellationMarketplaceCoordinationRowsSchema,
});
export type PaymentMarketplaceCanonicalRows = z.infer<typeof paymentMarketplaceCanonicalRowsSchema>;
export type PaymentMarketplacePredecessorRows = z.infer<typeof paymentMarketplacePredecessorRowsSchema>;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const eventId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const safeTime = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => Number.isFinite(new Date(value).getTime()));
const revision = z.number().int().min(0).max(MAX_WALLET_BACKUP_COMMANDS);
const positiveRevision = revision.refine(value => value > 0);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
const record = z.record(z.string(), z.unknown());
const role = z.enum(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);
const checkpoint = z.strictObject({ revision, eventHash: hex, stateHash: hex, lastCommandAtMs: safeTime });
const continuation = z.strictObject({ checkpoint, commandRevision: positiveRevision, commandKey: z.string().min(1).max(512) });
const haltedContinuation = continuation.extend({ sourceHaltReason: z.string().min(1).nullable() });
const originalBasis = initialMarketplaceCoordinationRowsSchema.shape.activations.element.shape.canonical_basis;
const cancellationBasis = cancellationMarketplaceCoordinationRowsSchema.shape.cancellations.element.shape.canonical_basis;
const evidenceMetadata = z.strictObject({ id, purchaseRequestId: id, side: z.literal("buyer"), uploadedByUserId: id,
  uploadedAt: z.string().datetime({ precision: 3 }), fileName: z.enum(["buyer-payment-evidence.png", "buyer-payment-evidence.jpg", "buyer-payment-evidence.pdf"]),
  mimeType: z.enum(["image/png", "image/jpeg", "application/pdf"]), sizeBytes: z.number().int().min(1).max(8 * 1024 * 1024),
  storagePath: z.string().min(1).max(512), status: z.literal("uploaded") });
const evidenceCommitment = z.strictObject({ metadata: evidenceMetadata, contentDigest: hex });
const evidenceBasisRow = paymentMarketplaceCanonicalRowsSchema.shape.evidence.element.omit({ content: true }).extend({
  uploaded_at: cancellationBasis.shape.reminders.element.shape.created_at,
});
const actionBasis = z.strictObject({ request: originalBasis.shape.request, listing: originalBasis.shape.listing,
  trade: originalBasis.shape.trade.unwrap(), reminders: cancellationBasis.shape.reminders, actorRole: role,
  evidence: z.array(z.strictObject({ row: evidenceBasisRow, contentDigest: hex })).max(1) });
const canonicalInput = z.strictObject({ evidence: evidenceCommitment.optional(), reason: z.string().min(1).max(500).optional() });
const canonicalResult = z.strictObject({ kind: z.enum(["claim", "dispute"]), request: record, listing: record, trade: record,
  evidence: z.array(evidenceCommitment).max(1), disputes: z.array(record).max(1), notifications: z.array(record).min(1).max(2),
  notificationUpdates: z.array(record).max(MAX_PAYMENT_MARKETPLACE_BACKUP_ROWS_PER_TABLE), auditLogs: z.array(record).length(1) });
const receiptBase = { platformRequestId: id, platformTradeId: id, platformListingId: id, walletTradeId: id, walletListingId: id,
  acceptanceKey: hex, actorUserId: id, actorKind: z.literal("buyer"), commandRevision: positiveRevision, commandKey: z.string().min(1).max(512),
  inputDigest: hex, plannerInputDigest: hex, termsDigest: hex, principalRaw: raw, transferAmountRaw: z.literal("0") };
const claimReceipt = z.strictObject({ ...receiptBase, claimKey: hex, claimedAtMs: safeTime, input: v5PaymentClaimInputSchema });
const disputeReceipt = z.strictObject({ ...receiptBase, disputeKey: hex, claimKey: hex, disputedAtMs: safeTime, input: v5DisputeFreezeInputSchema });
const actionBase = { request_id: id, actor_user_id: id, actor_kind: z.literal("buyer"), input_digest: hex,
  wallet_command_revision: positiveRevision, wallet_command_key: z.string().min(1).max(512), wallet_event_hash: hex,
  publication_id: eventId, canonical_basis: actionBasis, canonical_input: canonicalInput, canonical_result: canonicalResult };
const predecessorCommitment = z.strictObject({
  initial: z.strictObject({ activation: initialMarketplaceCoordinationRowsSchema.shape.activations.element,
    acceptance: initialMarketplaceCoordinationRowsSchema.shape.acceptances.element, publication: initialMarketplaceCoordinationRowsSchema.shape.publications.element }),
  cancellation: z.strictObject({ transition: cancellationMarketplaceCoordinationRowsSchema.shape.transitions.element,
    cancellation: cancellationMarketplaceCoordinationRowsSchema.shape.cancellations.element.nullable(),
    publication: cancellationMarketplaceCoordinationRowsSchema.shape.publications.element.nullable() }),
});
const publicationPayload = z.strictObject({ type: z.enum(["initial_payment_claimed", "initial_dispute_frozen"]),
  requestId: id, listingId: id, tradeId: id, walletTradeId: id, sellerId: id, buyerId: id, actorUserId: id, actorKind: z.literal("buyer"),
  acceptanceKey: hex, actionKey: hex, walletRevision: positiveRevision, walletEventHash: hex, termsDigest: hex,
  principalRaw: raw, transferAmountRaw: z.literal("0"), paymentVerified: z.literal(false), notificationIds: z.array(eventId).min(1).max(2),
  auditId: eventId, timelineEventId: eventId });
export const paymentMarketplaceCoordinationRowsSchema = z.strictObject({
  transitions: z.array(z.strictObject({ request_id: id, profile: z.literal(PAYMENT_MARKETPLACE_WALLET_BACKUP_SCHEMA),
    source_status: z.enum(["accepted", "cancelled"]), actor_user_id: id, input_digest: hex, wallet_checkpoint: checkpoint,
    wallet_command_revision: positiveRevision, wallet_command_key: z.string().min(1).max(512), wallet_event_hash: hex,
    continuation: haltedContinuation, predecessor: predecessorCommitment })).length(1),
  claims: z.array(z.strictObject({ claim_key: hex, ...actionBase, receipt: claimReceipt })).max(1),
  dispute_freezes: z.array(z.strictObject({ dispute_key: hex, ...actionBase, receipt: disputeReceipt })).max(1),
  publications: z.array(z.strictObject({ id: eventId, operation: z.enum(["claim", "dispute"]), action_key: hex, payload: publicationPayload })).max(2),
});
export type PaymentMarketplaceCoordinationRows = z.infer<typeof paymentMarketplaceCoordinationRowsSchema>;
export type PaymentMarketplaceRecoveryRows = { canonical: PaymentMarketplaceCanonicalRows;
  predecessor: PaymentMarketplacePredecessorRows; coordination: PaymentMarketplaceCoordinationRows };
const walletRecord = z.strictObject({ revision: positiveRevision, command_key: z.string().min(1).max(512), command_type: z.string().min(1).max(80),
  occurred_at_ms: z.string().regex(/^(?:0|[1-9]\d{0,15})$/).refine(value => safeTime.safeParse(Number(value)).success),
  command_json: z.unknown().refine(value => value !== undefined), input_hash: hex, result_json: z.unknown().refine(value => value !== undefined),
  result_hash: hex, state_hash: hex, previous_event_hash: hex, event_hash: hex });
const walletEnvelope = z.strictObject({ format: z.literal(WALLET_BACKUP_FORMAT), formatVersion: z.literal(5), scope: z.literal(PAYMENT_MARKETPLACE_WALLET_LEDGER_SCOPE),
  mode: z.literal("simulation-only"), engineVersion: z.literal(WALLET_V5_ENGINE_VERSION), sourcePaused: z.literal(true), exportedAtMs: safeTime,
  checkpoint, continuation, initialContinuation: continuation, cancellationContinuation: haltedContinuation, paymentContinuation: haltedContinuation,
  commands: z.array(walletRecord).min(1).max(MAX_WALLET_BACKUP_COMMANDS - 1), checksum: hex });
const envelopeSchema = z.strictObject({ format: z.literal(PAYMENT_MARKETPLACE_WALLET_BACKUP_FORMAT), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), schemaVersion: z.literal(PAYMENT_MARKETPLACE_WALLET_BACKUP_SCHEMA), exportedAtMs: safeTime,
  requestId: id, ownerId: id, wallet: walletEnvelope, canonical: paymentMarketplaceCanonicalRowsSchema,
  predecessor: paymentMarketplacePredecessorRowsSchema, coordination: paymentMarketplaceCoordinationRowsSchema, checksum: hex });
export type PaymentMarketplaceWalletBackupEnvelope = z.infer<typeof envelopeSchema>;
export type PaymentMarketplaceWalletBackupInspection = Pick<PaymentMarketplaceWalletBackupEnvelope,
  "format" | "formatVersion" | "mode" | "schemaVersion" | "exportedAtMs" | "requestId" | "ownerId" | "checksum"> & {
  checkpoint: PaymentMarketplaceWalletBackupEnvelope["wallet"]["checkpoint"]; commandCount: number; walletChecksum: string;
  claimCount: number; disputeCount: number; cancellationCount: number; evidenceCount: number;
  canonicalRowCounts: Record<keyof PaymentMarketplaceCanonicalRows, number>;
  predecessorRowCounts: { initial: Record<keyof PaymentMarketplacePredecessorRows["initial"], number>;
    cancellation: Record<keyof PaymentMarketplacePredecessorRows["cancellation"], number> };
  coordinationRowCounts: Record<keyof PaymentMarketplaceCoordinationRows, number>; halted: true; credentialsIncluded: false;
};
function check(value: unknown, message: string): asserts value { if (!value) throw new WalletBackupError(message); }
const same = (a: unknown, b: unknown) => walletDigest(a) === walletDigest(b);
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function sqlTime(value: string) {
  const micros = timestampMicros(value); check(micros !== null, "Invalid payment canonical timestamp");
  return new Date(Number(micros / BigInt(1000))).toISOString().replace(/\.\d{3}Z$/, `.${String(micros % BigInt(1_000_000)).padStart(6, "0")}Z`);
}
function exportedRow<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(structuredClone(value)).map(([key, item]) => [key,
    key.endsWith("_at") && typeof item === "string" ? sqlTime(item) : item])) as T;
}
type ActionRow = PaymentMarketplaceCoordinationRows["claims"][number] | PaymentMarketplaceCoordinationRows["dispute_freezes"][number];
function actionKind(row: ActionRow) { return "claim_key" in row ? "claim" as const : "dispute" as const; }
function actionKey(row: ActionRow) { return "claim_key" in row ? row.claim_key : row.dispute_key; }
function restoreRow<T extends { id: string }>(rows: T[], row: T) {
  const index = rows.findIndex(value => value.id === row.id); check(index >= 0, "Missing payment canonical row during exact reconstruction"); rows[index] = row;
}
function rewindCanonical(envelope: PaymentMarketplaceWalletBackupEnvelope): PaymentMarketplaceCanonicalRows {
  const canonical = structuredClone(envelope.canonical);
  const actions: ActionRow[] = [...envelope.coordination.claims, ...envelope.coordination.dispute_freezes];
  for (const action of actions.sort((a, b) => b.wallet_command_revision - a.wallet_command_revision)) {
    const result = action.canonical_result, basis = action.canonical_basis;
    restoreRow(canonical.purchase_requests, exportedRow(basis.request)); restoreRow(canonical.listings, exportedRow(basis.listing));
    restoreRow(canonical.trades, exportedRow(basis.trade));
    const notices = new Set(result.notifications.map(row => row.id)), audits = new Set(result.auditLogs.map(row => row.id));
    const evidence = new Set(result.evidence.map(row => row.metadata.id)), disputes = new Set(result.disputes.map(row => row.id));
    canonical.notifications = canonical.notifications.filter(row => !notices.has(row.id));
    canonical.audit_logs = canonical.audit_logs.filter(row => !audits.has(row.id));
    canonical.evidence = canonical.evidence.filter(row => !evidence.has(row.id));
    canonical.disputes = canonical.disputes.filter(row => !disputes.has(row.id));
    for (const reminder of basis.reminders) restoreRow(canonical.notifications, exportedRow(reminder));
  }
  return canonical;
}
function sorted<T extends { id: string }>(rows: T[]): T[] { return [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function mutableMarketplace(canonical: PaymentMarketplaceCanonicalRows, action: ActionRow): DevelopmentPaymentMarketplace {
  return {
    users: canonical.users.map(user => ({ id: user.id, role: user.id === action.actor_user_id ? action.canonical_basis.actorRole : user.role,
      disabled: false, createdAt: new Date(user.created_at).toISOString(), updatedAt: new Date(user.updated_at).toISOString() })),
    marketplaceListings: canonical.listings.map(row => row.payload), purchaseRequests: canonical.purchase_requests.map(row => row.payload),
    commissionRecords: canonical.commissions.map(row => row.payload), sellerReviews: [],
    marketplaceEnforcementRecords: canonical.marketplace_enforcement_records.map(row => row.payload),
    tradeEvidenceFiles: canonical.evidence.map(row => row.payload), disputes: canonical.disputes.map(row => row.payload),
    notifications: [...canonical.notifications].sort((a, b) => a.sort_index - b.sort_index || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(row => row.payload),
  } as unknown as DevelopmentPaymentMarketplace;
}
function publication(row: ActionRow, envelope: PaymentMarketplaceWalletBackupEnvelope) {
  const activation = envelope.predecessor.initial.activations[0], kind = actionKind(row), r = row.receipt;
  return { type: kind === "claim" ? "initial_payment_claimed" : "initial_dispute_frozen", requestId: row.request_id,
    listingId: activation.platform_listing_id, tradeId: activation.platform_trade_id, walletTradeId: activation.wallet_trade_id,
    sellerId: activation.seller_id, buyerId: activation.buyer_id, actorUserId: row.actor_user_id, actorKind: "buyer", acceptanceKey: r.acceptanceKey,
    actionKey: actionKey(row), walletRevision: row.wallet_command_revision, walletEventHash: row.wallet_event_hash, termsDigest: r.termsDigest,
    principalRaw: r.principalRaw, transferAmountRaw: "0", paymentVerified: false,
    notificationIds: row.canonical_result.notifications.map(item => item.id), auditId: row.canonical_result.auditLogs[0].id,
    timelineEventId: (row.canonical_result.request.timeline as { id: string }[]).at(-1)!.id };
}
function applyCanonical(canonical: PaymentMarketplaceCanonicalRows, action: ActionRow, result: DevelopmentPaymentMarketplaceResult) {
  const basis = action.canonical_basis, at = result.request.updatedAt;
  restoreRow(canonical.purchase_requests, exportedRow({ ...basis.request, status: "payment_sent", updated_at: at, payload: plain(result.request) as unknown as Record<string, unknown> }));
  restoreRow(canonical.listings, exportedRow({ ...basis.listing, status: "in_trade", updated_at: result.listing.updatedAt, payload: plain(result.listing) as unknown as Record<string, unknown> }));
  restoreRow(canonical.trades, exportedRow({ ...basis.trade, status: "payment_sent", updated_at: at, payload: plain(result.trade) }));
  for (const [index, payload] of result.notifications.entries()) {
    check(!canonical.notifications.some(row => row.id === payload.id), "Duplicate payment notification identity");
    canonical.notifications.push({ id: payload.id, user_id: payload.userId, category: payload.category, is_read: false,
      created_at: sqlTime(at), sort_index: index, payload: plain(payload) as unknown as Record<string, unknown> });
  }
  for (const payload of result.notificationUpdates) {
    const before = basis.reminders.find(row => row.id === payload.id); check(before, "Payment reminder update has no exact captured source");
    restoreRow(canonical.notifications, exportedRow({ ...before, is_read: true, payload: plain(payload) as unknown as Record<string, unknown> }));
  }
  for (const payload of result.auditLogs) {
    check(!canonical.audit_logs.some(row => row.id === payload.id), "Duplicate payment audit identity");
    canonical.audit_logs.push({ id: payload.id, action: payload.action, actor_user_id: payload.actorUserId, target_user_id: payload.targetUserId ?? null,
      listing_id: payload.listingId ?? null, purchase_request_id: payload.purchaseRequestId ?? null, created_at: sqlTime(at), sort_index: 0,
      payload: plain(payload) as unknown as Record<string, unknown> });
  }
  for (const item of result.evidence) {
    const p = item.metadata;
    check(!canonical.evidence.some(row => row.id === p.id), "Duplicate payment evidence identity");
    canonical.evidence.push({ id: p.id, purchase_request_id: p.purchaseRequestId, side: p.side, uploaded_by_user_id: p.uploadedByUserId,
      mime_type: p.mimeType, file_name: p.fileName, size_bytes: p.sizeBytes, uploaded_at: sqlTime(p.uploadedAt), sort_index: 0,
      payload: plain(p) as unknown as Record<string, unknown>, content: item.contentBase64 });
  }
  for (const p of result.disputes) {
    check(!canonical.disputes.some(row => row.id === p.id), "Duplicate payment dispute identity");
    canonical.disputes.push({ id: p.id, trade_id: p.tradeId, purchase_request_id: p.purchaseRequestId, seller_id: p.sellerId, buyer_id: p.buyerId,
      status: p.status, created_at: sqlTime(p.createdAt), updated_at: sqlTime(p.updatedAt), sort_index: 0, payload: plain(p) as unknown as Record<string, unknown> });
  }
  for (const key of Object.keys(canonical) as (keyof PaymentMarketplaceCanonicalRows)[]) {
    if (key !== "runtime_meta") (canonical[key] as unknown[]) = sorted(canonical[key] as { id: string }[]);
  }
}
function verifyAction(envelope: PaymentMarketplaceWalletBackupEnvelope, state: V5State,
  canonical: PaymentMarketplaceCanonicalRows, action: ActionRow) {
  const kind = actionKind(action), key = actionKey(action), receipt = action.receipt, basis = action.canonical_basis;
  const activation = envelope.predecessor.initial.activations[0], acceptance = envelope.predecessor.initial.acceptances[0];
  const source = envelope.wallet.commands[action.wallet_command_revision - 1], command = parseV5Command(source?.command_json);
  const financial = kind === "claim" ? state.initialPaymentClaimReceipts.get(key) : state.initialDisputeFreezeReceipts.get(key);
  check(action.actor_user_id === activation.buyer_id && receipt.actorUserId === activation.buyer_id && receipt.actorKind === "buyer"
    && action.request_id === activation.request_id && receipt.platformRequestId === activation.request_id
    && receipt.platformTradeId === activation.platform_trade_id && receipt.platformListingId === activation.platform_listing_id
    && receipt.walletTradeId === activation.wallet_trade_id && receipt.walletListingId === activation.wallet_listing_id
    && receipt.acceptanceKey === acceptance.acceptance_key && receipt.transferAmountRaw === "0"
    && financial && same(financial, receipt) && same(source.result_json, receipt) && same(command.input, receipt.input)
    && source.command_type === (kind === "claim" ? "claimInitialPayment" : "freezeInitialDispute")
    && command.actor.kind === "buyer" && command.actor.id === action.actor_user_id
    && source.command_key === action.wallet_command_key && source.event_hash === action.wallet_event_hash
    && receipt.commandRevision === action.wallet_command_revision && receipt.commandKey === action.wallet_command_key,
  "Payment action receipt differs from its original buyer, accepted terms, zero-money financial result or command");
  const request = canonical.purchase_requests.find(row => row.id === activation.request_id);
  const listing = canonical.listings.find(row => row.id === activation.platform_listing_id);
  const trade = canonical.trades.find(row => row.id === activation.platform_trade_id);
  check(request && listing && trade && sameRow(request, basis.request) && sameRow(listing, basis.listing) && sameRow(trade, basis.trade)
    && receipt.input.preconditions.requestDigest === walletDigest(basis.request.payload)
    && receipt.input.preconditions.listingDigest === walletDigest(basis.listing.payload)
    && receipt.input.preconditions.tradeDigest === walletDigest(basis.trade.payload), "Payment action basis differs from the exact original canonical prestate");
  const reminders = canonical.notifications.filter(row => row.payload.reason === "automatic_trade_action_reminder"
    && row.payload.relatedRequestId === activation.request_id && row.payload.state !== "archived"
    && (row.user_id === activation.buyer_id || (kind === "dispute" && row.user_id === activation.seller_id)))
    .sort((a, b) => a.sort_index - b.sort_index || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  check(reminders.length === basis.reminders.length && reminders.every((row, index) => sameRow(row, basis.reminders[index])),
    "Payment action omits, changes or reorders its exact reminder archive scope");
  const existingEvidence = canonical.evidence.filter(row => row.purchase_request_id === activation.request_id);
  check(existingEvidence.length === basis.evidence.length && existingEvidence.every((row, index) => {
    const { content, ...metadataRow } = row;
    return content !== null && sameRow(metadataRow, basis.evidence[index].row)
      && createHash("sha256").update(Buffer.from(content, "base64")).digest("hex") === basis.evidence[index].contentDigest;
  }), "Payment action evidence basis changed or omitted original binary linkage");
  const marketplace = mutableMarketplace(canonical, action);
  let expected: DevelopmentPaymentMarketplaceResult;
  if (kind === "claim") {
    check(command.type === "claimInitialPayment", "Invalid payment claim command");
    const proof = command.input.claim.proof;
    const evidence = proof ? envelope.canonical.evidence.find(row => row.id === proof.evidenceId) : undefined;
    check(!proof || (evidence && evidence.content !== null), "Bank claim is missing its original private evidence bytes");
    const input = { kind: "alpha-wallet-initial-payment-claim-v1", actorUserId: action.actor_user_id, requestId: action.request_id,
      evidence: proof ? { mimeType: proof.mimeType, contentDigest: proof.contentSha256 } : null };
    check(action.input_digest === walletDigest(input), "Buyer payment business fingerprint changed");
    expected = plain(planDevelopmentPaymentClaim(marketplace, { requestId: action.request_id, tradeId: activation.platform_trade_id,
      actorUserId: action.actor_user_id, claimedAtMs: command.input.claimedAtMs,
      ...(proof ? { evidence: { mimeType: proof.mimeType, contentBase64: evidence!.content! } } : {}) }));
    check(same(action.canonical_input, expected.evidence.length ? { evidence: paymentCanonicalCommitment(expected).evidence[0] } : {}),
      "Claim private input differs from derived neutral evidence metadata");
    if (proof) check(expected.evidence[0].metadata.id === proof.evidenceId && expected.evidence[0].contentDigest === proof.contentSha256
      && expected.evidence[0].metadata.mimeType === proof.mimeType && expected.evidence[0].metadata.sizeBytes === proof.sizeBytes,
    "Claim bytes, safe financial proof and deterministic evidence identity disagree");
  } else {
    check(command.type === "freezeInitialDispute", "Invalid dispute freeze command");
    const reason = action.canonical_input.reason;
    check(reason !== undefined && same(action.canonical_input, { reason }) && sha(reason) === command.input.reasonDigest
      && action.input_digest === walletDigest({ kind: "alpha-wallet-initial-payment-dispute-v1", actorUserId: action.actor_user_id,
        requestId: action.request_id, reasonDigest: command.input.reasonDigest }), "Dispute normalized reason commitment or business fingerprint changed");
    const retained = existingEvidence.map(row => {
      check(row.content !== null, "Retained dispute evidence has no original bytes");
      const item = { metadata: row.payload as unknown as TradeEvidenceFile, contentBase64: row.content,
        contentDigest: createHash("sha256").update(Buffer.from(row.content, "base64")).digest("hex") };
      assertDevelopmentPaymentEvidence(item, request.payload as unknown as PurchaseRequest); return item;
    });
    expected = plain(planDevelopmentPaymentDispute(marketplace, { requestId: action.request_id, tradeId: activation.platform_trade_id,
      actorUserId: action.actor_user_id, openedAtMs: command.input.disputedAtMs, reason }, retained));
  }
  check(same(action.canonical_result, paymentCanonicalCommitment(expected)), "Payment canonical effects differ from the unchanged pure planner");
  const row = envelope.coordination.publications.find(value => value.operation === kind && value.action_key === key);
  check(row && row.id === action.publication_id && row.id === `payment-${kind}-publication-${key}` && same(row.payload, publication(action, envelope)),
    "Payment safe publication intent is missing, changed or contains private data");
  applyCanonical(canonical, action, expected);
}
function coordinatedHistory(envelope: PaymentMarketplaceWalletBackupEnvelope, state: V5State) {
  const { canonical, predecessor, coordination, wallet } = envelope;
  canonicalIdentities(canonical);
  check([...Object.values(canonical), ...Object.values(predecessor.initial), ...Object.values(predecessor.cancellation), ...Object.values(coordination)]
    .reduce((total, rows) => total + rows.length, 0) <= MAX_PAYMENT_MARKETPLACE_BACKUP_ROWS, "Payment combined backup exceeds its total row limit");
  const before = verifyV4History(wallet.commands.slice(0, state.paymentContinuation.checkpoint.revision));
  check(isV4State(before.state) && same(state.paymentContinuation.checkpoint, { revision: before.revision, eventHash: before.eventHash,
    stateHash: walletDigest(before.state), lastCommandAtMs: before.lastCommandAtMs }) && before.state.haltReason === state.paymentContinuation.sourceHaltReason,
  "Payment continuation differs from the exact original V4 checkpoint and inherited pause");
  const sourceCanonical = rewindCanonical(envelope), t = coordination.transitions[0], activation = predecessor.initial.activations[0];
  verifyPaymentMarketplacePredecessor({ requestId: envelope.requestId, ownerId: envelope.ownerId, canonical: sourceCanonical,
    predecessor: predecessor.initial, coordination: predecessor.cancellation,
    wallet: { commands: wallet.commands.slice(0, before.revision), initialContinuation: wallet.initialContinuation, cancellationContinuation: wallet.cancellationContinuation } }, before.state);
  const transitionCommand = wallet.commands[t.wallet_command_revision - 1], upgrade = parseV5Command(transitionCommand?.command_json);
  check(t.request_id === envelope.requestId && t.request_id === activation.request_id && canonical.users.some(user => user.id === t.actor_user_id)
    && t.input_digest === walletDigest({ kind: "alpha-wallet-initial-payment-upgrade-v1", actorUserId: t.actor_user_id, requestId: t.request_id })
    && same(t.predecessor, { initial: { activation, acceptance: predecessor.initial.acceptances[0], publication: predecessor.initial.publications[0] },
      cancellation: { transition: predecessor.cancellation.transitions[0], cancellation: predecessor.cancellation.cancellations[0] ?? null,
        publication: predecessor.cancellation.publications[0] ?? null } })
    && t.source_status === (predecessor.cancellation.cancellations.length ? "cancelled" : "accepted")
    && same(t.continuation, state.paymentContinuation) && same(t.wallet_checkpoint, state.paymentContinuation.checkpoint)
    && t.wallet_command_revision === state.paymentContinuation.commandRevision && t.wallet_command_key === state.paymentContinuation.commandKey
    && upgrade.type === "continueFromV4" && upgrade.actor.kind === "operator" && upgrade.actor.id === t.actor_user_id
    && same(upgrade.input.checkpoint, t.wallet_checkpoint) && same(transitionCommand.result_json, t.continuation)
    && transitionCommand.command_key === t.wallet_command_key && transitionCommand.event_hash === t.wallet_event_hash,
  "Payment transition differs from its exact predecessor evidence or original explicit owner continuation");
  const tail = wallet.commands.slice(t.wallet_command_revision);
  check(coordination.claims.length === state.initialPaymentClaimReceipts.size && coordination.dispute_freezes.length === state.initialDisputeFreezeReceipts.size
    && coordination.publications.length === coordination.claims.length + coordination.dispute_freezes.length
    && tail.filter(row => row.command_type === "claimInitialPayment").length === coordination.claims.length
    && tail.filter(row => row.command_type === "freezeInitialDispute").length === coordination.dispute_freezes.length
    && tail.every(row => { const command = parseV5Command(row.command_json); return command.type === "pause"
      || (command.type === "claimInitialPayment" || command.type === "freezeInitialDispute") && command.input.terms.platformRequestId === activation.request_id; })
    && (t.source_status === "accepted" || coordination.claims.length === 0 && coordination.dispute_freezes.length === 0),
  "Payment successor contains missing, extra or unsupported command/receipt/publication progress");
  for (const action of [...coordination.claims, ...coordination.dispute_freezes].sort((a, b) => a.wallet_command_revision - b.wallet_command_revision)) {
    check(action.wallet_command_revision > t.wallet_command_revision, "Payment action predates its explicit profile continuation");
    verifyAction(envelope, state, sourceCanonical, action);
  }
  check(same(sourceCanonical, canonical), "Payment canonical rows differ from complete exact forward reconstruction");
}

/** Integrity and consistency only. Historical owner labels never grant restored authority. */
export function parsePaymentMarketplaceWalletBackup(serialized: string, expectedChecksum?: string): PaymentMarketplaceWalletBackupEnvelope {
  assertSimulationRuntime("simulation-only");
  try {
    check(typeof serialized === "string" && serialized.length > 0 && serialized.length <= MAX_WALLET_BACKUP_BYTES
      && Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES, "Payment marketplace backup exceeds its byte limit");
    const document: unknown = JSON.parse(serialized); checkJsonTree(document);
    const envelope = envelopeSchema.parse(document), { checksum, ...body } = envelope;
    check(walletDigest(body) === checksum, "Payment marketplace backup checksum mismatch");
    if (expectedChecksum !== undefined) check(hex.safeParse(expectedChecksum).success && checksum === expectedChecksum,
      "Payment marketplace backup differs from its separately retained expected checksum");
    checkJsonTree(envelope.canonical, true); checkJsonTree(envelope.predecessor, true); checkJsonTree(envelope.coordination, true);
    const { checksum: walletChecksum, ...walletBody } = envelope.wallet;
    check(walletDigest(walletBody) === walletChecksum, "Payment nested wallet checksum mismatch");
    const replay = verifyV5History(envelope.wallet.commands);
    check(isV5State(replay.state) && Boolean(replay.state.haltReason), "Payment combined backup requires a durably paused V5 source");
    check(envelope.wallet.commands.length === replay.revision && same(envelope.wallet.checkpoint, { revision: replay.revision,
      eventHash: replay.eventHash, stateHash: walletDigest(replay.state), lastCommandAtMs: replay.lastCommandAtMs }), "Payment nested checkpoint differs from original replay");
    check(same(envelope.wallet.continuation, replay.state.continuation) && same(envelope.wallet.initialContinuation, replay.state.initialContinuation)
      && same(envelope.wallet.cancellationContinuation, replay.state.cancellationContinuation) && same(envelope.wallet.paymentContinuation, replay.state.paymentContinuation)
      && envelope.wallet.exportedAtMs >= replay.lastCommandAtMs && envelope.exportedAtMs >= envelope.wallet.exportedAtMs,
    "Payment continuation inventory or export chronology disagrees");
    coordinatedHistory(envelope, replay.state);
    return envelope;
  } catch (error) {
    if (error instanceof WalletBackupError) throw error;
    throw new WalletBackupError("Unsupported, malformed, truncated or inconsistent payment marketplace/wallet backup");
  }
}
const counts = <T extends Record<string, unknown[]>>(rows: T) => Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values.length])) as Record<keyof T, number>;
/** Detached metadata only; private evidence bytes, reasons, profiles and destinations remain absent. */
export function inspectPaymentMarketplaceWalletBackup(serialized: string, options: { expectedChecksum?: string } = {}): PaymentMarketplaceWalletBackupInspection {
  const e = parsePaymentMarketplaceWalletBackup(serialized, options.expectedChecksum);
  return { format: e.format, formatVersion: e.formatVersion, mode: e.mode, schemaVersion: e.schemaVersion, exportedAtMs: e.exportedAtMs,
    requestId: e.requestId, ownerId: e.ownerId, checksum: e.checksum, checkpoint: structuredClone(e.wallet.checkpoint), commandCount: e.wallet.commands.length,
    walletChecksum: e.wallet.checksum, claimCount: e.coordination.claims.length, disputeCount: e.coordination.dispute_freezes.length,
    cancellationCount: e.predecessor.cancellation.cancellations.length, evidenceCount: e.canonical.evidence.length,
    canonicalRowCounts: counts(e.canonical), predecessorRowCounts: { initial: counts(e.predecessor.initial), cancellation: counts(e.predecessor.cancellation) },
    coordinationRowCounts: counts(e.coordination), halted: true, credentialsIncluded: false };
}
