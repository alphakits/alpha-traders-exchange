import "server-only";

import { z } from "zod";
import { areTradeAmountsLocked } from "@/lib/trade-amount-lock";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import type { MarketplaceListing, PurchaseRequest, TradeDisputeCase, TradeEvidenceFile } from "@/types/alpha-exchange";
import { describeDevelopmentTradeTerms, planAcceptedAmountTerms } from "./accepted-terms";
import { assetFor, parseUnits } from "./amounts";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS, WALLET_BACKUP_FORMAT, WalletBackupError } from "./backup";
import { walletDigest } from "./commands";
import { balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import { acceptanceInputFromPlan, parseV2Command, v2TermsSchema, WALLET_V2_ENGINE_VERSION } from "./v2-commands";
import { isV2State, planningBindingFor, type V2AcceptanceReceipt, type V2State } from "./v2-engine";
import { inspectVersionedWalletBackup } from "./versioned-backup";
import { verifyVersionedHistory } from "./versioned-durable";

export const MARKETPLACE_WALLET_BACKUP_FORMAT = "alpha-wallet-marketplace-simulation-backup" as const;
export const MARKETPLACE_WALLET_BACKUP_SCHEMA = "canonical-cohort-v1" as const;
export const MAX_MARKETPLACE_BACKUP_ROWS_PER_TABLE = 1_000;
export const MAX_MARKETPLACE_BACKUP_ROWS = 10_000;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const eventId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const safeTime = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  .refine(value => Number.isFinite(new Date(value).getTime()));
const safeRevision = z.number().int().min(0).max(MAX_WALLET_BACKUP_COMMANDS);
const positiveRevision = safeRevision.refine(value => value > 0);
const sortIndex = z.number().int().min(0).max(2_147_483_647);
const record = z.record(z.string(), z.unknown());
const label = z.string().min(1).max(100);
const role = z.enum(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);
const sellerStatus = z.enum(["buyer", "pending_seller_approval", "approved_seller", "rejected", "suspended"]);
const asset = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
const signedRaw = z.string().regex(/^(?:0|-?[1-9]\d{0,77})$/);

/** PostgreSQL's microseconds are retained; JSON/Date millisecond truncation is not a backup. */
function timestampMicros(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value)) return null;
  const millisecondIso = `${value.slice(0, 23)}Z`;
  const time = Date.parse(millisecondIso);
  if (!Number.isFinite(time) || time < 0 || new Date(time).toISOString() !== millisecondIso) return null;
  return BigInt(time) * BigInt(1_000) + BigInt(value.length === 27 ? value.slice(23, 26) : "0");
}
const sqlTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine(value => timestampMicros(value) !== null);
const pgVersion = z.string().regex(/^(?:0|[1-9]\d{0,18})$/).refine(value => BigInt(value) <= BigInt("9223372036854775807"));
const rows = <T extends z.ZodType>(schema: T) => z.array(schema).max(MAX_MARKETPLACE_BACKUP_ROWS_PER_TABLE);

/** A fixed development fixture profile, not an arbitrary SQL/database dump. */
export const marketplaceCanonicalRowsSchema = z.strictObject({
  runtime_meta: rows(z.strictObject({ singleton: z.literal(true), version: pgVersion, updated_at: sqlTime })).length(1),
  purchase_requests: rows(z.strictObject({ id, trade_id: id.nullable(), listing_id: id, buyer_id: id,
    seller_id: id, status: label, updated_at: sqlTime, payload: record })).min(1),
  // Only identifiers and role labels cross this boundary. No profile, login,
  // password hash, verification evidence, session or authentication token does.
  users: rows(z.strictObject({ id, role, seller_status: sellerStatus })).min(2),
  listings: rows(z.strictObject({ id, seller_id: id, payload: record, status: label, active_trade_request_id: id.nullable() })).min(1),
  commissions: rows(z.strictObject({ id: eventId, seller_id: id, payload: record,
    purchase_request_id: id.nullable(), listing_id: id.nullable(), buyer_id: id.nullable() })),
  trust_snapshots: rows(z.strictObject({ seller_id: id, payload: record })),
  evidence: rows(z.strictObject({ id: eventId, purchase_request_id: id, payload: record })),
  disputes: rows(z.strictObject({ id: eventId, purchase_request_id: id, payload: record })),
  notifications: rows(z.strictObject({ id: eventId, user_id: id, category: label, is_read: z.boolean(),
    created_at: sqlTime, sort_index: sortIndex, payload: record })),
  audit_logs: rows(z.strictObject({ id: eventId, action: label, actor_user_id: id, target_user_id: id.nullable(),
    listing_id: id.nullable(), purchase_request_id: id.nullable(), created_at: sqlTime, sort_index: sortIndex, payload: record })),
  activity_logs: rows(z.strictObject({ id: eventId, user_id: id, category: label,
    created_at: sqlTime, sort_index: sortIndex, payload: record })),
  trades: rows(z.strictObject({ id, purchase_request_id: id, listing_id: id, seller_id: id,
    buyer_id: id, status: label, payload: record })),
});
export type MarketplaceCanonicalRows = z.infer<typeof marketplaceCanonicalRowsSchema>;

