import "server-only";

// Frozen predecessor proof copied for the new profile. The original V4 manifest
// and its paused-backup semantics are unchanged. This accepts only the verified
// original V4 history prefix and the reconstructed pre-V5 canonical rows.
import { z } from "zod";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import { assetFor, parseUnits } from "./amounts";
import { WalletBackupError } from "./backup";
import { walletDigest } from "./commands";
import { balance } from "./ledger";
import { planDevelopmentPrepaymentCancellation, type DevelopmentPrepaymentCancellationMarketplace } from "./prepayment-cancellation";
import { parseV3Command } from "./v3-commands";
import { verifyV3History } from "./v3-durable";
import { isV3State, type V3State } from "./v3-engine";
import { parseV4Command } from "./v4-commands";
import type { V4State } from "./v4-engine";
import { MAX_CANCELLATION_MARKETPLACE_BACKUP_ROWS,
  type CancellationMarketplaceCanonicalRows, type CancellationMarketplacePredecessorRows,
  type CancellationMarketplaceWalletBackupEnvelope } from "./cancellation-marketplace-backup-manifest";
export type PaymentMarketplacePredecessorProof = Pick<CancellationMarketplaceWalletBackupEnvelope,
  "requestId" | "ownerId" | "canonical" | "predecessor" | "coordination"> & {
  wallet: Pick<CancellationMarketplaceWalletBackupEnvelope["wallet"], "commands" | "initialContinuation" | "cancellationContinuation">;
};

const role = z.enum(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);

