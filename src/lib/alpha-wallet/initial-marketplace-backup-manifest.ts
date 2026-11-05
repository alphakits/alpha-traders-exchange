import "server-only";

import { z } from "zod";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import { assetFor, parseUnits } from "./amounts";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS, WALLET_BACKUP_FORMAT, WalletBackupError } from "./backup";
import { walletDigest } from "./commands";
import { balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import { parseV3Command, v3InitialInputSchema, WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { verifyV3History } from "./v3-durable";
import { isV3State, type V3State } from "./v3-engine";

/** A new recovery contract. Neither isolated v3 nor correction-cohort bytes are accepted. */
export const INITIAL_MARKETPLACE_WALLET_BACKUP_FORMAT = "alpha-wallet-initial-marketplace-simulation-backup" as const;
export const INITIAL_MARKETPLACE_WALLET_BACKUP_SCHEMA = "canonical-initial-cohort-v1" as const;
export const INITIAL_MARKETPLACE_WALLET_LEDGER_SCOPE = "initial-marketplace-v3-ledger" as const;
export const MAX_INITIAL_MARKETPLACE_BACKUP_ROWS_PER_TABLE = 1_000;
export const MAX_INITIAL_MARKETPLACE_BACKUP_ROWS = 10_000;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const eventId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const safeTime = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  .refine(value => Number.isFinite(new Date(value).getTime()));
const revision = z.number().int().min(0).max(MAX_WALLET_BACKUP_COMMANDS);
const positiveRevision = revision.refine(value => value > 0);
const sortIndex = z.number().int().min(0).max(2_147_483_647);
const record = z.record(z.string(), z.unknown());
const label = z.string().min(1).max(100);
const role = z.enum(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);
const sellerStatus = z.enum(["buyer", "pending_seller_approval", "approved_seller", "rejected", "suspended"]);
const asset = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
const pgVersion = z.string().regex(/^(?:0|[1-9]\d{0,18})$/).refine(value => BigInt(value) <= BigInt("9223372036854775807"));
const rows = <T extends z.ZodType>(schema: T) => z.array(schema).max(MAX_INITIAL_MARKETPLACE_BACKUP_ROWS_PER_TABLE);

/** Preserve native microseconds, including verbatim PostgreSQL JSON timestamps in the activation basis. */
function timestampMicros(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone, sign, offsetHour = "0", offsetMinute = "0"] = match;
  if (Number(year) < 1 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || Number(offsetHour) > 15 || Number(offsetMinute) > 59) return null;
  const padded = fraction.padEnd(6, "0");
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}.${padded.slice(0, 3)}Z`;
  const localMs = Date.parse(local);
  if (!Number.isFinite(localMs) || new Date(localMs).toISOString() !== local) return null;
  const offset = zone === "Z" ? 0 : (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === "-" ? -1 : 1);
  const ms = localMs - offset * 60_000;
  if (ms < 0 || !Number.isFinite(new Date(ms).getTime())) return null;
  return BigInt(ms) * BigInt(1000) + BigInt(padded.slice(3));
}
const sqlTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine(value => timestampMicros(value) !== null);
// PostgreSQL to_jsonb(timestamptz) in UTC uses +00:00 and omits a zero
// fraction, otherwise trimming only trailing fractional zeroes. Existing SQL
// compares this immutable JSON exactly. Refuse alternate spellings before any
// target is opened; never silently rewrite the retained activation evidence.
const basisTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{0,5}[1-9])?\+00:00$/)
  .refine(value => timestampMicros(value) !== null);
const checkpointSchema = z.strictObject({ revision, eventHash: hex, stateHash: hex, lastCommandAtMs: safeTime });
const continuationSchema = z.strictObject({ checkpoint: checkpointSchema, commandRevision: positiveRevision,
  commandKey: z.string().min(1).max(512) });

const requestColumns = { id, trade_id: id.nullable(), listing_id: id, seller_id: id, buyer_id: id, status: label,
  timed_out_at: sqlTime.nullable(), completed_at: sqlTime.nullable(), created_at: sqlTime, updated_at: sqlTime,
  sort_index: sortIndex, payload: record };
const listingColumns = { id, seller_id: id, status: label, active_trade_request_id: id.nullable(), expires_at: sqlTime.nullable(),
  created_at: sqlTime, updated_at: sqlTime, sort_index: sortIndex, payload: record };
const tradeColumns = { id, purchase_request_id: id, listing_id: id, seller_id: id, buyer_id: id, status: label,
  completed_at: sqlTime.nullable(), created_at: sqlTime, updated_at: sqlTime, sort_index: sortIndex, payload: record };
const requestRowSchema = z.strictObject(requestColumns);
const listingRowSchema = z.strictObject(listingColumns);
const tradeRowSchema = z.strictObject(tradeColumns);
const canonicalBase64 = z.string().max(MAX_WALLET_BACKUP_BYTES)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine(value => Buffer.from(value, "base64").toString("base64") === value);

/** Exact initial-cohort relational shape. It is intentionally not the older correction fixture schema. */
export const initialMarketplaceCanonicalRowsSchema = z.strictObject({
  runtime_meta: rows(z.strictObject({ singleton: z.literal(true), version: pgVersion, updated_at: sqlTime })).length(1),
  // Original profiles and credentials never enter a recovery bundle. The three
  // ordering/chronology columns are retained; restored accounts remain disabled.
  users: rows(z.strictObject({ id, role, seller_status: sellerStatus, created_at: sqlTime, updated_at: sqlTime,
    sort_index: sortIndex })).min(2),
  listings: rows(listingRowSchema).min(1),
  purchase_requests: rows(requestRowSchema).min(1),
  trades: rows(tradeRowSchema),
  commissions: rows(z.strictObject({ id: eventId, purchase_request_id: id.nullable(), listing_id: id.nullable(), seller_id: id,
    buyer_id: id.nullable(), payment_status: label, due_at: sqlTime.nullable(), created_at: sqlTime, updated_at: sqlTime,
    sort_index: sortIndex, payload: record })),
  marketplace_enforcement_records: rows(z.strictObject({ id: eventId, seller_id: id, status: label,
    violation_number: z.number().int().min(0).max(2_147_483_647), issued_at: sqlTime, due_at: sqlTime.nullable(),
    created_at: sqlTime, updated_at: sqlTime, sort_index: sortIndex, payload: record })),
  evidence: rows(z.strictObject({ id: eventId, purchase_request_id: id, side: z.enum(["buyer", "seller"]), uploaded_by_user_id: id,
    mime_type: label, file_name: z.string().min(1).max(4096), size_bytes: z.number().int().min(0).max(2_147_483_647),
    uploaded_at: sqlTime, sort_index: sortIndex, payload: record, content: canonicalBase64.nullable() })),
  disputes: rows(z.strictObject({ id: eventId, trade_id: id, purchase_request_id: id, seller_id: id, buyer_id: id,
    status: z.enum(["open", "resolved"]), created_at: sqlTime, updated_at: sqlTime, sort_index: sortIndex, payload: record })),
  notifications: rows(z.strictObject({ id: eventId, user_id: id, category: label, is_read: z.boolean(),
    created_at: sqlTime, sort_index: sortIndex, payload: record })),
  audit_logs: rows(z.strictObject({ id: eventId, action: label, actor_user_id: id, target_user_id: id.nullable(),
    listing_id: id.nullable(), purchase_request_id: id.nullable(), created_at: sqlTime, sort_index: sortIndex, payload: record })),
});
export type InitialMarketplaceCanonicalRows = z.infer<typeof initialMarketplaceCanonicalRowsSchema>;
const basisRequestSchema = z.strictObject({ ...requestColumns, timed_out_at: basisTime.nullable(), completed_at: basisTime.nullable(),
  created_at: basisTime, updated_at: basisTime });
const basisListingSchema = z.strictObject({ ...listingColumns, expires_at: basisTime.nullable(), created_at: basisTime, updated_at: basisTime });
const basisTradeSchema = z.strictObject({ ...tradeColumns, completed_at: basisTime.nullable(), created_at: basisTime, updated_at: basisTime });
const canonicalBasisSchema = z.strictObject({ request: basisRequestSchema, listing: basisListingSchema,
  trade: basisTradeSchema.nullable(), siblings: rows(basisRequestSchema).min(1) });
const initialReceiptSchema = z.strictObject({ acceptanceKey: hex, platformRequestId: id, platformTradeId: id, actorUserId: id,
  buyerId: id, walletTradeId: id, commandRevision: positiveRevision, commandKey: z.string().min(1).max(512), inputDigest: hex,
  plannerInputDigest: hex, termsDigest: hex, principalRaw: raw, transferAmountRaw: raw, acceptedAtMs: safeTime, input: v3InitialInputSchema });
const canonicalResultSchema = z.strictObject({ request: record, listing: record, trade: record,
  notifications: z.array(record).length(1), auditLogs: z.array(record).length(1) });
const publicationSchema = z.strictObject({ type: z.literal("initial_seller_request_accepted"), requestId: id, listingId: id,
  tradeId: id, buyerId: id, sellerId: id, walletTradeId: id, walletRevision: positiveRevision, walletEventHash: hex,
  termsDigest: hex, notificationIds: z.array(eventId).length(1), auditId: eventId, timelineEventId: eventId });
export const initialMarketplaceCoordinationRowsSchema = z.strictObject({
  activations: z.array(z.strictObject({ request_id: id, cohort: z.literal(true), platform_listing_id: id, platform_trade_id: id,
    wallet_listing_id: id, wallet_trade_id: id, buyer_id: id, seller_id: id, asset_id: asset, actor_user_id: id, input_digest: hex,
    wallet_checkpoint: checkpointSchema, canonical_basis: canonicalBasisSchema })).length(1),
  acceptances: z.array(z.strictObject({ acceptance_key: hex, request_id: id, actor_user_id: id, input_digest: hex,
    wallet_command_revision: positiveRevision, wallet_command_key: z.string().min(1).max(512), wallet_event_hash: hex,
    receipt: initialReceiptSchema, publication_id: eventId, canonical_result: canonicalResultSchema })).max(1),
  publications: z.array(z.strictObject({ id: eventId, acceptance_key: hex, payload: publicationSchema })).max(1),
});
export type InitialMarketplaceCoordinationRows = z.infer<typeof initialMarketplaceCoordinationRowsSchema>;
export type InitialMarketplaceRecoveryRows = { canonical: InitialMarketplaceCanonicalRows; coordination: InitialMarketplaceCoordinationRows };

const walletRecordSchema = z.strictObject({ revision: positiveRevision, command_key: z.string().min(1).max(512),
  command_type: z.string().min(1).max(80), occurred_at_ms: z.string().regex(/^(?:0|[1-9]\d{0,15})$/)
    .refine(value => safeTime.safeParse(Number(value)).success),
  command_json: z.unknown().refine(value => value !== undefined), input_hash: hex,
  result_json: z.unknown().refine(value => value !== undefined), result_hash: hex, state_hash: hex, previous_event_hash: hex, event_hash: hex });
const walletEnvelopeSchema = z.strictObject({ format: z.literal(WALLET_BACKUP_FORMAT), formatVersion: z.literal(3),
  scope: z.literal(INITIAL_MARKETPLACE_WALLET_LEDGER_SCOPE), mode: z.literal("simulation-only"),
  engineVersion: z.literal(WALLET_V3_ENGINE_VERSION), sourcePaused: z.literal(true), exportedAtMs: safeTime,
  checkpoint: checkpointSchema, continuation: continuationSchema, initialContinuation: continuationSchema,
  // Every valid exported bundle retains room for its mandatory recovery pause.
  commands: z.array(walletRecordSchema).min(1).max(MAX_WALLET_BACKUP_COMMANDS - 1), checksum: hex });
const envelopeSchema = z.strictObject({ format: z.literal(INITIAL_MARKETPLACE_WALLET_BACKUP_FORMAT), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), schemaVersion: z.literal(INITIAL_MARKETPLACE_WALLET_BACKUP_SCHEMA),
  exportedAtMs: safeTime, requestId: id, ownerId: id, wallet: walletEnvelopeSchema,
  canonical: initialMarketplaceCanonicalRowsSchema, coordination: initialMarketplaceCoordinationRowsSchema, checksum: hex });
export type InitialMarketplaceWalletBackupEnvelope = z.infer<typeof envelopeSchema>;
export type InitialMarketplaceWalletBackupInspection = Pick<InitialMarketplaceWalletBackupEnvelope,
  "format" | "formatVersion" | "mode" | "schemaVersion" | "exportedAtMs" | "requestId" | "ownerId" | "checksum"> & {
    checkpoint: InitialMarketplaceWalletBackupEnvelope["wallet"]["checkpoint"];
    commandCount: number; walletChecksum: string;
    canonicalRowCounts: { [K in keyof InitialMarketplaceCanonicalRows]: number };
    coordinationRowCounts: { [K in keyof InitialMarketplaceCoordinationRows]: number };
    halted: true; credentialsIncluded: false;
  };

function verify(value: unknown, message: string): asserts value { if (!value) throw new WalletBackupError(message); }
const same = (left: unknown, right: unknown) => walletDigest(left) === walletDigest(right);
const absent = (value: unknown) => value === undefined || value === null;
const nullable = (value: unknown) => value ?? null;
function sameTime(left: unknown, right: unknown) {
  const a = timestampMicros(left), b = timestampMicros(right);
  return a !== null && b !== null && a === b;
}
function nullableTime(left: unknown, right: unknown) { return absent(left) || absent(right) ? absent(left) && absent(right) : sameTime(left, right); }
function chronology(row: { created_at: string; updated_at: string; payload?: Record<string, unknown> }) {
  verify(timestampMicros(row.created_at)! <= timestampMicros(row.updated_at)!, "Canonical row chronology is reversed");
  if (row.payload) verify(sameTime(row.created_at, row.payload.createdAt) && sameTime(row.updated_at, row.payload.updatedAt),
    "Canonical scalar and payload chronology disagree");
}
function orderedUnique<T>(collection: T[], key: (row: T) => string) {
  verify(collection.every((row, index) => index === 0 || key(collection[index - 1]) < key(row)),
    "Initial recovery rows require unique deterministic identity order");
}
function payloadArray(value: unknown): Record<string, unknown>[] {
  verify(Array.isArray(value) && value.every(item => item !== null && typeof item === "object" && !Array.isArray(item)),
    "Malformed canonical initial history");
  return value as Record<string, unknown>[];
}
function checkJsonTree(value: unknown, rejectCredentials = false) {
  const pending = [{ value, depth: 0 }]; let visited = 0;
  const credentials = new Set(["password", "passwordhash", "tokenhash", "sessiontoken", "accesstoken", "refreshtoken",
    "passwordresettoken", "emailverificationtoken", "authorization", "cookie", "privatekey", "signingkey", "mnemonic",
    "deviceidhash", "accesstokenhash", "refreshtokenhash", "tokenfamilyid"]);
  while (pending.length) {
    const current = pending.pop()!;
    verify(++visited <= 250_000 && current.depth <= 64, "Initial recovery nesting or item limit exceeded");
    if (current.value === null || typeof current.value !== "object") {
      verify(typeof current.value !== "number" || Number.isFinite(current.value), "Non-finite initial recovery value");
      continue;
    }
    for (const [key, item] of Object.entries(current.value)) {
      verify(!["__proto__", "prototype", "constructor"].includes(key), "Unsupported initial recovery object key");
      if (rejectCredentials) verify(!credentials.has(key.replace(/[_-]/g, "").toLowerCase()),
        "Authentication material is outside initial marketplace recovery");
      pending.push({ value: item, depth: current.depth + 1 });
    }
  }
}

function canonicalIdentities(canonical: InitialMarketplaceCanonicalRows) {
  for (const [table, collection] of Object.entries(canonical)) {
    if (table !== "runtime_meta") orderedUnique(collection as { id: string }[], row => row.id);
  }
  const users = new Map(canonical.users.map(row => [row.id, row]));
  const requests = new Map(canonical.purchase_requests.map(row => [row.id, row]));
  const listings = new Map(canonical.listings.map(row => [row.id, row]));
  const trades = new Map(canonical.trades.map(row => [row.id, row]));
  verify(new Set(canonical.purchase_requests.filter(row => row.trade_id !== null).map(row => row.trade_id)).size
    === canonical.purchase_requests.filter(row => row.trade_id !== null).length
    && new Set(canonical.trades.map(row => row.purchase_request_id)).size === canonical.trades.length,
  "Canonical initial trade identity is duplicated");
  for (const row of canonical.users) chronology(row);
  for (const row of canonical.purchase_requests) {
    const p = row.payload; chronology(row);
    verify(p.id === row.id && nullable(p.tradeId) === row.trade_id && p.listingId === row.listing_id && p.sellerId === row.seller_id
      && p.buyerId === row.buyer_id && p.status === row.status && users.has(row.seller_id) && users.has(row.buyer_id)
      && row.seller_id !== row.buyer_id && listings.get(row.listing_id)?.seller_id === row.seller_id
      && nullableTime(row.timed_out_at, p.timedOutAt) && nullableTime(row.completed_at, p.completedAt),
    "Canonical request identity, lifecycle or participant closure disagrees");
    for (const field of ["timeline", "messages"] as const) {
      if (p[field] === undefined) continue;
      const entries = payloadArray(p[field]);
      verify(new Set(entries.map(entry => entry.id)).size === entries.length && entries.every(entry => typeof entry.id === "string"
        && (field !== "messages" || entry.purchaseRequestId === row.id)), "Canonical request history identity disagrees");
    }
  }
  for (const row of canonical.listings) {
    const p = row.payload; chronology(row);
    verify(p.id === row.id && p.sellerId === row.seller_id && p.status === row.status && users.has(row.seller_id)
      && nullable(p.activeTradeRequestId) === row.active_trade_request_id && nullableTime(row.expires_at, p.expiresAt)
      && (row.active_trade_request_id === null || requests.get(row.active_trade_request_id)?.listing_id === row.id),
    "Canonical listing identity or reservation link disagrees");
  }
  for (const row of canonical.trades) {
    const p = row.payload, request = requests.get(row.purchase_request_id); chronology(row);
    verify(request && request.trade_id === row.id && request.listing_id === row.listing_id && request.seller_id === row.seller_id
      && request.buyer_id === row.buyer_id && request.status === row.status && p.id === row.id && p.purchaseRequestId === request.id
      && p.listingId === row.listing_id && p.sellerId === row.seller_id && p.buyerId === row.buyer_id && p.status === row.status
      && nullableTime(row.completed_at, p.completedAt) && same(p.timeline ?? [], request.payload.timeline ?? []),
    "Canonical physical trade projection disagrees");
  }
  for (const row of canonical.commissions) {
    const p = row.payload; chronology(row);
    verify(p.id === row.id && p.sellerId === row.seller_id && p.paymentStatus === row.payment_status
      && nullable(p.purchaseRequestId) === row.purchase_request_id && nullable(p.listingId) === row.listing_id
      && nullable(p.buyerId) === row.buyer_id && nullableTime(row.due_at, p.dueAt) && users.has(row.seller_id)
      && (row.buyer_id === null || users.has(row.buyer_id)) && (row.purchase_request_id === null || requests.has(row.purchase_request_id))
      && (row.listing_id === null || listings.has(row.listing_id)), "Canonical commission identity or closure disagrees");
  }
  for (const row of canonical.marketplace_enforcement_records) {
    const p = row.payload; chronology(row);
    verify(p.id === row.id && p.sellerId === row.seller_id && p.status === row.status && p.violationNumber === row.violation_number
      && sameTime(row.issued_at, p.issuedAt) && nullableTime(row.due_at, p.dueAt) && users.has(row.seller_id),
    "Canonical enforcement identity or chronology disagrees");
  }
  for (const row of canonical.evidence) {
    const p = row.payload;
    verify(p.id === row.id && p.purchaseRequestId === row.purchase_request_id && p.side === row.side
      && p.uploadedByUserId === row.uploaded_by_user_id && p.mimeType === row.mime_type && p.fileName === row.file_name
      && p.sizeBytes === row.size_bytes && sameTime(row.uploaded_at, p.uploadedAt)
      && requests.has(row.purchase_request_id) && users.has(row.uploaded_by_user_id)
      && (row.content === null || Buffer.from(row.content, "base64").byteLength === row.size_bytes),
    "Canonical evidence identity, binary content or chronology disagrees");
  }
  for (const row of canonical.disputes) {
    const p = row.payload, request = requests.get(row.purchase_request_id); chronology(row);
    verify(p.id === row.id && p.tradeId === row.trade_id && p.purchaseRequestId === row.purchase_request_id
      && p.sellerId === row.seller_id && p.buyerId === row.buyer_id && p.status === row.status
      && request && request.trade_id === row.trade_id && request.seller_id === row.seller_id && request.buyer_id === row.buyer_id,
    "Canonical dispute identity or closure disagrees");
  }
  for (const row of canonical.notifications) {
    const p = row.payload;
    verify(p.id === row.id && p.userId === row.user_id && p.category === row.category && p.isRead === row.is_read
      && sameTime(row.created_at, p.createdAt) && users.has(row.user_id)
      && (absent(p.relatedRequestId) || requests.has(String(p.relatedRequestId)))
      && (absent(p.relatedTradeId) || trades.has(String(p.relatedTradeId)))
      && (absent(p.relatedListingId) || listings.has(String(p.relatedListingId))), "Canonical notification identity or closure disagrees");
    const request = requests.get(String(p.relatedRequestId)), trade = trades.get(String(p.relatedTradeId));
    verify((!request || absent(p.relatedTradeId) || request.trade_id === p.relatedTradeId)
      && (!request || absent(p.relatedListingId) || request.listing_id === p.relatedListingId)
      && (!trade || absent(p.relatedListingId) || trade.listing_id === p.relatedListingId), "Canonical notification links disagree");
  }
  for (const row of canonical.audit_logs) {
    const p = row.payload;
    verify(p.id === row.id && p.action === row.action && p.actorUserId === row.actor_user_id
      && nullable(p.targetUserId) === row.target_user_id && nullable(p.listingId) === row.listing_id
      && nullable(p.purchaseRequestId) === row.purchase_request_id && sameTime(row.created_at, p.createdAt)
      && users.has(row.actor_user_id) && (row.target_user_id === null || users.has(row.target_user_id))
      && (row.listing_id === null || listings.has(row.listing_id)) && (row.purchase_request_id === null || requests.has(row.purchase_request_id)),
    "Canonical audit identity or closure disagrees");
  }
  return { users, requests, listings, trades };
}

/** Normalize only relational timestamp columns for comparison; retained JSON bytes are never rewritten. */
function comparableRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    key.endsWith("_at") && value !== null ? timestampMicros(value)?.toString() : value]));
}
const sameRow = (a: Record<string, unknown>, b: Record<string, unknown>) => same(comparableRow(a), comparableRow(b));
type Activation = InitialMarketplaceCoordinationRows["activations"][number];
type Acceptance = InitialMarketplaceCoordinationRows["acceptances"][number];

function validateOriginalBasis(activation: Activation, prefix: V3State) {
  const basis = activation.canonical_basis, request = basis.request, listing = basis.listing, p = request.payload, l = listing.payload;
  verify(request.id === activation.request_id && request.trade_id === activation.platform_trade_id
    && request.listing_id === activation.platform_listing_id && request.seller_id === activation.seller_id && request.buyer_id === activation.buyer_id
    && activation.seller_id !== activation.buyer_id && request.status === "pending" && p.status === "pending"
    && listing.id === activation.platform_listing_id && listing.seller_id === activation.seller_id && listing.status === "active"
    && l.status === "active" && l.approvalStatus === "approved" && listing.active_trade_request_id === null
    && l.activeTradeRequestId === undefined && p.id === request.id && p.tradeId === request.trade_id && p.listingId === listing.id
    && p.sellerId === request.seller_id && p.buyerId === request.buyer_id && l.id === listing.id && l.sellerId === listing.seller_id,
  "Initial activation must retain its exact pending canonical request and open listing");
  chronology(request); chronology(listing);
  orderedUnique(basis.siblings, row => row.id);
  verify(basis.siblings.every(row => row.listing_id === listing.id && row.payload.listingId === listing.id)
    && basis.siblings.filter(row => row.id === request.id).length === 1
    && sameRow(basis.siblings.find(row => row.id === request.id)!, request), "Initial activation sibling basis is incomplete or aliased");
  if (basis.trade) {
    const trade = basis.trade; chronology(trade);
    verify(trade.id === activation.platform_trade_id && trade.purchase_request_id === request.id && trade.listing_id === listing.id
      && trade.buyer_id === activation.buyer_id && trade.seller_id === activation.seller_id && trade.status === "pending"
      && trade.completed_at === null && trade.payload.id === trade.id && trade.payload.purchaseRequestId === request.id
      && trade.payload.listingId === listing.id && trade.payload.buyerId === activation.buyer_id && trade.payload.sellerId === activation.seller_id
      && trade.payload.status === "pending" && same(trade.payload.timeline ?? [], p.timeline ?? []),
    "Initial activation pending trade projection is inconsistent");
  }
  const forbidden = ["tradeCreatedAt", "usdtDemandId", "usdtDemandOfferId", "termsProposal", "priceOfferAcceptedAt",
    "firstSellerResponseAt", "paymentSentAt", "sensitivePaymentSharedAt", "sensitivePaymentKind", "fundsReceivedAt",
    "usdtReleaseStartedAt", "usdtReleaseDeadlineAt", "usdtSentAt", "completedAt", "timedOutAt", "timeoutReason",
    "buyerConfirmationArchivedAt", "lockedAt", "reviewUnlockedAt", "buyerEvidence", "sellerEvidence", "buyerReview", "sellerBuyerReview",
    "sellerResponse", "closedAt", "closedByUserId", "closeReason", "closeExplanation", "completionReceipt", "historicalCompletion",
    "buyerVolumeCredit", "trustReconciliation", "actionReminderState", "inactivityWarningSentAt", "sellerWiseAccountId",
    "buyerWiseAccountId", "sellerWiseAccountSnapshot", "buyerWiseAccountSnapshot"];
  const timeline = payloadArray(p.timeline);
  verify(forbidden.every(key => p[key] === undefined) && request.timed_out_at === null && request.completed_at === null
    && p.cardlessCodeAwaitingBuyerConfirmation !== true && (p.amountAdjustmentCount === undefined || p.amountAdjustmentCount === 0)
    && (p.counterPrices === undefined || (Array.isArray(p.counterPrices) && p.counterPrices.length === 0))
    && timeline.length === 1 && timeline[0].type === "request_submitted" && timeline[0].actorUserId === activation.buyer_id
    && sameTime(timeline[0].createdAt, p.createdAt) && p.buyerSafetyAcknowledged === true && p.bankTransferProvider !== "wise"
    && !l.closedAt && !l.expiredAt && !l.cancelledAt && !l.completedAt && !l.newRequestBlockReason && !l.blockingReason,
  "Initial activation basis contains unsupported prior lifecycle progress");
  const description = describeDevelopmentTradeTerms({ mode: "simulation-only", request: p as unknown as PurchaseRequest,
    assetId: activation.asset_id, walletListingId: activation.wallet_listing_id });
  verify(description.terms.platformTradeId === activation.platform_trade_id && description.terms.priceMode === "listing_price"
    && description.terms.listingPriceAtRequest === description.terms.pricePerUsdt
    && ["Bank Transfer", "Face-to-Face (Meet in Person)"].includes(description.terms.paymentMethod)
    && l.network === p.network && l.currency === "ILS", "Initial activation must preserve supported original buyer terms");
  const walletListing = prefix.listings.get(activation.wallet_listing_id);
  const scale = BigInt(10) ** BigInt(assetFor(activation.asset_id).decimals - 6);
  verify(walletListing && walletListing.sellerId === activation.seller_id && walletListing.assetId === activation.asset_id
    && walletListing.approved && walletListing.funded && !walletListing.closed && !prefix.trades.has(activation.wallet_trade_id)
    && balance(prefix, activation.asset_id, `listing:${activation.wallet_listing_id}`) === parseUnits(String(l.availableAmount), 6) * scale
    && prefix.initialBindings.size === 0 && prefix.initialAcceptanceReceipts.size === 0 && prefix.haltReason === null
    && ![...prefix.payouts.values()].some(payout => !["confirmed", "failed_final"].includes(payout.state)),
  "Initial activation checkpoint must retain full funding and no initial reservation or unfinished payout");
  verify(!basis.siblings.some(row => row.id !== activation.request_id && isDemandReservedTrade(row.payload as unknown as PurchaseRequest)),
    "Initial activation basis contains a competing target-listing reservation");
  return description;
}

function expectedCanonical(activation: Activation, accepted: Acceptance) {
  const basis = activation.canonical_basis, receipt = accepted.receipt;
  const request = structuredClone(basis.request.payload), listing = structuredClone(basis.listing.payload);
  const at = new Date(receipt.acceptedAtMs).toISOString();
  const suffix = walletDigest(["initial_seller_acceptance", activation.request_id, activation.platform_trade_id]);
  const retainedTimeline = payloadArray(accepted.canonical_result.request.timeline);
  const actorRole = retainedTimeline.at(-1)?.actorRole;
  verify(role.safeParse(actorRole).success && receipt.acceptedAtMs > Date.parse(String(request.updatedAt))
    && receipt.acceptedAtMs > Date.parse(String(listing.updatedAt)), "Initial canonical acceptance chronology or recorded actor role is invalid");
  const timeline = [...payloadArray(request.timeline), { id: `initial-acceptance-event-${suffix}`, type: "request_accepted",
    actorUserId: activation.seller_id, actorRole, message: "Seller accepted request", createdAt: at }];
  Object.assign(request, { status: "accepted", tradeCreatedAt: at, updatedAt: at, cardlessCodeAwaitingBuyerConfirmation: false, timeline });
  if (receipt.input.terms.paymentMethod === "Face-to-Face (Meet in Person)") request.sellerSafetyAcknowledged = true;
  Object.assign(listing, { status: "matched", activeTradeRequestId: activation.request_id, lockedAt: listing.lockedAt ?? at, updatedAt: at });
  const trade = { id: activation.platform_trade_id, purchaseRequestId: activation.request_id, listingId: activation.platform_listing_id,
    sellerId: activation.seller_id, buyerId: activation.buyer_id, status: "accepted", createdAt: at, updatedAt: at, timeline };
  const notification = { id: `initial-acceptance-notification-${suffix}`, userId: activation.buyer_id, category: "trade",
    title: "Trade request accepted", message: "Seller accepted this development trade request.", isRead: false,
    relatedRequestId: activation.request_id, relatedTradeId: activation.platform_trade_id, relatedListingId: activation.platform_listing_id, createdAt: at };
  const audit = { id: `initial-acceptance-audit-${suffix}`, action: "listing_matched", actorUserId: activation.seller_id,
    targetUserId: activation.seller_id, listingId: activation.platform_listing_id, purchaseRequestId: activation.request_id,
    details: "Initial seller acceptance persisted in an isolated development transaction.", createdAt: at };
  return { request, listing, trade, notifications: [notification], auditLogs: [audit] };
}

function coordinatedHistory(envelope: InitialMarketplaceWalletBackupEnvelope, state: V3State) {
  const { canonical, coordination, wallet } = envelope;
  verify([...Object.values(canonical), ...Object.values(coordination)].reduce((sum, values) => sum + values.length, 0)
    <= MAX_INITIAL_MARKETPLACE_BACKUP_ROWS, "Initial recovery total row limit exceeded");
  const identities = canonicalIdentities(canonical), activation = coordination.activations[0], basis = activation.canonical_basis;
  // Historical role labels are not authority: export checks current stored web/
  // mobile owner credentials. Supplementary current roles need not be restored.
  verify(identities.users.has(envelope.ownerId) && identities.users.has(activation.actor_user_id)
    && identities.users.has(activation.seller_id) && identities.users.has(activation.buyer_id) && activation.request_id === envelope.requestId,
  "Initial recovery requires its exact activation, owner and participant identities");
  verify(activation.input_digest === walletDigest({ kind: "alpha-wallet-initial-marketplace-activation-v1",
    actorUserId: activation.actor_user_id, requestId: activation.request_id, assetId: activation.asset_id,
    walletListingId: activation.wallet_listing_id, walletTradeId: activation.wallet_trade_id }), "Initial activation input fingerprint disagrees");
  verify(activation.wallet_checkpoint.revision >= wallet.initialContinuation.commandRevision
    && activation.wallet_checkpoint.revision < wallet.commands.length, "Initial activation checkpoint is outside the original v3 history");
  const prefix = verifyV3History(wallet.commands.slice(0, activation.wallet_checkpoint.revision));
  verify(isV3State(prefix.state) && same(activation.wallet_checkpoint, { revision: prefix.revision, eventHash: prefix.eventHash,
    stateHash: walletDigest(prefix.state), lastCommandAtMs: prefix.lastCommandAtMs }), "Initial activation checkpoint disagrees with replay");
  const description = validateOriginalBasis(activation, prefix.state);
  const tail = wallet.commands.slice(activation.wallet_checkpoint.revision);
  verify(tail.length > 0 && tail.at(-1)!.command_type === "pause" && tail.every(row => {
    const command = parseV3Command(row.command_json);
    return (command.type === "pause" && command.actor.kind === "operator") || (command.type === "acceptInitialSellerRequest"
      && command.actor.kind === "seller" && command.actor.id === activation.seller_id && command.input.terms.platformRequestId === activation.request_id);
  }), "Activated initial history contains an unsupported transition or lacks its final pause");
  verify(coordination.acceptances.length === state.initialAcceptanceReceipts.size
    && coordination.acceptances.length === state.initialBindings.size && coordination.publications.length === coordination.acceptances.length
    && tail.filter(row => row.command_type === "acceptInitialSellerRequest").length === coordination.acceptances.length,
  "Initial acceptance, binding, command and publication counts disagree");
  const request = identities.requests.get(envelope.requestId), listing = identities.listings.get(activation.platform_listing_id);
  const physical = canonical.trades.filter(row => row.purchase_request_id === activation.request_id
    || row.payload.purchaseRequestId === activation.request_id || row.id === activation.platform_trade_id || row.payload.id === activation.platform_trade_id);
  verify(request && listing && physical.length <= 1, "Initial current canonical mapping is missing or ambiguous");
  const siblings = canonical.purchase_requests.filter(row => row.listing_id === activation.platform_listing_id || row.payload.listingId === activation.platform_listing_id);
  verify(siblings.length === basis.siblings.length && siblings.every(row => {
    const original = basis.siblings.find(other => other.id === row.id);
    return original && (row.id === activation.request_id || sameRow(row, original));
  }), "Initial canonical sibling identities, quantities or ordering changed");
  verify(!canonical.evidence.some(row => row.purchase_request_id === activation.request_id)
    && !canonical.disputes.some(row => row.purchase_request_id === activation.request_id)
    && !canonical.commissions.some(row => row.purchase_request_id === activation.request_id || row.payload.tradeId === activation.platform_trade_id)
    && ![...state.payouts.values()].some(payout => !["confirmed", "failed_final"].includes(payout.state)),
  "Initial recovery cohort contains unsupported payment, dispute, commission or payout progress");
  const acceptance = coordination.acceptances[0];
  if (!acceptance) {
    verify(sameRow(request, basis.request) && sameRow(listing, basis.listing)
      && (basis.trade === null ? physical.length === 0 : physical.length === 1 && sameRow(physical[0], basis.trade)),
    "Unaccepted initial activation must preserve its complete original canonical basis");
    return;
  }
  const receipt = state.initialAcceptanceReceipts.get(acceptance.acceptance_key), binding = state.initialBindings.get(activation.request_id);
  const commandRow = wallet.commands[acceptance.wallet_command_revision - 1], command = parseV3Command(commandRow?.command_json);
  verify(receipt && binding && same(receipt, acceptance.receipt) && command.type === "acceptInitialSellerRequest"
    && command.actor.kind === "seller" && command.actor.id === activation.seller_id && same(command.input, receipt.input)
    && commandRow.command_key === acceptance.wallet_command_key && commandRow.event_hash === acceptance.wallet_event_hash
    && same(commandRow.result_json, receipt) && receipt.commandKey === acceptance.wallet_command_key
    && receipt.commandRevision === acceptance.wallet_command_revision && acceptance.request_id === activation.request_id
    && acceptance.actor_user_id === activation.seller_id && receipt.actorUserId === activation.seller_id
    && receipt.platformRequestId === activation.request_id && receipt.platformTradeId === activation.platform_trade_id
    && receipt.buyerId === activation.buyer_id && receipt.walletTradeId === activation.wallet_trade_id
    && binding.walletListingId === activation.wallet_listing_id && binding.assetId === activation.asset_id
    && same(receipt.input.terms, description.terms) && receipt.termsDigest === description.digest
    && receipt.commandRevision === activation.wallet_checkpoint.revision + 1
    && receipt.input.preconditions.requestDigest === walletDigest(basis.request.payload)
    && receipt.input.preconditions.listingDigest === walletDigest(basis.listing.payload)
    && receipt.input.preconditions.requestUpdatedAt === basis.request.payload.updatedAt
    && receipt.input.buyerRequestEvidence.requestDigest === walletDigest(basis.request.payload)
    && receipt.input.buyerRequestEvidence.submissionTimelineDigest === walletDigest(payloadArray(basis.request.payload.timeline)[0])
    && receipt.input.buyerRequestEvidence.submissionTimelineEntryId === payloadArray(basis.request.payload.timeline)[0].id,
  "Initial coordinated acceptance differs from its exact seller receipt, mapping or original buyer evidence");
  verify(acceptance.input_digest === walletDigest({ kind: "alpha-wallet-initial-marketplace-acceptance-v1", actorUserId: activation.seller_id,
    requestId: activation.request_id, safetyAcknowledged: receipt.input.sellerAction.faceToFaceSafetyAcknowledged }),
  "Initial acceptance public-input fingerprint disagrees");
  const expected = expectedCanonical(activation, acceptance), at = expected.trade.updatedAt;
  verify(same(acceptance.canonical_result, expected), "Initial acceptance canonical result or deterministic events changed");
  const expectedTrade = basis.trade ? { ...basis.trade, status: "accepted", created_at: at, updated_at: at, payload: expected.trade }
    : { id: activation.platform_trade_id, purchase_request_id: activation.request_id, listing_id: activation.platform_listing_id,
      seller_id: activation.seller_id, buyer_id: activation.buyer_id, status: "accepted", completed_at: null,
      created_at: at, updated_at: at, sort_index: 0, payload: expected.trade };
  verify(sameRow(request, { ...basis.request, status: "accepted", updated_at: at, payload: expected.request })
    && sameRow(listing, { ...basis.listing, status: "matched", active_trade_request_id: activation.request_id, updated_at: at, payload: expected.listing })
    && physical.length === 1 && sameRow(physical[0], expectedTrade), "Initial accepted canonical rows differ from their exact original transition");
  const notification = expected.notifications[0], audit = expected.auditLogs[0];
  const notificationRow = canonical.notifications.find(row => row.id === notification.id), auditRow = canonical.audit_logs.find(row => row.id === audit.id);
  verify(notificationRow && sameRow(notificationRow, { id: notification.id, user_id: activation.buyer_id, category: "trade",
    is_read: false, created_at: at, sort_index: 0, payload: notification })
    && auditRow && sameRow(auditRow, { id: audit.id, action: "listing_matched", actor_user_id: activation.seller_id,
      target_user_id: activation.seller_id, listing_id: activation.platform_listing_id, purchase_request_id: activation.request_id,
      created_at: at, sort_index: 0, payload: audit }), "Initial canonical notification or audit is missing or changed");
  const eventId = payloadArray(expected.request.timeline).at(-1)!.id;
  verify(canonical.purchase_requests.reduce((count, row) => count + payloadArray(row.payload.timeline ?? []).filter(entry => entry.id === eventId).length, 0) === 1,
    "Initial deterministic acceptance event identity is duplicated");
  const publication = coordination.publications[0];
  verify(acceptance.publication_id === `initial-wallet-publication-${acceptance.acceptance_key}` && publication.id === acceptance.publication_id
    && publication.acceptance_key === acceptance.acceptance_key && same(publication.payload, { type: "initial_seller_request_accepted",
      requestId: activation.request_id, listingId: activation.platform_listing_id, tradeId: activation.platform_trade_id,
      buyerId: activation.buyer_id, sellerId: activation.seller_id, walletTradeId: activation.wallet_trade_id,
      walletRevision: acceptance.wallet_command_revision, walletEventHash: acceptance.wallet_event_hash, termsDigest: receipt.termsDigest,
      notificationIds: [notification.id], auditId: audit.id, timelineEventId: eventId }), "Initial safe publication intent is missing or changed");
}

/** Pure, bounded validation before any target transaction. Consistency is not a signature or account authority. */
export function parseInitialMarketplaceWalletBackup(serialized: string, expectedChecksum?: string): InitialMarketplaceWalletBackupEnvelope {
  assertSimulationRuntime("simulation-only");
  try {
    verify(typeof serialized === "string" && serialized.length > 0 && serialized.length <= MAX_WALLET_BACKUP_BYTES
      && Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES, "Initial marketplace backup exceeds the development JSON byte limit");
    const document: unknown = JSON.parse(serialized); checkJsonTree(document);
    const envelope = envelopeSchema.parse(document), { checksum, ...body } = envelope;
    verify(walletDigest(body) === checksum, "Initial marketplace backup checksum mismatch");
    if (expectedChecksum !== undefined) verify(hex.safeParse(expectedChecksum).success && expectedChecksum === checksum,
      "Initial marketplace backup differs from the separately retained expected checksum");
    checkJsonTree(envelope.canonical, true); checkJsonTree(envelope.coordination, true);
    const { checksum: walletChecksum, ...walletBody } = envelope.wallet;
    verify(walletDigest(walletBody) === walletChecksum, "Initial nested wallet backup checksum mismatch");
    const recovered = verifyV3History(envelope.wallet.commands);
    verify(isV3State(recovered.state) && Boolean(recovered.state.haltReason), "Initial combined recovery requires a verified paused v3 source");
    verify(envelope.wallet.commands.length === recovered.revision && same(envelope.wallet.checkpoint, { revision: recovered.revision,
      eventHash: recovered.eventHash, stateHash: walletDigest(recovered.state), lastCommandAtMs: recovered.lastCommandAtMs }),
    "Initial nested wallet checkpoint disagrees with original replay");
    verify(same(envelope.wallet.continuation, recovered.state.continuation)
      && same(envelope.wallet.initialContinuation, recovered.state.initialContinuation)
      && envelope.wallet.continuation.commandRevision < envelope.wallet.initialContinuation.commandRevision
      && envelope.wallet.exportedAtMs >= recovered.lastCommandAtMs && envelope.exportedAtMs >= envelope.wallet.exportedAtMs,
    "Initial recovery continuation or export chronology disagrees");
    coordinatedHistory(envelope, recovered.state);
    return envelope;
  } catch (error) {
    if (error instanceof WalletBackupError) throw error;
    throw new WalletBackupError("Unsupported, malformed, truncated or inconsistent initial marketplace/wallet backup");
  }
}

/** No private financial snapshots, destinations, profiles or authentication material are exposed. */
export function inspectInitialMarketplaceWalletBackup(serialized: string, options: { expectedChecksum?: string } = {}): InitialMarketplaceWalletBackupInspection {
  const envelope = parseInitialMarketplaceWalletBackup(serialized, options.expectedChecksum);
  return { format: envelope.format, formatVersion: envelope.formatVersion, mode: envelope.mode, schemaVersion: envelope.schemaVersion,
    exportedAtMs: envelope.exportedAtMs, requestId: envelope.requestId, ownerId: envelope.ownerId, checksum: envelope.checksum,
    checkpoint: structuredClone(envelope.wallet.checkpoint), commandCount: envelope.wallet.commands.length, walletChecksum: envelope.wallet.checksum,
    canonicalRowCounts: Object.fromEntries(Object.entries(envelope.canonical).map(([key, value]) => [key, value.length])) as InitialMarketplaceWalletBackupInspection["canonicalRowCounts"],
    coordinationRowCounts: Object.fromEntries(Object.entries(envelope.coordination).map(([key, value]) => [key, value.length])) as InitialMarketplaceWalletBackupInspection["coordinationRowCounts"],
    halted: true, credentialsIncluded: false };
}