const bindingSchema = z.strictObject({
  platformRequestId: id, platformListingId: id, walletListingId: id, walletTradeId: id, assetId: asset,
  revision: z.literal(0), terms: v2TermsSchema, termsDigest: hex, walletTradeDigest: hex, enrollmentTermsDigest: hex,
  enrollmentCommandRevision: positiveRevision, enrollmentCommandKey: z.string().min(1).max(512),
  lastCommandRevision: positiveRevision, lastCommandKey: z.string().min(1).max(512), lastSubmittedAdjustmentCount: z.literal(0),
});
const acceptanceReceiptSchema = z.strictObject({
  acceptanceKey: hex, platformRequestId: id, proposalId: id, actorUserId: id, walletTradeId: id,
  commandRevision: positiveRevision, commandKey: z.string().min(1).max(512), inputDigest: hex, plannerInputDigest: hex,
  priorTermsDigest: hex, acceptedTermsDigest: hex, bindingRevision: z.number().int().min(1).max(2),
  principalDeltaRaw: signedRaw, transferAmountRaw: raw, terms: v2TermsSchema, acceptedAtMs: safeTime,
});
const publicationPayloadSchema = z.strictObject({
  type: z.literal("amount_correction_accepted"), requestId: id, listingId: id, tradeId: id.nullable(), proposalId: id,
  buyerId: id, sellerId: id, bindingRevision: z.number().int().min(1).max(2), walletRevision: positiveRevision,
  walletEventHash: hex, termsDigest: hex, notificationIds: z.array(eventId).length(1), auditId: eventId, messageId: eventId,
});
export const marketplaceCoordinationRowsSchema = z.strictObject({
  enrollments: z.array(z.strictObject({ request_id: id, cohort: z.literal(true), platform_listing_id: id,
    platform_trade_id: id.nullable(), wallet_listing_id: id, wallet_trade_id: id, buyer_id: id, seller_id: id,
    asset_id: asset, actor_user_id: id, input_digest: hex, wallet_command_revision: positiveRevision,
    wallet_command_key: z.string().min(1).max(512), wallet_event_hash: hex, binding: bindingSchema })).length(1),
  // The installed coordinator has no operation that submits a second proposal.
  // Widening this cohort requires a format/schema/lifecycle change together.
  acceptances: z.array(z.strictObject({ acceptance_key: hex, request_id: id, proposal_id: id, actor_user_id: id,
    input_digest: hex, wallet_command_revision: positiveRevision, wallet_command_key: z.string().min(1).max(512),
    wallet_event_hash: hex, receipt: acceptanceReceiptSchema, publication_id: eventId })).max(1),
  publications: z.array(z.strictObject({ id: eventId, acceptance_key: hex, payload: publicationPayloadSchema })).max(1),
});
export type MarketplaceCoordinationRows = z.infer<typeof marketplaceCoordinationRowsSchema>;
export type MarketplaceRecoveryRows = { canonical: MarketplaceCanonicalRows; coordination: MarketplaceCoordinationRows };

const checkpointSchema = z.strictObject({ revision: safeRevision, eventHash: hex, stateHash: hex, lastCommandAtMs: safeTime });
const walletRecordSchema = z.strictObject({
  revision: positiveRevision, command_key: z.string().min(1).max(512), command_type: z.string().min(1).max(80),
  occurred_at_ms: z.string().regex(/^(?:0|[1-9]\d{0,15})$/).refine(value => safeTime.safeParse(Number(value)).success),
  command_json: z.unknown().refine(value => value !== undefined), input_hash: hex,
  result_json: z.unknown().refine(value => value !== undefined), result_hash: hex,
  state_hash: hex, previous_event_hash: hex, event_hash: hex,
});
const walletEnvelopeSchema = z.strictObject({
  format: z.literal(WALLET_BACKUP_FORMAT), formatVersion: z.literal(2), mode: z.literal("simulation-only"),
  engineVersion: z.literal(WALLET_V2_ENGINE_VERSION), exportedAtMs: safeTime, checkpoint: checkpointSchema,
  continuation: z.strictObject({ checkpoint: checkpointSchema, commandRevision: positiveRevision, commandKey: z.string().min(1).max(512) }),
  commands: z.array(walletRecordSchema).min(1).max(MAX_WALLET_BACKUP_COMMANDS), checksum: hex,
});
const envelopeSchema = z.strictObject({
  format: z.literal(MARKETPLACE_WALLET_BACKUP_FORMAT), formatVersion: z.literal(1), mode: z.literal("simulation-only"),
  schemaVersion: z.literal(MARKETPLACE_WALLET_BACKUP_SCHEMA), exportedAtMs: safeTime, requestId: id, ownerId: id,
  wallet: walletEnvelopeSchema, canonical: marketplaceCanonicalRowsSchema, coordination: marketplaceCoordinationRowsSchema, checksum: hex,
});
export type MarketplaceWalletBackupEnvelope = z.infer<typeof envelopeSchema>;
export type MarketplaceWalletBackupInspection = Pick<MarketplaceWalletBackupEnvelope,
  "format" | "formatVersion" | "mode" | "schemaVersion" | "exportedAtMs" | "requestId" | "ownerId" | "checksum"> & {
    checkpoint: MarketplaceWalletBackupEnvelope["wallet"]["checkpoint"];
    commandCount: number; walletChecksum: string;
    canonicalRowCounts: { [K in keyof MarketplaceCanonicalRows]: number };
    coordinationRowCounts: { [K in keyof MarketplaceCoordinationRows]: number };
    halted: true; credentialsIncluded: false;
  };