/** Preserve native microseconds, including verbatim PostgreSQL JSON timestamps in the activation basis. */
export function timestampMicros(value: unknown): bigint | null {
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
export function checkJsonTree(value: unknown, rejectCredentials = false) {
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

export function canonicalIdentities(canonical: CancellationMarketplaceCanonicalRows) {
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
export const sameRow = (a: Record<string, unknown>, b: Record<string, unknown>) => same(comparableRow(a), comparableRow(b));
type Activation = CancellationMarketplacePredecessorRows["activations"][number];
type Acceptance = CancellationMarketplacePredecessorRows["acceptances"][number];

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

function originalAcceptance(envelope: PaymentMarketplacePredecessorProof, state: V4State) {
  const { wallet, canonical, predecessor } = envelope;
  const identities = canonicalIdentities(canonical), activation = predecessor.activations[0], acceptance = predecessor.acceptances[0];
  verify(acceptance && predecessor.publications.length === 1 && activation.request_id === envelope.requestId
    && identities.users.has(envelope.ownerId) && identities.users.has(activation.actor_user_id)
    && identities.users.has(activation.seller_id) && identities.users.has(activation.buyer_id),
  "Cancellation recovery requires its original accepted mapping and complete identity references");
  verify(activation.input_digest === walletDigest({ kind: "alpha-wallet-initial-marketplace-activation-v1",
    actorUserId: activation.actor_user_id, requestId: activation.request_id, assetId: activation.asset_id,
    walletListingId: activation.wallet_listing_id, walletTradeId: activation.wallet_trade_id }), "Original initial activation fingerprint disagrees");
  verify(activation.wallet_checkpoint.revision >= wallet.initialContinuation.commandRevision
    && activation.wallet_checkpoint.revision < wallet.cancellationContinuation.checkpoint.revision,
  "Original activation checkpoint must precede the V4 continuation");
  const prefix = verifyV3History(wallet.commands.slice(0, activation.wallet_checkpoint.revision));
  verify(isV3State(prefix.state) && same(activation.wallet_checkpoint, { revision: prefix.revision, eventHash: prefix.eventHash,
    stateHash: walletDigest(prefix.state), lastCommandAtMs: prefix.lastCommandAtMs }), "Original activation checkpoint disagrees with unchanged replay");
  const description = validateOriginalBasis(activation, prefix.state);
  const tail = wallet.commands.slice(activation.wallet_checkpoint.revision, wallet.cancellationContinuation.checkpoint.revision);
  verify(tail.length > 0 && tail.every(row => {
    const command = parseV3Command(row.command_json);
    return command.type === "pause" && command.actor.kind === "operator"
      || command.type === "acceptInitialSellerRequest" && command.actor.kind === "seller"
        && command.actor.id === activation.seller_id && command.input.terms.platformRequestId === activation.request_id;
  }) && tail.filter(row => row.command_type === "acceptInitialSellerRequest").length === 1,
  "Original coordinated V3 prefix contains an unsupported transition or missing acceptance");
  const receipt = state.initialAcceptanceReceipts.get(acceptance.acceptance_key), binding = state.initialBindings.get(activation.request_id);
  const commandRow = wallet.commands[acceptance.wallet_command_revision - 1], command = parseV3Command(commandRow?.command_json);
  const basis = activation.canonical_basis;
  verify(state.initialBindings.size === 1 && state.initialAcceptanceReceipts.size === 1 && receipt && binding
    && same(receipt, acceptance.receipt) && command.type === "acceptInitialSellerRequest"
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
  "Original coordinated acceptance differs from its unchanged financial receipt, mapping or buyer evidence");
  verify(acceptance.input_digest === walletDigest({ kind: "alpha-wallet-initial-marketplace-acceptance-v1", actorUserId: activation.seller_id,
    requestId: activation.request_id, safetyAcknowledged: receipt.input.sellerAction.faceToFaceSafetyAcknowledged }),
  "Original initial acceptance input fingerprint disagrees");
  const expected = expectedCanonical(activation, acceptance), at = expected.trade.updatedAt;
  verify(same(acceptance.canonical_result, expected), "Original canonical acceptance or deterministic events changed");
  const expectedTrade = basis.trade ? { ...basis.trade, status: "accepted", created_at: at, updated_at: at, payload: expected.trade }
    : { id: activation.platform_trade_id, purchase_request_id: activation.request_id, listing_id: activation.platform_listing_id,
      seller_id: activation.seller_id, buyer_id: activation.buyer_id, status: "accepted", completed_at: null,
      created_at: at, updated_at: at, sort_index: 0, payload: expected.trade };
  const expectedRequest = { ...basis.request, status: "accepted", updated_at: at, payload: expected.request };
  const expectedListing = { ...basis.listing, status: "matched", active_trade_request_id: activation.request_id, updated_at: at, payload: expected.listing };
  const notification = expected.notifications[0], audit = expected.auditLogs[0];
  const notificationRow = canonical.notifications.find(row => row.id === notification.id), auditRow = canonical.audit_logs.find(row => row.id === audit.id);
  verify(notificationRow && sameRow(notificationRow, { id: notification.id, user_id: activation.buyer_id, category: "trade",
    is_read: false, created_at: at, sort_index: 0, payload: notification })
    && auditRow && sameRow(auditRow, { id: audit.id, action: "listing_matched", actor_user_id: activation.seller_id,
      target_user_id: activation.seller_id, listing_id: activation.platform_listing_id, purchase_request_id: activation.request_id,
      created_at: at, sort_index: 0, payload: audit }), "Original acceptance notification or audit is missing or changed");
  const eventId = payloadArray(expected.request.timeline).at(-1)!.id;
  verify(canonical.purchase_requests.reduce((count, row) => count + payloadArray(row.payload.timeline ?? []).filter(entry => entry.id === eventId).length, 0) === 1,
    "Original acceptance timeline identity is missing or duplicated");
  const publication = predecessor.publications[0];
  verify(acceptance.publication_id === `initial-wallet-publication-${acceptance.acceptance_key}` && publication.id === acceptance.publication_id
    && publication.acceptance_key === acceptance.acceptance_key && same(publication.payload, { type: "initial_seller_request_accepted",
      requestId: activation.request_id, listingId: activation.platform_listing_id, tradeId: activation.platform_trade_id,
      buyerId: activation.buyer_id, sellerId: activation.seller_id, walletTradeId: activation.wallet_trade_id,
      walletRevision: acceptance.wallet_command_revision, walletEventHash: acceptance.wallet_event_hash, termsDigest: receipt.termsDigest,
      notificationIds: [notification.id], auditId: audit.id, timelineEventId: eventId }), "Original initial publication intent is missing or changed");
  const siblings = canonical.purchase_requests.filter(row => row.listing_id === activation.platform_listing_id || row.payload.listingId === activation.platform_listing_id);
  verify(siblings.length === basis.siblings.length && siblings.every(row => {
    const original = basis.siblings.find(other => other.id === row.id);
    return original && (row.id === activation.request_id || sameRow(row, original));
  }), "Original canonical sibling identities, quantities or ordering changed");
  verify(!canonical.evidence.some(row => row.purchase_request_id === activation.request_id)
    && !canonical.disputes.some(row => row.purchase_request_id === activation.request_id || row.trade_id === activation.platform_trade_id)
    && !canonical.commissions.some(row => row.purchase_request_id === activation.request_id || row.payload.tradeId === activation.platform_trade_id)
    && ![...state.payouts.values()].some(payout => !["confirmed", "failed_final"].includes(payout.state)),
  "Cancellation recovery contains unsupported target payment, dispute, commission or unfinished payout progress");
  return { activation, acceptance, identities, expectedRequest, expectedListing, expectedTrade };
}

export function verifyPaymentMarketplacePredecessor(envelope: PaymentMarketplacePredecessorProof, state: V4State) {
  const { canonical, predecessor, coordination, wallet } = envelope;
  verify([...Object.values(canonical), ...Object.values(predecessor), ...Object.values(coordination)]
    .reduce((sum, values) => sum + values.length, 0) <= MAX_CANCELLATION_MARKETPLACE_BACKUP_ROWS,
  "Cancellation recovery total row limit exceeded");
  const original = originalAcceptance(envelope, state);
  const { activation, acceptance, identities, expectedRequest, expectedListing, expectedTrade } = original;
  const transition = coordination.transitions[0], continuation = state.cancellationContinuation;
  const upgraded = wallet.commands[transition.wallet_command_revision - 1], upgrade = parseV4Command(upgraded?.command_json);
  verify(transition.request_id === activation.request_id && identities.users.has(transition.actor_user_id)
    && transition.input_digest === walletDigest({ kind: "alpha-wallet-initial-cancellation-upgrade-v1",
      actorUserId: transition.actor_user_id, requestId: transition.request_id })
    && same(transition.predecessor, { activation, acceptance, publication: predecessor.publications[0] })
    && same(transition.wallet_checkpoint, continuation.checkpoint) && same(transition.continuation, continuation)
    && transition.wallet_command_revision === continuation.commandRevision && transition.wallet_command_key === continuation.commandKey
    && upgrade.type === "continueFromV3" && upgrade.actor.kind === "operator" && upgrade.actor.id === transition.actor_user_id
    && same(upgrade.input.checkpoint, transition.wallet_checkpoint) && upgraded.command_key === transition.wallet_command_key
    && upgraded.event_hash === transition.wallet_event_hash && same(upgraded.result_json, continuation),
  "Successor transition differs from its exact predecessor, explicit continuation or recorded owner identity");
  const beforeUpgrade = verifyV3History(wallet.commands.slice(0, continuation.checkpoint.revision));
  verify(isV3State(beforeUpgrade.state) && same(continuation.checkpoint, { revision: beforeUpgrade.revision,
    eventHash: beforeUpgrade.eventHash, stateHash: walletDigest(beforeUpgrade.state), lastCommandAtMs: beforeUpgrade.lastCommandAtMs })
    && beforeUpgrade.state.haltReason === continuation.sourceHaltReason,
  "Cancellation continuation must preserve its original V3 checkpoint and inherited halt");
  const tail = wallet.commands.slice(continuation.commandRevision);
  verify(tail.every(row => {
    const command = parseV4Command(row.command_json);
    return command.type === "pause" && command.actor.kind === "operator"
      || command.type === "cancelInitialTrade" && command.input.terms.platformRequestId === activation.request_id;
  }) && coordination.cancellations.length === state.initialCancellationReceipts.size
    && coordination.publications.length === coordination.cancellations.length
    && tail.filter(row => row.command_type === "cancelInitialTrade").length === coordination.cancellations.length,
  "Successor cancellation, command, receipt and publication inventories disagree");
  const request = identities.requests.get(activation.request_id), listing = identities.listings.get(activation.platform_listing_id);
  const physical = canonical.trades.filter(row => row.purchase_request_id === activation.request_id || row.id === activation.platform_trade_id);
  verify(request && listing && physical.length === 1, "Successor canonical mapping is missing or ambiguous");
  const cancellation = coordination.cancellations[0];
  if (!cancellation) {
    verify(sameRow(request, expectedRequest) && sameRow(listing, expectedListing) && sameRow(physical[0], expectedTrade),
      "An uncancelled successor must preserve the original accepted canonical rows");
    return;
  }
  const receipt = state.initialCancellationReceipts.get(cancellation.cancellation_key);
  const row = wallet.commands[cancellation.wallet_command_revision - 1], command = parseV4Command(row?.command_json);
  verify(receipt && same(receipt, cancellation.receipt) && command.type === "cancelInitialTrade"
    && same(command.input, receipt.input) && same(row.result_json, receipt)
    && row.command_key === cancellation.wallet_command_key && row.event_hash === cancellation.wallet_event_hash
    && receipt.commandRevision === cancellation.wallet_command_revision && receipt.commandKey === cancellation.wallet_command_key
    && cancellation.request_id === activation.request_id && receipt.platformRequestId === activation.request_id
    && receipt.platformTradeId === activation.platform_trade_id && receipt.platformListingId === activation.platform_listing_id
    && receipt.walletTradeId === activation.wallet_trade_id && receipt.walletListingId === activation.wallet_listing_id
    && receipt.acceptanceKey === acceptance.acceptance_key && cancellation.actor_user_id === receipt.actorUserId
    && cancellation.actor_kind === receipt.actorKind && command.actor.id === receipt.actorUserId && command.actor.kind === receipt.actorKind
    && (receipt.actorKind === "seller" ? receipt.actorUserId === activation.seller_id : receipt.actorUserId === activation.buyer_id)
    && cancellation.input_digest === walletDigest({ kind: "alpha-wallet-initial-cancellation-request-v1",
      actorUserId: cancellation.actor_user_id, requestId: cancellation.request_id }),
  "Coordinated cancellation differs from its original financial receipt, party or command");
  const basis = cancellation.canonical_basis;
  verify(sameRow(basis.request, expectedRequest) && sameRow(basis.listing, expectedListing) && sameRow(basis.trade, expectedTrade)
    && receipt.input.preconditions.requestDigest === walletDigest(basis.request.payload)
    && receipt.input.preconditions.listingDigest === walletDigest(basis.listing.payload)
    && receipt.input.preconditions.tradeDigest === walletDigest(basis.trade.payload),
  "Cancellation prestate must retain the exact original accepted target and financial digest commitments");
  verify(new Set(basis.reminders.map(reminder => reminder.id)).size === basis.reminders.length
    && basis.reminders.every((reminder, index) => index === 0 || basis.reminders[index - 1].sort_index < reminder.sort_index
      || basis.reminders[index - 1].sort_index === reminder.sort_index && basis.reminders[index - 1].id < reminder.id),
  "Cancellation reminder basis requires exact sort-index/identity order");
  for (const reminder of basis.reminders) {
    const p = reminder.payload;
    verify(p.id === reminder.id && p.userId === reminder.user_id && p.category === reminder.category && p.isRead === reminder.is_read
      && sameTime(p.createdAt, reminder.created_at) && reminder.user_id === activation.buyer_id
      && p.reason === "automatic_trade_action_reminder" && p.relatedRequestId === activation.request_id && p.state !== "archived",
    "Cancellation reminder prestate is inconsistent or outside its exact archive scope");
  }
  // These synthetic metadata-only accounts let the pure mechanical planner
  // reproduce recorded events. They do not reconstruct authentication or make
  // historical roles current authority; private account/session rows are absent.
  const users = canonical.users.map(user => ({ id: user.id, role: user.id === cancellation.actor_user_id ? basis.actorRole : user.role,
    disabled: false, createdAt: new Date(user.created_at).toISOString(), updatedAt: new Date(user.updated_at).toISOString() }));
  const cancellationNoticeIds = new Set(cancellation.canonical_result.notifications.map(notice => notice.id));
  const originalNotifications = canonical.notifications.filter(notice => !cancellationNoticeIds.has(notice.id))
    .sort((left, right) => left.sort_index - right.sort_index || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map(notice => basis.reminders.find(original => original.id === notice.id)?.payload ?? notice.payload);
  const marketplace = { users, marketplaceListings: [basis.listing.payload],
    purchaseRequests: canonical.purchase_requests.filter(candidate => candidate.listing_id === activation.platform_listing_id)
      .map(candidate => candidate.id === activation.request_id ? basis.request.payload : candidate.payload),
    commissionRecords: canonical.commissions.map(value => value.payload), sellerReviews: [],
    marketplaceEnforcementRecords: canonical.marketplace_enforcement_records.map(value => value.payload),
    tradeEvidenceFiles: canonical.evidence.map(value => value.payload), disputes: canonical.disputes.map(value => value.payload),
    notifications: originalNotifications } as unknown as DevelopmentPrepaymentCancellationMarketplace;
  // Canonical persistence uses ordinary JSON: explicit undefined removal keys
  // are absent in the stored payload, rather than walletJson's undefined tags.
  const expected = JSON.parse(JSON.stringify(planDevelopmentPrepaymentCancellation(marketplace, { requestId: activation.request_id,
    tradeId: activation.platform_trade_id, actorUserId: cancellation.actor_user_id, cancelledAtMs: receipt.cancelledAtMs }))) as ReturnType<typeof planDevelopmentPrepaymentCancellation>;
  verify(same(cancellation.canonical_result, expected), "Cancellation canonical result or deterministic events changed");
  const at = new Date(receipt.cancelledAtMs).toISOString();
  verify(sameRow(request, { ...basis.request, status: "cancelled", updated_at: at, payload: expected.request })
    && sameRow(listing, { ...basis.listing, status: "active", active_trade_request_id: null, updated_at: at, payload: expected.listing })
    && sameRow(physical[0], { ...basis.trade, status: "cancelled", updated_at: at, payload: expected.trade }),
  "Cancelled canonical request, physical trade or reopened listing differs from the exact result");
  for (const [index, notification] of expected.notifications.entries()) {
    const retained = canonical.notifications.find(value => value.id === notification.id);
    verify(retained && sameRow(retained, { id: notification.id, user_id: notification.userId, category: notification.category,
      is_read: false, created_at: at, sort_index: index, payload: notification }), "Cancellation notification is missing or changed");
  }
  verify(expected.notificationUpdates.length === basis.reminders.length, "Cancellation reminder archive inventory disagrees");
  for (const notification of expected.notificationUpdates) {
    const before = basis.reminders.find(value => value.id === notification.id), retained = canonical.notifications.find(value => value.id === notification.id);
    verify(before && retained && sameRow(retained, { ...before, is_read: true, payload: notification }),
      "Cancellation reminder archive is missing or changed");
  }
  const audit = expected.auditLogs[0], retainedAudit = canonical.audit_logs.find(value => value.id === audit.id);
  verify(retainedAudit && sameRow(retainedAudit, { id: audit.id, action: audit.action, actor_user_id: audit.actorUserId,
    target_user_id: audit.targetUserId ?? null, listing_id: audit.listingId ?? null, purchase_request_id: audit.purchaseRequestId ?? null,
    created_at: at, sort_index: 0, payload: audit }), "Cancellation audit is missing or changed");
  const timelineEventId = expected.request.timeline.at(-1)!.id;
  verify(canonical.purchase_requests.reduce((count, candidate) => count + payloadArray(candidate.payload.timeline ?? [])
    .filter(entry => entry.id === timelineEventId).length, 0) === 1, "Cancellation event identity is missing or duplicated");
  const publication = coordination.publications[0];
  verify(cancellation.publication_id === `cancellation-wallet-publication-${cancellation.cancellation_key}`
    && publication?.id === cancellation.publication_id && publication.cancellation_key === cancellation.cancellation_key
    && same(publication.payload, { type: "initial_trade_cancelled", requestId: activation.request_id, listingId: activation.platform_listing_id,
      tradeId: activation.platform_trade_id, walletTradeId: activation.wallet_trade_id, sellerId: activation.seller_id, buyerId: activation.buyer_id,
      actorUserId: cancellation.actor_user_id, actorKind: cancellation.actor_kind, acceptanceKey: acceptance.acceptance_key,
      cancellationKey: cancellation.cancellation_key, walletRevision: cancellation.wallet_command_revision,
      walletEventHash: cancellation.wallet_event_hash, termsDigest: receipt.termsDigest,
      notificationIds: expected.notifications.map(notice => notice.id), auditId: audit.id, timelineEventId }),
  "Cancellation safe publication intent is missing or changed");
}