function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletBackupError(message);
}
const same = (left: unknown, right: unknown) => walletDigest(left) === walletDigest(right);
const absent = (value: unknown) => value === undefined || value === null;
const nullable = (value: unknown) => value ?? null;
function sameTime(left: unknown, right: unknown) {
  const a = timestampMicros(left), b = timestampMicros(right);
  return a !== null && b !== null && a === b;
}
function unique<T>(values: T[], key: (value: T) => unknown) {
  verify(new Set(values.map(key)).size === values.length, "Duplicate canonical or coordination identity in marketplace backup");
}
function ordered<T>(values: T[], key: (value: T) => string) {
  verify(values.every((value, index) => index === 0 || key(values[index - 1]) < key(value)),
    "Marketplace backup rows must retain their deterministic identity order");
}
function payloadArray(value: unknown): Record<string, unknown>[] {
  verify(Array.isArray(value) && value.every(item => item !== null && typeof item === "object" && !Array.isArray(item)),
    "Malformed canonical history in marketplace backup");
  return value as Record<string, unknown>[];
}

/** Limit traversal before recursively canonicalizing untrusted JSON. */
function checkJsonTree(value: unknown, rejectCredentials = false) {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let visited = 0;
  const credentials = new Set(["password", "passwordhash", "tokenhash", "sessiontoken", "accesstoken", "refreshtoken",
    "passwordresettoken", "emailverificationtoken", "authorization", "cookie", "privatekey", "signingkey", "mnemonic"]);
  while (pending.length) {
    const next = pending.pop()!;
    verify(++visited <= 250_000 && next.depth <= 64, "Marketplace backup nesting or item limit exceeded");
    if (next.value === null || typeof next.value !== "object") {
      verify(typeof next.value !== "number" || Number.isFinite(next.value), "Non-finite marketplace backup value");
      continue;
    }
    for (const [key, item] of Object.entries(next.value)) {
      verify(!["__proto__", "prototype", "constructor"].includes(key), "Unsupported marketplace backup object key");
      if (rejectCredentials) verify(!credentials.has(key.replace(/[_-]/g, "").toLowerCase()),
        "Authentication material is outside the marketplace recovery format");
      pending.push({ value: item, depth: next.depth + 1 });
    }
  }
}

function canonicalIdentities(canonical: MarketplaceCanonicalRows) {
  const count = Object.values(canonical).reduce((total, collection) => total + collection.length, 0);
  verify(count <= MAX_MARKETPLACE_BACKUP_ROWS, "Marketplace backup total row limit exceeded");
  for (const [table, collection] of Object.entries(canonical)) {
    if (table !== "runtime_meta") {
      const key = (row: Record<string, unknown>) => String(table === "trust_snapshots" ? row.seller_id : row.id);
      unique(collection as Record<string, unknown>[], key);
      ordered(collection as Record<string, unknown>[], key);
    }
  }
  const users = new Map(canonical.users.map(row => [row.id, row]));
  const requests = new Map(canonical.purchase_requests.map(row => [row.id, row]));
  const listings = new Map(canonical.listings.map(row => [row.id, row]));
  const trades = new Map(canonical.trades.map(row => [row.id, row]));
  unique(canonical.purchase_requests.filter(row => row.trade_id !== null), row => row.trade_id);
  unique(canonical.trades, row => row.purchase_request_id);
  for (const row of canonical.purchase_requests) {
    const p = row.payload;
    verify(p.id === row.id && nullable(p.tradeId) === row.trade_id && p.listingId === row.listing_id && p.buyerId === row.buyer_id
      && p.sellerId === row.seller_id && p.status === row.status && sameTime(row.updated_at, p.updatedAt)
      && users.has(row.buyer_id) && users.has(row.seller_id) && row.buyer_id !== row.seller_id
      && listings.get(row.listing_id)?.seller_id === row.seller_id,
    "Canonical request identity, chronology or participant closure disagrees");
    if (p.timeline !== undefined) payloadArray(p.timeline);
    if (p.messages !== undefined) {
      const messages = payloadArray(p.messages);
      unique(messages, message => message.id);
      verify(messages.every(message => typeof message.id === "string" && message.purchaseRequestId === row.id),
        "Canonical message identity disagrees");
    }
  }
  for (const row of canonical.listings) {
    const p = row.payload;
    verify(p.id === row.id && p.sellerId === row.seller_id && p.status === row.status
      && nullable(p.activeTradeRequestId) === row.active_trade_request_id && users.has(row.seller_id)
      && (row.active_trade_request_id === null || requests.get(row.active_trade_request_id)?.listing_id === row.id),
    "Canonical listing identity or active-request closure disagrees");
  }
  for (const row of canonical.trades) {
    const p = row.payload, request = requests.get(row.purchase_request_id);
    verify(request && row.id === (request.trade_id ?? request.id) && row.listing_id === request.listing_id
      && row.buyer_id === request.buyer_id && row.seller_id === request.seller_id && row.status === request.status
      && p.id === row.id && p.purchaseRequestId === row.purchase_request_id && p.listingId === row.listing_id
      && p.sellerId === row.seller_id && p.buyerId === row.buyer_id && p.status === row.status
      && same(p.timeline ?? [], request.payload.timeline ?? []), "Canonical derived trade projection disagrees");
  }
  for (const row of canonical.commissions) {
    const p = row.payload;
    verify(p.id === row.id && p.sellerId === row.seller_id && nullable(p.purchaseRequestId) === row.purchase_request_id
      && nullable(p.listingId) === row.listing_id && nullable(p.buyerId) === row.buyer_id
      && users.has(row.seller_id) && (row.buyer_id === null || users.has(row.buyer_id))
      && (row.purchase_request_id === null || requests.has(row.purchase_request_id))
      && (row.listing_id === null || listings.has(row.listing_id)), "Canonical commission identity or closure disagrees");
  }
  for (const row of canonical.trust_snapshots) verify(row.payload.sellerId === row.seller_id && users.has(row.seller_id),
    "Canonical trust snapshot identity disagrees");
  for (const row of [...canonical.evidence, ...canonical.disputes]) verify(row.payload.id === row.id
    && row.payload.purchaseRequestId === row.purchase_request_id && requests.has(row.purchase_request_id),
  "Canonical evidence or dispute identity disagrees");
  for (const row of canonical.notifications) {
    const p = row.payload;
    verify(p.id === row.id && p.userId === row.user_id && p.category === row.category && p.isRead === row.is_read
      && sameTime(row.created_at, p.createdAt) && users.has(row.user_id), "Canonical notification identity or timestamp disagrees");
    const relatedRequest = absent(p.relatedRequestId) ? undefined : requests.get(String(p.relatedRequestId));
    const relatedTrade = absent(p.relatedTradeId) ? undefined : trades.get(String(p.relatedTradeId));
    verify((absent(p.relatedRequestId) || relatedRequest) && (absent(p.relatedTradeId) || relatedTrade)
      && (absent(p.relatedListingId) || listings.has(String(p.relatedListingId)))
      && (!relatedRequest || absent(p.relatedTradeId) || relatedRequest.trade_id === p.relatedTradeId)
      && (!relatedRequest || absent(p.relatedListingId) || relatedRequest.listing_id === p.relatedListingId)
      && (!relatedTrade || absent(p.relatedListingId) || relatedTrade.listing_id === p.relatedListingId),
    "Canonical notification links disagree");
  }
  for (const row of canonical.audit_logs) {
    const p = row.payload;
    verify(p.id === row.id && p.action === row.action && p.actorUserId === row.actor_user_id
      && nullable(p.targetUserId) === row.target_user_id && nullable(p.listingId) === row.listing_id
      && nullable(p.purchaseRequestId) === row.purchase_request_id && sameTime(row.created_at, p.createdAt)
      && users.has(row.actor_user_id)
      && (row.target_user_id === null || users.has(row.target_user_id))
      && (row.listing_id === null || listings.has(row.listing_id))
      && (row.purchase_request_id === null || requests.has(row.purchase_request_id)), "Canonical audit identity or closure disagrees");
  }
  for (const row of canonical.activity_logs) verify(row.payload.id === row.id && row.payload.userId === row.user_id
    && row.payload.category === row.category && sameTime(row.created_at, row.payload.createdAt) && users.has(row.user_id),
  "Canonical activity identity or timestamp disagrees");
  return { users, requests, listings, trades };
}

function publicEnrollmentDigest(row: MarketplaceCoordinationRows["enrollments"][number]) {
  return walletDigest({ kind: "marketplace-enrollment-v1", actorUserId: row.actor_user_id, requestId: row.request_id,
    walletListingId: row.wallet_listing_id, walletTradeId: row.wallet_trade_id, assetId: row.asset_id });
}
function publicAcceptanceDigest(receipt: V2AcceptanceReceipt) {
  return walletDigest({ kind: "marketplace-amount-acceptance-v1", actorUserId: receipt.actorUserId,
    requestId: receipt.platformRequestId, proposalId: receipt.proposalId, expectedBindingRevision: receipt.bindingRevision - 1 });
}
function safePublication(row: MarketplaceCoordinationRows["acceptances"][number], enrollment: MarketplaceCoordinationRows["enrollments"][number]) {
  return { type: "amount_correction_accepted", requestId: row.request_id, listingId: enrollment.platform_listing_id,
    tradeId: enrollment.platform_trade_id, proposalId: row.proposal_id, buyerId: enrollment.buyer_id, sellerId: enrollment.seller_id,
    bindingRevision: row.receipt.bindingRevision, walletRevision: row.wallet_command_revision, walletEventHash: row.wallet_event_hash,
    termsDigest: row.receipt.acceptedTermsDigest, notificationIds: [`wallet-notification-${row.acceptance_key}`],
    auditId: `wallet-audit-${row.acceptance_key}`, messageId: `wallet-message-${row.acceptance_key}` };
}

/** Recover the exact pre-acceptance JSON using the immutable planner fingerprint. */
function requestBeforeAcceptance(request: PurchaseRequest, receipt: V2AcceptanceReceipt, envelope: MarketplaceWalletBackupEnvelope) {
  const record = envelope.wallet.commands[receipt.commandRevision - 1];
  const command = parseV2Command(record.command_json);
  verify(command.type === "acceptAmountCorrection", "Acceptance command is missing from marketplace backup");
  const proposal = request.termsProposal;
  verify(proposal?.id === receipt.proposalId && proposal.kind === "amount_correction" && proposal.status === "accepted"
    && proposal.resolvedAt === new Date(receipt.acceptedAtMs).toISOString(), "Canonical accepted proposal disagrees with its receipt");
  const previous = envelope.coordination.enrollments[0].binding.terms;
  const before = structuredClone(request);
  before.updatedAt = command.input.preconditions.requestUpdatedAt;
  before.usdtAmount = previous.usdtAmount;
  before.fiatAmount = previous.fiatAmount;
  before.pricePerUsdt = previous.pricePerUsdt;
  before.termsProposal!.status = "pending";
  delete before.termsProposal!.resolvedAt;
  before.messages = (request.messages ?? []).slice(1);
  // The legacy canonical mapper can retain exact safe numeric amounts. The
  // original hash chooses their representation; no rounding or coercion wins.
  for (let numeric = 0; numeric < 8; numeric++) {
    for (const missingMessages of [false, true]) {
      if (missingMessages && before.messages.length > 0) continue;
      const candidate = structuredClone(before) as unknown as Record<string, unknown>;
      for (const [index, key] of ["usdtAmount", "fiatAmount", "pricePerUsdt"].entries()) {
        if (numeric & (1 << index)) candidate[key] = Number(candidate[key]);
      }
      if (missingMessages) delete candidate.messages;
      if (walletDigest(candidate) === command.input.preconditions.requestDigest) return candidate as unknown as PurchaseRequest;
    }
  }
  throw new WalletBackupError("Canonical request no longer matches the accepted command's immutable prior snapshot");
}

function verifyAcceptanceEffects(envelope: MarketplaceWalletBackupEnvelope, request: PurchaseRequest, row: MarketplaceCoordinationRows["acceptances"][number]) {
  const receipt = row.receipt, enrollment = envelope.coordination.enrollments[0];
  const at = new Date(receipt.acceptedAtMs).toISOString();
  const message = `Trade terms accepted: ${receipt.terms.usdtAmount} USDT for ${receipt.terms.currency} ${receipt.terms.fiatAmount}.`;
  const messageId = `wallet-message-${receipt.acceptanceKey}`;
  const currentMessage = request.messages?.[0];
  verify(currentMessage && role.safeParse(currentMessage.senderRole).success && same(currentMessage, {
    id: messageId, purchaseRequestId: request.id, kind: "system", senderUserId: receipt.actorUserId,
    senderRole: currentMessage.senderRole, message, createdAt: at, readByUserIds: [],
  }), "Canonical acceptance system message is missing or changed");
  verify(envelope.canonical.purchase_requests.reduce((count, record) => count
    + ((record.payload.messages as Record<string, unknown>[] | undefined) ?? []).filter(item => item.id === messageId).length, 0) === 1,
  "Canonical acceptance system message identity is duplicated");
  const notification = envelope.canonical.notifications.find(item => item.id === `wallet-notification-${receipt.acceptanceKey}`);
  const audit = envelope.canonical.audit_logs.find(item => item.id === `wallet-audit-${receipt.acceptanceKey}`);
  verify(notification && notification.user_id === enrollment.seller_id && notification.category === "trade"
    && notification.is_read === false && sameTime(notification.created_at, at) && same(notification.payload, {
      id: notification.id, userId: enrollment.seller_id, category: "trade", title: "Trade proposal updated", message, isRead: false,
      relatedRequestId: request.id, ...(enrollment.platform_trade_id === null ? {} : { relatedTradeId: enrollment.platform_trade_id }),
      relatedListingId: enrollment.platform_listing_id, createdAt: at,
    }), "Canonical acceptance notification is missing or changed");
  verify(audit && audit.actor_user_id === receipt.actorUserId && audit.target_user_id === null && audit.purchase_request_id === request.id
    && audit.listing_id === enrollment.platform_listing_id && audit.action === "trade_amount_correction_accepted"
    && sameTime(audit.created_at, at) && same(audit.payload, { id: audit.id, actorUserId: receipt.actorUserId,
      action: "trade_amount_correction_accepted", purchaseRequestId: request.id, listingId: enrollment.platform_listing_id,
      details: message, reason: "development_wallet_amount_acceptance", createdAt: at }),
  "Canonical acceptance audit is missing or changed");
  verify(request.updatedAt === at, "Canonical acceptance timestamp disagrees");

  const before = requestBeforeAcceptance(request, receipt, envelope);
  const priorWallet = verifyVersionedHistory(envelope.wallet.commands.slice(0, receipt.commandRevision - 1));
  verify(isV2State(priorWallet.state), "Acceptance lacks its verified v2 prior state");
  const sorted = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const plan = planAcceptedAmountTerms({ mode: "simulation-only", actorUserId: receipt.actorUserId,
    requestId: request.id, proposalId: receipt.proposalId, expectedBindingRevision: receipt.bindingRevision - 1,
    marketplace: {
      purchaseRequests: sorted(envelope.canonical.purchase_requests.map(item => item.id === request.id ? before : item.payload as unknown as PurchaseRequest)),
      marketplaceListings: sorted(envelope.canonical.listings.map(item => item.payload as unknown as MarketplaceListing)),
      tradeEvidenceFiles: sorted(envelope.canonical.evidence.filter(item => item.purchase_request_id === request.id)
        .map(item => item.payload as unknown as TradeEvidenceFile)),
      disputes: sorted(envelope.canonical.disputes.filter(item => item.purchase_request_id === request.id)
        .map(item => item.payload as unknown as TradeDisputeCase)),
    }, wallet: priorWallet, binding: planningBindingFor(priorWallet.state, request.id),
  });
  const command = parseV2Command(envelope.wallet.commands[receipt.commandRevision - 1].command_json);
  verify(command.type === "acceptAmountCorrection" && same(acceptanceInputFromPlan(plan), command.input),
    "Canonical acceptance preconditions disagree with the exact verified wallet command");
}

function coordinatedHistory(envelope: MarketplaceWalletBackupEnvelope, state: V2State) {
  const { canonical, coordination, wallet } = envelope;
  verify([...Object.values(canonical), ...Object.values(coordination)].reduce((total, collection) => total + collection.length, 0)
    <= MAX_MARKETPLACE_BACKUP_ROWS, "Marketplace backup total row limit exceeded");
  const identities = canonicalIdentities(canonical);
  const enrollment = coordination.enrollments[0];
  const requestRow = identities.requests.get(envelope.requestId);
  verify(identities.users.get(envelope.ownerId)?.role === "owner" && enrollment.request_id === envelope.requestId && requestRow,
    "Marketplace backup needs its retained owner identity and enrolled canonical request");
  const request = requestRow.payload as unknown as PurchaseRequest;
  const listingRow = identities.listings.get(enrollment.platform_listing_id);
  const binding = state.termsBindings.get(envelope.requestId);
  verify(state.termsBindings.size === 1 && binding && listingRow && identities.users.has(enrollment.actor_user_id),
    "Marketplace recovery supports exactly one complete enrolled cohort");
  const listing = listingRow.payload as unknown as MarketplaceListing;
  const enrolledCommand = wallet.commands[enrollment.wallet_command_revision - 1];
  const command = parseV2Command(enrolledCommand?.command_json);
  verify(command.type === "enrollReservedTrade" && command.actor.kind === "operator" && command.actor.id === enrollment.actor_user_id
    && enrolledCommand.command_key === enrollment.wallet_command_key && enrolledCommand.event_hash === enrollment.wallet_event_hash
    && same(enrolledCommand.result_json, enrollment.binding) && enrollment.input_digest === publicEnrollmentDigest(enrollment)
    && enrollment.binding.enrollmentCommandRevision === enrollment.wallet_command_revision
    && enrollment.binding.enrollmentCommandKey === enrollment.wallet_command_key
    && enrollment.binding.lastCommandRevision === enrollment.wallet_command_revision && enrollment.binding.lastCommandKey === enrollment.wallet_command_key
    && enrollment.binding.platformRequestId === enrollment.request_id && enrollment.binding.platformListingId === enrollment.platform_listing_id
    && enrollment.binding.walletListingId === enrollment.wallet_listing_id && enrollment.binding.walletTradeId === enrollment.wallet_trade_id
    && enrollment.binding.assetId === enrollment.asset_id && enrollment.binding.terms.platformTradeId === enrollment.platform_trade_id
    && enrollment.binding.terms.buyerId === enrollment.buyer_id && enrollment.binding.terms.sellerId === enrollment.seller_id
    && binding.enrollmentCommandRevision === enrollment.wallet_command_revision && binding.enrollmentCommandKey === enrollment.wallet_command_key
    && binding.enrollmentTermsDigest === enrollment.binding.termsDigest && binding.walletTradeId === enrollment.wallet_trade_id
    && binding.walletListingId === enrollment.wallet_listing_id && binding.assetId === enrollment.asset_id,
  "Marketplace enrollment differs from its verified original wallet command");
  const later = wallet.commands.slice(enrollment.wallet_command_revision);
  verify(later.length > 0 && later.every(row => {
    const command = parseV2Command(row.command_json);
    return command.type === "pause" || command.type === "acceptAmountCorrection";
  }) && later[later.length - 1].command_type === "pause", "Enrolled wallet history has an unsupported transition or lacks an owner pause");
  verify(request.status === "accepted" && request.listingId === enrollment.platform_listing_id
    && (request.tradeId ?? null) === enrollment.platform_trade_id && request.buyerId === enrollment.buyer_id && request.sellerId === enrollment.seller_id
    && !areTradeAmountsLocked(request) && listingRow.active_trade_request_id === request.id,
  "Canonical request is outside the clean enrolled recovery cohort");
  const description = describeDevelopmentTradeTerms({ mode: "simulation-only", request, assetId: enrollment.asset_id, walletListingId: enrollment.wallet_listing_id });
  verify(same(description.terms, binding.terms) && description.digest === binding.termsDigest
    && ["Bank Transfer", "Face-to-Face (Meet in Person)"].includes(description.terms.paymentMethod),
  "Canonical current terms or private payment-instruction digest disagree");
  verify(!canonical.purchase_requests.some(row => row.id !== request.id && row.listing_id === listing.id
    && isDemandReservedTrade(row.payload as unknown as PurchaseRequest)), "Canonical recovery cohort has another active listing reservation");
  verify(!canonical.evidence.some(row => row.purchase_request_id === request.id)
    && !canonical.disputes.some(row => row.purchase_request_id === request.id && row.payload.status === "open")
    && !canonical.commissions.some(row => row.purchase_request_id === request.id || row.payload.tradeId === (request.tradeId ?? request.id)),
  "Canonical payment, dispute or commission progress is outside the recovery cohort");
  const projection = canonical.trades.filter(row => row.purchase_request_id === request.id);
  verify(projection.length <= 1 && projection.every(row => absent(row.payload.completedAt)), "Canonical reserved trade projection has settlement progress");
  const live = [...state.trades.values()].filter(trade => !["completed", "cancelled"].includes(trade.status));
  const trade = state.trades.get(enrollment.wallet_trade_id), walletListing = state.listings.get(enrollment.wallet_listing_id);
  verify(live.length === 1 && live[0].id === enrollment.wallet_trade_id && trade && walletListing
    && trade.status === "reserved" && !trade.disputed && trade.evidence === undefined && trade.authorization === undefined && trade.payoutId === undefined
    && walletListing.funded && walletListing.approved && !walletListing.closed
    && ![...state.payouts.values()].some(payout => !["confirmed", "failed_final"].includes(payout.state)),
  "Wallet recovery cohort must contain one clean reservation and no unfinished payout");
  const scale = BigInt(10) ** BigInt(assetFor(enrollment.asset_id).decimals - 6);
  verify(listing.sellerId === request.sellerId && listing.network === request.network && listing.currency === "ILS"
    && ["active", "matched", "in_trade"].includes(listing.status) && listing.approvalStatus === "approved"
    && !listing.closedAt && !listing.expiredAt && !listing.cancelledAt && !listing.completedAt
    && listing.bankTransferProvider !== "wise" && !listing.wiseAccountId
    && parseUnits(String(listing.availableAmount), 6) * scale === balance(state, enrollment.asset_id, `listing:${enrollment.wallet_listing_id}`)
      + balance(state, enrollment.asset_id, `trade:${enrollment.wallet_trade_id}`), "Canonical listing capacity and wallet principal disagree");
  verify(coordination.acceptances.length === state.acceptanceReceipts.size && coordination.acceptances.length === binding.revision
    && coordination.publications.length === coordination.acceptances.length, "Marketplace acceptance, publication and wallet receipt counts disagree");
  unique(coordination.acceptances, row => row.acceptance_key);
  unique(coordination.publications, row => row.id);
  ordered(coordination.enrollments, row => row.request_id);
  ordered(coordination.acceptances, row => row.acceptance_key);
  ordered(coordination.publications, row => row.id);
  for (const row of coordination.acceptances) {
    const receipt = state.acceptanceReceipts.get(row.acceptance_key), commandRow = wallet.commands[row.wallet_command_revision - 1];
    const command = parseV2Command(commandRow?.command_json);
    verify(receipt && same(receipt, row.receipt) && command.type === "acceptAmountCorrection" && command.actor.kind === "buyer"
      && command.actor.id === row.actor_user_id && row.actor_user_id === enrollment.buyer_id && row.request_id === request.id
      && receipt.platformRequestId === row.request_id && receipt.proposalId === row.proposal_id && receipt.actorUserId === row.actor_user_id
      && receipt.commandRevision === row.wallet_command_revision && receipt.commandKey === row.wallet_command_key
      && commandRow.command_key === row.wallet_command_key && commandRow.event_hash === row.wallet_event_hash && same(commandRow.result_json, receipt)
      && row.input_digest === publicAcceptanceDigest(receipt) && row.publication_id === `wallet-publication-${row.acceptance_key}`,
    "Marketplace acceptance differs from its original verified wallet receipt");
    const publication = coordination.publications.find(item => item.id === row.publication_id);
    verify(publication?.acceptance_key === row.acceptance_key && same(publication.payload, safePublication(row, enrollment)),
      "Marketplace publication intent is missing, changed or contains extra data");
    verifyAcceptanceEffects(envelope, request, row);
  }
  if (coordination.acceptances.length === 0) {
    verify(request.termsProposal?.kind === "amount_correction" && request.termsProposal.status === "pending"
      && request.termsProposal.resolvedAt === undefined, "Unaccepted cohort must retain its original pending proposal");
    const beforePause = verifyVersionedHistory(wallet.commands.slice(0, enrollment.wallet_command_revision));
    verify(isV2State(beforePause.state), "Enrolled cohort has no verified pre-pause state");
    planAcceptedAmountTerms({ mode: "simulation-only", actorUserId: request.buyerId, requestId: request.id,
      proposalId: request.termsProposal.id, expectedBindingRevision: 0, marketplace: {
        purchaseRequests: canonical.purchase_requests.map(row => row.payload as unknown as PurchaseRequest),
        marketplaceListings: canonical.listings.map(row => row.payload as unknown as MarketplaceListing),
        tradeEvidenceFiles: canonical.evidence.filter(row => row.purchase_request_id === request.id).map(row => row.payload as unknown as TradeEvidenceFile),
        disputes: canonical.disputes.filter(row => row.purchase_request_id === request.id).map(row => row.payload as unknown as TradeDisputeCase),
      }, wallet: beforePause, binding: planningBindingFor(beforePause.state, request.id) });
  }
}

/**
 * Validate the complete logical recovery unit before a target is opened. Hashes
 * prove consistency, not origin/freshness or that a separate source is fenced.
 * Unknown parsing/replay failures are deliberately stripped of private payloads.
 */
export function parseMarketplaceWalletBackup(serialized: string, expectedChecksum?: string): MarketplaceWalletBackupEnvelope {
  assertSimulationRuntime("simulation-only");
  try {
    verify(typeof serialized === "string" && serialized.length > 0 && serialized.length <= MAX_WALLET_BACKUP_BYTES
      && Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES, "Marketplace backup must fit the development JSON byte limit");
    const document: unknown = JSON.parse(serialized);
    checkJsonTree(document);
    const envelope = envelopeSchema.parse(document);
    const { checksum, ...body } = envelope;
    verify(walletDigest(body) === checksum, "Marketplace backup checksum mismatch");
    if (expectedChecksum !== undefined) verify(hex.safeParse(expectedChecksum).success && expectedChecksum === checksum,
      "Marketplace backup differs from the separately retained expected checksum");
    checkJsonTree(envelope.canonical, true);
    const inspected = inspectVersionedWalletBackup(JSON.stringify(envelope.wallet));
    verify(inspected.formatVersion === 2 && envelope.exportedAtMs >= inspected.exportedAtMs
      && envelope.exportedAtMs >= inspected.checkpoint.lastCommandAtMs, "Marketplace export timestamp precedes its verified wallet snapshot");
    const recovered = verifyVersionedHistory(envelope.wallet.commands);
    verify(isV2State(recovered.state) && Boolean(recovered.state.haltReason), "Combined recovery export requires a verified paused v2 wallet");
    coordinatedHistory(envelope, recovered.state);
    return envelope;
  } catch (error) {
    if (error instanceof WalletBackupError) throw error;
    throw new WalletBackupError("Unsupported, malformed, truncated or inconsistent combined marketplace/wallet backup");
  }
}

/** Safe metadata only; financial rows and private instructions stay in the file. */
export function inspectMarketplaceWalletBackup(serialized: string, options: { expectedChecksum?: string } = {}): MarketplaceWalletBackupInspection {
  const envelope = parseMarketplaceWalletBackup(serialized, options.expectedChecksum);
  return { format: envelope.format, formatVersion: envelope.formatVersion, mode: envelope.mode, schemaVersion: envelope.schemaVersion,
    checksum: envelope.checksum, exportedAtMs: envelope.exportedAtMs, requestId: envelope.requestId, ownerId: envelope.ownerId,
    checkpoint: structuredClone(envelope.wallet.checkpoint), commandCount: envelope.wallet.commands.length, walletChecksum: envelope.wallet.checksum,
    canonicalRowCounts: Object.fromEntries(Object.entries(envelope.canonical).map(([key, rows]) => [key, rows.length])) as MarketplaceWalletBackupInspection["canonicalRowCounts"],
    coordinationRowCounts: Object.fromEntries(Object.entries(envelope.coordination).map(([key, rows]) => [key, rows.length])) as MarketplaceWalletBackupInspection["coordinationRowCounts"],
    halted: true, credentialsIncluded: false };
}
