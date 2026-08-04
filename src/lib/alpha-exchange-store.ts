                  import { appendFileSync, mkdirSync } from "fs";
import path from "path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { normalizeTransactionHash } from "@/lib/tx-hash-utils";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { createExchangeDisplayLookup, normalizeDisplayNumber, replaceExchangeEntityIds } from "./alpha-exchange-display";
import { calculateSellerTrustSnapshot, rankTrustSnapshots } from "@/lib/trust-engine";
import { getSellerPrestigeProgress, getSellerPublicVolumeLabel, resolveSellerPrestigeRank, sellerPrestigeRankWeight } from "@/lib/seller-prestige";
import { evaluateSellerAchievements } from "@/lib/seller-achievements";
import { runEnvValidation } from "@/lib/env-validation";
import { getAlphaExchangeRepository, type SnapshotTableName } from "@/lib/alpha-exchange-repository";
import { addRole, hasRole, isUserRole, normalizeRolesForUser, removeRole, resolvePrimaryRole } from "@/lib/roles";
import { publishRealtimeEvent } from "@/lib/realtime";
import {
  MAX_LISTING_PAYMENT_METHODS,
  isBankTransferPaymentMethod,
  isCardlessAtmPaymentMethod,
  isFaceToFacePaymentMethod,
  requiresIsraeliBankSelection,
  isSellerEvidenceRequiredForPaymentMethod,
  normalizeMarketplacePaymentMethod,
  resolveListingPaymentMethods,
} from "@/lib/marketplace-payment-methods";
import {
  MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS,
  parseIsraeliBankSelection,
  serializeIsraeliBankSelection,
} from "@/lib/israeli-banks";
import type {
  AlphaExchangeActivityLogEntry,
  BetaAnnouncement,
  BetaAnnouncementType,
  BetaFeedbackCategory,
  BetaFeedbackEntry,
  BetaFeedbackStatus,
  AlphaExchangeDb,
  AlphaExchangeNotification,
  AlphaExchangeUser,
  AuditAction,
  AuditLogEntry,
  AuthSession,
  CommissionRecord,
  ListingApprovalStatus,
  ListingStatus,
  MarketplaceListing,
  OwnerBusinessDashboardMetrics,
  PasswordResetToken,
  PrivateBetaInviteCode,
  PurchaseRequest,
  PurchaseRequestStatus,
  SupportedNetwork,
  SellerApplication,
  SellerApplicationStatus,
  SellerReport,
  SellerLevel,
  NotificationCategory,
  NotificationCenterCategory,
  NotificationPriorityLevel,
  NotificationPreferences,
  NotificationState,
  NotificationTradeSnapshot,
  SellerPublicProfile,
  PremiumSellerProfileData,
  SellerReputationSnapshot,
  SellerAvailabilityStatus,
  SellerStatus,
  SellerOnlineStatus,
  SellerPromotionHistoryEntry,
  SellerAchievement,
  TradeDisputeCase,
  TradeEvidenceFile,
  TradeEvidenceSide,
  TradeChatMessage,
  TradeTimelineEventType,
  OwnerPrivateBetaDashboardData,
  OnboardingSelection,
  UserRole,
  SellerReviewRecord,
  TrustSnapshotRecord,
  TrustScoreChangeLog,
} from "@/types/alpha-exchange";

const SELLER_EVIDENCE_TRACE_PATH = path.join(process.cwd(), "tmp", "seller-evidence-server.log");

function writeSellerEvidenceTrace(label: string, payload: unknown) {
  if (process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM !== "1") return;
  mkdirSync(path.dirname(SELLER_EVIDENCE_TRACE_PATH), { recursive: true });
  appendFileSync(SELLER_EVIDENCE_TRACE_PATH, `${JSON.stringify({ label, payload }, null, 2)}\n`, "utf8");
}

function getSortableDisplayTimestamp<T extends { createdAt?: string; updatedAt?: string }>(item: T) {
  const createdAtMs = item.createdAt ? new Date(item.createdAt).getTime() : Number.NaN;
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) return createdAtMs;
  const updatedAtMs = item.updatedAt ? new Date(item.updatedAt).getTime() : Number.NaN;
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs;
  return 0;
}

function assignDisplayNumbers<T extends { displayNumber?: number; createdAt?: string; updatedAt?: string }>(items: T[]) {
  const usedNumbers = new Set<number>();
  let nextDisplayNumber = 1;
  let changed = false;

  for (const item of items) {
    const displayNumber = normalizeDisplayNumber(item.displayNumber);
    if (!displayNumber) continue;
    usedNumbers.add(displayNumber);
    if (displayNumber >= nextDisplayNumber) nextDisplayNumber = displayNumber + 1;
  }

  const missing = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !normalizeDisplayNumber(item.displayNumber))
    .sort((left, right) => {
      const timestampDelta = getSortableDisplayTimestamp(left.item) - getSortableDisplayTimestamp(right.item);
      if (timestampDelta !== 0) return timestampDelta;
      return left.index - right.index;
    });

  for (const { item } of missing) {
    while (usedNumbers.has(nextDisplayNumber)) nextDisplayNumber += 1;
    item.displayNumber = nextDisplayNumber;
    usedNumbers.add(nextDisplayNumber);
    nextDisplayNumber += 1;
    changed = true;
  }

  return changed;
}

function ensureDisplayNumbers(db: AlphaExchangeDb) {
  return [
    assignDisplayNumbers(db.sellerApplications),
    assignDisplayNumbers(db.marketplaceListings),
    assignDisplayNumbers(db.purchaseRequests),
    assignDisplayNumbers(db.commissionRecords),
    assignDisplayNumbers(db.disputes),
    assignDisplayNumbers(db.sellerReports),
  ].some(Boolean);
}

const supportedEvidenceMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

// Validate environment variables on first module load
runEnvValidation();

const defaultDb: AlphaExchangeDb = {
  users: [],
  sellerApplications: [],
  marketplaceListings: [],
  purchaseRequests: [],
  commissionRecords: [],
  auditLogs: [],
  authSessions: [],
  passwordResetTokens: [],
  notifications: [],
  activityLog: [],
  disputes: [],
  sellerReports: [],
  trustSnapshots: [],
  trustScoreHistory: [],
  tradeEvidenceFiles: [],
  tradeMessages: [],
  privateBetaInvites: [],
  privateBetaInviteUses: [],
  betaFeedback: [],
  betaAnnouncements: [],
  sellerReviews: [],
};

// Cache TTL: writeDb() always updates the cache on write, so correctness is
// maintained even with a long TTL. Raising from 1 s to 15 s eliminates the
// full 22-table snapshot reload that was occurring on nearly every request.
const DB_CACHE_TTL_MS = 15_000;
const MAX_ACTIVE_LISTINGS_PER_SELLER = 2;
const COMMISSION_GRACE_PERIOD_DAYS = 7;
const DEFAULT_LISTING_EXPIRATION_HOURS = 24;
const ALLOWED_LISTING_EXPIRATION_HOURS = [1, 6, 12, 24] as const;
const DEFAULT_STALE_TRADE_TIMEOUT_MINUTES = 20;
const BUYER_CONFIRMATION_TIMEOUT_MINUTES = 5;
const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
const SYSTEM_ACTOR_USER_ID = "system:marketplace";
let dbCache: { value: AlphaExchangeDb; updatedAt: number } | null = null;
let dbReadInFlight: Promise<AlphaExchangeDb> | null = null;
let dbWriteInFlight: Promise<void> = Promise.resolve();

export function invalidateAlphaExchangeStoreCache() {
  dbCache = null;
  dbReadInFlight = null;
}

export class TradeBlockedError extends Error {
  readonly code: string;
  readonly purchaseRequestId?: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, purchaseRequestId?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "TradeBlockedError";
    this.code = code;
    this.purchaseRequestId = purchaseRequestId;
    this.details = details;
  }
}

function syncCachedAuthSessions(nextAuthSessions: AuthSession[]) {
  if (!dbCache) return;
  dbCache = {
    value: {
      ...dbCache.value,
      authSessions: structuredClone(nextAuthSessions),
    },
    updatedAt: Date.now(),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isSupportedNetwork(value: string): value is SupportedNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20" || value === "SOL";
}

function normalizeNotificationPreferences(input?: NotificationPreferences): NotificationPreferences {
  return {
    inApp: input?.inApp !== false,
    email: input?.email === true,
    sms: input?.sms === true,
  };
}

function isNotificationCenterCategory(value: string): value is NotificationCenterCategory {
  return value === "trades" || value === "listings" || value === "account" || value === "reviews" || value === "system" || value === "announcements";
}

function normalizeNotificationState(value: unknown, isRead: boolean): NotificationState {
  if (value === "archived") return "archived";
  if (value === "read") return "read";
  if (value === "unread") return "unread";
  return isRead ? "read" : "unread";
}

function resolveNotificationCenterCategory(notification: Pick<AlphaExchangeNotification, "category" | "title" | "message">): NotificationCenterCategory {
  const text = `${notification.title} ${notification.message}`.toLowerCase();
  if (notification.category === "trade") {
    if (text.includes("review")) return "reviews";
    return "trades";
  }
  if (notification.category === "trust") return "reviews";
  if (notification.category === "listing") return "listings";
  if (notification.category === "system") {
    return text.includes("announcement") ? "announcements" : "system";
  }
  if (notification.category === "account" || notification.category === "application" || notification.category === "dispute" || notification.category === "report") {
    return "account";
  }
  return "system";
}

function resolveNotificationPriority(notification: Pick<AlphaExchangeNotification, "title" | "message" | "category" | "centerCategory">): { priority: NotificationPriorityLevel; rank: number } {
  const text = `${notification.title} ${notification.message}`.toLowerCase();
  if (text.includes("buyer paid") || text.includes("marked payment sent") || text.includes("verify your payment")) {
    return { priority: "critical", rank: 10 };
  }
  if (text.includes("usdt sent") || text.includes("confirmed your payment") || text.includes("waiting for usdt")) {
    return { priority: "critical", rank: 20 };
  }
  if (text.includes("trade completed") || text.includes("review available") || text.includes("confirm trade completed")) {
    return { priority: "high", rank: 30 };
  }
  if (text.includes("review")) {
    return { priority: "high", rank: 40 };
  }
  if (text.includes("listing expired") || text.includes("listing unavailable")) {
    return { priority: "normal", rank: 50 };
  }
  if (text.includes("seller approved") || text.includes("application approved")) {
    return { priority: "normal", rank: 60 };
  }
  if ((notification.centerCategory ?? "system") === "announcements") {
    return { priority: "low", rank: 70 };
  }
  return notification.category === "trade" ? { priority: "high", rank: 35 } : { priority: "normal", rank: 65 };
}

function resolveTradeRequiredAction(request: PurchaseRequest, recipientIsSeller: boolean) {
  if (request.status === "pending") {
    return recipientIsSeller ? "Accept or decline this request" : "Wait for seller response";
  }
  if (request.status === "accepted") {
    return recipientIsSeller ? "Wait for buyer payment proof" : "Upload payment proof and mark Payment Sent";
  }
  if (request.status === "payment_sent") {
    return recipientIsSeller ? "Verify payment, upload proof, then mark USDT Sent" : "Wait for seller USDT release";
  }
  if (request.status === "usdt_sent") {
    return recipientIsSeller ? "Wait for buyer completion confirmation" : "Confirm trade completed";
  }
  if (request.status === "review_open" || request.status === "completed") {
    return "Leave your trade review";
  }
  if (request.status === "declined" || request.status === "cancelled") {
    return "Trade is closed";
  }
  return "Open trade details";
}

function resolveNotificationActionLabel(notification: Pick<AlphaExchangeNotification, "title" | "message" | "centerCategory" | "relatedTradeId" | "relatedRequestId">, request?: PurchaseRequest) {
  const text = `${notification.title} ${notification.message}`.toLowerCase();
  if (text.includes("seller application")) return "Review Application";
  if (text.includes("listing")) return "Manage Listing";
  if (text.includes("verify") || text.includes("payment sent")) return "Verify Payment";
  if (text.includes("confirm") && text.includes("completed")) return "Confirm Completion";
  if (text.includes("review") || request?.status === "review_open" || request?.status === "completed") return "Leave Review";
  if ((notification.centerCategory ?? "system") === "trades" || notification.relatedTradeId || notification.relatedRequestId) return "Continue Trade";
  return "Open";
}

function resolveTradeContextForNotification(
  db: AlphaExchangeDb,
  input: { userId: string; relatedRequestId?: string; relatedTradeId?: string; relatedListingId?: string },
) {
  const directRequest = input.relatedRequestId ? db.purchaseRequests.find((request) => request.id === input.relatedRequestId) : undefined;
  if (directRequest) return directRequest;

  const byTrade = input.relatedTradeId
    ? db.purchaseRequests.find((request) => request.id === input.relatedTradeId || request.tradeId === input.relatedTradeId)
    : undefined;
  if (byTrade) return byTrade;

  if (!input.relatedListingId) return undefined;
  const related = db.purchaseRequests
    .filter((request) => request.listingId === input.relatedListingId && (request.buyerId === input.userId || request.sellerId === input.userId))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return related[0];
}

function buildTradeSnapshotForNotification(db: AlphaExchangeDb, userId: string, request?: PurchaseRequest): NotificationTradeSnapshot | undefined {
  if (!request) return undefined;
  const recipientIsSeller = request.sellerId === userId;
  const counterpartyId = recipientIsSeller ? request.buyerId : request.sellerId;
  const counterparty = db.users.find((user) => user.id === counterpartyId);
  const listing = db.marketplaceListings.find((item) => item.id === request.listingId);
  return {
    requestId: request.id,
    requestDisplayNumber: request.displayNumber,
    tradeId: request.tradeId,
    tradeDisplayNumber: request.displayNumber,
    listingDisplayNumber: listing?.displayNumber,
    sellerId: request.sellerId,
    buyerId: request.buyerId,
    counterpartyName: counterparty?.fullName?.trim() || (recipientIsSeller ? "Buyer" : "Seller"),
    counterpartyAvatarUrl: counterparty?.profilePhotoUrl?.trim() || undefined,
    usdtAmount: request.usdtAmount,
    fiatAmount: request.fiatAmount,
    currency: request.currency,
    currentStage: request.status,
    requiredAction: resolveTradeRequiredAction(request, recipientIsSeller),
  };
}

function enrichNotification(db: AlphaExchangeDb, notification: AlphaExchangeNotification, cachedLookup?: Record<string, string>): AlphaExchangeNotification {
  const request = resolveTradeContextForNotification(db, {
    userId: notification.userId,
    relatedRequestId: notification.relatedRequestId,
    relatedTradeId: notification.relatedTradeId,
    relatedListingId: notification.relatedListingId,
  });
  const relatedRequestId = notification.relatedRequestId ?? request?.id;
  const relatedTradeId = notification.relatedTradeId ?? request?.tradeId ?? request?.id;
  const centerCategory = notification.centerCategory && isNotificationCenterCategory(notification.centerCategory)
    ? notification.centerCategory
    : resolveNotificationCenterCategory(notification);
  const state = normalizeNotificationState(notification.state, notification.isRead);
  const priority = notification.priority ?? resolveNotificationPriority({ ...notification, centerCategory }).priority;
  const priorityRank = typeof notification.priorityRank === "number"
    ? notification.priorityRank
    : resolveNotificationPriority({ ...notification, centerCategory }).rank;
  const isTradeNotification = notification.category === "trade";
  const relatedHref = isTradeNotification && request
    ? requestDetailsHref(request.id)
    : notification.relatedHref;
  const actionHref = notification.actionHref?.trim() || relatedHref;
  const listing = request ? db.marketplaceListings.find((item) => item.id === request.listingId) : undefined;
  // Reuse a pre-built lookup when available (batch calls) to avoid O(n) per notification.
  const displayLookup = cachedLookup ?? createExchangeDisplayLookup({
    listings: db.marketplaceListings,
    requests: db.purchaseRequests,
    commissions: db.commissionRecords,
    disputes: db.disputes,
    applications: db.sellerApplications,
  });
  return {
    ...notification,
    title: replaceExchangeEntityIds(notification.title, displayLookup),
    message: replaceExchangeEntityIds(notification.message, displayLookup),
    isRead: state !== "unread",
    state,
    centerCategory,
    priority,
    priorityRank,
    relatedRequestId,
    relatedRequestDisplayNumber: request?.displayNumber,
    relatedTradeId,
    relatedTradeDisplayNumber: request?.displayNumber,
    relatedListingDisplayNumber: listing?.displayNumber,
    relatedHref,
    actionHref,
    actionLabel: notification.actionLabel?.trim() || resolveNotificationActionLabel(notification, request),
    tradeSnapshot: isTradeNotification
      ? (notification.tradeSnapshot ?? buildTradeSnapshotForNotification(db, notification.userId, request))
      : undefined,
    updatedAt: notification.updatedAt ?? notification.createdAt,
  };
}

function getLargeTradeThreshold() {
  const raw = Number(process.env.ALPHA_EXCHANGE_LARGE_TRADE_THRESHOLD ?? "50000");
  if (Number.isNaN(raw) || raw <= 0) return 50000;
  return raw;
}

function getMaxEvidenceSizeBytes() {
  const raw = Number(process.env.ALPHA_EXCHANGE_EVIDENCE_MAX_SIZE_MB ?? "8");
  if (Number.isNaN(raw) || raw <= 0) return 8 * 1024 * 1024;
  return Math.round(raw * 1024 * 1024);
}

function getListingExpirationHours(value?: number | string) {
  const parsed = Number(value ?? DEFAULT_LISTING_EXPIRATION_HOURS);
  if (!ALLOWED_LISTING_EXPIRATION_HOURS.includes(parsed as (typeof ALLOWED_LISTING_EXPIRATION_HOURS)[number])) {
    return DEFAULT_LISTING_EXPIRATION_HOURS;
  }
  return parsed;
}

function getListingExpirationIso(base: string, hours?: number | string) {
  const baseMs = new Date(base).getTime();
  const safeBaseMs = Number.isNaN(baseMs) || baseMs <= 0 ? Date.now() : baseMs;
  return new Date(safeBaseMs + getListingExpirationHours(hours) * 60 * 60 * 1000).toISOString();
}

function getStaleTradeTimeoutMinutes() {
  const raw = Number(process.env.ALPHA_EXCHANGE_STALE_TRADE_TIMEOUT_MINUTES ?? DEFAULT_STALE_TRADE_TIMEOUT_MINUTES);
  if (Number.isNaN(raw) || raw <= 0) return DEFAULT_STALE_TRADE_TIMEOUT_MINUTES;
  return raw;
}

function extensionForEvidenceMimeType(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "pdf";
}

function toNumber(value: string | number | null | undefined) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function roundUsdt(value: number) {
  return Number(value.toFixed(2));
}

function isQaCommissionModeEnabled() {
  return process.env.ALPHA_EXCHANGE_QA_COMMISSION_MODE === "1";
}

function isQaResetModeEnabled() {
  return process.env.ALPHA_EXCHANGE_QA_MODE === "1";
}

function getCommissionAmountDueUsdt(db: AlphaExchangeDb, record: CommissionRecord) {
  const request = db.purchaseRequests.find((item) => item.id === record.purchaseRequestId);
  if (request) {
    if (isQaCommissionModeEnabled()) return 1;
    const requestedUsdt = toNumber(request.usdtAmount);
    if (requestedUsdt > 0) return roundUsdt(requestedUsdt * 0.01);
  }
  if (isQaCommissionModeEnabled()) return 1;
  return roundUsdt(record.commissionAmount);
}

function addDaysIso(value: string, days: number) {
  const start = new Date(value).getTime();
  if (!start || Number.isNaN(start)) return nowIso();
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
}

function addMinutesIso(value: string, minutes: number) {
  const start = new Date(value).getTime();
  if (!start || Number.isNaN(start)) return nowIso();
  return new Date(start + minutes * 60 * 1000).toISOString();
}

function normalizeListingStatus(value: string): ListingStatus {
  if (value === "draft" || value === "active" || value === "paused" || value === "matched" || value === "in_trade" || value === "expired" || value === "completed" || value === "cancelled" || value === "closed") {
    return value;
  }
  if (value === "available") return "active";
  if (value === "sold") return "completed";
  if (value === "rejected") return "cancelled";
  return "draft";
}

function normalizeListingApprovalStatus(value: string | undefined, listingStatus: ListingStatus): ListingApprovalStatus | undefined {
  if (value === "pending" || value === "approved" || value === "rejected" || value === "changes_requested") {
    return value;
  }
  if (listingStatus === "draft") return "pending";
  if (listingStatus === "active") return "approved";
  return undefined;
}

function normalizeSellerAvailabilityStatus(value: string | undefined): SellerAvailabilityStatus {
  if (value === "away" || value === "vacation") return value;
  return "available";
}

function normalizeCommissionPaymentStatus(value: string | undefined, dueAt?: string) {
  if (value === "paid") return "paid" as const;
  const dueMs = dueAt ? new Date(dueAt).getTime() : 0;
  if (dueMs && !Number.isNaN(dueMs) && dueMs < Date.now()) return "overdue" as const;
  return "pending" as const;
}

function isListingCountedAgainstCreateLimit(status: ListingStatus) {
  return status === "draft" || status === "active" || status === "matched" || status === "in_trade";
}

function isListingLocked(status: ListingStatus) {
  return status === "matched" || status === "in_trade";
}

function canListingReceiveRequests(listing: MarketplaceListing) {
  return listing.status === "active" && toNumber(listing.availableAmount) > 0;
}

function isListingPendingApproval(listing: MarketplaceListing) {
  return listing.status === "draft" && (listing.approvalStatus ?? "pending") === "pending";
}

function isSellerUnavailableForNewBuyers(availabilityStatus: SellerAvailabilityStatus) {
  return availabilityStatus === "vacation";
}

function isRequestStatusLockingListing(status: PurchaseRequestStatus) {
  return status === "accepted"
    || status === "payment_sent"
    || status === "funds_received"
    || status === "usdt_release_pending"
    || status === "usdt_sent";
}

function getSellerOpenTradeCount(db: AlphaExchangeDb, sellerId: string) {
  return db.purchaseRequests.filter((request) => request.sellerId === sellerId && (
    request.status === "accepted"
    || request.status === "payment_sent"
    || request.status === "funds_received"
    || request.status === "usdt_release_pending"
    || request.status === "usdt_sent"
  )).length;
}

function getSellerPendingCommissionCount(db: AlphaExchangeDb, sellerId: string) {
  return db.commissionRecords.filter((record) => record.sellerId === sellerId && normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt) !== "paid").length;
}

function hasBuyerReviewSubmitted(db: AlphaExchangeDb, request: PurchaseRequest) {
  if (request.buyerReview) return true;
  const tradeId = request.tradeId ?? request.id;
  return db.sellerReviews.some((review) => review.tradeId === tradeId);
}

function getBuyerPendingFeedbackTrade(db: AlphaExchangeDb, buyerId: string) {
  const completedStatuses = new Set<PurchaseRequestStatus>(["review_open", "locked", "completed"]);
  return db.purchaseRequests
    .filter((request) => request.buyerId === buyerId && completedStatuses.has(request.status) && !hasBuyerReviewSubmitted(db, request))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
}

function getSellerOpenListingCount(db: AlphaExchangeDb, sellerId: string) {
  return db.marketplaceListings.filter((listing) => listing.sellerId === sellerId && isListingCountedAgainstCreateLimit(listing.status)).length;
}

function getSellerListingBlockReason(db: AlphaExchangeDb, sellerId: string) {
  const pendingCommissionCount = getSellerPendingCommissionCount(db, sellerId);
  if (pendingCommissionCount > 0) {
    return "You have commission payments pending. Clear them before creating or renewing listings.";
  }
  const openListingCount = getSellerOpenListingCount(db, sellerId);
  if (openListingCount >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
    return "You already have 2 active listings. Close one before creating another.";
  }
  return null;
}

function getListingByIdOrThrow(db: AlphaExchangeDb, listingId: string) {
  const listing = db.marketplaceListings.find((item) => item.id === listingId);
  if (!listing) throw new Error("Listing not found.");
  return listing;
}

function appendListingStateAudit(db: AlphaExchangeDb, input: {
  actorUserId: string;
  listingId: string;
  targetUserId: string;
  action: AuditAction;
  details: string;
  purchaseRequestId?: string;
}) {
  return appendAuditLog(db, input);
}

function levelRank(level: SellerLevel) {
  return sellerPrestigeRankWeight(level);
}

function summarizePromotionBenefits(rank: SellerLevel) {
  if (rank === "silver") return "Higher marketplace visibility and stronger buyer trust.";
  if (rank === "gold") return "Priority placement and stronger trust signaling on seller cards.";
  if (rank === "platinum") return "Premium placement and increased visibility with serious buyers.";
  if (rank === "diamond") return "Top-tier visibility and premium reputation with buyers.";
  if (rank === "legendary") return "Legendary recognition across Alpha Exchange and maximum buyer trust.";
  return "Starter prestige level unlocked.";
}

function getSellerApprovedAt(db: AlphaExchangeDb, sellerId: string) {
  const approvalEntry = db.auditLogs
    .filter((entry) => entry.targetUserId === sellerId && entry.action === "seller_approved")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  return approvalEntry?.createdAt;
}

function buildSellerAchievements(db: AlphaExchangeDb, seller: AlphaExchangeUser): SellerAchievement[] {
  const sellerRequests = db.purchaseRequests.filter((request) => request.sellerId === seller.id);
  const qualifyingTrades = sellerRequests.filter((request) => {
    if (request.status === "cancelled" || request.status === "declined") return false;
    const hasCommissionRecord = db.commissionRecords.some((record) => record.purchaseRequestId === request.id);
    const hasDispute = db.disputes.some((dispute) => dispute.purchaseRequestId === request.id);
    return Boolean(request.completedAt) && Boolean(request.usdtSentAt) && hasCommissionRecord && !hasDispute;
  });

  const reviews = sellerRequests.filter((request) => Boolean(request.buyerReview)).length;
  const responseTimes = qualifyingTrades
    .map((request) => {
      const submittedAt = new Date(request.createdAt).getTime();
      const acceptedAt = new Date(request.tradeCreatedAt ?? request.updatedAt).getTime();
      if (!submittedAt || !acceptedAt || acceptedAt < submittedAt) return 0;
      return (acceptedAt - submittedAt) / 60000;
    })
    .filter((value) => value > 0);
  const responseTimeMinutes = responseTimes.length ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length : 0;
  const completionRate = sellerRequests.length ? (qualifyingTrades.length / sellerRequests.length) * 100 : 0;
  const completedTradeMonths = Array.from(new Set(qualifyingTrades.filter((request) => request.completedAt).map((request) => new Date(request.completedAt!).toISOString().slice(0, 7))));
  const currentAchievements = evaluateSellerAchievements({
    sellerId: seller.id,
    sellerName: seller.fullName,
    rank: seller.sellerPrestigeRank ?? "bronze",
    lifetimeVolumeUsdt: Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? 0)),
    completedTrades: qualifyingTrades.length,
    reviewCount: reviews,
    averageRating: sellerRequests.filter((request) => request.buyerReview).reduce((sum, request) => sum + (request.buyerReview?.rating ?? 0), 0) / Math.max(1, reviews),
    responseTimeMinutes,
    completionRate,
    approvedAt: getSellerApprovedAt(db, seller.id) ?? seller.createdAt,
    createdAt: seller.createdAt,
    tradeRequests: sellerRequests.length,
    completedTradeMonths,
    hasCommissionRecords: db.commissionRecords.some((record) => record.sellerId === seller.id),
    hasDispute: db.disputes.some((dispute) => dispute.sellerId === seller.id),
    sellerStatus: seller.sellerStatus,
  });

  const persistent = [...(seller.sellerAchievements ?? [])];
  const mergedByKey = new Map<string, SellerAchievement>();
  for (const achievement of persistent) mergedByKey.set(achievement.key, achievement);
  for (const achievement of currentAchievements) {
    if (!mergedByKey.has(achievement.key)) {
      mergedByKey.set(achievement.key, achievement);
    }
  }
  return Array.from(mergedByKey.values()).sort((left, right) => left.title.localeCompare(right.title));
}

function buildHallOfFameEntry(db: AlphaExchangeDb, seller: AlphaExchangeUser) {
  const achievements = buildSellerAchievements(db, seller);
  return {
    sellerId: seller.id,
    sellerName: seller.fullName,
    rank: seller.sellerPrestigeRank ?? "bronze",
    prestigeVolumeUsdt: Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? 0)),
    achievements,
    promotedAt: seller.updatedAt,
    publicVolumeRange: getSellerPublicVolumeLabel(seller.sellerPrestigeRank ?? "bronze"),
  };
}

function normalizePromotionHistoryEntry(raw: unknown): SellerPromotionHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const rank = String(entry.rank ?? "");
  if (!isValidSellerLevel(rank)) return null;
  const previousRankRaw = String(entry.previousRank ?? "");
  const previousRank = isValidSellerLevel(previousRankRaw) ? previousRankRaw : undefined;
  const promotedAt = typeof entry.promotedAt === "string" ? entry.promotedAt : nowIso();
  const lifetimeCompletedVolumeUsdt = Math.max(0, Number(entry.lifetimeCompletedVolumeUsdt ?? 0));
  const source = entry.source === "admin_override" ? "admin_override" : "automatic";
  return {
    id: typeof entry.id === "string" ? entry.id : `promotion-${randomUUID()}`,
    rank,
    previousRank,
    promotedAt,
    lifetimeCompletedVolumeUsdt,
    source,
    triggerTradeId: typeof entry.triggerTradeId === "string" ? entry.triggerTradeId : undefined,
    reason: typeof entry.reason === "string" ? entry.reason : undefined,
    actorUserId: typeof entry.actorUserId === "string" ? entry.actorUserId : undefined,
  };
}

function isValidSellerLevel(value: string): value is SellerLevel {
  return value === "bronze" || value === "silver" || value === "gold" || value === "platinum" || value === "diamond" || value === "legendary";
}

function buildPrestigeFieldsForSnapshot(input: { volumeUsdt: number; rank: SellerLevel; isOverridden: boolean }) {
  const progress = getSellerPrestigeProgress(input.volumeUsdt, input.rank);
  return {
    publicVolumeRange: getSellerPublicVolumeLabel(input.rank),
    nextRank: progress.nextRank,
    remainingVolumeToNextRank: progress.remainingUsdt,
    prestigeProgressPercent: progress.progressPercent,
    lifetimeCompletedVolumeUsdt: input.volumeUsdt,
    isRankOverridden: input.isOverridden,
  };
}

function buildSellerPublicProfile(user: AlphaExchangeUser): SellerPublicProfile {
  return {
    sellerId: user.id,
    sellerName: user.fullName,
    fullName: user.fullName,
    profilePhotoUrl: user.profilePhotoUrl,
    memberSince: user.createdAt,
    languages: user.languages,
    preferredNetworks: user.preferredNetworks,
    bio: user.bio,
    tradingExperience: user.tradingExperience,
    workingHours: user.workingHours,
    preferredPaymentMethods: user.preferredPaymentMethods,
    country: user.country,
    city: user.city,
    coverBannerUrl: user.coverBannerUrl,
    isFoundingSeller: user.isFoundingSeller === true,
    isFoundingMember: user.isFoundingMember === true,
    isFeaturedSeller: user.isFeaturedSeller === true,
    isProfileHidden: user.isProfileHidden === true,
    isOwner: isAlphaExchangeOwnerEmail(user.email),
    role: user.role,
    roles: user.roles ?? [user.role],
    sellerStatus: user.sellerStatus,
    allowDirectMessages: user.allowDirectMessages !== false,
    contact: {
      email: user.showEmailPublic === true ? user.email : "",
      phone: user.showPhonePublic === true ? user.whatsappNumber : "",
    },
    onlineStatus: user.onlineStatus,
    availabilityStatus: user.availabilityStatus,
    lastActiveAt: user.lastActiveAt,
  };
}

function buildPublicUserProfileDataForUser(input: {
  db: AlphaExchangeDb;
  user: AlphaExchangeUser;
  viewerUserId?: string;
  viewerRole?: UserRole;
  enforceSearchVisibility?: boolean;
}) {
  const { db, enforceSearchVisibility = true, user, viewerRole, viewerUserId } = input;
  const viewerIsPrivileged = viewerRole === "admin" || viewerRole === "owner";
  const viewerIsOwner = viewerUserId === user.id;
  const canBypassVisibility = viewerIsOwner || viewerIsPrivileged;

  if (user.isProfileHidden === true && !canBypassVisibility) return null;
  if (enforceSearchVisibility && user.allowProfileSearch === false && !canBypassVisibility) return null;

  const username = deriveSellerRouteUsername({ fullName: user.fullName, email: user.email, id: user.id });
  const trustSnapshot = isTrustEligibleSeller(user) ? computeSellerReputationSnapshot(db, user.id) : null;
  const buyerRequests = db.purchaseRequests.filter((request) => request.buyerId === user.id);
  const sellerRequests = db.purchaseRequests.filter((request) => request.sellerId === user.id);
  const completedAsBuyer = buyerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length;
  const completedAsSeller = sellerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length;
  const reviewsWritten = buyerRequests.filter((request) => Boolean(request.buyerReview)).length;
  const reviewsReceived = sellerRequests.filter((request) => Boolean(request.buyerReview)).length;

  const showStats = user.showTradeStats !== false || canBypassVisibility;
  const showLastActive = user.showLastActive !== false || canBypassVisibility;
  const showPhone = user.showPhonePublic === true || canBypassVisibility;
  const showEmail = user.showEmailPublic === true || canBypassVisibility;

  return {
    profile: {
      id: user.id,
      username,
      fullName: user.fullName,
      role: user.role,
      roles: user.roles ?? [user.role],
      sellerStatus: user.sellerStatus,
      memberSince: user.createdAt,
      lastActiveAt: showLastActive ? user.lastActiveAt ?? user.updatedAt : null,
      country: user.country ?? "",
      city: user.city ?? "",
      languages: user.languages ?? [],
      bio: user.bio ?? "",
      profilePhotoUrl: user.profilePhotoUrl ?? "",
      coverBannerUrl: user.coverBannerUrl ?? "",
      isFeaturedSeller: user.isFeaturedSeller === true,
      isFoundingMember: user.isFoundingMember === true,
      isFoundingSeller: user.isFoundingSeller === true,
      allowDirectMessages: user.allowDirectMessages !== false || canBypassVisibility,
      contact: {
        email: showEmail ? user.email : "",
        phone: showPhone ? user.whatsappNumber : "",
      },
    },
    reputation: trustSnapshot
      ? {
          level: user.sellerPrestigeRank ?? trustSnapshot.level,
          trustScore: trustSnapshot.trustScore,
          publicVolumeRange: trustSnapshot.publicVolumeRange,
          rating: trustSnapshot.rating,
          badges: trustSnapshot.badges,
        }
      : null,
    stats: showStats
      ? {
          completedAsBuyer,
          completedAsSeller,
          reviewsWritten,
          reviewsReceived,
          activeListings: db.marketplaceListings.filter((listing) => listing.sellerId === user.id && listing.status === "active").length,
          pendingListings: db.marketplaceListings.filter((listing) => listing.sellerId === user.id && isListingPendingApproval(listing)).length,
        }
      : null,
  };
}

export async function getPublicUserProfileById(input: {
  userId: string;
  viewerUserId?: string;
  viewerRole?: UserRole;
}) {
  const db = await readDb();
  const user = db.users.find((row) => row.id === input.userId);
  if (!user) return null;
  return buildPublicUserProfileDataForUser({
    db,
    user,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
    enforceSearchVisibility: true,
  });
}

function deriveSellerRouteUsername(input: { fullName?: string; email?: string; id?: string }) {
  const base = (input.fullName || input.email || input.id || "seller")
    .toString()
    .trim()
    .toLowerCase();

  const normalized = base
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return normalized || "seller";
}

export function derivePublicProfileUsername(input: { fullName?: string; email?: string; id?: string }) {
  return deriveSellerRouteUsername(input);
}

function isTrustEligibleSeller(user: AlphaExchangeUser) {
  return hasRole(user, "approved_seller") || user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended";
}

function computeTrustSnapshotMap(db: AlphaExchangeDb) {
  if (db.trustSnapshots.length) {
    return new Map(db.trustSnapshots.map((entry) => [entry.sellerId, entry.snapshot]));
  }
  const listingsBySeller = new Map<string, MarketplaceListing[]>();
  for (const listing of db.marketplaceListings) {
    const rows = listingsBySeller.get(listing.sellerId);
    if (rows) rows.push(listing);
    else listingsBySeller.set(listing.sellerId, [listing]);
  }
  const requestsBySeller = new Map<string, PurchaseRequest[]>();
  for (const request of db.purchaseRequests) {
    const rows = requestsBySeller.get(request.sellerId);
    if (rows) rows.push(request);
    else requestsBySeller.set(request.sellerId, [request]);
  }
  const commissionsBySeller = new Map<string, CommissionRecord[]>();
  for (const record of db.commissionRecords) {
    const rows = commissionsBySeller.get(record.sellerId);
    if (rows) rows.push(record);
    else commissionsBySeller.set(record.sellerId, [record]);
  }
  const base = db.users
    .filter((user) => isTrustEligibleSeller(user))
    .map((seller) => {
      const snapshot = calculateSellerTrustSnapshot({
        seller,
        listings: listingsBySeller.get(seller.id) ?? [],
        requests: requestsBySeller.get(seller.id) ?? [],
        commissions: commissionsBySeller.get(seller.id) ?? [],
      });
      const derivedRank = resolveSellerPrestigeRank(snapshot.totalUsdtVolume);
      const effectiveRank = seller.sellerRankOverride?.rank ?? seller.sellerPrestigeRank ?? derivedRank;
      snapshot.level = effectiveRank;
      snapshot.lifetimeCompletedVolumeUsdt = snapshot.totalUsdtVolume;
      Object.assign(
        snapshot,
        buildPrestigeFieldsForSnapshot({
          volumeUsdt: snapshot.totalUsdtVolume,
          rank: effectiveRank,
          isOverridden: Boolean(seller.sellerRankOverride),
        }),
      );
      return snapshot;
    });
  const ranked = rankTrustSnapshots(base);
  return new Map(ranked.map((snapshot) => [snapshot.sellerId, snapshot]));
}

function computeSellerReputationSnapshot(db: AlphaExchangeDb, sellerId: string): SellerReputationSnapshot {
  const snapshots = computeTrustSnapshotMap(db);
  const existing = snapshots.get(sellerId);
  if (existing) return existing;

  const seller = db.users.find((user) => user.id === sellerId);
  if (!seller) {
    return {
      sellerId,
      trustScore: 0,
      reliabilityScore: 0,
      responseScore: 0,
      activityScore: 0,
      marketplacePosition: 0,
      reputationSummary: "Growing Seller",
      level: "bronze",
      badges: [],
      rating: 0,
      completedTrades: 0,
      totalUsdtVolume: 0,
      successRate: 0,
      acceptanceRate: 0,
      cancellationRate: 0,
      completionRate: 0,
      responseTimeMinutes: 0,
      customerSatisfaction: 0,
      recentActivityScore: 0,
      accountAgeDays: 0,
      profileCompletion: 0,
      verificationScore: 0,
      disputesLost: 0,
      marketplaceViolations: 0,
      listingQualityScore: 0,
      profileViews: 0,
      listingViews: 0,
      tradeRequests: 0,
      monthlyGrowthPercent: 0,
      estimatedCommissionPaid: 0,
      revenueGenerated: 0,
      repeatBuyers: 0,
      averageTradeSize: 0,
      publicVolumeRange: "0+",
      nextRank: "silver",
      remainingVolumeToNextRank: 15000,
      prestigeProgressPercent: 0,
      lifetimeCompletedVolumeUsdt: 0,
      isRankOverridden: false,
    };
  }
  const snapshot = calculateSellerTrustSnapshot({
    seller,
    listings: db.marketplaceListings.filter((listing) => listing.sellerId === seller.id),
    requests: db.purchaseRequests.filter((request) => request.sellerId === seller.id),
    commissions: db.commissionRecords.filter((record) => record.sellerId === seller.id),
    marketplacePosition: 0,
  });
  const derivedRank = resolveSellerPrestigeRank(snapshot.totalUsdtVolume);
  const effectiveRank = seller.sellerRankOverride?.rank ?? seller.sellerPrestigeRank ?? derivedRank;
  snapshot.level = effectiveRank;
  snapshot.lifetimeCompletedVolumeUsdt = snapshot.totalUsdtVolume;
  Object.assign(
    snapshot,
    buildPrestigeFieldsForSnapshot({
      volumeUsdt: snapshot.totalUsdtVolume,
      rank: effectiveRank,
      isOverridden: Boolean(seller.sellerRankOverride),
    }),
  );
  return snapshot;
}

function qualitySortListings(db: AlphaExchangeDb, listings: MarketplaceListing[]) {
  const snapshots = computeTrustSnapshotMap(db);
  const score = (reputation: SellerReputationSnapshot) => {
    const responseSpeedScore = Math.max(0, 100 - Math.min(60, reputation.responseTimeMinutes) * 1.5);
    const normalizedTrades = Math.min(100, reputation.completedTrades / 8);
    return (
      reputation.completionRate * 0.3
      + reputation.rating * 20 * 0.2
      + responseSpeedScore * 0.15
      + reputation.recentActivityScore * 0.15
      + normalizedTrades * 0.1
      + levelRank(reputation.level) * (100 / 6) * 0.1
    );
  };
  return [...listings].sort((left, right) => {
    const leftRep = snapshots.get(left.sellerId) ?? computeSellerReputationSnapshot(db, left.sellerId);
    const rightRep = snapshots.get(right.sellerId) ?? computeSellerReputationSnapshot(db, right.sellerId);

    const scoreDiff = score(rightRep) - score(leftRep);
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    if (rightRep.trustScore !== leftRep.trustScore) return rightRep.trustScore - leftRep.trustScore;
    if (levelRank(rightRep.level) !== levelRank(leftRep.level)) return levelRank(rightRep.level) - levelRank(leftRep.level);
    if (rightRep.rating !== leftRep.rating) return rightRep.rating - leftRep.rating;
    if (rightRep.completionRate !== leftRep.completionRate) return rightRep.completionRate - leftRep.completionRate;
    if (leftRep.responseTimeMinutes !== rightRep.responseTimeMinutes) return leftRep.responseTimeMinutes - rightRep.responseTimeMinutes;
    if (rightRep.completedTrades !== leftRep.completedTrades) return rightRep.completedTrades - leftRep.completedTrades;
    return rightRep.recentActivityScore - leftRep.recentActivityScore;
  });
}

function enrichListingsWithSellerData(db: AlphaExchangeDb, listings: MarketplaceListing[]) {
  const snapshots = computeTrustSnapshotMap(db);
  const usersById = new Map(db.users.map((user) => [user.id, user]));
  return listings.map((listing) => {
    const seller = usersById.get(listing.sellerId);
    if (!seller) return listing;
    return {
      ...listing,
      sellerProfile: buildSellerPublicProfile(seller),
      sellerReputation: snapshots.get(seller.id) ?? computeSellerReputationSnapshot(db, seller.id),
    };
  });
}

export async function getSellerProfileRouteData(input: {
  username: string;
  sellerId?: string;
  viewerUserId?: string;
  viewerRole?: UserRole;
  viewerEmail?: string;
}) {
  const db = await readDb();
  const normalizedUsername = input.username.trim().toLowerCase();
  const normalizedSellerId = String(input.sellerId ?? "").trim();
  const seller = normalizedSellerId
    ? db.users.find((user) => user.id === normalizedSellerId)
    : db.users.find((user) => deriveSellerRouteUsername({ fullName: user.fullName, email: user.email, id: user.id }) === normalizedUsername);
  if (!seller || (seller.sellerStatus !== "approved_seller" && seller.sellerStatus !== "suspended")) {
    return null;
  }

  const profile = await getPremiumSellerProfile({
    sellerId: seller.id,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
    viewerEmail: input.viewerEmail,
  });

  const listings = await getMarketplaceListings("active");
  const sellerListings = listings.filter((listing) => listing.sellerId === seller.id).slice(0, 6);
  const similarSellers = listings
    .filter((listing) => listing.sellerId !== seller.id)
    .slice(0, 4)
    .map((listing) => ({
      sellerId: listing.sellerId,
      sellerName: listing.sellerDisplayName,
      sellerLevel: listing.sellerReputation?.level ?? "bronze",
      trustScore: listing.sellerReputation?.trustScore ?? 0,
      profilePhotoUrl: listing.sellerProfile?.profilePhotoUrl ?? "",
      publicVolumeRange: listing.sellerReputation?.publicVolumeRange ?? "0+",
    }));

  return {
    profile,
    sellerListings,
    similarSellers,
  };
}

export async function getPublicUserProfileRouteData(input: {
  username: string;
  viewerUserId?: string;
  viewerRole?: UserRole;
}) {
  const db = await readDb();
  const normalizedUsername = input.username.trim().toLowerCase();
  const user = db.users.find((row) => deriveSellerRouteUsername({ fullName: row.fullName, email: row.email, id: row.id }) === normalizedUsername);
  if (!user) return null;
  return buildPublicUserProfileDataForUser({
    db,
    user,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
  });
}

export async function getPremiumSellerProfile(input: {
  sellerId: string;
  viewerUserId?: string;
  viewerRole?: UserRole;
  viewerEmail?: string;
}): Promise<PremiumSellerProfileData | null> {
  const db = await readDb();
  const usersById = new Map(db.users.map((user) => [user.id, user]));
  const seller = db.users.find((user) => user.id === input.sellerId);
  if (!seller) return null;
  if (seller.sellerStatus !== "approved_seller" && seller.sellerStatus !== "suspended") return null;
  const publicAccount = buildPublicUserProfileDataForUser({
    db,
    user: seller,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
    enforceSearchVisibility: false,
  });
  if (!publicAccount) return null;
  const viewerIsOwner = input.viewerRole === "owner" || (input.viewerRole === "admin" && isAlphaExchangeOwnerEmail(input.viewerEmail ?? ""));
  const viewerIsSellerOwner = input.viewerUserId === seller.id;
  const canSeeExactSellerStats = viewerIsOwner || viewerIsSellerOwner;

  const sellerRequests = db.purchaseRequests.filter((request) => request.sellerId === seller.id);
  const completedStatuses = new Set<PurchaseRequestStatus>(["completed", "locked", "review_open"]);
  const completedTrades = sellerRequests.filter((request) => completedStatuses.has(request.status) || Boolean(request.completedAt));
  const reviews = completedTrades
    .filter((request) => request.buyerReview && (viewerIsOwner || viewerIsSellerOwner || request.buyerReview.hidden !== true))
    .map((request) => ({
      id: `review-${request.id}`,
      tradeId: request.tradeId ?? request.id,
      rating: request.buyerReview!.rating,
      comment: request.buyerReview!.comment,
      createdAt: request.buyerReview!.createdAt,
      buyerId: request.buyerId,
      buyerName: usersById.get(request.buyerId)?.fullName ?? request.buyerName ?? "Buyer",
      verifiedPurchase: true,
      sellerResponse: request.sellerResponse,
    }))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const completionRate = sellerRequests.length ? (completedTrades.length / sellerRequests.length) * 100 : 0;
  const responseTimes = sellerRequests
    .map((request) => {
      const submitted = new Date(request.createdAt).getTime();
      const accepted = new Date(request.tradeCreatedAt ?? request.updatedAt).getTime();
      if (!submitted || !accepted || accepted < submitted) return 0;
      return (accepted - submitted) / 60000;
    })
    .filter((value) => value > 0);
  const responseTimeMinutes = responseTimes.length ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length : 0;
  const completedBuyerCounts = completedTrades.reduce<Record<string, number>>((acc, request) => {
    acc[request.buyerId] = (acc[request.buyerId] ?? 0) + 1;
    return acc;
  }, {});
  const completedBuyerCount = Object.keys(completedBuyerCounts).length;
  const repeatBuyerCount = Object.values(completedBuyerCounts).filter((count) => count > 1).length;
  const repeatBuyersPercent = completedBuyerCount ? (repeatBuyerCount / completedBuyerCount) * 100 : 0;

  const trustSnapshot = computeSellerReputationSnapshot(db, seller.id);
  const nowMs = Date.now();
  const yearsOnPlatform = Math.max(0, (nowMs - new Date(seller.createdAt).getTime()) / (365 * 24 * 60 * 60 * 1000));

  const latestTradeActivities = completedTrades
    .slice(0, 6)
    .map((request) => ({
      id: `activity-trade-${request.id}`,
      type: "trade_completed" as const,
      message: `Trade ${request.tradeId ?? request.id} completed.`,
      createdAt: request.completedAt ?? request.updatedAt,
    }));
  const latestReviewActivities = reviews.slice(0, 6).map((review) => ({
    id: `activity-review-${review.id}`,
    type: "review_submitted" as const,
    message: `New verified review received (${review.rating.toFixed(1)}★).`,
    createdAt: review.createdAt,
  }));
  const trustChanges = db.trustScoreHistory
    .filter((entry) => entry.sellerId === seller.id && entry.newScore > entry.oldScore)
    .slice(0, 6)
    .map((entry) => ({
      id: `activity-trust-${entry.id}`,
      type: "trust_score_updated" as const,
      message: `Trust score increased from ${entry.oldScore.toFixed(1)} to ${entry.newScore.toFixed(1)}.`,
      createdAt: entry.createdAt,
    }));
  const achievementActivities = (trustSnapshot.badges ?? []).slice(0, 6).map((badge) => ({
    id: `activity-achievement-${badge}`,
    type: "achievement_earned" as const,
    message: `Achievement active: ${badge.replaceAll("_", " ")}.`,
    createdAt: seller.updatedAt,
  }));
  const recentActivity = [...latestTradeActivities, ...latestReviewActivities, ...trustChanges, ...achievementActivities]
    .filter((entry) => entry.createdAt)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 12);

  const profile: SellerPublicProfile = {
    ...buildSellerPublicProfile(seller),
    sellerName: publicAccount.profile.fullName,
    fullName: publicAccount.profile.fullName,
    username: publicAccount.profile.username,
    profilePhotoUrl: publicAccount.profile.profilePhotoUrl,
    memberSince: publicAccount.profile.memberSince,
    languages: publicAccount.profile.languages,
    bio: publicAccount.profile.bio,
    country: publicAccount.profile.country,
    city: publicAccount.profile.city,
    coverBannerUrl: publicAccount.profile.coverBannerUrl,
    isFeaturedSeller: publicAccount.profile.isFeaturedSeller,
    isFoundingMember: publicAccount.profile.isFoundingMember,
    isFoundingSeller: publicAccount.profile.isFoundingSeller,
    role: publicAccount.profile.role,
    roles: publicAccount.profile.roles,
    sellerStatus: publicAccount.profile.sellerStatus,
    allowDirectMessages: publicAccount.profile.allowDirectMessages,
    contact: publicAccount.profile.contact,
    lastActiveAt: publicAccount.profile.lastActiveAt ?? undefined,
  };
  const lifetimeCompletedVolumeUsdt = Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? trustSnapshot.totalUsdtVolume));
  const sellerAchievements = seller.sellerAchievements ?? [];
  const hallOfFameEligible = (seller.sellerPrestigeRank ?? trustSnapshot.level) === "legendary";
  const currentRank = seller.sellerPrestigeRank ?? trustSnapshot.level;
  const prestigeProgress = getSellerPrestigeProgress(lifetimeCompletedVolumeUsdt, currentRank);
  const ownerTools = viewerIsOwner
    ? {
        auditHistory: db.auditLogs
          .filter((entry) => entry.targetUserId === seller.id || entry.actorUserId === seller.id)
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .slice(0, 40),
        commissionHistory: db.commissionRecords
          .filter((entry) => entry.sellerId === seller.id)
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .slice(0, 40),
        tradeHistory: sellerRequests
          .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
          .slice(0, 50)
          .map((request) => enrichRequestWithEvidence(db, request)),
      }
    : undefined;

  return {
    sellerId: seller.id,
    profile,
    sellerLevel: currentRank,
    nextRank: prestigeProgress.nextRank,
    progressToNextRankPercent: Number(prestigeProgress.progressPercent.toFixed(2)),
    amountToNextRankUsdt: Number(prestigeProgress.remainingUsdt.toFixed(2)),
    publicVolumeRange: getSellerPublicVolumeLabel(currentRank),
    lifetimeCompletedVolumeUsdt: Number(lifetimeCompletedVolumeUsdt.toFixed(2)),
    trustScore: Number(trustSnapshot.trustScore.toFixed(1)),
    completedTrades: completedTrades.length,
    tradeVolume: canSeeExactSellerStats ? Number(trustSnapshot.totalUsdtVolume.toFixed(2)) : undefined,
    exactTradeVolume: canSeeExactSellerStats ? Number(trustSnapshot.totalUsdtVolume.toFixed(2)) : undefined,
    commissionPaid: Number(trustSnapshot.estimatedCommissionPaid.toFixed(2)),
    averageTradeSize: Number(trustSnapshot.averageTradeSize.toFixed(2)),
    averageRating: Number(trustSnapshot.rating.toFixed(2)),
    responseTimeMinutes: Number(responseTimeMinutes.toFixed(2)),
    completionRate: Number(completionRate.toFixed(2)),
    repeatBuyersPercent: Number(repeatBuyersPercent.toFixed(2)),
    totalReviews: reviews.length,
    yearsOnPlatform: Number(yearsOnPlatform.toFixed(2)),
    badges: trustSnapshot.badges ?? [],
    promotionHistory: [...(seller.sellerPromotionHistory ?? [])].sort((left, right) => new Date(right.promotedAt).getTime() - new Date(left.promotedAt).getTime()).slice(0, 20),
    achievements: sellerAchievements,
    prestigeVolumeUsdt: Number(lifetimeCompletedVolumeUsdt.toFixed(2)),
    prestigeVolumePublicLabel: getSellerPublicVolumeLabel(currentRank),
    hallOfFameEligible,
    latestReviews: reviews.slice(0, 12),
    recentActivity,
    ownerTools,
  };
}

function isValidSellerStatus(value: string): value is SellerStatus {
  return value === "buyer" || value === "pending_seller_approval" || value === "approved_seller" || value === "rejected" || value === "suspended";
}

function isValidSellerApplicationStatus(value: string): value is SellerApplicationStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

function isValidPurchaseStatus(value: string): value is PurchaseRequestStatus {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "payment_sent" ||
    value === "funds_received" ||
    value === "usdt_release_pending" ||
    value === "usdt_sent" ||
    value === "completed" ||
    value === "locked" ||
    value === "review_open" ||
    value === "declined" ||
    value === "cancelled"
  );
}

function isValidTradeTimelineType(value: string): value is TradeTimelineEventType {
  return (
    value === "request_submitted" ||
    value === "request_accepted" ||
    value === "payment_sent" ||
    value === "seller_confirmed_funds" ||
    value === "usdt_release_started" ||
    value === "usdt_sent" ||
    value === "trade_completed" ||
    value === "trade_timed_out" ||
    value === "trade_locked" ||
    value === "review_unlocked" ||
    value === "dispute_opened" ||
    value === "commission_recorded" ||
    value === "commission_paid" ||
    value === "buyer_evidence_uploaded" ||
    value === "seller_evidence_uploaded" ||
    value === "request_declined" ||
    value === "request_cancelled"
  );
}

function isValidInviteStatus(value: string): value is "active" | "expired" | "disabled" {
  return value === "active" || value === "expired" || value === "disabled";
}

function isValidFeedbackCategory(value: string): value is BetaFeedbackCategory {
  return value === "bug" || value === "suggestion" || value === "confusing_ux" || value === "feature_request" || value === "performance" || value === "other";
}

function isValidFeedbackStatus(value: string): value is BetaFeedbackStatus {
  return value === "new" || value === "in_review" || value === "resolved";
}

function isValidAnnouncementType(value: string): value is BetaAnnouncementType {
  return value === "maintenance" || value === "new_feature" || value === "bug_fix" || value === "known_issue";
}

function inferSellerStatus(role: UserRole): SellerStatus {
  if (role === "approved_seller") return "approved_seller";
  if (role === "pending_seller_approval") return "pending_seller_approval";
  return "buyer";
}

function isOnboardingSelection(value: string): value is OnboardingSelection {
  return value === "guest" || value === "student" || value === "buyer" || value === "seller_applicant";
}

function normalizeDb(db: AlphaExchangeDb): AlphaExchangeDb {
  const runtimeVersion = (db as { __runtimeVersion?: unknown }).__runtimeVersion;
  const normalized: AlphaExchangeDb = {
    ...defaultDb,
    ...db,
    users: (db.users ?? []).map((user) => {
      const email = normalizeEmail(typeof user.email === "string" ? user.email : "");
      const fallbackRole = isUserRole(String(user.role ?? "")) ? (user.role as UserRole) : "guest";
      const sellerStatus = isValidSellerStatus((user as { sellerStatus?: string }).sellerStatus ?? "") ? (user as { sellerStatus: SellerStatus }).sellerStatus : inferSellerStatus(fallbackRole);
      const normalizedRoles = normalizeRolesForUser({
        email,
        role: fallbackRole,
        roles: Array.isArray((user as { roles?: unknown[] }).roles)
          ? (user as { roles: unknown[] }).roles.map((item) => String(item)).filter(isUserRole)
          : undefined,
        sellerStatus,
      });
      const normalizedRole = resolvePrimaryRole(normalizedRoles);
      const onboardingSelectionRaw = typeof (user as { onboardingSelection?: string }).onboardingSelection === "string"
        ? (user as { onboardingSelection: string }).onboardingSelection
        : undefined;
      const onboardingSelection = isOnboardingSelection(String(onboardingSelectionRaw ?? ""))
        ? (onboardingSelectionRaw as OnboardingSelection)
        : normalizedRoles.includes("buyer")
          ? "buyer"
          : normalizedRoles.includes("student")
            ? "student"
            : undefined;
      const onboardingCompletedAt = typeof (user as { onboardingCompletedAt?: string }).onboardingCompletedAt === "string"
        ? (user as { onboardingCompletedAt: string }).onboardingCompletedAt
        : onboardingSelection
          ? (typeof user.updatedAt === "string" ? user.updatedAt : nowIso())
          : undefined;
      const lifetimeCompletedVolumeUsdt = Math.max(0, Number((user as { lifetimeCompletedVolumeUsdt?: number }).lifetimeCompletedVolumeUsdt ?? 0));
      const sellerPrestigeRankRaw = String((user as { sellerPrestigeRank?: string }).sellerPrestigeRank ?? "");
      const sellerPrestigeRank = isValidSellerLevel(sellerPrestigeRankRaw) ? sellerPrestigeRankRaw : resolveSellerPrestigeRank(lifetimeCompletedVolumeUsdt);
      const sellerRankOverrideRaw = (user as { sellerRankOverride?: { rank?: string; reason?: string; setAt?: string; setByUserId?: string } }).sellerRankOverride;
      const sellerRankOverride =
        sellerRankOverrideRaw && isValidSellerLevel(String(sellerRankOverrideRaw.rank ?? ""))
          ? {
              rank: String(sellerRankOverrideRaw.rank) as SellerLevel,
              reason: String(sellerRankOverrideRaw.reason ?? "").trim(),
              setAt: typeof sellerRankOverrideRaw.setAt === "string" ? sellerRankOverrideRaw.setAt : nowIso(),
              setByUserId: typeof sellerRankOverrideRaw.setByUserId === "string" ? sellerRankOverrideRaw.setByUserId : SYSTEM_ACTOR_USER_ID,
            }
          : undefined;
      const sellerPromotionHistory = Array.isArray((user as { sellerPromotionHistory?: unknown[] }).sellerPromotionHistory)
        ? (user as { sellerPromotionHistory: unknown[] }).sellerPromotionHistory.map(normalizePromotionHistoryEntry).filter((entry): entry is SellerPromotionHistoryEntry => Boolean(entry)).slice(0, 200)
        : [];
      const sellerAchievementsRaw = Array.isArray((user as { sellerAchievements?: unknown[] }).sellerAchievements)
        ? (user as { sellerAchievements: unknown[] }).sellerAchievements.filter((entry) => entry && typeof entry === "object")
        : [];
      return {
        ...user,
        email,
        roles: normalizedRoles,
        role: normalizedRole,
        sellerStatus,
        preferredNetworks: Array.isArray((user as { preferredNetworks?: string[] }).preferredNetworks)
          ? ((user as { preferredNetworks: string[] }).preferredNetworks.filter((network) => isSupportedNetwork(network)) as SupportedNetwork[])
          : [],
        profilePhotoUrl: typeof (user as { profilePhotoUrl?: string }).profilePhotoUrl === "string" ? (user as { profilePhotoUrl: string }).profilePhotoUrl : "",
        languages: Array.isArray((user as { languages?: string[] }).languages) ? (user as { languages: string[] }).languages.map((language) => String(language).trim()).filter(Boolean) : ["English"],
        bio: typeof (user as { bio?: string }).bio === "string" ? (user as { bio: string }).bio : "",
        tradingExperience: typeof (user as { tradingExperience?: string }).tradingExperience === "string" ? (user as { tradingExperience: string }).tradingExperience.trim() : "",
        workingHours: typeof (user as { workingHours?: string }).workingHours === "string" ? (user as { workingHours: string }).workingHours.trim() : "",
        preferredPaymentMethods: Array.isArray((user as { preferredPaymentMethods?: string[] }).preferredPaymentMethods)
          ? (user as { preferredPaymentMethods: string[] }).preferredPaymentMethods.map((item) => String(item).trim()).filter(Boolean)
          : [],
        country: typeof (user as { country?: string }).country === "string" ? (user as { country: string }).country.trim() : "",
        city: typeof (user as { city?: string }).city === "string" ? (user as { city: string }).city.trim() : "",
        coverBannerUrl: typeof (user as { coverBannerUrl?: string }).coverBannerUrl === "string" ? (user as { coverBannerUrl: string }).coverBannerUrl.trim() : "",
        onlineStatus: (user as { onlineStatus?: string }).onlineStatus === "online" ? "online" : "offline",
        availabilityStatus: normalizeSellerAvailabilityStatus((user as { availabilityStatus?: string }).availabilityStatus),
        lastActiveAt: typeof (user as { lastActiveAt?: string }).lastActiveAt === "string" ? (user as { lastActiveAt: string }).lastActiveAt : (typeof user.updatedAt === "string" ? user.updatedAt : undefined),
        isFeaturedSeller: (user as { isFeaturedSeller?: boolean }).isFeaturedSeller === true,
        isProfileHidden: (user as { isProfileHidden?: boolean }).isProfileHidden === true,
        showTradeStats: (user as { showTradeStats?: boolean }).showTradeStats !== false,
        showLastActive: (user as { showLastActive?: boolean }).showLastActive !== false,
        allowDirectMessages: (user as { allowDirectMessages?: boolean }).allowDirectMessages !== false,
        allowProfileSearch: (user as { allowProfileSearch?: boolean }).allowProfileSearch !== false,
        showPhonePublic: (user as { showPhonePublic?: boolean }).showPhonePublic === true,
        showEmailPublic: (user as { showEmailPublic?: boolean }).showEmailPublic === true,
        notificationPreferences: normalizeNotificationPreferences((user as { notificationPreferences?: NotificationPreferences }).notificationPreferences),
        emailVerified: (user as { emailVerified?: boolean }).emailVerified !== false,
        emailVerifiedAt:
          typeof (user as { emailVerifiedAt?: string }).emailVerifiedAt === "string"
            ? (user as { emailVerifiedAt: string }).emailVerifiedAt
            : undefined,
        emailVerificationTokenHash:
          typeof (user as { emailVerificationTokenHash?: string }).emailVerificationTokenHash === "string"
            ? (user as { emailVerificationTokenHash: string }).emailVerificationTokenHash
            : undefined,
        emailVerificationTokenExpiresAt:
          typeof (user as { emailVerificationTokenExpiresAt?: string }).emailVerificationTokenExpiresAt === "string"
            ? (user as { emailVerificationTokenExpiresAt: string }).emailVerificationTokenExpiresAt
            : undefined,
        emailVerificationSentAt:
          typeof (user as { emailVerificationSentAt?: string }).emailVerificationSentAt === "string"
            ? (user as { emailVerificationSentAt: string }).emailVerificationSentAt
            : undefined,
        isFoundingMember: (user as { isFoundingMember?: boolean }).isFoundingMember === true,
        isFoundingSeller: (user as { isFoundingSeller?: boolean }).isFoundingSeller === true,
        registeredViaInviteCodeId:
          typeof (user as { registeredViaInviteCodeId?: string }).registeredViaInviteCodeId === "string"
            ? (user as { registeredViaInviteCodeId: string }).registeredViaInviteCodeId
            : undefined,
        verifiedPhone:
          typeof (user as { verifiedPhone?: string }).verifiedPhone === "string"
            ? (user as { verifiedPhone: string }).verifiedPhone
            : undefined,
        phoneVerifiedAt:
          typeof (user as { phoneVerifiedAt?: string }).phoneVerifiedAt === "string"
            ? (user as { phoneVerifiedAt: string }).phoneVerifiedAt
            : undefined,
        buyerVerificationStatus:
          (user as { buyerVerificationStatus?: string }).buyerVerificationStatus === "verified"
            ? "verified"
            : (user as { buyerVerificationStatus?: string }).buyerVerificationStatus === "otp_sent"
              ? "otp_sent"
              : "not_started",
        buyerVerificationAttempts: Math.max(0, Number((user as { buyerVerificationAttempts?: number }).buyerVerificationAttempts ?? 0)),
        buyerVerificationWindowStartedAt:
          typeof (user as { buyerVerificationWindowStartedAt?: string }).buyerVerificationWindowStartedAt === "string"
            ? (user as { buyerVerificationWindowStartedAt: string }).buyerVerificationWindowStartedAt
            : undefined,
        buyerOtpSendsToday: Math.max(0, Number((user as { buyerOtpSendsToday?: number }).buyerOtpSendsToday ?? 0)),
        buyerOtpSendsDate:
          typeof (user as { buyerOtpSendsDate?: string }).buyerOtpSendsDate === "string"
            ? (user as { buyerOtpSendsDate: string }).buyerOtpSendsDate
            : undefined,
        buyerOtpRequestedAt:
          typeof (user as { buyerOtpRequestedAt?: string }).buyerOtpRequestedAt === "string"
            ? (user as { buyerOtpRequestedAt: string }).buyerOtpRequestedAt
            : undefined,
        buyerFirstName:
          typeof (user as { buyerFirstName?: string }).buyerFirstName === "string"
            ? (user as { buyerFirstName: string }).buyerFirstName
            : undefined,
        buyerLastName:
          typeof (user as { buyerLastName?: string }).buyerLastName === "string"
            ? (user as { buyerLastName: string }).buyerLastName
            : undefined,
        buyerDisplayName:
          typeof (user as { buyerDisplayName?: string }).buyerDisplayName === "string"
            ? (user as { buyerDisplayName: string }).buyerDisplayName
            : undefined,
        onboardingSelection,
        onboardingCompletedAt,
        lifetimeCompletedVolumeUsdt,
        sellerPrestigeRank,
        sellerRankOverride,
        sellerPromotionHistory,
        sellerAchievements: sellerAchievementsRaw.map((entry) => entry as SellerAchievement),
      };
    }),
    sellerApplications: (db.sellerApplications ?? []).map((application) => ({
      ...application,
      displayNumber: normalizeDisplayNumber((application as { displayNumber?: unknown }).displayNumber),
      status: isValidSellerApplicationStatus(application.status) ? application.status : "pending",
    })),
    purchaseRequests: (db.purchaseRequests ?? []).map((request) => ({
      ...request,
      displayNumber: normalizeDisplayNumber((request as { displayNumber?: unknown }).displayNumber),
      status: isValidPurchaseStatus(request.status) ? request.status : "pending",
      tradeId: typeof (request as { tradeId?: string }).tradeId === "string" ? (request as { tradeId: string }).tradeId : undefined,
      usdtAmount:
        typeof (request as { usdtAmount?: string }).usdtAmount === "string" && (request as { usdtAmount: string }).usdtAmount.trim()
          ? (request as { usdtAmount: string }).usdtAmount.trim()
          : "0",
      fiatAmount:
        typeof (request as { fiatAmount?: string }).fiatAmount === "string" && (request as { fiatAmount: string }).fiatAmount.trim()
          ? (request as { fiatAmount: string }).fiatAmount.trim()
          : "0",
      currency:
        typeof (request as { currency?: string }).currency === "string" && (request as { currency: string }).currency.trim()
          ? (request as { currency: string }).currency.trim()
          : "ILS",
      network:
       typeof (request as { network?: string }).network === "string" && isSupportedNetwork((request as { network: string }).network)
         ? ((request as { network: SupportedNetwork }).network)
          : "TRC20",
      paymentMethod:
        normalizeMarketplacePaymentMethod((request as { paymentMethod?: string }).paymentMethod) ??
        "Bank Transfer",
      buyerSafetyAcknowledged:
        typeof (request as { buyerSafetyAcknowledged?: unknown }).buyerSafetyAcknowledged === "boolean"
          ? (request as { buyerSafetyAcknowledged: boolean }).buyerSafetyAcknowledged
          : !isFaceToFacePaymentMethod((request as { paymentMethod?: string }).paymentMethod),
      sellerSafetyAcknowledged:
        typeof (request as { sellerSafetyAcknowledged?: unknown }).sellerSafetyAcknowledged === "boolean"
          ? (request as { sellerSafetyAcknowledged: boolean }).sellerSafetyAcknowledged
          : (
            !isFaceToFacePaymentMethod((request as { paymentMethod?: string }).paymentMethod) ||
            (isValidPurchaseStatus(request.status) ? request.status !== "pending" : true)
          ),
      timeline: Array.isArray((request as { timeline?: unknown[] }).timeline)
        ? (request as { timeline: unknown[] }).timeline
            .filter((entry) => entry && typeof entry === "object")
            .map((entry, index) => {
              const item = entry as Record<string, unknown>;
              return {
                id: typeof item.id === "string" ? item.id : `timeline-${request.id}-${index + 1}`,
                type: typeof item.type === "string" && isValidTradeTimelineType(item.type) ? item.type : "request_submitted",
                actorUserId: typeof item.actorUserId === "string" ? item.actorUserId : request.buyerId,
                actorRole: item.actorRole === "admin" || item.actorRole === "approved_seller" ? item.actorRole : "buyer",
                message: typeof item.message === "string" && item.message.trim() ? item.message : "Trade event",
                createdAt: typeof item.createdAt === "string" ? item.createdAt : request.createdAt,
              };
            })
        : [
            {
              id: `timeline-${request.id}-submitted`,
              type: "request_submitted",
              actorUserId: request.buyerId,
              actorRole: "buyer",
              message: "Buyer submitted request",
              createdAt: request.createdAt,
            },
          ],
      tradeCreatedAt: typeof (request as { tradeCreatedAt?: string }).tradeCreatedAt === "string" ? (request as { tradeCreatedAt: string }).tradeCreatedAt : undefined,
      paymentSentAt: typeof (request as { paymentSentAt?: string }).paymentSentAt === "string" ? (request as { paymentSentAt: string }).paymentSentAt : undefined,
      usdtSentAt: typeof (request as { usdtSentAt?: string }).usdtSentAt === "string" ? (request as { usdtSentAt: string }).usdtSentAt : undefined,
      completedAt: typeof (request as { completedAt?: string }).completedAt === "string" ? (request as { completedAt: string }).completedAt : undefined,
      timedOutAt: typeof (request as { timedOutAt?: string }).timedOutAt === "string" ? (request as { timedOutAt: string }).timedOutAt : undefined,
      timeoutReason: typeof (request as { timeoutReason?: string }).timeoutReason === "string" ? (request as { timeoutReason: string }).timeoutReason : undefined,
      lockedAt: typeof (request as { lockedAt?: string }).lockedAt === "string" ? (request as { lockedAt: string }).lockedAt : undefined,
      reviewUnlockedAt:
        typeof (request as { reviewUnlockedAt?: string }).reviewUnlockedAt === "string" ? (request as { reviewUnlockedAt: string }).reviewUnlockedAt : undefined,
      buyerReview:
        (request as { buyerReview?: { reviewerUserId?: string; rating?: number; comment?: string; createdAt?: string; hidden?: boolean; hiddenReason?: string } }).buyerReview &&
        typeof (request as { buyerReview: { reviewerUserId?: string } }).buyerReview.reviewerUserId === "string"
          ? {
              reviewerUserId: (request as { buyerReview: { reviewerUserId: string } }).buyerReview.reviewerUserId,
              rating: Number((request as { buyerReview: { rating?: number } }).buyerReview.rating ?? 5),
              comment: String((request as { buyerReview: { comment?: string } }).buyerReview.comment ?? "").trim(),
              createdAt: String((request as { buyerReview: { createdAt?: string } }).buyerReview.createdAt ?? request.updatedAt),
              hidden: (request as { buyerReview: { hidden?: boolean } }).buyerReview.hidden === true,
              hiddenReason:
                typeof (request as { buyerReview: { hiddenReason?: string } }).buyerReview.hiddenReason === "string"
                  ? (request as { buyerReview: { hiddenReason: string } }).buyerReview.hiddenReason.trim()
                  : undefined,
            }
          : undefined,
      sellerResponse:
        (request as { sellerResponse?: { responderUserId?: string; message?: string; createdAt?: string } }).sellerResponse &&
        typeof (request as { sellerResponse: { responderUserId?: string } }).sellerResponse.responderUserId === "string"
          ? {
              responderUserId: (request as { sellerResponse: { responderUserId: string } }).sellerResponse.responderUserId,
              message: String((request as { sellerResponse: { message?: string } }).sellerResponse.message ?? "").trim(),
              createdAt: String((request as { sellerResponse: { createdAt?: string } }).sellerResponse.createdAt ?? request.updatedAt),
            }
          : undefined,
    })),
    commissionRecords: (db.commissionRecords ?? []).map((record) => {
      const createdAt = typeof (record as { createdAt?: string }).createdAt === "string" ? (record as { createdAt: string }).createdAt : nowIso();
      const dueAt = typeof (record as { dueAt?: string }).dueAt === "string" ? (record as { dueAt: string }).dueAt : addDaysIso(createdAt, COMMISSION_GRACE_PERIOD_DAYS);
      return {
        ...record,
        displayNumber: normalizeDisplayNumber((record as { displayNumber?: unknown }).displayNumber),
        paymentStatus: normalizeCommissionPaymentStatus((record as { paymentStatus?: string }).paymentStatus, dueAt),
        dueAt,
        paidAt: typeof (record as { paidAt?: string }).paidAt === "string" ? (record as { paidAt: string }).paidAt : undefined,
        overdueNotifiedAt:
          typeof (record as { overdueNotifiedAt?: string }).overdueNotifiedAt === "string"
            ? (record as { overdueNotifiedAt: string }).overdueNotifiedAt
            : undefined,
        createdAt,
        updatedAt: typeof (record as { updatedAt?: string }).updatedAt === "string" ? (record as { updatedAt: string }).updatedAt : createdAt,
      };
    }),
    auditLogs: (db.auditLogs ?? []).map((entry) => ({
      ...entry,
      reason: typeof (entry as { reason?: string }).reason === "string" ? (entry as { reason: string }).reason : undefined,
      oldValue: (entry as { oldValue?: unknown }).oldValue,
      newValue: (entry as { newValue?: unknown }).newValue,
    })),
    authSessions: db.authSessions ?? [],
    passwordResetTokens: db.passwordResetTokens ?? [],
    notifications: (db.notifications ?? [])
      .filter((item) => item && typeof item.userId === "string")
      .map((item) => {
        const entry = item as AlphaExchangeNotification;
        const state = normalizeNotificationState(entry.state, entry.isRead);
        return {
          ...entry,
          state,
          isRead: state !== "unread",
          centerCategory: entry.centerCategory && isNotificationCenterCategory(entry.centerCategory)
            ? entry.centerCategory
            : resolveNotificationCenterCategory(entry),
          priority: entry.priority ?? resolveNotificationPriority({ ...entry, centerCategory: resolveNotificationCenterCategory(entry) }).priority,
          priorityRank: typeof entry.priorityRank === "number"
            ? entry.priorityRank
            : resolveNotificationPriority({ ...entry, centerCategory: resolveNotificationCenterCategory(entry) }).rank,
          updatedAt: entry.updatedAt ?? entry.createdAt,
          archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : undefined,
        } satisfies AlphaExchangeNotification;
      }),
    activityLog: (db.activityLog ?? []).filter((item) => item && typeof item.userId === "string"),
    disputes: (db.disputes ?? [])
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        ...item,
        displayNumber: normalizeDisplayNumber((item as { displayNumber?: unknown }).displayNumber),
        buyerEvidenceId: typeof (item as { buyerEvidenceId?: string }).buyerEvidenceId === "string" ? (item as { buyerEvidenceId: string }).buyerEvidenceId : undefined,
        sellerEvidenceId: typeof (item as { sellerEvidenceId?: string }).sellerEvidenceId === "string" ? (item as { sellerEvidenceId: string }).sellerEvidenceId : undefined,
      })),
    sellerReports: (db.sellerReports ?? [])
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        ...item,
        displayNumber: normalizeDisplayNumber((item as { displayNumber?: unknown }).displayNumber),
      })),
    trustSnapshots: (db.trustSnapshots ?? []).filter((entry) => entry && typeof entry.sellerId === "string" && entry.snapshot),
    trustScoreHistory: (db.trustScoreHistory ?? []).filter((entry) => entry && typeof entry.sellerId === "string"),
    tradeEvidenceFiles: (db.tradeEvidenceFiles ?? [])
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.purchaseRequestId === "string")
      .filter((entry) => supportedEvidenceMimeTypes.has(String((entry as { mimeType?: string }).mimeType ?? "")))
      .map((entry) => ({
        ...entry,
        side: (entry as { side?: string }).side === "seller" ? "seller" : "buyer",
        status: (entry as { status?: string }).status === "replaced" ? "replaced" : "uploaded",
        fileName: String((entry as { fileName?: string }).fileName ?? "").trim() || "evidence-file",
        sizeBytes: Math.max(0, Number((entry as { sizeBytes?: number }).sizeBytes ?? 0)),
        storagePath: String((entry as { storagePath?: string }).storagePath ?? ""),
      })),
    tradeMessages: (db.tradeMessages ?? [])
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.purchaseRequestId === "string")
      .map((entry) => {
        const senderRoleRaw = typeof (entry as { senderRole?: string }).senderRole === "string"
          ? (entry as { senderRole: string }).senderRole
          : "buyer";
        return {
          ...entry,
          kind: (entry as { kind?: string }).kind === "system" ? "system" : "user",
          senderRole: isUserRole(senderRoleRaw) ? senderRoleRaw : "buyer",
          message: String((entry as { message?: string }).message ?? "").trim(),
          createdAt: String((entry as { createdAt?: string }).createdAt ?? nowIso()),
          readByUserIds: Array.from(
            new Set(
              Array.isArray((entry as { readByUserIds?: string[] }).readByUserIds)
                ? (entry as { readByUserIds: string[] }).readByUserIds.map((id) => String(id).trim()).filter(Boolean)
                : [],
            ),
          ),
        } satisfies TradeChatMessage;
      }),
    privateBetaInvites: (db.privateBetaInvites ?? []).map((invite) => ({
      ...invite,
      status: isValidInviteStatus(String((invite as { status?: string }).status ?? "")) ? (invite as { status: "active" | "expired" | "disabled" }).status : "active",
      maxUses: Math.max(1, Number((invite as { maxUses?: number }).maxUses ?? 1)),
      usedCount: Math.max(0, Number((invite as { usedCount?: number }).usedCount ?? 0)),
      code: String((invite as { code?: string }).code ?? "").trim().toUpperCase(),
    })),
    privateBetaInviteUses: (db.privateBetaInviteUses ?? []).filter((item) => item && typeof item.id === "string"),
    betaFeedback: (db.betaFeedback ?? []).map((item) => ({
      ...item,
      category: isValidFeedbackCategory(String((item as { category?: string }).category ?? "")) ? (item as { category: BetaFeedbackCategory }).category : "other",
      status: isValidFeedbackStatus(String((item as { status?: string }).status ?? "")) ? (item as { status: BetaFeedbackStatus }).status : "new",
      message: String((item as { message?: string }).message ?? "").trim(),
    })),
    betaAnnouncements: (db.betaAnnouncements ?? []).map((item) => ({
      ...item,
      type: isValidAnnouncementType(String((item as { type?: string }).type ?? "")) ? (item as { type: BetaAnnouncementType }).type : "maintenance",
      isActive: (item as { isActive?: boolean }).isActive !== false,
      title: String((item as { title?: string }).title ?? "").trim(),
      message: String((item as { message?: string }).message ?? "").trim(),
    })),
    sellerReviews: (db.sellerReviews ?? []).map((review) => ({
      ...review,
      id: String((review as { id?: string }).id ?? `review-${randomUUID()}`),
      tradeId: String((review as { tradeId?: string }).tradeId ?? ""),
      buyerId: String((review as { buyerId?: string }).buyerId ?? ""),
      sellerId: String((review as { sellerId?: string }).sellerId ?? ""),
      rating: Math.max(1, Math.min(5, Math.round(Number((review as { rating?: number }).rating ?? 0)))) ,
      comment: String((review as { comment?: string }).comment ?? "").trim(),
      sellerReply: typeof (review as { sellerReply?: string }).sellerReply === "string" ? (review as { sellerReply: string }).sellerReply.trim() : undefined,
      createdAt: String((review as { createdAt?: string }).createdAt ?? nowIso()),
      updatedAt: String((review as { updatedAt?: string }).updatedAt ?? (review as { createdAt?: string }).createdAt ?? nowIso()),
      editedAt: typeof (review as { editedAt?: string }).editedAt === "string" ? (review as { editedAt: string }).editedAt : undefined,
      hidden: (review as { hidden?: boolean }).hidden === true,
      hiddenReason: typeof (review as { hiddenReason?: string }).hiddenReason === "string" ? (review as { hiddenReason: string }).hiddenReason.trim() : undefined,
      verifiedTrade: (review as { verifiedTrade?: boolean }).verifiedTrade !== false,
      tradeAmount: String((review as { tradeAmount?: string }).tradeAmount ?? "0"),
      network: String((review as { network?: string }).network ?? "TRC20"),
    })),
    marketplaceListings: (db.marketplaceListings ?? []).map((listing) => ({
      ...listing,
      displayNumber: normalizeDisplayNumber((listing as { displayNumber?: unknown }).displayNumber),
      photos: Array.isArray((listing as { photos?: string[] }).photos)
        ? (listing as { photos: string[] }).photos.map((photo) => String(photo).trim()).filter(Boolean).slice(0, 6)
        : [],
      originalAmount:
        typeof (listing as { originalAmount?: string }).originalAmount === "string" && (listing as { originalAmount: string }).originalAmount.trim()
          ? (listing as { originalAmount: string }).originalAmount.trim()
          : (typeof (listing as { availableAmount?: string }).availableAmount === "string" ? (listing as { availableAmount: string }).availableAmount.trim() : "0"),
      currency: typeof (listing as { currency?: string }).currency === "string" && (listing as { currency: string }).currency.trim()
        ? (listing as { currency: string }).currency.trim()
        : "ILS",
      minimumTrade:
        typeof (listing as { minimumTrade?: string }).minimumTrade === "string" && (listing as { minimumTrade: string }).minimumTrade.trim()
          ? (listing as { minimumTrade: string }).minimumTrade.trim()
          : "0",
      maximumTrade:
        typeof (listing as { maximumTrade?: string }).maximumTrade === "string" && (listing as { maximumTrade: string }).maximumTrade.trim()
          ? (listing as { maximumTrade: string }).maximumTrade.trim()
          : (typeof (listing as { availableAmount?: string }).availableAmount === "string" ? (listing as { availableAmount: string }).availableAmount.trim() : "0"),
      paymentMethods: (() => {
        const methods = resolveListingPaymentMethods(
          (listing as { paymentMethods?: string[] }).paymentMethods,
          (listing as { paymentMethod?: string }).paymentMethod,
        );
        return methods.length ? methods : ["Bank Transfer"];
      })(),
      paymentMethod:
        normalizeMarketplacePaymentMethod((listing as { paymentMethod?: string }).paymentMethod) ??
        resolveListingPaymentMethods((listing as { paymentMethods?: string[] }).paymentMethods)[0] ??
        "Bank Transfer",
      sellerDescription: typeof (listing as { sellerDescription?: string }).sellerDescription === "string"
        ? (listing as { sellerDescription: string }).sellerDescription.trim()
        : "",
      notes: typeof (listing as { notes?: string }).notes === "string"
        ? (listing as { notes: string }).notes.trim()
        : "",
      ownerReviewReason: typeof (listing as { ownerReviewReason?: string }).ownerReviewReason === "string"
        ? (listing as { ownerReviewReason: string }).ownerReviewReason.trim()
        : undefined,
      ownerReviewedAt: typeof (listing as { ownerReviewedAt?: string }).ownerReviewedAt === "string"
        ? (listing as { ownerReviewedAt: string }).ownerReviewedAt
        : undefined,
      ownerReviewedBy: typeof (listing as { ownerReviewedBy?: string }).ownerReviewedBy === "string"
        ? (listing as { ownerReviewedBy: string }).ownerReviewedBy
        : undefined,
      expiresAt: typeof (listing as { expiresAt?: string }).expiresAt === "string"
        ? (listing as { expiresAt: string }).expiresAt
        : getListingExpirationIso(typeof (listing as { createdAt?: string }).createdAt === "string" ? (listing as { createdAt: string }).createdAt : nowIso()),
      expiredAt: typeof (listing as { expiredAt?: string }).expiredAt === "string" ? (listing as { expiredAt: string }).expiredAt : undefined,
      lastRenewedAt: typeof (listing as { lastRenewedAt?: string }).lastRenewedAt === "string" ? (listing as { lastRenewedAt: string }).lastRenewedAt : undefined,
      activeTradeRequestId:
        typeof (listing as { activeTradeRequestId?: string }).activeTradeRequestId === "string"
          ? (listing as { activeTradeRequestId: string }).activeTradeRequestId
          : undefined,
      lockedAt: typeof (listing as { lockedAt?: string }).lockedAt === "string" ? (listing as { lockedAt: string }).lockedAt : undefined,
      completedAt: typeof (listing as { completedAt?: string }).completedAt === "string" ? (listing as { completedAt: string }).completedAt : undefined,
      cancelledAt: typeof (listing as { cancelledAt?: string }).cancelledAt === "string" ? (listing as { cancelledAt: string }).cancelledAt : undefined,
      closedAt: typeof (listing as { closedAt?: string }).closedAt === "string" ? (listing as { closedAt: string }).closedAt : undefined,
      blockingReason: typeof (listing as { blockingReason?: string }).blockingReason === "string" ? (listing as { blockingReason: string }).blockingReason : undefined,
      status: normalizeListingStatus(String((listing as { status?: string }).status ?? "")),
      approvalStatus: normalizeListingApprovalStatus(
        typeof (listing as { approvalStatus?: string }).approvalStatus === "string"
          ? (listing as { approvalStatus: string }).approvalStatus
          : undefined,
        normalizeListingStatus(String((listing as { status?: string }).status ?? "")),
      ),
      network:
        typeof (listing as { network?: string }).network === "string" && isSupportedNetwork((listing as { network: string }).network)
          ? ((listing as { network: SupportedNetwork }).network)
          : "TRC20",
    })),
  };

  if (typeof runtimeVersion === "number" && Number.isFinite(runtimeVersion)) {
    Object.defineProperty(normalized, "__runtimeVersion", {
      value: runtimeVersion,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  ensureDisplayNumbers(normalized);
  return normalized;
}

async function readDb(options?: { bypassCache?: boolean }): Promise<AlphaExchangeDb> {
  if (options?.bypassCache) {
    const repository = await getAlphaExchangeRepository();
    const parsed = await repository.loadSnapshot();
    const normalized = normalizeDb(parsed);
    ensureDisplayNumbers(normalized);
    return normalized;
  }
  const now = Date.now();
  if (dbCache && now - dbCache.updatedAt <= DB_CACHE_TTL_MS) {
    return structuredClone(dbCache.value);
  }
  if (!dbReadInFlight) {
    dbReadInFlight = (async () => {
      try {
        const repository = await getAlphaExchangeRepository();
        const parsed = await repository.loadSnapshot();
        const normalized = normalizeDb(parsed);
        const numberingChanged = ensureDisplayNumbers(normalized);
        const changed = await applyMarketplaceReliabilityRules(normalized);
        if (changed || numberingChanged) {
          await writeDb(normalized);
          return normalized;
        }
        dbCache = { value: normalized, updatedAt: Date.now() };
        return normalized;
      } finally {
        dbReadInFlight = null;
      }
    })();
  }
  const normalized = await dbReadInFlight;
  return structuredClone(normalized);
}

const USER_PROFILE_TABLES = ["users", "seller_profiles", "seller_settings"] as const satisfies readonly SnapshotTableName[];
const TRUST_INIT_TABLES = [...USER_PROFILE_TABLES, "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const LISTING_WRITE_TABLES = ["listings", "audit_logs", "notifications"] as const satisfies readonly SnapshotTableName[];
const LISTING_TRUST_WRITE_TABLES = [...USER_PROFILE_TABLES, "listings", "audit_logs", "notifications", "activity_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const SELLER_APPLICATION_REVIEW_TABLES = [...USER_PROFILE_TABLES, "seller_applications", "notifications", "audit_logs", "activity_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const SELLER_STATUS_TRUST_TABLES = [...USER_PROFILE_TABLES, "audit_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const SELLER_STATUS_NOTIFICATION_TABLES = [...USER_PROFILE_TABLES, "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const SELLER_PROFILE_STATE_TABLES = [...USER_PROFILE_TABLES, "audit_logs"] as const satisfies readonly SnapshotTableName[];
const SELLER_PRESTIGE_TABLES = [...USER_PROFILE_TABLES, "notifications", "audit_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const PURCHASE_REQUEST_CREATE_TABLES = ["purchase_requests", "notifications", "audit_logs", "activity_logs"] as const satisfies readonly SnapshotTableName[];
const TRADE_STATUS_BASE_TABLES = ["purchase_requests", "listings", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
// For completed/declined/cancelled: core trade state written synchronously (critical path).
const TRADE_COMPLETION_CORE_TABLES = ["purchase_requests", "listings", "notifications", "audit_logs", "commissions"] as const satisfies readonly SnapshotTableName[];
// For completed/declined/cancelled: trust data written after the response via after() (non-critical path).
const TRADE_COMPLETION_TRUST_TABLES = [...USER_PROFILE_TABLES, "activity_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const TRADE_EVIDENCE_BASE_TABLES = ["purchase_requests", "audit_logs", "activity_logs", "evidence"] as const satisfies readonly SnapshotTableName[];
const TRADE_EVIDENCE_PAYMENT_TABLES = ["purchase_requests", "listings", "notifications", "audit_logs", "activity_logs", "evidence"] as const satisfies readonly SnapshotTableName[];
const TRADE_REVIEW_TABLES = ["purchase_requests", "notifications", "audit_logs", "activity_logs"] as const satisfies readonly SnapshotTableName[];
const COMMISSION_PAYMENT_TABLES = ["purchase_requests", "commissions", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const PURCHASE_REQUEST_ONLY_TABLES = ["purchase_requests"] as const satisfies readonly SnapshotTableName[];
const COMMISSION_RESET_TABLES = ["purchase_requests", "commissions", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const COMMISSION_STATUS_TABLES = ["purchase_requests", "commissions", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const AUDIT_LOG_ONLY_TABLES = ["audit_logs"] as const satisfies readonly SnapshotTableName[];
const NOTIFICATION_ONLY_TABLES = ["notifications"] as const satisfies readonly SnapshotTableName[];
const NOTIFICATION_PREFERENCES_TABLES = [...USER_PROFILE_TABLES, "activity_logs"] as const satisfies readonly SnapshotTableName[];
const DISPUTE_WRITE_TABLES = ["purchase_requests", "disputes", "notifications", "activity_logs"] as const satisfies readonly SnapshotTableName[];
const SELLER_REPORT_TABLES = ["seller_reports", "notifications", "activity_logs"] as const satisfies readonly SnapshotTableName[];
const BETA_ANNOUNCEMENT_TABLES = ["beta_announcements", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const BETA_ANNOUNCEMENT_STATE_TABLES = ["beta_announcements", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const ADMIN_LISTING_OVERRIDE_TABLES = ["listings", "purchase_requests", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];

async function writeDb(db: AlphaExchangeDb, options?: { evidenceOverrides?: Map<string, Buffer>; traceTag?: string; selectedTables?: readonly SnapshotTableName[] }) {
  const normalized = normalizeDb(db);
  ensureDisplayNumbers(normalized);
  const tables = options?.selectedTables ?? ["(all)"];
  const storeWriteStart = process.env.ALPHA_EXCHANGE_PERF === "1" ? Date.now() : 0;
  const writeTask = dbWriteInFlight.then(async () => {
    if (process.env.ALPHA_EXCHANGE_PERF === "1") {
      const waitedMs = Date.now() - storeWriteStart;
      console.log(`[STORE-PERF] writeDb[${tables.join(",")}] waited_for_prev_write ${waitedMs}ms`);
    }
    const repository = await getAlphaExchangeRepository();
    await repository.saveSnapshot(normalized, {
      evidenceOverrides: options?.evidenceOverrides,
      traceTag: options?.traceTag,
      selectedTables: options?.selectedTables,
    });
  });
  dbWriteInFlight = writeTask.catch(() => undefined);
  try {
    await writeTask;
    if (process.env.ALPHA_EXCHANGE_PERF === "1") {
      console.log(`[STORE-PERF] writeDb[${tables.join(",")}] total ${Date.now() - storeWriteStart}ms`);
    }
    dbCache = { value: normalized, updatedAt: Date.now() };
  } finally {
    dbReadInFlight = null;
  }
}

// Internal delta type for targeted listing-creation writes.
type ListingCreationWriteDelta = {
  newListing: MarketplaceListing;
  newAuditLogs: AuditLogEntry[];
  newNotifications: AlphaExchangeNotification[];
  newActivityLogs: AlphaExchangeActivityLogEntry[];
  newTrustHistoryEntries: TrustScoreChangeLog[];
  updatedTrustSnapshots: TrustSnapshotRecord[];
};

// Targeted read — fetches only the 11 tables required by createMarketplaceListing,
// dropping the 11 tables that are never read on this code path (seller_profiles,
// seller_settings, trades, evidence, sessions, password_reset_tokens,
// seller_reports, private_beta_invites, private_beta_invite_uses,
// beta_feedback, beta_announcements).
// Returns the full cached db when the cache is warm (TTL: 1 s) to avoid any
// DB round-trip at all. fromCache=true signals that the caller may update the
// cache with the mutated db after writing; fromCache=false signals it should
// invalidate so the next read performs a fresh full load.
async function readDbForListingCreation(): Promise<{ db: AlphaExchangeDb; fromCache: boolean }> {
  const now = Date.now();
  if (dbCache && now - dbCache.updatedAt <= DB_CACHE_TTL_MS) {
    return { db: structuredClone(dbCache.value), fromCache: true };
  }
  if (!dbReadInFlight) {
    dbReadInFlight = (async () => {
      try {
        const repository = await getAlphaExchangeRepository();
        const partial = await repository.loadSnapshotForListingCreation();
        const normalized = normalizeDb(partial);
        ensureDisplayNumbers(normalized);
        return normalized;
      } finally {
        dbReadInFlight = null;
      }
    })();
  }
  const db = await dbReadInFlight;
  return { db: structuredClone(db), fromCache: false };
}

// Targeted write — persists only the rows that changed during createMarketplaceListing.
// The listing INSERT + trust_snapshot UPSERTs run in one transaction; all other
// writes (audit_logs, notifications, activity_log, trust_score_history) are
// independent parallel INSERTs with no advisory lock or version-check overhead.
// Cache is updated when db came from the full cached read (fromCache=true) so
// subsequent in-process hits reflect the new listing immediately. When the read
// was a targeted partial read the cache is invalidated to force a fresh full load.
async function writeDbForListingCreation(
  db: AlphaExchangeDb,
  delta: ListingCreationWriteDelta,
  fromCache: boolean,
) {
  const writeTask = dbWriteInFlight.then(async () => {
    const repository = await getAlphaExchangeRepository();
    await repository.saveListingCreationSnapshotTargeted(delta);
  });
  dbWriteInFlight = writeTask.catch(() => undefined);
  try {
    await writeTask;
    if (fromCache) {
      dbCache = { value: db, updatedAt: Date.now() };
    } else {
      dbCache = null;
    }
  } finally {
    dbReadInFlight = null;
  }
}

async function appendAuditLog(db: AlphaExchangeDb, input: {
  action: AuditAction;
  actorUserId: string;
  targetUserId?: string;
  listingId?: string;
  purchaseRequestId?: string;
  details?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
}) {
  ensureDisplayNumbers(db);
  const displayLookup = createExchangeDisplayLookup({
    listings: db.marketplaceListings,
    requests: db.purchaseRequests,
    commissions: db.commissionRecords,
    disputes: db.disputes,
    applications: db.sellerApplications,
  });
  const entry: AuditLogEntry = {
    id: `audit-${randomUUID()}`,
    action: input.action,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    listingId: input.listingId,
    purchaseRequestId: input.purchaseRequestId,
    details: input.details ? replaceExchangeEntityIds(input.details, displayLookup) : input.details,
    oldValue: input.oldValue,
    newValue: input.newValue,
    reason: input.reason,
    createdAt: nowIso(),
  };
  db.auditLogs.unshift(entry);
}

function getOwnerUser(db: AlphaExchangeDb) {
  return db.users.find((user) => hasRole(user, "owner")) ?? null;
}

function getAdminNotificationRecipients(db: AlphaExchangeDb) {
  return db.users.filter((user) => hasRole(user, "owner") || hasRole(user, "admin"));
}

function pushNotification(
  db: AlphaExchangeDb,
  input: {
    userId: string;
    category: NotificationCategory;
    title: string;
    message: string;
    relatedTradeId?: string;
    relatedRequestId?: string;
    relatedListingId?: string;
    relatedHref?: string;
    actionLabel?: string;
    actionHref?: string;
    reason?: string;
    priority?: NotificationPriorityLevel;
    state?: NotificationState;
  },
) {
  ensureDisplayNumbers(db);
  const user = db.users.find((item) => item.id === input.userId);
  if (!user) return;
  if (user.notificationPreferences?.inApp === false && input.category !== "trade") return;
  const inferredRequest = resolveTradeContextForNotification(db, {
    userId: input.userId,
    relatedRequestId: input.relatedRequestId,
    relatedTradeId: input.relatedTradeId,
    relatedListingId: input.relatedListingId,
  });
  const relatedRequestId = input.relatedRequestId ?? inferredRequest?.id;
  const centerCategory = resolveNotificationCenterCategory({
    category: input.category,
    title: input.title,
    message: input.message,
  } as AlphaExchangeNotification);
  const inferredPriority = resolveNotificationPriority({
    title: input.title,
    message: input.message,
    category: input.category,
    centerCategory,
  } as AlphaExchangeNotification);
  const createdAt = nowIso();
  const relatedHref = input.relatedHref?.trim() || (relatedRequestId ? requestDetailsHref(relatedRequestId) : undefined);
  const nextState = input.state ?? "unread";

  const duplicate = db.notifications.find((item) => {
    if (item.userId !== input.userId) return false;
    if (item.category !== input.category) return false;
    if (item.title !== input.title) return false;
    if ((item.relatedRequestId ?? "") !== (relatedRequestId ?? "")) return false;
    const ageMs = Date.now() - new Date(item.createdAt).getTime();
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 45_000;
  });

  if (duplicate) {
    const duplicateIndex = db.notifications.findIndex((item) => item.id === duplicate.id);
    if (duplicateIndex >= 0) {
      const updated = enrichNotification(db, {
        ...duplicate,
        message: input.message,
        state: nextState,
        isRead: nextState !== "unread",
        relatedTradeId: input.relatedTradeId ?? duplicate.relatedTradeId,
        relatedRequestId: relatedRequestId ?? duplicate.relatedRequestId,
        relatedListingId: input.relatedListingId ?? duplicate.relatedListingId,
        relatedHref: relatedHref ?? duplicate.relatedHref,
        centerCategory,
        priority: input.priority ?? inferredPriority.priority,
        priorityRank: inferredPriority.rank,
        actionLabel: input.actionLabel ?? duplicate.actionLabel,
        actionHref: input.actionHref ?? duplicate.actionHref ?? relatedHref,
        reason: input.reason ?? duplicate.reason,
        archivedAt: nextState === "archived" ? createdAt : undefined,
        updatedAt: createdAt,
      });
      db.notifications[duplicateIndex] = updated;
      publishRealtimeEvent({
        type: "notification.updated",
        payload: { notification: updated },
      });
      return;
    }
  }

  const notification = enrichNotification(db, {
    id: `notif-${randomUUID()}`,
    userId: input.userId,
    category: input.category,
    title: input.title,
    message: input.message,
    isRead: nextState !== "unread",
    state: nextState,
    priority: input.priority ?? inferredPriority.priority,
    priorityRank: inferredPriority.rank,
    actionLabel: input.actionLabel,
    actionHref: input.actionHref ?? relatedHref,
    reason: input.reason,
    relatedTradeId: input.relatedTradeId,
    relatedRequestId,
    relatedListingId: input.relatedListingId,
    relatedHref,
    tradeSnapshot: buildTradeSnapshotForNotification(db, input.userId, inferredRequest),
    archivedAt: nextState === "archived" ? createdAt : undefined,
    updatedAt: createdAt,
    createdAt,
  });
  db.notifications.unshift(notification);
  publishRealtimeEvent({
    type: "notification.created",
    payload: { notification },
  });
}

function requestDetailsHref(requestId: string) {
  return `/trade-room/${encodeURIComponent(requestId)}`;
}

function pushActivityLog(
  db: AlphaExchangeDb,
  input: { userId: string; category: NotificationCategory; title: string; details: string },
) {
  ensureDisplayNumbers(db);
  const displayLookup = createExchangeDisplayLookup({
    listings: db.marketplaceListings,
    requests: db.purchaseRequests,
    commissions: db.commissionRecords,
    disputes: db.disputes,
    applications: db.sellerApplications,
  });
  const entry: AlphaExchangeActivityLogEntry = {
    id: `activity-${randomUUID()}`,
    userId: input.userId,
    category: input.category,
    title: replaceExchangeEntityIds(input.title, displayLookup),
    details: replaceExchangeEntityIds(input.details, displayLookup),
    createdAt: nowIso(),
  };
  db.activityLog.unshift(entry);
}

function listingShouldExpire(listing: MarketplaceListing, nowMs: number) {
  if (listing.status !== "active" && listing.status !== "paused") return false;
  if (!listing.expiresAt) return false;
  const expiresMs = new Date(listing.expiresAt).getTime();
  if (!expiresMs || Number.isNaN(expiresMs)) return false;
  return expiresMs <= nowMs;
}

function listingExpirationDeferredByTrade(listing: MarketplaceListing) {
  return isListingLocked(listing.status) || Boolean(listing.activeTradeRequestId);
}

async function expireListing(db: AlphaExchangeDb, listing: MarketplaceListing, actorUserId: string, reason: string) {
  const previousStatus = listing.status;
  const now = nowIso();
  listing.status = "expired";
  listing.expiredAt = now;
  listing.updatedAt = now;
  listing.activeTradeRequestId = undefined;
  listing.lockedAt = undefined;

  await appendAuditLog(db, {
    action: "listing_expired",
    actorUserId,
    targetUserId: listing.sellerId,
    listingId: listing.id,
    details: `Listing ${listing.id} expired.`,
    oldValue: { status: previousStatus, expiresAt: listing.expiresAt },
    newValue: { status: "expired", expiredAt: now },
    reason,
  });
  pushNotification(db, {
    userId: listing.sellerId,
    category: "listing",
    title: "Listing expired",
    message: `Listing ${listing.id} expired and is no longer visible to buyers.`,
    relatedListingId: listing.id,
    relatedHref: "/usdt-exchange",
  });
  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "listing",
      title: "Listing expired",
      message: `${listing.sellerDisplayName}'s listing ${listing.id} expired.`,
      relatedListingId: listing.id,
      relatedHref: "/admin/alpha-exchange",
    });
  }
}

function unlockListingAfterCancelledTrade(db: AlphaExchangeDb, listing: MarketplaceListing, actorUserId: string, request: PurchaseRequest, reason: string) {
  const now = nowIso();
  const hadExpiredClock = Boolean(listing.expiresAt) && new Date(listing.expiresAt!).getTime() <= Date.now();
  const nextStatus: ListingStatus = hadExpiredClock ? "expired" : "active";
  const previousActiveTradeRequestId = listing.activeTradeRequestId;
  listing.activeTradeRequestId = undefined;
  listing.lockedAt = undefined;
  listing.updatedAt = now;
  listing.status = nextStatus;
  if (nextStatus === "expired") {
    listing.expiredAt = now;
  }
  void appendAuditLog(db, {
    action: nextStatus === "expired" ? "listing_expired" : "listing_reopened",
    actorUserId,
    targetUserId: listing.sellerId,
    listingId: listing.id,
    purchaseRequestId: request.id,
    details: nextStatus === "expired" ? `Listing ${listing.id} expired after trade unlock.` : `Listing ${listing.id} reopened after trade cancellation.`,
    oldValue: { status: request.status, activeTradeRequestId: previousActiveTradeRequestId },
    newValue: { status: nextStatus },
    reason,
  });
}

async function markCommissionOverdue(db: AlphaExchangeDb, record: CommissionRecord, actorUserId: string) {
  const now = nowIso();
  record.paymentStatus = "overdue";
  record.overdueNotifiedAt = record.overdueNotifiedAt ?? now;
  record.updatedAt = now;
  await appendAuditLog(db, {
    action: "commission_overdue",
    actorUserId,
    targetUserId: record.sellerId,
    listingId: record.listingId,
    purchaseRequestId: record.purchaseRequestId,
    details: `Commission ${record.id} is overdue.`,
    oldValue: { paymentStatus: "pending", dueAt: record.dueAt },
    newValue: { paymentStatus: "overdue", overdueNotifiedAt: record.overdueNotifiedAt },
  });
  pushNotification(db, {
    userId: record.sellerId,
    category: "trade",
    title: "Commission overdue",
    message: `Commission for trade ${record.purchaseRequestId} is overdue and requires payment.`,
    relatedTradeId: record.purchaseRequestId,
    relatedListingId: record.listingId,
    relatedHref: "/usdt-exchange",
  });
  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "trade",
      title: "Commission overdue",
      message: `Commission for trade ${record.purchaseRequestId} is now overdue.`,
      relatedTradeId: record.purchaseRequestId,
      relatedListingId: record.listingId,
      relatedHref: "/admin/alpha-exchange",
    });
  }
}

async function applyMarketplaceReliabilityRules(db: AlphaExchangeDb) {
  let changed = false;
  const nowMs = Date.now();
  const timeoutWindowMs = getStaleTradeTimeoutMinutes() * 60 * 1000;

  for (const record of db.commissionRecords) {
    if (record.paymentStatus === "paid" || !record.dueAt) continue;
    const dueMs = new Date(record.dueAt).getTime();
    if (!dueMs || Number.isNaN(dueMs) || dueMs > nowMs || record.overdueNotifiedAt) continue;
    changed = true;
    await markCommissionOverdue(db, record, SYSTEM_ACTOR_USER_ID);
  }

  for (const request of db.purchaseRequests) {
    if (request.status !== "accepted" || request.paymentSentAt || request.usdtSentAt || request.completedAt) continue;
    const startedAtMs = new Date(request.tradeCreatedAt ?? request.updatedAt ?? request.createdAt).getTime();
    if (!startedAtMs || Number.isNaN(startedAtMs) || startedAtMs + timeoutWindowMs > nowMs) continue;
    const listing = db.marketplaceListings.find((item) => item.id === request.listingId);
    changed = true;
    const now = nowIso();
    request.status = "cancelled";
    request.timedOutAt = now;
    request.timeoutReason = "Buyer inactivity timeout.";
    request.updatedAt = now;
    request.timeline = [...(request.timeline ?? [])];
    request.timeline.push({
      id: `timeline-timeout-${randomUUID()}`,
      type: "request_cancelled",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      actorRole: "admin",
      message: "Trade timed out due to buyer inactivity",
      createdAt: now,
    });
    if (listing && listing.activeTradeRequestId === request.id && !request.usdtSentAt) {
      unlockListingAfterCancelledTrade(db, listing, SYSTEM_ACTOR_USER_ID, request, request.timeoutReason);
    }
    await appendAuditLog(db, {
      action: "trade_timed_out",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      targetUserId: request.buyerId,
      listingId: request.listingId,
      purchaseRequestId: request.id,
      details: `Trade ${request.tradeId ?? request.id} timed out.`,
      oldValue: { status: "accepted" },
      newValue: { status: "cancelled", timedOutAt: now },
      reason: request.timeoutReason,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade timed out",
      message: `Trade ${request.tradeId ?? request.id} timed out because there was no buyer activity.`,
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: "Trade timed out",
      message: `Trade ${request.tradeId ?? request.id} timed out after buyer inactivity.`,
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
    const owner = getOwnerUser(db);
    if (owner) {
      pushNotification(db, {
        userId: owner.id,
        category: "trade",
        title: "Trade timed out",
        message: `Trade ${request.tradeId ?? request.id} timed out and was cancelled automatically.`,
        relatedTradeId: request.tradeId ?? request.id,
        relatedListingId: request.listingId,
        relatedHref: "/admin/alpha-exchange",
      });
    }
  }

  for (const request of db.purchaseRequests) {
    if (request.status !== "usdt_release_pending") continue;
    if (!request.usdtReleaseDeadlineAt) continue;
    if (request.usdtSentAt || request.completedAt) continue;
    if (request.timeoutReason === "USDT release SLA expired.") continue;
    const deadlineMs = new Date(request.usdtReleaseDeadlineAt).getTime();
    if (!deadlineMs || Number.isNaN(deadlineMs) || deadlineMs > nowMs) continue;

    const now = nowIso();
    changed = true;
    request.timedOutAt = now;
    request.timeoutReason = "USDT release SLA expired.";
    request.updatedAt = now;
    appendTradeTimelineEntry(request, {
      type: "trade_timed_out",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      actorRole: "admin",
      message: "USDT release window expired — trade marked overdue.",
      createdAt: now,
    });
    await appendAuditLog(db, {
      action: "trade_timed_out",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      targetUserId: request.sellerId,
      listingId: request.listingId,
      purchaseRequestId: request.id,
      details: `Trade ${request.tradeId ?? request.id} exceeded the 45-minute USDT release SLA.`,
      oldValue: { status: "usdt_release_pending", usdtReleaseDeadlineAt: request.usdtReleaseDeadlineAt },
      newValue: { status: "usdt_release_pending", timedOutAt: now, overdue: true },
      reason: request.timeoutReason,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade overdue",
      message: `Trade ${request.tradeId ?? request.id} exceeded the USDT release deadline. You can open a dispute now.`,
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: "USDT release overdue",
      message: `Trade ${request.tradeId ?? request.id} exceeded the 45-minute release window and is now overdue.`,
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    for (const adminUser of getAdminNotificationRecipients(db)) {
      pushNotification(db, {
        userId: adminUser.id,
        category: "trade",
        title: "Trade overdue alert",
        message: `Trade ${request.tradeId ?? request.id} exceeded the 45-minute USDT release SLA.`,
        relatedTradeId: request.tradeId ?? request.id,
        relatedListingId: request.listingId,
        relatedHref: "/admin/alpha-exchange",
      });
    }
    publishRealtimeEvent({
      type: "trade.status_changed",
      payload: { request: enrichRequestWithEvidence(db, request) },
    });
  }

  const buyerConfirmationTimeoutMs = BUYER_CONFIRMATION_TIMEOUT_MINUTES * 60 * 1000;
  for (const request of db.purchaseRequests) {
    if (request.status !== "usdt_sent") continue;
    if (request.buyerConfirmationArchivedAt || request.completedAt) continue;
    if (!request.usdtSentAt) continue;
    const usdtSentMs = new Date(request.usdtSentAt).getTime();
    if (!usdtSentMs || Number.isNaN(usdtSentMs) || usdtSentMs + buyerConfirmationTimeoutMs > nowMs) continue;

    const now = nowIso();
    changed = true;
    request.buyerConfirmationArchivedAt = now;
    request.updatedAt = now;
    appendTradeTimelineEntry(request, {
      type: "buyer_confirmation_overdue",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      actorRole: "admin",
      message: "Buyer confirmation reminder sent — trade archived awaiting buyer confirmation.",
      createdAt: now,
    });
    await appendAuditLog(db, {
      action: "trade_timed_out",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      targetUserId: request.buyerId,
      listingId: request.listingId,
      purchaseRequestId: request.id,
      details: `Trade ${request.tradeId ?? request.id} awaiting buyer confirmation beyond the ${BUYER_CONFIRMATION_TIMEOUT_MINUTES}-minute window.`,
      oldValue: { status: "usdt_sent" },
      newValue: { status: "usdt_sent", buyerConfirmationArchivedAt: now },
      reason: "Buyer confirmation overdue.",
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Action Required — Confirm USDT Receipt",
      message: `Please confirm that you received your USDT from trade ${request.tradeId ?? request.id} to complete your purchase.`,
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
      priority: "high",
      actionLabel: "Confirm Receipt",
      actionHref: requestDetailsHref(request.id),
    });
    publishRealtimeEvent({
      type: "trade.status_changed",
      payload: { request: enrichRequestWithEvidence(db, request) },
    });
  }

  for (const listing of db.marketplaceListings) {
    if (!isListingLocked(listing.status) && !listing.activeTradeRequestId) continue;
    const linkedRequest = listing.activeTradeRequestId
      ? db.purchaseRequests.find((request) => request.id === listing.activeTradeRequestId)
      : undefined;
    if (linkedRequest && isRequestStatusLockingListing(linkedRequest.status)) continue;

    changed = true;
    const now = nowIso();
    const previousStatus = listing.status;
    const previousActiveTradeRequestId = listing.activeTradeRequestId;
    listing.activeTradeRequestId = undefined;
    listing.lockedAt = undefined;
    listing.updatedAt = now;

    const remainingAmount = toNumber(listing.availableAmount);
    if (remainingAmount <= 0) {
      listing.status = "completed";
      listing.completedAt = listing.completedAt ?? now;
    } else {
      const expiresMs = listing.expiresAt ? new Date(listing.expiresAt).getTime() : 0;
      const shouldExpire = Boolean(expiresMs && !Number.isNaN(expiresMs) && expiresMs <= nowMs);
      listing.status = shouldExpire ? "expired" : "active";
      listing.expiredAt = shouldExpire ? (listing.expiredAt ?? now) : undefined;
    }

    await appendAuditLog(db, {
      action: listing.status === "expired" ? "listing_expired" : listing.status === "completed" ? "listing_completed" : "listing_reopened",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      targetUserId: listing.sellerId,
      listingId: listing.id,
      details: `Recovered stale trade lock on listing ${listing.id}.`,
      oldValue: {
        status: previousStatus,
        activeTradeRequestId: previousActiveTradeRequestId,
      },
      newValue: {
        status: listing.status,
        activeTradeRequestId: listing.activeTradeRequestId,
      },
      reason: "Stale listing lock had no active trade request.",
    });
  }

  for (const listing of db.marketplaceListings) {
    if (!listingShouldExpire(listing, nowMs) || listingExpirationDeferredByTrade(listing)) continue;
    changed = true;
    await expireListing(db, listing, SYSTEM_ACTOR_USER_ID, "Listing expiration time reached.");
  }

  return changed;
}

function resolveActorRole(db: AlphaExchangeDb, actorUserId: string): UserRole {
  return db.users.find((user) => user.id === actorUserId)?.role ?? "buyer";
}

function appendTradeTimelineEntry(
  request: PurchaseRequest,
  input: { type: TradeTimelineEventType; actorUserId: string; actorRole: UserRole; message: string; createdAt?: string },
) {
  const createdAt = input.createdAt ?? nowIso();
  request.timeline = [
    ...(request.timeline ?? []),
    {
      id: `timeline-${request.id}-${(request.timeline?.length ?? 0) + 1}`,
      type: input.type,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      message: input.message,
      createdAt,
    },
  ];
}

function appendSystemTradeMessage(
  db: AlphaExchangeDb,
  request: PurchaseRequest,
  input: { senderUserId: string; senderRole: UserRole; message: string; createdAt?: string },
) {
  const createdAt = input.createdAt ?? nowIso();
  const nextMessage: TradeChatMessage = {
    id: `trade-msg-${randomUUID()}`,
    purchaseRequestId: request.id,
    kind: "system",
    senderUserId: input.senderUserId,
    senderRole: input.senderRole,
    message: input.message,
    createdAt,
    readByUserIds: [],
  };
  request.messages = [nextMessage, ...(request.messages ?? [])];
  db.tradeMessages = [nextMessage, ...(db.tradeMessages ?? [])];
}

function enrichRequestWithEvidence(db: AlphaExchangeDb, request: PurchaseRequest): PurchaseRequest {
  const buyerEvidence = db.tradeEvidenceFiles.find((item) => item.purchaseRequestId === request.id && item.side === "buyer");
  const sellerEvidence = db.tradeEvidenceFiles.find((item) => item.purchaseRequestId === request.id && item.side === "seller");
  return {
    ...request,
    buyerEvidence,
    sellerEvidence,
  };
}

function getTradeEvidenceFile(db: AlphaExchangeDb, purchaseRequestId: string, side: TradeEvidenceSide) {
  return db.tradeEvidenceFiles.find((item) => item.purchaseRequestId === purchaseRequestId && item.side === side);
}

async function recalculateTrustEngine(db: AlphaExchangeDb, input: { reason: string; triggeredBy: string }) {
  const previous = new Map(db.trustSnapshots.map((entry) => [entry.sellerId, entry.snapshot]));
  const owner = getOwnerUser(db);
  const eligibleSellers = db.users.filter((user) => isTrustEligibleSeller(user));
  const sellerById = new Map(eligibleSellers.map((seller) => [seller.id, seller]));
  const sellerIndexById = new Map(db.users.map((user, index) => [user.id, index]));
  const listingsBySeller = new Map<string, MarketplaceListing[]>();
  const requestsBySeller = new Map<string, PurchaseRequest[]>();
  const commissionsBySeller = new Map<string, CommissionRecord[]>();
  const visibleReviewCountBySeller = new Map<string, number>();

  for (const listing of db.marketplaceListings) {
    const bucket = listingsBySeller.get(listing.sellerId);
    if (bucket) bucket.push(listing);
    else listingsBySeller.set(listing.sellerId, [listing]);
  }

  for (const request of db.purchaseRequests) {
    const bucket = requestsBySeller.get(request.sellerId);
    if (bucket) bucket.push(request);
    else requestsBySeller.set(request.sellerId, [request]);
  }

  for (const record of db.commissionRecords) {
    const bucket = commissionsBySeller.get(record.sellerId);
    if (bucket) bucket.push(record);
    else commissionsBySeller.set(record.sellerId, [record]);
  }

  for (const request of db.purchaseRequests) {
    if (!request.buyerReview || request.buyerReview.hidden === true) continue;
    visibleReviewCountBySeller.set(request.sellerId, (visibleReviewCountBySeller.get(request.sellerId) ?? 0) + 1);
  }

  const computed = rankTrustSnapshots(
    eligibleSellers
      .map((seller) => {
        const snapshot = calculateSellerTrustSnapshot({
          seller,
          listings: listingsBySeller.get(seller.id) ?? [],
          requests: requestsBySeller.get(seller.id) ?? [],
          commissions: commissionsBySeller.get(seller.id) ?? [],
        });
        const derivedRank = resolveSellerPrestigeRank(snapshot.totalUsdtVolume);
        const effectiveRank = seller.sellerRankOverride?.rank ?? seller.sellerPrestigeRank ?? derivedRank;
        snapshot.level = effectiveRank;
        snapshot.lifetimeCompletedVolumeUsdt = snapshot.totalUsdtVolume;
        Object.assign(
          snapshot,
          buildPrestigeFieldsForSnapshot({
            volumeUsdt: snapshot.totalUsdtVolume,
            rank: effectiveRank,
            isOverridden: Boolean(seller.sellerRankOverride),
          }),
        );
        return snapshot;
      }),
  );

  const now = nowIso();
  db.trustSnapshots = computed.map((snapshot) => ({
    sellerId: snapshot.sellerId,
    snapshot,
    updatedAt: now,
  }));

  for (const snapshot of computed) {
    const sellerIndex = sellerIndexById.get(snapshot.sellerId) ?? -1;
    const seller = sellerIndex !== -1 ? db.users[sellerIndex] : sellerById.get(snapshot.sellerId);
    const previousRank = seller?.sellerPrestigeRank ?? previous.get(snapshot.sellerId)?.level ?? resolveSellerPrestigeRank(snapshot.totalUsdtVolume);
    const hasOverride = Boolean(seller?.sellerRankOverride);
    if (seller && sellerIndex !== -1) {
      const nextAchievements = buildSellerAchievements(db, { ...seller, lifetimeCompletedVolumeUsdt: snapshot.totalUsdtVolume, sellerPrestigeRank: snapshot.level });
      db.users[sellerIndex] = {
        ...seller,
        lifetimeCompletedVolumeUsdt: snapshot.totalUsdtVolume,
        sellerPrestigeRank: snapshot.level,
        sellerAchievements: nextAchievements,
      };
    }

    const previousSnapshot = previous.get(snapshot.sellerId);
    const oldScore = Number(previousSnapshot?.trustScore ?? 0);
    const newScore = Number(snapshot.trustScore);
    const scoreChanged = Math.round(oldScore * 10) !== Math.round(newScore * 10);
    const levelChanged = previousSnapshot && previousSnapshot.level !== snapshot.level;
    const sharpDrop = previousSnapshot && oldScore - newScore >= 8;
    const trustIncreased = previousSnapshot && newScore - oldScore >= 1;
    const flagged = snapshot.trustScore < 55 || snapshot.marketplaceViolations > 0 || snapshot.disputesLost >= 3 || snapshot.cancellationRate >= 20;

    if (scoreChanged) {
      publishRealtimeEvent({
        type: "reputation.updated",
        payload: {
          sellerId: snapshot.sellerId,
          trustScore: newScore,
          reviewCount: visibleReviewCountBySeller.get(snapshot.sellerId) ?? 0,
        },
      });
      db.trustScoreHistory.unshift({
        id: `trust-score-${randomUUID()}`,
        sellerId: snapshot.sellerId,
        oldScore,
        newScore,
        reason: input.reason,
        triggeredBy: input.triggeredBy,
        createdAt: now,
      });
      await appendAuditLog(db, {
        action: "trust_score_updated",
        actorUserId: input.triggeredBy,
        targetUserId: snapshot.sellerId,
        details: `Trust score ${oldScore.toFixed(1)} -> ${newScore.toFixed(1)} (${input.reason})`,
      });
    }

    if (trustIncreased) {
      pushNotification(db, {
        userId: snapshot.sellerId,
        category: "trust",
        title: "Trust score increased",
        message: `Your trust score increased from ${oldScore.toFixed(1)} to ${newScore.toFixed(1)}.`,
      });
      pushActivityLog(db, {
        userId: snapshot.sellerId,
        category: "trust",
        title: "Trust score increased",
        details: `Trust score improved to ${newScore.toFixed(1)}.`,
      });
    }

    if (levelChanged) {
      pushNotification(db, {
        userId: snapshot.sellerId,
        category: "trust",
        title: "Prestige rank updated",
        message: `Your prestige rank changed from ${previousSnapshot!.level} to ${snapshot.level}.`,
      });
      pushActivityLog(db, {
        userId: snapshot.sellerId,
        category: "trust",
        title: "Prestige rank updated",
        details: `Prestige rank is now ${snapshot.level}.`,
      });
    }

    const promotedAutomatically = !hasOverride && levelRank(snapshot.level) > levelRank(previousRank);
    if (promotedAutomatically && seller && sellerIndex !== -1) {
      const entry: SellerPromotionHistoryEntry = {
        id: `promotion-${randomUUID()}`,
        rank: snapshot.level,
        previousRank,
        promotedAt: now,
        lifetimeCompletedVolumeUsdt: snapshot.totalUsdtVolume,
        source: "automatic",
      };
      const history = [entry, ...(seller.sellerPromotionHistory ?? [])].slice(0, 200);
      db.users[sellerIndex] = {
        ...db.users[sellerIndex],
        sellerPromotionHistory: history,
      };
      await appendAuditLog(db, {
        action: "seller_prestige_promoted",
        actorUserId: input.triggeredBy,
        targetUserId: snapshot.sellerId,
        details: `Seller promoted from ${previousRank} to ${snapshot.level}.`,
        oldValue: { rank: previousRank, lifetimeCompletedVolumeUsdt: seller.lifetimeCompletedVolumeUsdt ?? 0 },
        newValue: { rank: snapshot.level, lifetimeCompletedVolumeUsdt: snapshot.totalUsdtVolume },
        reason: input.reason,
      });
      pushNotification(db, {
        userId: snapshot.sellerId,
        category: "trust",
        title: "Congratulations! New prestige rank unlocked",
        message: `You reached ${snapshot.level} seller. ${summarizePromotionBenefits(snapshot.level)}`,
      });
      pushActivityLog(db, {
        userId: snapshot.sellerId,
        category: "trust",
        title: "Prestige promotion unlocked",
        details: `Promoted to ${snapshot.level} seller.`,
      });
    }

    if (owner && sharpDrop) {
      pushNotification(db, {
        userId: owner.id,
        category: "trust",
        title: "Sharp trust score drop",
        message: `Seller ${snapshot.sellerId} dropped from ${oldScore.toFixed(1)} to ${newScore.toFixed(1)}.`,
      });
    }

    if (owner && flagged) {
      const alreadyNotifiedRecently = db.notifications.some(
        (notification) =>
          notification.userId === owner.id &&
          notification.category === "trust" &&
          notification.message.includes(snapshot.sellerId) &&
          now.slice(0, 10) === notification.createdAt.slice(0, 10),
      );
      if (!alreadyNotifiedRecently) {
        pushNotification(db, {
          userId: owner.id,
          category: "trust",
          title: "Flagged seller detected",
          message: `Seller ${snapshot.sellerId} is flagged for trust/risk signals.`,
        });
      }
    }
  }
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeHexEquals(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isAdminEmail(email: string) {
  return isAlphaExchangeOwnerEmail(email);
}

export function canPublishListings(user: Pick<AlphaExchangeUser, "role" | "roles" | "sellerStatus">) {
  // Admin and owner can always publish listings.
  if (hasRole(user, "admin") || hasRole(user, "owner")) return true;
  return user.sellerStatus === "approved_seller";
}

function resolveInviteStatus(invite: PrivateBetaInviteCode) {
  if (invite.status === "disabled") return "disabled" as const;
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) return "expired" as const;
  if (invite.usedCount >= invite.maxUses) return "expired" as const;
  return "active" as const;
}

export async function createUser(input: {
  fullName: string;
  email: string;
  passwordHash: string;
  whatsappNumber: string;
}) {
  const db = await readDb();
  const email = normalizeEmail(input.email);
  if (db.users.some((user) => normalizeEmail(user.email) === email)) {
    throw new Error("Email already registered.");
  }

  const timestamp = nowIso();
  const roles = normalizeRolesForUser({
    email,
    roles: isAdminEmail(email) ? ["owner", "admin"] : ["guest"],
    sellerStatus: "buyer",
  });
  const role = resolvePrimaryRole(roles);
  const user: AlphaExchangeUser = {
    id: `user-${randomUUID()}`,
    fullName: input.fullName.trim(),
    email,
    passwordHash: input.passwordHash,
    whatsappNumber: input.whatsappNumber.trim(),
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    preferredPaymentMethods: [],
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    onlineStatus: "offline",
    availabilityStatus: "available",
    lastActiveAt: timestamp,
    isFeaturedSeller: false,
    isProfileHidden: false,
    showTradeStats: true,
    showLastActive: true,
    allowDirectMessages: true,
    allowProfileSearch: true,
    showPhonePublic: false,
    showEmailPublic: false,
    notificationPreferences: normalizeNotificationPreferences(),
    role,
    roles,
    sellerStatus: "buyer",
    emailVerified: false,
    emailVerifiedAt: undefined,
    emailVerificationTokenHash: undefined,
    emailVerificationTokenExpiresAt: undefined,
    emailVerificationSentAt: undefined,
    onboardingSelection: undefined,
    onboardingCompletedAt: undefined,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerRankOverride: undefined,
    sellerPromotionHistory: [],
    isFoundingMember: !isAdminEmail(email),
    isFoundingSeller: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.users.push(user);
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return user;
}

export async function upsertUserProfileForAuth(input: {
  fullName: string;
  email: string;
  passwordHash?: string;
  whatsappNumber: string;
  emailVerified?: boolean;
}) {
  const db = await readDb();
  const email = normalizeEmail(input.email);
  const existingIndex = db.users.findIndex((user) => normalizeEmail(user.email) === email);
  const timestamp = nowIso();
  if (existingIndex !== -1) {
    const existing = db.users[existingIndex];
    const normalizedRoles = normalizeRolesForUser({
      email,
      role: existing.role,
      roles: existing.roles,
      sellerStatus: existing.sellerStatus,
    });
    const nextFullName = input.fullName.trim() || existing.fullName;
    const nextWhatsappNumber = input.whatsappNumber.trim() || existing.whatsappNumber;
    const nextPasswordHash = input.passwordHash ?? existing.passwordHash;
    const nextRole = resolvePrimaryRole(normalizedRoles);
    const nextEmailVerified = input.emailVerified === true ? true : existing.emailVerified === true;
    const nextEmailVerifiedAt = input.emailVerified === true
      ? (existing.emailVerifiedAt ?? timestamp)
      : existing.emailVerifiedAt;

    const unchanged =
      existing.fullName === nextFullName
      && existing.whatsappNumber === nextWhatsappNumber
      && existing.passwordHash === nextPasswordHash
      && existing.role === nextRole
      && existing.emailVerified === nextEmailVerified
      && existing.emailVerifiedAt === nextEmailVerifiedAt
      && JSON.stringify(existing.roles ?? []) === JSON.stringify(normalizedRoles);

    if (unchanged) {
      return existing;
    }

    db.users[existingIndex] = {
      ...existing,
      fullName: nextFullName,
      whatsappNumber: nextWhatsappNumber,
      passwordHash: nextPasswordHash,
      roles: normalizedRoles,
      role: nextRole,
      emailVerified: nextEmailVerified,
      emailVerifiedAt: nextEmailVerifiedAt,
      updatedAt: timestamp,
    };
    await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
    return db.users[existingIndex];
  }

  const roles = normalizeRolesForUser({
    email,
    roles: isAdminEmail(email) ? ["owner", "admin"] : ["guest"],
    sellerStatus: "buyer",
  });
  const role = resolvePrimaryRole(roles);
  const user: AlphaExchangeUser = {
    id: `user-${randomUUID()}`,
    fullName: input.fullName.trim(),
    email,
    passwordHash: input.passwordHash ?? "",
    whatsappNumber: input.whatsappNumber.trim(),
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    preferredPaymentMethods: [],
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    onlineStatus: "offline",
    availabilityStatus: "available",
    lastActiveAt: timestamp,
    isFeaturedSeller: false,
    isProfileHidden: false,
    showTradeStats: true,
    showLastActive: true,
    allowDirectMessages: true,
    allowProfileSearch: true,
    showPhonePublic: false,
    showEmailPublic: false,
    notificationPreferences: normalizeNotificationPreferences(),
    role,
    roles,
    sellerStatus: "buyer",
    emailVerified: input.emailVerified === true,
    emailVerifiedAt: input.emailVerified === true ? timestamp : undefined,
    emailVerificationTokenHash: undefined,
    emailVerificationTokenExpiresAt: undefined,
    emailVerificationSentAt: undefined,
    onboardingSelection: undefined,
    onboardingCompletedAt: undefined,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerRankOverride: undefined,
    sellerPromotionHistory: [],
    isFoundingMember: !isAdminEmail(email),
    isFoundingSeller: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.users.push(user);
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return user;
}

export function normalizeIsraeliPhone(rawPhone: string) {
  const normalized = String(rawPhone ?? "").replace(/\s+/g, "").replace(/-/g, "");
  if (!normalized) return null;
  if (/^05\d{8}$/.test(normalized)) return `+972${normalized.slice(1)}`;
  if (/^\+9725\d{8}$/.test(normalized)) return normalized;
  if (/^9725\d{8}$/.test(normalized)) return `+${normalized}`;
  return null;
}

export async function grantStudentRole(userId: string) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  const roles = addRole(removeRole(user.roles ?? [user.role], "guest"), "student");
  db.users[index] = {
    ...user,
    roles,
    role: resolvePrimaryRole(roles),
    onboardingSelection: "student",
    onboardingCompletedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return db.users[index];
}

export async function selectGuestOnboarding(userId: string) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  db.users[index] = {
    ...user,
    onboardingSelection: "guest",
    onboardingCompletedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return db.users[index];
}

export async function activateBuyerOnboardingWithoutPhone(input: {
  userId: string;
  firstName: string;
  lastName: string;
  displayName?: string;
}) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) {
    throw new Error("First name and last name are required.");
  }

  const roles = addRole(removeRole(user.roles ?? [user.role], "guest"), "buyer");
  db.users[index] = {
    ...user,
    roles,
    role: resolvePrimaryRole(roles),
    buyerFirstName: firstName,
    buyerLastName: lastName,
    buyerDisplayName: input.displayName?.trim() || undefined,
    onboardingSelection: "buyer",
    onboardingCompletedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return db.users[index];
}

export async function beginBuyerVerification(input: {
  userId: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  phone: string;
}) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  const normalizedPhone = normalizeIsraeliPhone(input.phone);
  if (!normalizedPhone) {
    throw new Error("This marketplace is currently available only for verified Israeli buyers.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const sendsDate = user.buyerOtpSendsDate ?? today;
  const sendsToday = sendsDate === today ? Number(user.buyerOtpSendsToday ?? 0) : 0;
  if (sendsToday >= 5) throw new Error("OTP send limit reached for today.");

  const conflict = db.users.find((item) => item.id !== user.id && item.verifiedPhone === normalizedPhone);
  if (conflict) throw new Error("This phone number is already linked to another buyer account.");

  db.users[index] = {
    ...user,
    buyerFirstName: input.firstName.trim(),
    buyerLastName: input.lastName.trim(),
    buyerDisplayName: input.displayName?.trim() || undefined,
    buyerVerificationStatus: "otp_sent",
    buyerOtpRequestedAt: nowIso(),
    buyerOtpSendsDate: today,
    buyerOtpSendsToday: sendsToday + 1,
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return { phone: normalizedPhone, user: db.users[index] };
}

export async function completeBuyerVerification(input: { userId: string; phone: string }) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  const normalizedPhone = normalizeIsraeliPhone(input.phone);
  if (!normalizedPhone) throw new Error("Invalid Israeli phone number.");
  const conflict = db.users.find((item) => item.id !== user.id && item.verifiedPhone === normalizedPhone);
  if (conflict) throw new Error("This phone number is already linked to another buyer account.");

  const roles = addRole(removeRole(user.roles ?? [user.role], "guest"), "buyer");
  db.users[index] = {
    ...user,
    roles,
    role: resolvePrimaryRole(roles),
    verifiedPhone: normalizedPhone,
    phoneVerifiedAt: nowIso(),
    buyerVerificationStatus: "verified",
    buyerVerificationAttempts: Math.max(0, Number(user.buyerVerificationAttempts ?? 0)),
    onboardingSelection: "buyer",
    onboardingCompletedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return db.users[index];
}

export async function recordBuyerVerificationAttempt(userId: string) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === userId);
  if (index === -1) return;
  const user = db.users[index];
  const now = Date.now();
  const windowStart = user.buyerVerificationWindowStartedAt ? new Date(user.buyerVerificationWindowStartedAt).getTime() : 0;
  const withinWindow = Number.isFinite(windowStart) && windowStart > 0 && now - windowStart < 60 * 60 * 1000;
  const attempts = withinWindow ? Number(user.buyerVerificationAttempts ?? 0) + 1 : 1;
  db.users[index] = {
    ...user,
    buyerVerificationAttempts: attempts,
    buyerVerificationWindowStartedAt: withinWindow ? user.buyerVerificationWindowStartedAt : nowIso(),
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
}

export async function createEmailVerificationTokenForUser(userId: string, durationHours = EMAIL_VERIFICATION_EXPIRY_HOURS) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === userId);
  if (userIndex === -1) {
    throw new Error("User not found.");
  }

  const token = randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
  const sentAt = nowIso();

  db.users[userIndex] = {
    ...db.users[userIndex],
    emailVerificationTokenHash: tokenHash,
    emailVerificationTokenExpiresAt: expiresAt,
    emailVerificationSentAt: sentAt,
    updatedAt: sentAt,
  };

  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return {
    token,
    expiresAt,
    user: db.users[userIndex],
  };
}

export async function createEmailVerificationTokenForEmail(email: string, durationHours = EMAIL_VERIFICATION_EXPIRY_HOURS) {
  const db = await readDb();
  const normalizedEmail = normalizeEmail(email);
  const userIndex = db.users.findIndex((user) => normalizeEmail(user.email) === normalizedEmail);
  if (userIndex === -1) {
    return null;
  }

  if (db.users[userIndex].emailVerified === true) {
    return {
      skipped: "already_verified" as const,
      user: db.users[userIndex],
    };
  }

  const token = randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
  const sentAt = nowIso();
  db.users[userIndex] = {
    ...db.users[userIndex],
    emailVerificationTokenHash: tokenHash,
    emailVerificationTokenExpiresAt: expiresAt,
    emailVerificationSentAt: sentAt,
    updatedAt: sentAt,
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return {
    skipped: null,
    token,
    expiresAt,
    user: db.users[userIndex],
  };
}

export async function consumeEmailVerificationToken(rawToken: string) {
  const token = String(rawToken ?? "").trim();
  if (!token) return { status: "invalid" as const };

  const db = await readDb();
  const candidateHash = hashToken(token);
  const now = Date.now();

  for (let index = 0; index < db.users.length; index += 1) {
    const user = db.users[index];
    if (!user.emailVerificationTokenHash) continue;
    if (!constantTimeHexEquals(user.emailVerificationTokenHash, candidateHash)) continue;

    const expiresAt = user.emailVerificationTokenExpiresAt ? new Date(user.emailVerificationTokenExpiresAt).getTime() : 0;
    if (!expiresAt || Number.isNaN(expiresAt) || expiresAt <= now) {
      db.users[index] = {
        ...user,
        emailVerificationTokenHash: undefined,
        emailVerificationTokenExpiresAt: undefined,
        updatedAt: nowIso(),
      };
      await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
      return { status: "expired" as const };
    }

    const verifiedAt = nowIso();
    db.users[index] = {
      ...user,
      emailVerified: true,
      emailVerifiedAt: verifiedAt,
      emailVerificationTokenHash: undefined,
      emailVerificationTokenExpiresAt: undefined,
      updatedAt: verifiedAt,
    };
    await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
    return { status: "verified" as const, user: db.users[index] };
  }

  return { status: "invalid" as const };
}

export async function updateUserPassword(userId: string, passwordHash: string) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === userId);
  if (index === -1) throw new Error("User not found.");
  db.users[index] = {
    ...db.users[index],
    passwordHash,
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
}

export async function updateUserSellerSettings(input: {
  userId: string;
  fullName?: string;
  whatsappNumber?: string;
  preferredNetworks?: SupportedNetwork[];
  profilePhotoUrl?: string;
  coverBannerUrl?: string;
  languages?: string[];
  bio?: string;
  tradingExperience?: string;
  workingHours?: string;
  preferredPaymentMethods?: string[];
  country?: string;
  city?: string;
  onlineStatus?: SellerOnlineStatus;
  isProfileHidden?: boolean;
  showTradeStats?: boolean;
  showLastActive?: boolean;
  allowDirectMessages?: boolean;
  allowProfileSearch?: boolean;
  showPhonePublic?: boolean;
  showEmailPublic?: boolean;
}) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  db.users[index] = {
    ...user,
    fullName: input.fullName?.trim() || user.fullName,
    whatsappNumber: input.whatsappNumber?.trim() || user.whatsappNumber,
    preferredNetworks: input.preferredNetworks ?? user.preferredNetworks,
    profilePhotoUrl: input.profilePhotoUrl?.trim() ?? user.profilePhotoUrl,
    coverBannerUrl: input.coverBannerUrl?.trim() ?? user.coverBannerUrl,
    languages: input.languages?.map((language) => String(language).trim()).filter(Boolean) ?? user.languages,
    bio: input.bio?.trim() ?? user.bio,
    tradingExperience: input.tradingExperience?.trim() ?? user.tradingExperience,
    workingHours: input.workingHours?.trim() ?? user.workingHours,
    preferredPaymentMethods: input.preferredPaymentMethods?.map((item) => String(item).trim()).filter(Boolean) ?? user.preferredPaymentMethods,
    country: input.country?.trim() ?? user.country,
    city: input.city?.trim() ?? user.city,
    onlineStatus: input.onlineStatus ?? user.onlineStatus,
    isProfileHidden: typeof input.isProfileHidden === "boolean" ? input.isProfileHidden : user.isProfileHidden,
    showTradeStats: typeof input.showTradeStats === "boolean" ? input.showTradeStats : user.showTradeStats,
    showLastActive: typeof input.showLastActive === "boolean" ? input.showLastActive : user.showLastActive,
    allowDirectMessages: typeof input.allowDirectMessages === "boolean" ? input.allowDirectMessages : user.allowDirectMessages,
    allowProfileSearch: typeof input.allowProfileSearch === "boolean" ? input.allowProfileSearch : user.allowProfileSearch,
    showPhonePublic: typeof input.showPhonePublic === "boolean" ? input.showPhonePublic : user.showPhonePublic,
    showEmailPublic: typeof input.showEmailPublic === "boolean" ? input.showEmailPublic : user.showEmailPublic,
    lastActiveAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (isTrustEligibleSeller(db.users[index])) {
    await recalculateTrustEngine(db, { reason: "Seller profile updated", triggeredBy: input.userId });
  }
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  if (input.onlineStatus && input.onlineStatus !== user.onlineStatus) {
    publishRealtimeEvent({ type: "seller.status_changed", payload: { sellerId: input.userId, onlineStatus: input.onlineStatus } });
  }
  return db.users[index];
}

export async function findUserByEmail(email: string) {
  const db = await readDb();
  const normalized = normalizeEmail(email);
  return db.users.find((user) => normalizeEmail(user.email) === normalized) ?? null;
}

export async function findUsersByEmail(email: string) {
  const db = await readDb();
  const normalized = normalizeEmail(email);
  return db.users.filter((user) => normalizeEmail(user.email) === normalized);
}

export async function getCommissionResetTraceByEmail(email: string) {
  const db = await readDb({ bypassCache: true });
  const normalizedEmail = normalizeEmail(email);
  const users = db.users.filter((user) => normalizeEmail(user.email) === normalizedEmail);
  const sellerUserIds = new Set(users.map((user) => user.id));

  const commissionRecords = db.commissionRecords
    .filter((record) => sellerUserIds.has(record.sellerId))
    .map((record) => {
      const request = db.purchaseRequests.find((item) => item.id === record.purchaseRequestId);
      const normalizedPaymentStatus = normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt);
      const amountDueUsdt = getCommissionAmountDueUsdt(db, record);
      return {
        commissionId: record.id,
        sellerId: record.sellerId,
        tradeId: request?.tradeId ?? request?.id ?? record.purchaseRequestId,
        tradeDisplayNumber: request?.displayNumber,
        paymentStatus: normalizedPaymentStatus,
        rawPaymentStatus: record.paymentStatus,
        amountDueUsdt,
        locked: normalizedPaymentStatus !== "paid",
        createdAt: record.createdAt,
      };
    });

  const sellerStates = users.map((user) => {
    const pendingRecords = db.commissionRecords
      .filter((record) => record.sellerId === user.id)
      .map((record) => ({
        ...record,
        paymentStatus: normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt),
      }))
      .filter((record) => record.paymentStatus !== "paid");
    const pendingCount = pendingRecords.length;
    const amountDue = pendingRecords.reduce((sum, record) => sum + getCommissionAmountDueUsdt(db, record), 0);
    const blockedReason = getSellerListingBlockReason(db, user.id);
    return {
      userId: user.id,
      normalizedEmail: normalizeEmail(user.email),
      role: user.role,
      pendingCommissionCount: pendingCount,
      commissionDueUsdt: Number(amountDue.toFixed(2)),
      sellerLocked: pendingCount > 0 || blockedReason !== null,
      canCreateListing: blockedReason === null,
      blockedReason,
    };
  });

  const globalPendingCommissions = db.commissionRecords
    .map((record) => ({
      record,
      normalizedPaymentStatus: normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt),
    }))
    .filter((item) => item.normalizedPaymentStatus !== "paid")
    .slice(0, 100)
    .map((item) => {
      const seller = db.users.find((user) => user.id === item.record.sellerId);
      const request = db.purchaseRequests.find((r) => r.id === item.record.purchaseRequestId);
      return {
        commissionId: item.record.id,
        sellerId: item.record.sellerId,
        sellerEmail: seller?.email ?? null,
        sellerNormalizedEmail: seller ? normalizeEmail(seller.email) : null,
        tradeId: request?.tradeId ?? request?.id ?? item.record.purchaseRequestId,
        tradeDisplayNumber: request?.displayNumber,
        paymentStatus: item.normalizedPaymentStatus,
        amountDueUsdt: getCommissionAmountDueUsdt(db, item.record),
        createdAt: item.record.createdAt,
      };
    });

  return {
    queryUsedBySellerDashboard: "GET /api/alpha-exchange/my-listings -> getSellerCommissionStatus(user.id) + getSellerListingWorkspaceSummary(user.id)",
    queryUsedByResetEndpoint: "POST /api/alpha-exchange/admin/commissions/reset-by-email -> clearSellerCommissionDuesByAdmin(sellerUserIds)",
    requestedEmail: email,
    normalizedEmail,
    users: users.map((user) => ({
      userId: user.id,
      normalizedEmail: normalizeEmail(user.email),
      role: user.role,
    })),
    commissionRecords,
    sellerStates,
    globalPendingCommissions,
  };
}

export async function findUserById(userId: string) {
  const db = await readDb();
  return db.users.find((user) => user.id === userId) ?? null;
}

export async function createAuthSession(userId: string, token: string, durationDays = 14) {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  const session: AuthSession = {
    token: hashToken(token),
    userId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const repository = await getAlphaExchangeRepository();
  await repository.upsertAuthSession(session);
  const cachedSessions = dbCache?.value.authSessions ?? [];
  syncCachedAuthSessions([...cachedSessions.filter((item) => item.userId !== userId && item.token !== session.token), session]);
  return session;
}

export async function getSessionByToken(token: string) {
  const hashed = hashToken(token);
  const repository = await getAlphaExchangeRepository();
  const session = await repository.getAuthSession(hashed);
  if (!session) {
    return null;
  }
  if (new Date(session.expiresAt) < new Date()) {
    await repository.deleteAuthSession(hashed);
    const cachedSessions = dbCache?.value.authSessions ?? [];
    syncCachedAuthSessions(cachedSessions.filter((item) => item.token !== hashed));
    return null;
  }
  return session;
}

export async function deleteSessionByToken(token: string) {
  const hashed = hashToken(token);
  const repository = await getAlphaExchangeRepository();
  await repository.deleteAuthSession(hashed);
  const cachedSessions = dbCache?.value.authSessions ?? [];
  syncCachedAuthSessions(cachedSessions.filter((item) => item.token !== hashed));
}

export async function createPasswordResetToken(userId: string, rawToken: string, durationMinutes = 30) {
  const db = await readDb();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + durationMinutes * 60 * 1000);
  const reset: PasswordResetToken = {
    id: `pwd-reset-${randomUUID()}`,
    userId,
    tokenHash: hashToken(rawToken),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.userId !== userId);
  db.passwordResetTokens.push(reset);
  await writeDb(db, { selectedTables: LISTING_WRITE_TABLES });
  return reset;
}

export async function consumePasswordResetToken(rawToken: string) {
  const db = await readDb();
  const hashed = hashToken(rawToken);
  const token = db.passwordResetTokens.find((item) => item.tokenHash === hashed);
  if (!token) return null;
  if (new Date(token.expiresAt) < new Date()) {
    db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.tokenHash !== hashed);
    await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
    return null;
  }
  db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.tokenHash !== hashed);
  await writeDb(db, { selectedTables: PURCHASE_REQUEST_CREATE_TABLES });
  return token;
}

export async function createSellerApplication(input: {
  userId: string;
  fullName: string;
  email: string;
  whatsappNumber: string;
  preferredNetworks: string[];
  expectedMonthlyTradingVolume: string;
  additionalNotes: string;
}) {
  const fullName = input.fullName.trim();
  const whatsappNumber = input.whatsappNumber.trim();
  const preferredNetworks = input.preferredNetworks
    .map((network) => String(network))
    .map((network) => network.trim())
    .filter(Boolean);

  if (!fullName) throw new Error("Full name is required.");
  if (!whatsappNumber) throw new Error("WhatsApp number is required.");
  if (preferredNetworks.length === 0) throw new Error("At least one selling method is required.");

  const db = await readDb();
  const now = nowIso();
  const user = db.users.find((item) => item.id === input.userId);
  if (!user) throw new Error("Account not found.");
  if (isAlphaExchangeOwnerEmail(user.email)) throw new Error("Owner accounts cannot submit seller applications.");
  if (hasRole(user, "admin")) throw new Error("Administrator accounts cannot submit seller applications.");
  if (!hasRole(user, "buyer")) throw new Error("Buyer verification required before seller application.");
  if (user.sellerStatus === "approved_seller") throw new Error("You are already an approved seller.");
  if (user.sellerStatus === "suspended") throw new Error("Your account is suspended.");
  if (user.sellerStatus === "pending_seller_approval") throw new Error("Your seller application is already pending review.");

  const existingIndex = db.sellerApplications.findIndex((item) => item.userId === input.userId);
  if (existingIndex >= 0 && db.sellerApplications[existingIndex].status === "pending") {
    throw new Error("Your seller application is already pending review.");
  }
  const next: SellerApplication = {
    id: existingIndex >= 0 ? db.sellerApplications[existingIndex].id : `seller-app-${randomUUID()}`,
    userId: input.userId,
    fullName,
    email: normalizeEmail(input.email),
    whatsappNumber,
    preferredNetworks,
    expectedMonthlyTradingVolume: input.expectedMonthlyTradingVolume.trim(),
    additionalNotes: input.additionalNotes.trim(),
    status: "pending",
    createdAt: existingIndex >= 0 ? db.sellerApplications[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    db.sellerApplications[existingIndex] = next;
  } else {
    db.sellerApplications.push(next);
  }

  const userIndex = db.users.findIndex((user) => user.id === input.userId);
  if (userIndex >= 0) {
    const nextRoles = addRole(removeRole(db.users[userIndex].roles ?? [db.users[userIndex].role], "guest"), "pending_seller_approval");
    db.users[userIndex] = {
      ...db.users[userIndex],
      sellerStatus: "pending_seller_approval",
      roles: nextRoles,
      role: resolvePrimaryRole(nextRoles),
      onboardingSelection: "seller_applicant",
      onboardingCompletedAt: db.users[userIndex].onboardingCompletedAt ?? now,
      updatedAt: now,
    };
  }

  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "application",
      title: "New Approved Seller Application",
      message: `${next.fullName} has applied to become an Approved Seller.`,
      actionLabel: "Review Application",
      relatedHref: `/admin/alpha-exchange?section=seller-applications&sellerApplication=${encodeURIComponent(next.id)}`,
    });
  }
  pushActivityLog(db, {
    userId: input.userId,
    category: "application",
    title: "Seller application submitted",
    details: "Your seller application is pending owner review.",
  });

  await writeDb(db, { selectedTables: SELLER_APPLICATION_REVIEW_TABLES });
  return next;
}

export async function getSellerApplicationByUserId(userId: string, dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.sellerApplications.find((item) => item.userId === userId) ?? null;
}

export async function getPendingSellerApplicationsForAdmin() {
  const db = await readDb();
  return db.sellerApplications.filter((item) => item.status === "pending");
}

export async function getAllSellerApplicationsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.sellerApplications;
}

export async function approveSellerApplicationByAdmin(applicationId: string, adminUserId: string, reason?: string) {
  const db = await readDb();
  const applicationIndex = db.sellerApplications.findIndex((item) => item.id === applicationId);
  if (applicationIndex === -1) throw new Error("Seller application not found.");

  const application = db.sellerApplications[applicationIndex];
  db.sellerApplications[applicationIndex] = {
    ...application,
    status: "approved",
    updatedAt: nowIso(),
  };

  const userIndex = db.users.findIndex((user) => user.id === application.userId);
  if (userIndex === -1) throw new Error("Application user not found.");
  const nextRoles = addRole(removeRole(db.users[userIndex].roles ?? [db.users[userIndex].role], "pending_seller_approval"), "approved_seller");
  db.users[userIndex] = {
    ...db.users[userIndex],
    roles: nextRoles,
    role: resolvePrimaryRole(nextRoles),
    sellerStatus: "approved_seller",
    isFoundingSeller: db.users[userIndex].isFoundingMember === true ? true : db.users[userIndex].isFoundingSeller === true,
    updatedAt: nowIso(),
  };

  await appendAuditLog(db, {
    action: "seller_approved",
    actorUserId: adminUserId,
    targetUserId: application.userId,
    details: `Approved seller application ${application.id}`,
    reason: reason?.trim() || undefined,
  });
  pushNotification(db, {
    userId: application.userId,
    category: "application",
    title: "Seller application approved",
    message: "Your seller account is approved and now active.",
    relatedHref: "/usdt-exchange",
  });
  pushActivityLog(db, {
    userId: application.userId,
    category: "application",
    title: "Application approved",
    details: "You can now create listings as an approved seller.",
  });
  await recalculateTrustEngine(db, { reason: "Seller approved", triggeredBy: adminUserId });

  await writeDb(db, { selectedTables: SELLER_APPLICATION_REVIEW_TABLES });
  return db.sellerApplications[applicationIndex];
}

export async function rejectSellerApplicationByAdmin(applicationId: string, adminUserId: string, reason?: string) {
  const db = await readDb();
  const applicationIndex = db.sellerApplications.findIndex((item) => item.id === applicationId);
  if (applicationIndex === -1) throw new Error("Seller application not found.");

  const application = db.sellerApplications[applicationIndex];
  db.sellerApplications[applicationIndex] = {
    ...application,
    status: "rejected",
    updatedAt: nowIso(),
  };

  const userIndex = db.users.findIndex((user) => user.id === application.userId);
  if (userIndex >= 0) {
    const nextRoles = removeRole(db.users[userIndex].roles ?? [db.users[userIndex].role], "pending_seller_approval");
    db.users[userIndex] = {
      ...db.users[userIndex],
      roles: nextRoles.length > 0 ? nextRoles : ["buyer"],
      role: resolvePrimaryRole(nextRoles.length > 0 ? nextRoles : ["buyer"]),
      sellerStatus: "rejected",
      updatedAt: nowIso(),
    };
  }

  await appendAuditLog(db, {
    action: "seller_rejected",
    actorUserId: adminUserId,
    targetUserId: application.userId,
    details: `Rejected seller application ${application.id}`,
    reason: reason?.trim() || undefined,
  });
  pushNotification(db, {
    userId: application.userId,
    category: "application",
    title: "Seller application rejected",
    message: "Your seller application was rejected.",
    relatedHref: "/usdt-exchange",
  });
  pushActivityLog(db, {
    userId: application.userId,
    category: "application",
    title: "Application rejected",
    details: "You can update details and apply again.",
  });
  await recalculateTrustEngine(db, { reason: "Seller application rejected", triggeredBy: adminUserId });

  await writeDb(db, { selectedTables: SELLER_APPLICATION_REVIEW_TABLES });
  return db.sellerApplications[applicationIndex];
}

export async function suspendApprovedSellerByAdmin(userId: string, adminUserId: string, reason?: string) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === userId);
  if (userIndex === -1) throw new Error("User not found.");
  const user = db.users[userIndex];
  if (hasRole(user, "owner")) throw new Error("Owner account cannot be suspended.");
  db.users[userIndex] = {
    ...user,
    sellerStatus: "suspended",
    updatedAt: nowIso(),
  };

  await appendAuditLog(db, {
    action: "seller_suspended",
    actorUserId: adminUserId,
    targetUserId: userId,
    details: `Suspended seller ${userId}`,
    reason: reason?.trim() || undefined,
  });
  await recalculateTrustEngine(db, { reason: "Seller suspended", triggeredBy: adminUserId });

  await writeDb(db, { selectedTables: SELLER_STATUS_TRUST_TABLES });
  return db.users[userIndex];
}

export async function reactivateSellerByAdmin(userId: string, adminUserId: string, reason?: string) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === userId);
  if (userIndex === -1) throw new Error("User not found.");
  const user = db.users[userIndex];
  if (hasRole(user, "owner")) throw new Error("Owner account cannot be modified.");
  const nextRoles = addRole(removeRole(user.roles ?? [user.role], "pending_seller_approval"), "approved_seller");
  db.users[userIndex] = {
    ...user,
    roles: nextRoles,
    role: resolvePrimaryRole(nextRoles),
    sellerStatus: "approved_seller",
    updatedAt: nowIso(),
  };

  await appendAuditLog(db, {
    action: "seller_reactivated",
    actorUserId: adminUserId,
    targetUserId: userId,
    details: `Reactivated seller ${userId}`,
    reason: reason?.trim() || undefined,
  });
  await recalculateTrustEngine(db, { reason: "Seller reactivated", triggeredBy: adminUserId });

  await writeDb(db, { selectedTables: SELLER_STATUS_TRUST_TABLES });
  return db.users[userIndex];
}

export async function getApprovedSellersForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.users.filter((user) => user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended");
}

export async function getHallOfFameEntries() {
  const db = await readDb();
  return db.users
    .filter((user) => (user.sellerPrestigeRank ?? "bronze") === "legendary")
    .map((user) => buildHallOfFameEntry(db, user))
    .sort((left, right) => new Date(right.promotedAt).getTime() - new Date(left.promotedAt).getTime());
}

export async function overrideSellerPrestigeByAdmin(input: {
  sellerId: string;
  adminUserId: string;
  rank: SellerLevel;
  reason: string;
  clearOverride?: boolean;
}) {
  const db = await readDb();
  const sellerIndex = db.users.findIndex((user) => user.id === input.sellerId);
  if (sellerIndex === -1) throw new Error("Seller not found.");
  const seller = db.users[sellerIndex];
  if (!isTrustEligibleSeller(seller)) throw new Error("Prestige can be changed only for approved sellers.");
  if (hasRole(seller, "owner")) throw new Error("Owner account cannot be modified.");

  const now = nowIso();
  const previousRank = seller.sellerPrestigeRank ?? "bronze";
  const previousOverride = seller.sellerRankOverride;
  const reason = input.reason.trim();
  if (!input.clearOverride && !reason) throw new Error("Override reason is required.");

  const nextRank = input.clearOverride
    ? resolveSellerPrestigeRank(Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? 0)))
    : input.rank;
  const historyEntry: SellerPromotionHistoryEntry = {
    id: `promotion-${randomUUID()}`,
    rank: nextRank,
    previousRank,
    promotedAt: now,
    lifetimeCompletedVolumeUsdt: Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? 0)),
    source: "admin_override",
    reason: reason || "Admin override cleared",
    actorUserId: input.adminUserId,
  };
  db.users[sellerIndex] = {
    ...seller,
    sellerPrestigeRank: nextRank,
    sellerRankOverride: input.clearOverride
      ? undefined
      : {
          rank: input.rank,
          reason,
          setAt: now,
          setByUserId: input.adminUserId,
        },
    sellerPromotionHistory: [historyEntry, ...(seller.sellerPromotionHistory ?? [])].slice(0, 200),
    updatedAt: now,
  };
  await appendAuditLog(db, {
    action: "seller_prestige_overridden",
    actorUserId: input.adminUserId,
    targetUserId: input.sellerId,
    details: input.clearOverride
      ? `Cleared prestige override. Rank recalculated to ${nextRank}.`
      : `Set seller prestige rank to ${input.rank}.`,
    oldValue: {
      rank: previousRank,
      override: previousOverride,
    },
    newValue: {
      rank: nextRank,
      override: input.clearOverride ? null : { rank: input.rank, reason },
    },
    reason: reason || "Admin override cleared",
  });
  pushNotification(db, {
    userId: input.sellerId,
    category: "trust",
    title: input.clearOverride ? "Prestige override removed" : "Prestige rank updated by admin",
    message: input.clearOverride
      ? `Your prestige rank is now ${nextRank} based on completed volume.`
      : `Your prestige rank was set to ${input.rank} by Alpha Traders admin.`,
  });
  await recalculateTrustEngine(db, { reason: "Admin prestige override", triggeredBy: input.adminUserId });
  await writeDb(db, { selectedTables: SELLER_PRESTIGE_TABLES });
  return db.users[sellerIndex];
}

export async function getMarketplaceListings(status?: string) {
  const db = await readDb();
  const nowMs = Date.now();
  const sellerById = new Map(db.users.map((user) => [user.id, user]));
  const sellersBlockedByCommission = new Set(
    db.commissionRecords
      .filter((record) => normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt) !== "paid")
      .map((record) => record.sellerId),
  );
  const hiddenSellerIds = new Set(
    db.users
      .filter((user) => user.isProfileHidden === true || user.sellerStatus === "suspended")
      .map((user) => user.id),
  );
  const rawListings =
    !status || status === "all"
      ? db.marketplaceListings.filter((listing) => {
          if (!canListingReceiveRequests(listing)) return false;
          if (hiddenSellerIds.has(listing.sellerId)) return false;
          if (sellersBlockedByCommission.has(listing.sellerId)) return false;
          const seller = sellerById.get(listing.sellerId);
          if (!seller || seller.sellerStatus !== "approved_seller") return false;
          if (isSellerUnavailableForNewBuyers(seller.availabilityStatus)) return false;
          if (toNumber(listing.availableAmount) <= 0) return false;
          if (listing.expiresAt) {
            const expiresMs = new Date(listing.expiresAt).getTime();
            if (expiresMs && !Number.isNaN(expiresMs) && expiresMs <= nowMs) return false;
          }
          return true;
        })
      : db.marketplaceListings.filter((listing) => listing.status === status && !hiddenSellerIds.has(listing.sellerId));
  const sortedListings = qualitySortListings(db, rawListings);
  return enrichListingsWithSellerData(db, sortedListings);
}

export async function updateSellerProfileStateByAdmin(input: {
  sellerId: string;
  adminUserId: string;
  feature?: boolean;
  hidden?: boolean;
}) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.sellerId);
  if (index === -1) throw new Error("Seller not found.");
  const seller = db.users[index];
  if (hasRole(seller, "owner")) throw new Error("Owner account cannot be modified.");
  if (seller.sellerStatus !== "approved_seller" && seller.sellerStatus !== "suspended") {
    throw new Error("Seller profile state can be managed only for approved sellers.");
  }
  const nextFeatured = typeof input.feature === "boolean" ? input.feature : seller.isFeaturedSeller === true;
  const nextHidden = typeof input.hidden === "boolean" ? input.hidden : seller.isProfileHidden === true;
  db.users[index] = {
    ...seller,
    isFeaturedSeller: nextFeatured,
    isProfileHidden: nextHidden,
    updatedAt: nowIso(),
  };

  if (seller.isFeaturedSeller !== nextFeatured) {
    await appendAuditLog(db, {
      action: "seller_featured",
      actorUserId: input.adminUserId,
      targetUserId: seller.id,
      details: `${nextFeatured ? "Featured" : "Unfeatured"} seller profile.`,
    });
  }
  if (seller.isProfileHidden !== nextHidden) {
    await appendAuditLog(db, {
      action: nextHidden ? "seller_hidden" : "seller_unhidden",
      actorUserId: input.adminUserId,
      targetUserId: seller.id,
      details: `${nextHidden ? "Hidden" : "Unhidden"} seller profile.`,
    });
  }

  await writeDb(db, { selectedTables: SELLER_PROFILE_STATE_TABLES });
  return db.users[index];
}

export async function getMarketplaceListingsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return enrichListingsWithSellerData(db, db.marketplaceListings);
}

export async function getPendingMarketplaceListingsForOwner(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const pending = db.marketplaceListings.filter((listing) => isListingPendingApproval(listing));
  return enrichListingsWithSellerData(db, pending);
}

export async function getMarketplaceListingById(id: string) {
  const db = await readDb();
  const listing = db.marketplaceListings.find((item) => item.id === id);
  if (!listing) return null;
  const [enriched] = enrichListingsWithSellerData(db, [listing]);
  return enriched ?? null;
}

function isListingCreateProfilingEnabled() {
  return process.env.ALPHA_EXCHANGE_PROFILE_LISTING_CREATE === "1";
}
function createStoreProfileLogger(scope: string) {
  const startedAt = Date.now();
  return (stage: string) => {
    if (!isListingCreateProfilingEnabled()) return;
    console.log(`[alpha-exchange-profile] ${scope} ${stage} +${Date.now() - startedAt}ms`);
  };
}
export async function createMarketplaceListing(input: {
  sellerId: string;
  sellerDisplayName: string;
  photos?: string[];
  availableAmount: string;
  price: string;
  currency?: string;
  network: SupportedNetwork;
  paymentMethod?: string;
  paymentMethods?: string[];
  bankName?: string;
  minimumTrade?: string;
  maximumTrade?: string;
  expiresAt?: string;
  expirationHours?: number | string;
  notes?: string;
  sellerDescription?: string;
  responseTime: string;
  acceptedCommissionPolicy?: boolean;
  actorUserId: string;
}) {
  const logProfile = createStoreProfileLogger("createMarketplaceListing");
  const { db, fromCache } = await readDbForListingCreation();
  logProfile("readDb");
  if (!input.acceptedCommissionPolicy) {
    throw new Error("You must confirm Alpha Traders 1% commission policy before publishing a listing.");
  }
  const blockReason = getSellerListingBlockReason(db, input.sellerId);
  if (blockReason) throw new Error(blockReason);
  logProfile("getSellerListingBlockReason");
  const now = nowIso();
  const expiresAt = input.expiresAt?.trim() || getListingExpirationIso(now, input.expirationHours);
  const listingPaymentMethods = resolveListingPaymentMethods(input.paymentMethods, input.paymentMethod).slice(0, MAX_LISTING_PAYMENT_METHODS);
  if (!listingPaymentMethods.length) {
    throw new Error("A valid payment method is required (Bank Transfer, Face-to-Face, or Cardless ATM Withdrawal).");
  }
  if (resolveListingPaymentMethods(input.paymentMethods, input.paymentMethod).length > MAX_LISTING_PAYMENT_METHODS) {
    throw new Error(`Select no more than ${MAX_LISTING_PAYMENT_METHODS} payment methods per listing.`);
  }
  const primaryPaymentMethod = listingPaymentMethods[0];
  const listingBanks = parseIsraeliBankSelection(input.bankName);
  if (requiresIsraeliBankSelection(listingPaymentMethods)) {
    if (!listingBanks.length) {
      throw new Error("Please choose one or two supported banks before publishing the listing.");
    }
    if (listingBanks.length > MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS) {
      throw new Error(`Select no more than ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} supported banks per listing.`);
    }
  }
  const listing: MarketplaceListing = {
    id: `listing-${randomUUID()}`,
    sellerId: input.sellerId,
    sellerDisplayName: input.sellerDisplayName,
    photos: (input.photos ?? []).map((photo) => String(photo).trim()).filter(Boolean).slice(0, 6),
    originalAmount: input.availableAmount.trim(),
    availableAmount: input.availableAmount.trim(),
    price: input.price.trim(),
    currency: input.currency?.trim() || "ILS",
    network: input.network,
    paymentMethods: listingPaymentMethods,
    paymentMethod: primaryPaymentMethod,
    bankName: requiresIsraeliBankSelection(listingPaymentMethods) ? serializeIsraeliBankSelection(listingBanks) || undefined : undefined,
    minimumTrade: input.minimumTrade?.trim() || "0",
    maximumTrade: input.maximumTrade?.trim() || input.availableAmount.trim(),
    expiresAt,
    notes: input.notes?.trim() || "",
    sellerDescription: input.sellerDescription?.trim() || "",
    responseTime: input.responseTime.trim() || "5 min",
    status: "draft",
    approvalStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };
  listing.paymentMethod = listing.paymentMethods[0] ?? "Bank Transfer";
  db.marketplaceListings.push(listing);
  // Assign display numbers for the new listing (ensureDisplayNumbers is idempotent
  // for items that already have a number, so existing listings are unaffected).
  ensureDisplayNumbers(db);
  logProfile("buildListing");

  // Snapshot array lengths before any mutations so we can compute the delta afterwards.
  const auditCountBefore = db.auditLogs.length;
  const notifCountBefore = db.notifications.length;
  const activityCountBefore = db.activityLog.length;
  const trustHistoryCountBefore = db.trustScoreHistory.length;

  await appendAuditLog(db, {
    action: "listing_created",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    listingId: listing.id,
    details: `Created listing ${listing.id} with ${listing.availableAmount} USDT available.`,
  });
  logProfile("appendAuditLog");
  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "listing",
      title: "New Listing Pending Review",
      message: `${input.sellerDisplayName} submitted listing ${listing.id} for admin approval.`,
      relatedListingId: listing.id,
      relatedHref: "/admin/alpha-exchange?tab=listings&status=draft",
    });
  }
  logProfile("pushNotification");
  pushActivityLog(db, {
    userId: input.sellerId,
    category: "listing",
    title: "Listing submitted for review",
    details: `Listing ${listing.id} is pending admin approval before going live.`,
  });
  logProfile("pushActivityLog");
  await recalculateTrustEngine(db, { reason: "Listing created", triggeredBy: input.actorUserId });
  logProfile("recalculateTrustEngine");

  // Compute deltas — new entries were prepended via unshift so they sit at the front.
  const newAuditLogs = db.auditLogs.slice(0, db.auditLogs.length - auditCountBefore);
  const newNotifications = db.notifications.slice(0, db.notifications.length - notifCountBefore);
  const newActivityLogs = db.activityLog.slice(0, db.activityLog.length - activityCountBefore);
  const newTrustHistoryEntries = db.trustScoreHistory.slice(0, db.trustScoreHistory.length - trustHistoryCountBefore);

  await writeDbForListingCreation(db, {
    newListing: listing,
    newAuditLogs,
    newNotifications,
    newActivityLogs,
    newTrustHistoryEntries,
    updatedTrustSnapshots: db.trustSnapshots,
  }, fromCache);
  logProfile("writeDbForListingCreation");
  publishRealtimeEvent({ type: "listing.created", payload: { listing } });
  logProfile("publishRealtimeEvent");
  return listing;
}

export async function updateMarketplaceListingForSeller(input: {
  listingId: string;
  sellerId: string;
  actorUserId: string;
  photos?: string[];
  availableAmount?: string;
  price?: string;
  currency?: string;
  network?: SupportedNetwork;
  paymentMethod?: string;
  paymentMethods?: string[];
  bankName?: string;
  minimumTrade?: string;
  maximumTrade?: string;
  expiresAt?: string;
  expirationHours?: number | string;
  notes?: string;
  sellerDescription?: string;
  responseTime?: string;
  status?: ListingStatus;
}) {
  const db = await readDb();
  const index = db.marketplaceListings.findIndex((listing) => listing.id === input.listingId);
  if (index === -1) throw new Error("Listing not found.");
  const current = db.marketplaceListings[index];
  if (current.sellerId !== input.sellerId) throw new Error("You can edit only your own listings.");
  if (isListingLocked(current.status)) {
    throw new Error("This listing is locked by an active trade and cannot be edited right now.");
  }
  if (current.status === "completed" || current.status === "cancelled" || current.status === "closed") {
    throw new Error("This listing is no longer editable.");
  }
  if (input.status && input.status !== "active" && input.status !== "paused") {
    throw new Error("Sellers can only switch listings between active and paused.");
  }
  if (current.status === "draft" && input.status === "active") {
    throw new Error("Pending approval listings cannot be activated by sellers.");
  }
  const shouldResubmitForApproval = current.status === "draft" && (
    current.approvalStatus === "rejected" || current.approvalStatus === "changes_requested"
  );
  const updatedAt = nowIso();
  const normalizedPaymentMethods = input.paymentMethods
    ? resolveListingPaymentMethods(input.paymentMethods, input.paymentMethod).slice(0, MAX_LISTING_PAYMENT_METHODS)
    : (input.paymentMethod ? resolveListingPaymentMethods(undefined, input.paymentMethod).slice(0, MAX_LISTING_PAYMENT_METHODS) : undefined);
  if (input.paymentMethods && resolveListingPaymentMethods(input.paymentMethods, input.paymentMethod).length > MAX_LISTING_PAYMENT_METHODS) {
    throw new Error(`Select no more than ${MAX_LISTING_PAYMENT_METHODS} payment methods per listing.`);
  }
  const nextPaymentMethods = normalizedPaymentMethods?.length
    ? normalizedPaymentMethods
    : (current.paymentMethods?.length ? current.paymentMethods : resolveListingPaymentMethods(undefined, current.paymentMethod));
  const nextPaymentMethod = nextPaymentMethods[0] ?? normalizeMarketplacePaymentMethod(current.paymentMethod) ?? "Bank Transfer";
  const nextRequiresBankSelection = requiresIsraeliBankSelection(nextPaymentMethods, nextPaymentMethod);
  const nextBankSelection = input.bankName !== undefined
    ? parseIsraeliBankSelection(input.bankName)
    : parseIsraeliBankSelection(current.bankName);
  if (nextRequiresBankSelection) {
    if (!nextBankSelection.length) {
      throw new Error("Please choose one or two supported banks before saving the listing.");
    }
    if (nextBankSelection.length > MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS) {
      throw new Error(`Select no more than ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} supported banks per listing.`);
    }
  }

  const next: MarketplaceListing = {
    ...current,
    photos: input.photos ? input.photos.map((photo) => String(photo).trim()).filter(Boolean).slice(0, 6) : current.photos,
    originalAmount: input.availableAmount?.trim() || current.originalAmount,
    availableAmount: input.availableAmount?.trim() || current.availableAmount,
    price: input.price?.trim() || current.price,
    currency: input.currency?.trim() || current.currency,
    network: input.network || current.network,
    paymentMethods: nextPaymentMethods,
    paymentMethod: nextPaymentMethod,
    bankName: nextRequiresBankSelection
      ? serializeIsraeliBankSelection(nextBankSelection) || undefined
      : undefined,
    minimumTrade: input.minimumTrade?.trim() || current.minimumTrade,
    maximumTrade: input.maximumTrade?.trim() || current.maximumTrade,
    expiresAt: input.expiresAt?.trim() || (input.expirationHours !== undefined ? getListingExpirationIso(updatedAt, input.expirationHours) : current.expiresAt),
    expiredAt: input.status === "active" ? undefined : current.expiredAt,
    lastRenewedAt: input.status === "active" && current.status === "expired" ? updatedAt : current.lastRenewedAt,
    notes: input.notes?.trim() ?? current.notes,
    sellerDescription: input.sellerDescription?.trim() ?? current.sellerDescription,
    responseTime: input.responseTime?.trim() || current.responseTime,
    status: input.status || current.status,
    approvalStatus: shouldResubmitForApproval
      ? "pending"
      : input.status === "active"
        ? "approved"
        : current.approvalStatus,
    ownerReviewReason: shouldResubmitForApproval ? undefined : current.ownerReviewReason,
    ownerReviewedAt: shouldResubmitForApproval ? undefined : current.ownerReviewedAt,
    ownerReviewedBy: shouldResubmitForApproval ? undefined : current.ownerReviewedBy,
    updatedAt,
  };
  next.paymentMethod = next.paymentMethods[0] ?? next.paymentMethod;
  if (!next.minimumTrade || toNumber(next.minimumTrade) < 0) {
    next.minimumTrade = "0";
  }
  const maxTradeNumber = toNumber(next.maximumTrade);
  const availableAmountNumber = toNumber(next.availableAmount);
  if (!next.maximumTrade || maxTradeNumber <= 0 || (availableAmountNumber > 0 && maxTradeNumber > availableAmountNumber)) {
    next.maximumTrade = next.availableAmount;
  }
  db.marketplaceListings[index] = next;
  await appendAuditLog(db, {
    action: input.status === "paused" ? "listing_paused" : input.status === "active" && current.status === "paused" ? "listing_resumed" : "listing_edited",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    listingId: next.id,
    details:
      shouldResubmitForApproval
        ? `Resubmitted listing ${next.id} for admin approval`
        : input.status === "paused"
        ? `Paused listing ${next.id}`
        : input.status === "active" && current.status === "paused"
          ? `Resumed listing ${next.id}`
          : `Edited listing ${next.id}`,
  });
  if (shouldResubmitForApproval) {
    const owner = getOwnerUser(db);
    if (owner) {
      pushNotification(db, {
        userId: owner.id,
        category: "listing",
        title: "New Listing Pending Review",
        message: `${next.sellerDisplayName} resubmitted listing ${next.id} for admin approval.`,
        relatedListingId: next.id,
        relatedHref: "/admin/alpha-exchange?tab=listings&status=draft",
      });
    }
    pushActivityLog(db, {
      userId: next.sellerId,
      category: "listing",
      title: "Listing resubmitted for review",
      details: `Listing ${next.id} was resubmitted and is pending admin approval.`,
    });
  }
  await recalculateTrustEngine(db, { reason: "Seller listing updated", triggeredBy: input.actorUserId });
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  if (current.availableAmount !== next.availableAmount) {
    publishRealtimeEvent({ type: "listing.quantity_changed", payload: { listingId: next.id, availableAmount: next.availableAmount } });
  }
  if (current.status !== next.status) {
    publishRealtimeEvent({ type: "listing.status_changed", payload: { listingId: next.id, status: next.status } });
  }
  return next;
}

export async function renewMarketplaceListing(input: {
  listingId: string;
  actorUserId: string;
  sellerId?: string;
  expirationHours?: number | string;
  reason?: string;
}) {
  const db = await readDb();
  const index = db.marketplaceListings.findIndex((listing) => listing.id === input.listingId);
  if (index === -1) throw new Error("Listing not found.");
  const listing = db.marketplaceListings[index];
  if (input.sellerId && listing.sellerId !== input.sellerId) throw new Error("You can renew only your own listings.");
  if (input.sellerId) {
    const pendingCommissionCount = getSellerPendingCommissionCount(db, input.sellerId);
    if (pendingCommissionCount > 0) {
      throw new Error("You have commission payments pending. Clear them before renewing this listing.");
    }
  }
  if (isListingLocked(listing.status)) throw new Error("This listing is locked by an active trade and cannot be renewed.");
  if (listing.status === "draft") throw new Error("Pending approval listings cannot be renewed.");
  if (listing.status === "completed" || listing.status === "cancelled" || listing.status === "closed") {
    throw new Error("This listing can no longer be renewed.");
  }
  const now = nowIso();
  const previousStatus = listing.status;
  const previousExpiresAt = listing.expiresAt;
  listing.status = "active";
  listing.expiresAt = getListingExpirationIso(now, input.expirationHours);
  listing.expiredAt = undefined;
  listing.lastRenewedAt = now;
  listing.updatedAt = now;
  listing.activeTradeRequestId = undefined;
  listing.lockedAt = undefined;

  await appendAuditLog(db, {
    action: "listing_renewed",
    actorUserId: input.actorUserId,
    targetUserId: listing.sellerId,
    listingId: listing.id,
    details: `Renewed listing ${listing.id}.`,
    oldValue: { status: previousStatus, expiresAt: previousExpiresAt },
    newValue: { status: listing.status, expiresAt: listing.expiresAt, lastRenewedAt: listing.lastRenewedAt },
    reason: input.reason,
  });
  pushNotification(db, {
    userId: listing.sellerId,
    category: "listing",
    title: "Listing renewed",
    message: `Listing ${listing.id} has been renewed and is live again.`,
    relatedListingId: listing.id,
    relatedHref: "/usdt-exchange",
  });
  await writeDb(db, { selectedTables: LISTING_WRITE_TABLES });
  publishRealtimeEvent({ type: "listing.status_changed", payload: { listingId: listing.id, status: listing.status } });
  return listing;
}

export async function updateSellerAvailabilityStatus(input: {
  sellerId: string;
  actorUserId: string;
  availabilityStatus: SellerAvailabilityStatus;
  reason?: string;
}) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.sellerId);
  if (index === -1) throw new Error("Seller not found.");
  const seller = db.users[index];
  const previousStatus = seller.availabilityStatus;
  if (previousStatus === input.availabilityStatus) return seller;
  db.users[index] = {
    ...seller,
    availabilityStatus: input.availabilityStatus,
    lastActiveAt: nowIso(),
    updatedAt: nowIso(),
  };
  await appendAuditLog(db, {
    action: input.availabilityStatus === "vacation" ? "seller_vacation_enabled" : "seller_vacation_disabled",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: `Seller availability updated to ${input.availabilityStatus}.`,
    oldValue: { availabilityStatus: previousStatus },
    newValue: { availabilityStatus: input.availabilityStatus },
    reason: input.reason,
  });
  pushNotification(db, {
    userId: input.sellerId,
    category: "account",
    title: input.availabilityStatus === "vacation" ? "Vacation enabled" : input.availabilityStatus === "away" ? "Availability updated" : "Vacation disabled",
    message:
      input.availabilityStatus === "vacation"
        ? "Your listings are now hidden from buyers until you switch back to Available or Away."
        : input.availabilityStatus === "away"
          ? "Your seller availability is now set to Away."
          : "Your listings are visible to buyers again.",
    relatedHref: "/usdt-exchange",
  });
  const owner = getOwnerUser(db);
  if (owner && input.availabilityStatus === "vacation") {
    pushNotification(db, {
      userId: owner.id,
      category: "account",
      title: "Seller entered Vacation Mode",
      message: `${seller.fullName} is now in Vacation Mode.`,
      relatedHref: "/admin/alpha-exchange",
    });
  }
  await writeDb(db, { selectedTables: SELLER_STATUS_NOTIFICATION_TABLES });
  publishRealtimeEvent({ type: "seller.status_changed", payload: { sellerId: input.sellerId, onlineStatus: db.users[index].onlineStatus } });
  return db.users[index];
}

export async function adminOverrideMarketplaceListing(input: {
  listingId: string;
  adminUserId: string;
  action: "renew" | "extend" | "close" | "force_close";
  expirationHours?: number | string;
  reason?: string;
}) {
  const db = await readDb();
  const index = db.marketplaceListings.findIndex((listing) => listing.id === input.listingId);
  if (index === -1) throw new Error("Listing not found.");
  const listing = db.marketplaceListings[index];
  const now = nowIso();
  const before = {
    status: listing.status,
    expiresAt: listing.expiresAt,
    expiredAt: listing.expiredAt,
    closedAt: listing.closedAt,
  };
  const activeRequest = listing.activeTradeRequestId
    ? db.purchaseRequests.find((request) => request.id === listing.activeTradeRequestId)
    : undefined;

  if (input.action === "renew") {
    if (isListingLocked(listing.status)) throw new Error("Locked listings cannot be renewed.");
    listing.status = "active";
    listing.expiresAt = getListingExpirationIso(now, input.expirationHours);
    listing.expiredAt = undefined;
    listing.closedAt = undefined;
    listing.lastRenewedAt = now;
  } else if (input.action === "extend") {
    listing.expiresAt = getListingExpirationIso(listing.expiresAt ?? now, input.expirationHours);
  } else if (input.action === "close" || input.action === "force_close") {
    if (input.action === "close" && isListingLocked(listing.status)) throw new Error("Locked listings require force close.");
    listing.status = "closed";
    listing.closedAt = now;
    listing.activeTradeRequestId = undefined;
    listing.lockedAt = undefined;
    if (activeRequest && (input.action === "force_close" || !isListingLocked(before.status))) {
      activeRequest.status = "cancelled";
      activeRequest.updatedAt = now;
      activeRequest.timeoutReason = undefined;
      activeRequest.timedOutAt = undefined;
      appendTradeTimelineEntry(activeRequest, {
        type: "request_cancelled",
        actorUserId: input.adminUserId,
        actorRole: "admin",
        message: input.action === "force_close" ? "Admin force-closed the listing and cancelled the trade" : "Admin closed the listing and cancelled the trade",
        createdAt: now,
      });
      pushNotification(db, {
        userId: activeRequest.buyerId,
        category: "trade",
        title: "Trade cancelled",
        message: `Trade ${activeRequest.tradeId ?? activeRequest.id} was cancelled by an admin listing action.`,
        relatedTradeId: activeRequest.tradeId ?? activeRequest.id,
        relatedListingId: listing.id,
        relatedHref: "/usdt-exchange",
      });
      pushNotification(db, {
        userId: activeRequest.sellerId,
        category: "trade",
        title: "Trade cancelled",
        message: `Trade ${activeRequest.tradeId ?? activeRequest.id} was cancelled by an admin listing action.`,
        relatedTradeId: activeRequest.tradeId ?? activeRequest.id,
        relatedListingId: listing.id,
        relatedHref: "/usdt-exchange",
      });
    }
  }
  listing.updatedAt = now;

  await appendAuditLog(db, {
    action: input.action === "extend" ? "listing_expiration_extended" : input.action === "renew" ? "listing_renewed" : "admin_override",
    actorUserId: input.adminUserId,
    targetUserId: listing.sellerId,
    listingId: listing.id,
    details: `Admin ${input.action.replace("_", " ")} on listing ${listing.id}.`,
    oldValue: before,
    newValue: {
      status: listing.status,
      expiresAt: listing.expiresAt,
      expiredAt: listing.expiredAt,
      closedAt: listing.closedAt,
    },
    reason: input.reason,
  });
  if (input.action === "renew") {
    pushNotification(db, {
      userId: listing.sellerId,
      category: "listing",
      title: "Listing renewed",
      message: `An admin renewed listing ${listing.id}.`,
      relatedListingId: listing.id,
      relatedHref: "/usdt-exchange",
    });
  }
  if (input.action === "extend") {
    pushNotification(db, {
      userId: listing.sellerId,
      category: "listing",
      title: "Listing expiration extended",
      message: `An admin extended the expiration for listing ${listing.id}.`,
      relatedListingId: listing.id,
      relatedHref: "/usdt-exchange",
    });
  }
  if (input.action === "close" || input.action === "force_close") {
    pushNotification(db, {
      userId: listing.sellerId,
      category: "listing",
      title: input.action === "force_close" ? "Listing force closed" : "Listing closed",
      message: `An admin ${input.action === "force_close" ? "force-closed" : "closed"} listing ${listing.id}.`,
      relatedListingId: listing.id,
      relatedHref: "/usdt-exchange",
    });
  }
  if (input.action === "force_close") {
    pushNotification(db, {
      userId: input.adminUserId,
      category: "listing",
      title: "Listing force closed",
      message: `Listing ${listing.id} was force-closed successfully.`,
      relatedListingId: listing.id,
      relatedHref: "/admin/alpha-exchange",
    });
  }
  await writeDb(db, { selectedTables: ADMIN_LISTING_OVERRIDE_TABLES });
  return listing;
}

export async function reviewMarketplaceListingByOwner(input: {
  listingId: string;
  ownerUserId: string;
  decision: "approve" | "reject" | "request_changes";
  reason?: string;
}) {
  const db = await readDb();
  const index = db.marketplaceListings.findIndex((listing) => listing.id === input.listingId);
  if (index === -1) throw new Error("Listing not found.");
  const current = db.marketplaceListings[index];
  const trimmedReason = String(input.reason ?? "").trim();
  if ((input.decision === "reject" || input.decision === "request_changes") && !trimmedReason) {
    throw new Error("Reason is required.");
  }
  const now = nowIso();
  const nextStatus: ListingStatus = input.decision === "approve" ? "active" : "draft";
  const nextApprovalStatus: ListingApprovalStatus =
    input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "changes_requested";

  db.marketplaceListings[index] = {
    ...current,
    status: nextStatus,
    approvalStatus: nextApprovalStatus,
    ownerReviewReason: input.decision === "approve" ? undefined : trimmedReason || undefined,
    ownerReviewedAt: now,
    ownerReviewedBy: input.ownerUserId,
    updatedAt: now,
  };

  await appendAuditLog(db, {
    action:
      input.decision === "approve"
        ? "listing_resumed"
        : "listing_edited",
    actorUserId: input.ownerUserId,
    targetUserId: current.sellerId,
    listingId: current.id,
    details:
      input.decision === "approve"
        ? `Owner approved listing ${current.id}`
        : input.decision === "reject"
          ? `Owner rejected listing ${current.id}: ${trimmedReason}`
          : `Owner requested changes for listing ${current.id}: ${trimmedReason}`,
    reason: trimmedReason || undefined,
  });
  pushNotification(db, {
    userId: current.sellerId,
    category: "listing",
    title:
      input.decision === "approve" ? "Listing Approved" : input.decision === "reject" ? "Listing Rejected" : "Listing Needs Changes",
    message:
      input.decision === "approve"
        ? "Your listing has been approved and is now live in the marketplace."
        : input.decision === "reject"
          ? `Your listing was rejected.\nReason: ${trimmedReason}`
          : `Your listing needs updates before approval.\nReason: ${trimmedReason}`,
    relatedListingId: current.id,
    relatedHref: "/usdt-exchange",
  });
  pushActivityLog(db, {
    userId: current.sellerId,
    category: "listing",
    title:
      input.decision === "approve" ? "Listing approved" : input.decision === "reject" ? "Listing rejected" : "Listing changes requested",
    details: input.decision === "approve"
      ? `Listing ${current.id} approved and now live.`
      : `Reason: ${trimmedReason}`,
  });
  await recalculateTrustEngine(db, {
    reason:
      input.decision === "approve" ? "Listing approved" : input.decision === "reject" ? "Listing rejected" : "Listing changes requested",
    triggeredBy: input.ownerUserId,
  });
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  return db.marketplaceListings[index];
}

export async function deleteMarketplaceListingForSeller(input: {
  listingId: string;
  sellerId: string;
  actorUserId: string;
}) {
  const db = await readDb();
  const listing = db.marketplaceListings.find((item) => item.id === input.listingId);
  if (!listing) throw new Error("Listing not found.");
  if (listing.sellerId !== input.sellerId) throw new Error("You can remove only your own listings.");
  if (isListingLocked(listing.status)) {
    throw new Error("This listing is locked by an active trade and cannot be closed.");
  }
  if (listing.status === "completed" || listing.status === "cancelled" || listing.status === "closed") {
    throw new Error("This listing is already closed.");
  }
  listing.status = "closed";
  listing.closedAt = nowIso();
  listing.updatedAt = listing.closedAt;
  listing.activeTradeRequestId = undefined;
  listing.lockedAt = undefined;
  await appendAuditLog(db, {
    action: "listing_closed",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    listingId: input.listingId,
    details: `Closed listing ${input.listingId}`,
  });
  await recalculateTrustEngine(db, { reason: "Listing removed", triggeredBy: input.actorUserId });
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  publishRealtimeEvent({ type: "listing.removed", payload: { listingId: input.listingId } });
}

export async function getMyMarketplaceListings(sellerId: string, status?: string, dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const rawListings =
    !status || status === "all"
      ? db.marketplaceListings.filter((listing) => listing.sellerId === sellerId)
      : db.marketplaceListings.filter((listing) => listing.sellerId === sellerId && listing.status === status);
  return enrichListingsWithSellerData(db, rawListings);
}

export async function getSellerListingWorkspaceSummary(sellerId: string, dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const blockedReason = getSellerListingBlockReason(db, sellerId);
  return {
    activeListingLimit: MAX_ACTIVE_LISTINGS_PER_SELLER,
    openListingCount: getSellerOpenListingCount(db, sellerId),
    openTradeCount: getSellerOpenTradeCount(db, sellerId),
    pendingCommissionCount: getSellerPendingCommissionCount(db, sellerId),
    canCreateListing: blockedReason === null,
    blockedReason,
  };
}

export async function getSellerCommissionStatus(sellerId: string, dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const pendingRecords = db.commissionRecords
    .filter((record) => record.sellerId === sellerId)
    .map((record) => ({
      ...record,
      paymentStatus: normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt),
    }))
    .filter((record) => record.paymentStatus !== "paid")
    .sort((left, right) => {
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return leftDue - rightDue;
    });
  const primaryRecord = pendingRecords[0];
  const amountDue = pendingRecords.reduce((sum, record) => sum + getCommissionAmountDueUsdt(db, record), 0);
  const hasOverdue = pendingRecords.some((record) => record.paymentStatus === "overdue");
  const primaryRequest = primaryRecord
    ? db.purchaseRequests.find((request) => request.id === primaryRecord.purchaseRequestId)
    : undefined;

  return {
    status: pendingRecords.length === 0 ? "clear" as const : hasOverdue ? "overdue" as const : "pending" as const,
    pendingCount: pendingRecords.length,
    amountDue,
    dueAt: primaryRecord?.dueAt,
    commissionId: primaryRecord?.id,
    relatedRequestId: primaryRecord?.purchaseRequestId,
    relatedTradeId: primaryRequest?.tradeId,
    relatedTradeDisplayNumber: primaryRequest?.displayNumber,
  };
}

export function getCommissionQaModeStatus() {
  return isQaCommissionModeEnabled();
}

export function getCommissionQaResetStatus() {
  return isQaResetModeEnabled();
}

export async function getWorkspaceBootstrapData(input: {
  userId: string;
  role: UserRole;
  includeSellerWorkspace: boolean;
}) {
  const db = await readDb();
  const purchaseRequests = await getMyPurchaseRequests(input.userId, input.role, db);
  const sellerApplication = await getSellerApplicationByUserId(input.userId, db);
  if (!input.includeSellerWorkspace) {
    return {
      purchaseRequests,
      sellerApplication,
      myListings: [] as MarketplaceListing[],
      sellerWorkspaceSummary: null,
      sellerCommissionStatus: null,
    };
  }

  const [myListings, sellerWorkspaceSummary, sellerCommissionStatus] = await Promise.all([
    getMyMarketplaceListings(input.userId, "all", db),
    getSellerListingWorkspaceSummary(input.userId, db),
    getSellerCommissionStatus(input.userId, db),
  ]);
  return {
    purchaseRequests,
    sellerApplication,
    myListings,
    sellerWorkspaceSummary,
    sellerCommissionStatus,
  };
}

export async function createPurchaseRequest(input: {
  buyerId: string;
  listingId: string;
  usdtAmount: string;
  buyerName: string;
  buyerWhatsapp: string;
  buyerNotes: string;
  paymentMethod?: string;
  bankName?: string;
  safetyAcknowledged?: boolean;
  actorUserId: string;
}) {
  const startedAt = Date.now();
  const dbReadStartedAt = Date.now();
  const db = await readDb({ bypassCache: true });
  const dbReadMs = Date.now() - dbReadStartedAt;
  const validationStartedAt = Date.now();
  const now = nowIso();
  const pendingConfirmationTrade = db.purchaseRequests.find(
    (r) => r.buyerId === input.buyerId && r.status === "usdt_sent" && r.buyerConfirmationArchivedAt,
  );
  if (pendingConfirmationTrade) {
    throw new TradeBlockedError(
      "AWAITING_BUYER_CONFIRMATION",
      "You have an outstanding trade awaiting your confirmation. Please confirm that you received your USDT before starting another purchase.",
      pendingConfirmationTrade.id,
    );
  }
  const activeBuyerTrade = db.purchaseRequests.find(
    (r) => r.buyerId === input.buyerId && isActiveTradeStatus(r.status) && !r.buyerConfirmationArchivedAt,
  );
  if (activeBuyerTrade) {
    throw new TradeBlockedError(
      "ACTIVE_TRADE_EXISTS",
      "You already have an active trade in progress. Complete or cancel it before starting another purchase.",
      activeBuyerTrade.id,
    );
  }
  const pendingFeedbackTrade = getBuyerPendingFeedbackTrade(db, input.buyerId);
  if (pendingFeedbackTrade) {
    throw new TradeBlockedError(
      "PENDING_BUYER_FEEDBACK",
      "Please complete your feedback for your previous trade before starting a new one.",
      pendingFeedbackTrade.id,
    );
  }
  const listing = db.marketplaceListings.find((item) => item.id === input.listingId);
  if (!listing) throw new Error("Listing not found.");
  const listingPaymentMethods = resolveListingPaymentMethods(listing.paymentMethods, listing.paymentMethod);
  const selectedPaymentMethod = normalizeMarketplacePaymentMethod(input.paymentMethod);
  const primaryPaymentMethod = selectedPaymentMethod && listingPaymentMethods.includes(selectedPaymentMethod)
    ? selectedPaymentMethod
    : listingPaymentMethods[0] ?? "Bank Transfer";
  if (selectedPaymentMethod && !listingPaymentMethods.includes(selectedPaymentMethod)) {
    throw new Error("Selected payment method is not available for this listing.");
  }
  const requiresFaceToFaceSafetyNotice = isFaceToFacePaymentMethod(primaryPaymentMethod);
  const buyerSafetyAcknowledged = !requiresFaceToFaceSafetyNotice || input.safetyAcknowledged === true;
  if (requiresFaceToFaceSafetyNotice && !buyerSafetyAcknowledged) {
    throw new Error("Please acknowledge the Face-to-Face privacy and safety notice before continuing.");
  }
  if (!canListingReceiveRequests(listing)) {
    pushNotification(db, {
      userId: input.buyerId,
      category: "listing",
      title: "Listing unavailable",
      message: `Listing ${input.listingId} is not available for a new buyer right now.`,
      relatedListingId: input.listingId,
      relatedHref: "/usdt-exchange",
    });
    await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
    throw new Error("Listing is not available for a new buyer right now.");
  }
  if (listing.sellerId === input.buyerId) throw new Error("You cannot submit a purchase request to your own listing.");
  const seller = db.users.find((user) => user.id === listing.sellerId);
  if (!seller || isSellerUnavailableForNewBuyers(seller.availabilityStatus)) {
    pushNotification(db, {
      userId: input.buyerId,
      category: "listing",
      title: "Listing unavailable",
      message: `The seller is currently unavailable for listing ${input.listingId}.`,
      relatedListingId: input.listingId,
      relatedHref: "/usdt-exchange",
    });
    await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
    throw new Error("Seller is currently unavailable for new buyer matches.");
  }
  const requestedUsdtAmount = String(input.usdtAmount ?? "").trim();
  const requestedAmount = toNumber(requestedUsdtAmount);
  const minimumTrade = Math.max(0, toNumber(listing.minimumTrade));
  const maximumTrade = toNumber(listing.maximumTrade) || toNumber(listing.availableAmount);
  const remainingAmount = toNumber(listing.availableAmount);
  if (!requestedUsdtAmount || requestedAmount <= 0) throw new Error("Trade amount must be greater than zero.");
  if (requestedAmount < minimumTrade) throw new Error(`Minimum trade for this listing is ${listing.minimumTrade} USDT.`);
  if (requestedAmount > maximumTrade) throw new Error(`Maximum trade for this listing is ${listing.maximumTrade} USDT.`);
  if (requestedAmount > remainingAmount) throw new Error("Requested amount exceeds the remaining listing quantity.");
  const validationMs = Date.now() - validationStartedAt;
  const businessStartedAt = Date.now();
  const sellerId = listing.sellerId;
  const usdtAmount = requestedUsdtAmount;
  const fiatAmount = (requestedAmount * toNumber(listing.price)).toFixed(2);
  const tradeId = `trade-${randomUUID()}`;
  const request: PurchaseRequest = {
    id: `purchase-${randomUUID()}`,
    buyerId: input.buyerId,
    listingId: input.listingId,
    sellerId,
    tradeId,
    buyerName: input.buyerName.trim(),
    buyerWhatsapp: input.buyerWhatsapp.trim(),
    buyerNotes: input.buyerNotes.trim(),
    usdtAmount,
    fiatAmount,
    currency: listing.currency,
    network: listing.network,
    paymentMethod: primaryPaymentMethod,
    buyerSafetyAcknowledged,
    sellerSafetyAcknowledged: !requiresFaceToFaceSafetyNotice,
    bankName: (isBankTransferPaymentMethod(primaryPaymentMethod) || isCardlessAtmPaymentMethod(primaryPaymentMethod))
      ? (serializeIsraeliBankSelection(parseIsraeliBankSelection(input.bankName || listing.bankName)) || undefined)
      : undefined,
    timeline: [
      {
        id: `timeline-purchase-${randomUUID()}-1`,
        type: "request_submitted",
        actorUserId: input.actorUserId,
        actorRole: resolveActorRole(db, input.actorUserId),
        message: "Buyer submitted request",
        createdAt: now,
      },
    ],
    tradeCreatedAt: undefined,
    paymentSentAt: undefined,
    usdtSentAt: undefined,
    completedAt: undefined,
    lockedAt: undefined,
    reviewUnlockedAt: undefined,
    buyerReview: undefined,
    sellerResponse: undefined,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  db.purchaseRequests.push(request);
  await appendAuditLog(db, {
    action: "purchase_request_submitted",
    actorUserId: input.actorUserId,
    targetUserId: sellerId,
    listingId: input.listingId,
    purchaseRequestId: request.id,
    details: `Submitted trade ${request.tradeId}`,
  });
  pushNotification(db, {
    userId: sellerId,
    category: "trade",
    title: "New trade request",
    message: `${request.buyerName} submitted a ${primaryPaymentMethod} trade request.`,
    relatedRequestId: request.id,
    relatedTradeId: request.tradeId,
    relatedListingId: request.listingId,
    relatedHref: requestDetailsHref(request.id),
  });
  pushActivityLog(db, {
    userId: input.buyerId,
    category: "trade",
    title: "Trade request submitted",
    details: `Trade ${request.tradeId} was submitted.`,
  });
  const businessMs = Date.now() - businessStartedAt;
  const writeStartedAt = Date.now();
  await writeDb(db, { selectedTables: PURCHASE_REQUEST_CREATE_TABLES });
  const writeMs = Date.now() - writeStartedAt;
  const sseStartedAt = Date.now();
  publishRealtimeEvent({
    type: "trade.request_created",
    payload: { request: enrichRequestWithEvidence(db, request) },
  });
  const sseMs = Date.now() - sseStartedAt;
  return {
    request,
    metrics: {
      totalMs: Date.now() - startedAt,
      readDbMs: dbReadMs,
      validationMs,
      businessMs,
      writeDbMs: writeMs,
      sseMs,
      trustMs: 0,
    },
  };
}

export async function getMyPurchaseRequests(userId: string, role: UserRole, dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  if (role === "admin" || role === "owner") return db.purchaseRequests.map((request) => enrichRequestWithEvidence(db, request));
  return db.purchaseRequests
    .filter((request) => request.buyerId === userId || request.sellerId === userId)
    .map((request) => enrichRequestWithEvidence(db, request));
}

const ACTIVE_TRADE_STATUSES: PurchaseRequestStatus[] = [
  "accepted",
  "payment_sent",
  "funds_received",
  "usdt_release_pending",
  "usdt_sent",
];

const ACTIONABLE_TRADE_STATUSES: PurchaseRequestStatus[] = ["pending", ...ACTIVE_TRADE_STATUSES];

function isActiveTradeStatus(status: PurchaseRequestStatus) {
  return ACTIVE_TRADE_STATUSES.includes(status);
}

function isActionableTradeStatus(status: PurchaseRequestStatus) {
  return ACTIONABLE_TRADE_STATUSES.includes(status);
}

function sortTradesByUpdatedAtDesc(left: PurchaseRequest, right: PurchaseRequest) {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function buildPurchaseRequestLookupCandidates(requestId: string) {
  const normalized = requestId.trim();
  const candidates = [normalized];
  if (normalized.startsWith("purchase-")) {
    candidates.push(normalized.slice("purchase-".length));
  } else {
    candidates.push(`purchase-${normalized}`);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function filterTradesForUser(db: AlphaExchangeDb, userId: string, role: UserRole) {
  return db.purchaseRequests.filter((request) => {
    if (role === "admin" || role === "owner") return true;
    return request.buyerId === userId || request.sellerId === userId;
  });
}

export async function getFirstActiveTradeForUser(userId: string, role: UserRole) {
  const db = await readDb();
  // Include "pending" only when the user is the buyer waiting for seller acceptance —
  // sellers and admins must not be locked into the trade room by an unaccepted request.
  const activeTrades = filterTradesForUser(db, userId, role)
    .filter((request) =>
      isActiveTradeStatus(request.status) ||
      (request.status === "pending" && request.buyerId === userId),
    )
    .sort(sortTradesByUpdatedAtDesc);
  return activeTrades[0] ? enrichRequestWithEvidence(db, activeTrades[0]) : null;
}

export async function getFirstActionableTradeForUser(userId: string, role: UserRole) {
  const db = await readDb();
  const actionableTrades = filterTradesForUser(db, userId, role)
    .filter((request) => isActionableTradeStatus(request.status))
    .sort(sortTradesByUpdatedAtDesc);
  return actionableTrades[0] ? enrichRequestWithEvidence(db, actionableTrades[0]) : null;
}

export async function resolveTradeRoomRequestForNotification(input: {
  userId: string;
  role: UserRole;
  notificationId: string;
  includePendingFallback?: boolean;
}) {
  const db = await readDb();
  const notification = db.notifications.find((item) => item.id === input.notificationId && item.userId === input.userId);
  if (!notification) {
    return {
      request: null,
      reason: "notification_not_found" as const,
      notification: null,
      consideredStatuses: input.includePendingFallback ? ACTIONABLE_TRADE_STATUSES : ACTIVE_TRADE_STATUSES,
      participantTradeStatuses: [],
    };
  }

  const enrichedNotification = enrichNotification(db, notification);
  const relatedRequest = resolveTradeContextForNotification(db, {
    userId: input.userId,
    relatedRequestId: enrichedNotification.relatedRequestId,
    relatedTradeId: enrichedNotification.relatedTradeId,
    relatedListingId: enrichedNotification.relatedListingId,
  });
  if (relatedRequest) {
    return {
      request: enrichRequestWithEvidence(db, relatedRequest),
      reason: "notification_related_request" as const,
      notification: enrichedNotification,
      consideredStatuses: input.includePendingFallback ? ACTIONABLE_TRADE_STATUSES : ACTIVE_TRADE_STATUSES,
      participantTradeStatuses: [],
    };
  }

  const snapshotRequestId = enrichedNotification.tradeSnapshot?.requestId;
  if (snapshotRequestId) {
    const snapshotRequest = db.purchaseRequests.find((request) => request.id === snapshotRequestId);
    if (snapshotRequest) {
      return {
        request: enrichRequestWithEvidence(db, snapshotRequest),
        reason: "trade_snapshot_request" as const,
        notification: enrichedNotification,
        consideredStatuses: input.includePendingFallback ? ACTIONABLE_TRADE_STATUSES : ACTIVE_TRADE_STATUSES,
        participantTradeStatuses: [],
      };
    }
  }

  const statusFilter = input.includePendingFallback ? isActionableTradeStatus : isActiveTradeStatus;
  const userTrades = filterTradesForUser(db, input.userId, input.role).sort(sortTradesByUpdatedAtDesc);
  const fallbackTrade = userTrades
    .filter((request) => statusFilter(request.status))
    [0];

  return {
    request: fallbackTrade ? enrichRequestWithEvidence(db, fallbackTrade) : null,
    reason: fallbackTrade ? "fallback_user_trade" as const : "no_trade_match" as const,
    notification: enrichedNotification,
    consideredStatuses: input.includePendingFallback ? ACTIONABLE_TRADE_STATUSES : ACTIVE_TRADE_STATUSES,
    participantTradeStatuses: userTrades.slice(0, 10).map((request) => ({
      requestId: request.id,
      status: request.status,
      updatedAt: request.updatedAt,
    })),
  };
}

export interface TradeRoomData {
  request: PurchaseRequest;
  listing: MarketplaceListing | null;
  counterpart: { buyerName: string; sellerName: string };
  messages: TradeChatMessage[];
  deadlineAt: string | null;
  timeRemainingSeconds: number | null;
  releaseDeadlineActive: boolean;
  releaseDeadlineOverdue: boolean;
  hasOpenDispute: boolean;
  canOpenDispute: boolean;
  isOverdue: boolean;
  sellerCommissionDueAmount: number;
  sellerCommissionDueCount: number;
}

export async function getTradeRoomData(input: {
  purchaseRequestId: string;
  actorUserId: string;
  actorRole: UserRole;
  markMessagesRead?: boolean;
  strongConsistency?: boolean;
}): Promise<TradeRoomData> {
  const debug = process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
  const db = await readDb({ bypassCache: input.strongConsistency === true });
  const lookupCandidates = buildPurchaseRequestLookupCandidates(input.purchaseRequestId);
  const requestIndex = db.purchaseRequests.findIndex((item) => lookupCandidates.includes(item.id));
  if (requestIndex === -1) {
    if (debug) console.log("[trade-room-open] store lookup failed", {
      incomingRequestId: input.purchaseRequestId,
      lookupCandidates,
      reason: "request_not_found",
      totalRequests: db.purchaseRequests.length,
    });
    // Always log this as an error so it surfaces in Vercel logs even without debug mode.
    // If totalRequests is 0, the system is running on the in-memory fallback (Postgres not connected).
    console.error("[trade-room-open] TRADE_NOT_FOUND", {
      incomingRequestId: input.purchaseRequestId,
      lookupCandidates,
      totalRequestsInDb: db.purchaseRequests.length,
      firstFiveRequestIds: db.purchaseRequests.slice(0, 5).map((r) => r.id),
      note: db.purchaseRequests.length === 0
        ? "DB is empty — system is using in-memory fallback (Postgres not connected or using wrong URL)"
        : "DB has data but request ID not found — possible ID mismatch",
    });
    throw new Error("Trade not found.");
  }
  const request = db.purchaseRequests[requestIndex];
  if (debug) console.log("[trade-room-open] store lookup success", {
    incomingRequestId: input.purchaseRequestId,
    resolvedRequestId: request.id,
    tradeStatus: request.status,
    listingId: request.listingId,
    tradeId: request.tradeId ?? null,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
  });
  assertTradeParticipantOrAdmin(request, input.actorUserId, input.actorRole);

  // Messages are stored in request.messages (persisted in purchase_requests.payload JSON).
  // Fall back to db.tradeMessages for backward compatibility with older records.
  const allMessages = request.messages?.length
    ? request.messages
    : (db.tradeMessages ?? []).filter((message) => message.purchaseRequestId === request.id);
  const messages = [...allMessages].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  let changed = false;
  if (input.markMessagesRead !== false) {
    for (const message of messages) {
      if (message.senderUserId === input.actorUserId) continue;
      if (message.readByUserIds.includes(input.actorUserId)) continue;
      message.readByUserIds.push(input.actorUserId);
      changed = true;
    }
    if (changed) {
      // Persist read-receipt updates back onto the request.messages array
      request.messages = messages;
      db.purchaseRequests[requestIndex] = request;
    }
  }
  if (changed) {
    await writeDb(db, { selectedTables: AUDIT_LOG_ONLY_TABLES });
  }

  const listing = db.marketplaceListings.find((item) => item.id === request.listingId) ?? null;
  const buyer = db.users.find((item) => item.id === request.buyerId) ?? null;
  const seller = db.users.find((item) => item.id === request.sellerId) ?? null;
  if (debug) console.log("[trade-room-open] store related entities", {
    requestId: request.id,
    foundListing: Boolean(listing),
    foundTradeId: request.tradeId ?? null,
    foundBuyer: Boolean(buyer),
    foundSeller: Boolean(seller),
  });
  const openDispute = db.disputes.find((item) => item.purchaseRequestId === request.id && item.status === "open");
  const deadlineAt = request.usdtReleaseDeadlineAt ?? null;
  const timeRemainingSeconds = deadlineAt ? Math.max(0, Math.floor((new Date(deadlineAt).getTime() - Date.now()) / 1000)) : null;
  const releaseDeadlineActive = request.status === "usdt_release_pending";
  const releaseDeadlineOverdue = Boolean(releaseDeadlineActive && timeRemainingSeconds !== null && timeRemainingSeconds <= 0);
  const isBuyerActor = request.buyerId === input.actorUserId;
  const isOverdue = releaseDeadlineOverdue || request.timeoutReason === "USDT release SLA expired.";
  const sellerPendingCommissions = db.commissionRecords.filter((record) => record.sellerId === request.sellerId && normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt) !== "paid");

  return {
    request: enrichRequestWithEvidence(db, request),
    listing,
    counterpart: {
      buyerName: buyer?.fullName ?? request.buyerName,
      sellerName: seller?.fullName ?? listing?.sellerDisplayName ?? request.sellerId,
    },
    messages,
    deadlineAt,
    timeRemainingSeconds,
    releaseDeadlineActive,
    releaseDeadlineOverdue,
    isOverdue,
    hasOpenDispute: Boolean(openDispute),
    canOpenDispute: isBuyerActor && (request.status === "payment_sent" || request.status === "funds_received" || request.status === "usdt_release_pending" || request.status === "usdt_sent"),
    sellerCommissionDueAmount: Number(sellerPendingCommissions.reduce((sum, record) => sum + getCommissionAmountDueUsdt(db, record), 0).toFixed(2)),
    sellerCommissionDueCount: sellerPendingCommissions.length,
  };
}

export async function postTradeRoomMessage(input: {
  purchaseRequestId: string;
  actorUserId: string;
  actorRole: UserRole;
  message: string;
}) {
  const startedAt = Date.now();
  const dbReadStartedAt = Date.now();
  const db = await readDb();
  const dbReadMs = Date.now() - dbReadStartedAt;
  const validationStartedAt = Date.now();
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.purchaseRequestId);
  if (requestIndex === -1) throw new Error("Trade not found.");
  const request = db.purchaseRequests[requestIndex];
  assertTradeParticipantOrAdmin(request, input.actorUserId, input.actorRole);

  const message = input.message.trim();
  if (!message) throw new Error("Message is required.");
  if (message.length > 1200) throw new Error("Message is too long.");
  const validationMs = Date.now() - validationStartedAt;

  const businessStartedAt = Date.now();
  const senderRole = resolveActorRole(db, input.actorUserId);
  const nextMessage: TradeChatMessage = {
    id: `trade-msg-${randomUUID()}`,
    purchaseRequestId: request.id,
    kind: "user",
    senderUserId: input.actorUserId,
    senderRole,
    message,
    createdAt: nowIso(),
    readByUserIds: [input.actorUserId],
  };
  // Store messages in request.messages (persisted inside purchase_requests.payload JSON).
  // Also keep db.tradeMessages in sync for backward compatibility.
  request.messages = [nextMessage, ...(request.messages ?? [])];
  db.purchaseRequests[requestIndex] = request;
  db.tradeMessages = [nextMessage, ...(db.tradeMessages ?? [])];
  const businessMs = Date.now() - businessStartedAt;
  const writeStartedAt = Date.now();
  await writeDb(db, { selectedTables: PURCHASE_REQUEST_ONLY_TABLES });
  const writeMs = Date.now() - writeStartedAt;
  const sseStartedAt = Date.now();
  publishRealtimeEvent({
    type: "trade.message_created",
    payload: {
      requestId: request.id,
      messageId: nextMessage.id,
    },
  });
  const sseMs = Date.now() - sseStartedAt;
  return {
    message: nextMessage,
    metrics: {
      totalMs: Date.now() - startedAt,
      readDbMs: dbReadMs,
      validationMs,
      businessMs,
      writeDbMs: writeMs,
      sseMs,
    },
  };
}

export interface AccountProfileSummary {
  id: string;
  profilePhotoUrl: string;
  coverBannerUrl: string;
  fullName: string;
  username: string;
  email: string;
  role: UserRole;
  sellerStatus: SellerStatus;
  memberSince: string;
  lastLogin: string;
  onlineStatus: SellerOnlineStatus;
  bio: string;
  country: string;
  language: string;
  whatsappNumber: string;
  showTradeStats: boolean;
  showLastActive: boolean;
  allowDirectMessages: boolean;
  allowProfileSearch: boolean;
  showPhonePublic: boolean;
  showEmailPublic: boolean;
}

export interface SellerAccountStats {
  kind: "seller";
  sellerLevel: SellerLevel;
  nextLevel?: SellerLevel;
  progressToNextLevelPercent: number;
  amountToNextLevelUsdt: number;
  lifetimeCompletedVolumeUsdt: number;
  commissionPaid: number;
  averageTradeSize: number;
  promotionHistory: SellerPromotionHistoryEntry[];
  trustScore: number;
  completedTrades: number;
  activeListings: number;
  pendingListings: number;
  averageRating: number;
}

export interface BuyerAccountStats {
  kind: "buyer";
  activeTrades: number;
  completedTrades: number;
  reviewsGiven: number;
}

export async function getAccountProfileData(userId: string): Promise<{
  profile: AccountProfileSummary;
  stats: SellerAccountStats | BuyerAccountStats;
}> {
  const db = await readDb();
  const user = db.users.find((row) => row.id === userId);
  if (!user) throw new Error("User not found.");

  const username = user.email.includes("@")
    ? user.email.split("@")[0].trim().toLowerCase()
    : user.fullName.trim().toLowerCase().replace(/\s+/g, "");
  const lastLogin = db.authSessions
    .filter((session) => session.userId === user.id)
    .map((session) => new Date(session.createdAt).getTime())
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0];

  const profile: AccountProfileSummary = {
    id: user.id,
    profilePhotoUrl: user.profilePhotoUrl,
    coverBannerUrl: user.coverBannerUrl ?? "",
    fullName: user.fullName,
    username,
    email: user.email,
    role: user.role,
    sellerStatus: user.sellerStatus,
    memberSince: user.createdAt,
    lastLogin: lastLogin ? new Date(lastLogin).toISOString() : user.updatedAt,
    onlineStatus: user.onlineStatus,
    bio: user.bio ?? "",
    country: user.country ?? "",
    language: user.languages?.[0] ?? "English",
    whatsappNumber: user.whatsappNumber ?? "",
    showTradeStats: user.showTradeStats !== false,
    showLastActive: user.showLastActive !== false,
    allowDirectMessages: user.allowDirectMessages !== false,
    allowProfileSearch: user.allowProfileSearch !== false,
    showPhonePublic: user.showPhonePublic === true,
    showEmailPublic: user.showEmailPublic === true,
  };

  if (hasRole(user, "approved_seller") || user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended") {
    const reputation = computeSellerReputationSnapshot(db, user.id);
    const sellerRequests = db.purchaseRequests.filter((request) => request.sellerId === user.id);
    const sellerLevel = user.sellerPrestigeRank ?? reputation.level;
    const prestigeProgress = getSellerPrestigeProgress(reputation.totalUsdtVolume, sellerLevel);
    const stats: SellerAccountStats = {
      kind: "seller",
      sellerLevel,
      nextLevel: prestigeProgress.nextRank,
      progressToNextLevelPercent: Number(prestigeProgress.progressPercent.toFixed(2)),
      amountToNextLevelUsdt: Number(prestigeProgress.remainingUsdt.toFixed(2)),
      lifetimeCompletedVolumeUsdt: Number(reputation.totalUsdtVolume.toFixed(2)),
      commissionPaid: Number(reputation.estimatedCommissionPaid.toFixed(2)),
      averageTradeSize: Number(reputation.averageTradeSize.toFixed(2)),
      promotionHistory: [...(user.sellerPromotionHistory ?? [])].slice(0, 10),
      trustScore: reputation.trustScore,
      completedTrades: sellerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length,
      activeListings: db.marketplaceListings.filter((listing) => listing.sellerId === user.id && listing.status === "active").length,
      pendingListings: db.marketplaceListings.filter((listing) => listing.sellerId === user.id && isListingPendingApproval(listing)).length,
      averageRating: reputation.rating,
    };
    return { profile, stats };
  }

  const buyerRequests = db.purchaseRequests.filter((request) => request.buyerId === user.id);
  const stats: BuyerAccountStats = {
    kind: "buyer",
    activeTrades: buyerRequests.filter(
      (request) =>
        request.status !== "completed"
        && request.status !== "review_open"
        && request.status !== "declined"
        && request.status !== "cancelled",
    ).length,
    completedTrades: buyerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length,
    reviewsGiven: buyerRequests.filter((request) => Boolean(request.buyerReview)).length,
  };
  return { profile, stats };
}

export async function updateAccountProfileData(input: {
  userId: string;
  profilePhotoUrl?: string;
  coverBannerUrl?: string;
  fullName?: string;
  bio?: string;
  country?: string;
  language?: string;
  whatsappNumber?: string;
  isProfileHidden?: boolean;
  showTradeStats?: boolean;
  showLastActive?: boolean;
  allowDirectMessages?: boolean;
  allowProfileSearch?: boolean;
  showPhonePublic?: boolean;
  showEmailPublic?: boolean;
}) {
  const languages = input.language !== undefined ? [String(input.language).trim() || "English"] : undefined;
  return updateUserSellerSettings({
    userId: input.userId,
    profilePhotoUrl: input.profilePhotoUrl,
    coverBannerUrl: input.coverBannerUrl,
    fullName: input.fullName,
    bio: input.bio,
    country: input.country,
    languages,
    whatsappNumber: input.whatsappNumber,
    isProfileHidden: input.isProfileHidden,
    showTradeStats: input.showTradeStats,
    showLastActive: input.showLastActive,
    allowDirectMessages: input.allowDirectMessages,
    allowProfileSearch: input.allowProfileSearch,
    showPhonePublic: input.showPhonePublic,
    showEmailPublic: input.showEmailPublic,
  });
}

function assertTradeParticipantOrAdmin(request: PurchaseRequest, userId: string, role: UserRole) {
  if (role === "admin" || role === "owner") return;
  if (request.buyerId === userId || request.sellerId === userId) return;
  throw new Error("You are not allowed to access trade evidence.");
}

export async function uploadTradeEvidence(input: {
  purchaseRequestId: string;
  actorUserId: string;
  actorRole: UserRole;
  side: TradeEvidenceSide;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
}) {
  const startedAt = Date.now();
  const dbReadStartedAt = Date.now();
  const db = await readDb({ bypassCache: true });
  const dbReadMs = Date.now() - dbReadStartedAt;
  const validationStartedAt = Date.now();
  const actorRole = resolveActorRole(db, input.actorUserId);
  const lookupId = String(input.purchaseRequestId ?? "");
  const requestById = db.purchaseRequests.find((item) => item.id === lookupId) ?? null;
  const requestByTradeId = db.purchaseRequests.find((item) => item.tradeId === lookupId) ?? null;
  if (input.side === "seller") {
    const matchedByTradeId = requestById?.tradeId
      ? db.purchaseRequests.find((item) => item.tradeId === requestById.tradeId || item.id === requestById.tradeId) ?? null
      : null;
    writeSellerEvidenceTrace("store-lookup", {
      purchaseRequestId: lookupId,
      lookupIdentifier: lookupId,
      startsWithTradePrefix: lookupId.startsWith("trade-"),
      startsWithPurchasePrefix: lookupId.startsWith("purchase-"),
      requestByIdFound: Boolean(requestById),
      requestByTradeIdFound: Boolean(requestByTradeId),
      requestById,
      requestByTradeId,
      referencedTradeId: requestById?.tradeId ?? null,
      tradeObjectByReferencedTradeId: matchedByTradeId,
      purchaseRequestCount: db.purchaseRequests.length,
      latestPurchaseRequestIds: db.purchaseRequests.slice(0, 10).map((item) => item.id),
    });
  }
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.purchaseRequestId);
  if (requestIndex === -1) {
    if (input.side === "seller") {
      writeSellerEvidenceTrace("store-lookup-miss", {
        reason: "No purchase request found by purchaseRequestId.",
        purchaseRequestId: lookupId,
        requestByTradeIdFound: Boolean(requestByTradeId),
      });
    }
    throw new Error("Trade not found.");
  }
  const request = db.purchaseRequests[requestIndex];

  assertTradeParticipantOrAdmin(request, input.actorUserId, input.actorRole);
  if (input.side === "buyer" && request.buyerId !== input.actorUserId) {
    throw new Error("Only the buyer can upload buyer evidence.");
  }
  if (input.side === "seller" && request.sellerId !== input.actorUserId) {
    throw new Error("Only the seller can upload seller evidence.");
  }
  if (request.status === "pending" || request.status === "declined" || request.status === "cancelled") {
    throw new Error("Evidence can be uploaded only after trade acceptance.");
  }

  const mimeType = String(input.mimeType ?? "").toLowerCase().trim();
  if (!supportedEvidenceMimeTypes.has(mimeType)) {
    throw new Error("Unsupported evidence file type.");
  }
  const maxBytes = getMaxEvidenceSizeBytes();
  const sizeBytes = Math.max(0, Number(input.sizeBytes ?? 0));
  if (!sizeBytes || sizeBytes > maxBytes) {
    throw new Error(`Evidence file exceeds limit (${Math.round(maxBytes / (1024 * 1024))}MB).`);
  }
  const raw = Buffer.from(String(input.contentBase64 ?? ""), "base64");
  if (!raw.length || raw.length > maxBytes) {
    throw new Error("Invalid evidence file payload.");
  }
  const validationMs = Date.now() - validationStartedAt;

  const extension = extensionForEvidenceMimeType(mimeType);
  const evidenceId = `evidence-${randomUUID()}`;
  const baseName = path
    .basename(String(input.fileName ?? "").trim() || `${input.side}-evidence.${extension}`)
    .replace(/[^a-zA-Z0-9._-]/g, "-");
  const storageFileName = `${input.side}-${evidenceId}.${extension}`;
  const storagePath = `db://alpha-exchange-evidence/${request.id}/${storageFileName}`;

  const existingIndex = db.tradeEvidenceFiles.findIndex((item) => item.purchaseRequestId === request.id && item.side === input.side);
  const existing = existingIndex >= 0 ? db.tradeEvidenceFiles[existingIndex] : undefined;

  const evidence: TradeEvidenceFile = {
    id: evidenceId,
    purchaseRequestId: request.id,
    side: input.side,
    uploadedByUserId: input.actorUserId,
    uploadedAt: nowIso(),
    fileName: baseName,
    mimeType: mimeType as TradeEvidenceFile["mimeType"],
    sizeBytes,
    storagePath,
    status: existing ? "replaced" : "uploaded",
  };

  if (existingIndex >= 0) db.tradeEvidenceFiles.splice(existingIndex, 1);
  db.tradeEvidenceFiles.unshift(evidence);
  const updatedAt = nowIso();
  const requestPaymentMethod = normalizeMarketplacePaymentMethod(request.paymentMethod) ?? "Bank Transfer";
  const isAtmTrade = isCardlessAtmPaymentMethod(requestPaymentMethod);
  const isBankTransferTrade = isBankTransferPaymentMethod(requestPaymentMethod);
  const shouldAutoSubmitPayment = input.side === "buyer" && request.status === "accepted";

  const nextRequest: PurchaseRequest = {
    ...request,
    buyerEvidence: input.side === "buyer" ? evidence : request.buyerEvidence,
    sellerEvidence: input.side === "seller" ? evidence : request.sellerEvidence,
    updatedAt,
  };
  appendTradeTimelineEntry(nextRequest, {
    type: input.side === "buyer" ? "buyer_evidence_uploaded" : "seller_evidence_uploaded",
    actorUserId: input.actorUserId,
    actorRole,
    message: input.side === "buyer" ? "Buyer uploaded payment evidence" : "Seller uploaded USDT evidence",
    createdAt: updatedAt,
  });
  appendSystemTradeMessage(db, nextRequest, {
    senderUserId: input.actorUserId,
    senderRole: actorRole,
    message: input.side === "buyer"
      ? "Buyer uploaded the payment receipt."
      : "Seller attached release evidence.",
    createdAt: updatedAt,
  });
  if (shouldAutoSubmitPayment) {
    nextRequest.status = "payment_sent";
    nextRequest.paymentSentAt = updatedAt;
    const listing = getListingByIdOrThrow(db, request.listingId);
    if (listing.activeTradeRequestId === request.id) {
      listing.status = "in_trade";
      listing.updatedAt = updatedAt;
    }
    appendTradeTimelineEntry(nextRequest, {
      type: "payment_sent",
      actorUserId: input.actorUserId,
      actorRole,
      message: "Buyer marked payment sent",
      createdAt: updatedAt,
    });
    appendSystemTradeMessage(db, nextRequest, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Buyer submitted payment. Seller should now confirm the money was received.",
      createdAt: updatedAt,
    });
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: isAtmTrade ? "Withdrawal ready" : "Buyer marked payment sent",
      message: isBankTransferTrade
        ? "Buyer marked payment as sent. Please verify the funds in your bank account."
        : isAtmTrade
          ? "Buyer has prepared the cardless withdrawal. Confirm after collecting the cash."
          : "Buyer marked payment as sent. Confirm funds in person after following safety guidelines.",
      relatedTradeId: nextRequest.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
  }
  db.purchaseRequests[requestIndex] = nextRequest;

  await appendAuditLog(db, {
    action: existing ? "trade_evidence_replaced" : "trade_evidence_uploaded",
    actorUserId: input.actorUserId,
    targetUserId: input.side === "buyer" ? request.sellerId : request.buyerId,
    purchaseRequestId: request.id,
    listingId: request.listingId,
    details: `${input.side} evidence ${existing ? "replaced" : "uploaded"} (${baseName})`,
  });
  pushActivityLog(db, {
    userId: input.actorUserId,
    category: "trade",
    title: "Trade evidence uploaded",
    details: `${input.side === "buyer" ? "Payment" : "USDT"} evidence uploaded for trade ${request.tradeId ?? request.id}.`,
  });
  const storageStartedAt = Date.now();
  const dbWriteStartedAt = Date.now();
  await writeDb(db, {
    evidenceOverrides: new Map([[evidenceId, raw]]),
    selectedTables: shouldAutoSubmitPayment ? TRADE_EVIDENCE_PAYMENT_TABLES : TRADE_EVIDENCE_BASE_TABLES,
  });
  const dbWriteMs = Date.now() - dbWriteStartedAt;
  const storageMs = Date.now() - storageStartedAt;
  publishRealtimeEvent({
    type: "trade.status_changed",
    payload: {
      requestId: nextRequest.id,
      request: enrichRequestWithEvidence(db, nextRequest),
      status: nextRequest.status,
      timeline: nextRequest.timeline,
      publishedAtEpochMs: Date.now(),
    },
  });
  return {
    request: enrichRequestWithEvidence(db, db.purchaseRequests[requestIndex]),
    metrics: {
      dbReadMs,
      validationMs,
      storageMs,
      dbWriteMs,
      routeMs: Date.now() - startedAt,
      autoAdvancedToPaymentSent: shouldAutoSubmitPayment,
    },
  };
}

export async function getTradeEvidenceForRequest(input: {
  purchaseRequestId: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  const db = await readDb();
  const request = db.purchaseRequests.find((item) => item.id === input.purchaseRequestId);
  if (!request) throw new Error("Trade not found.");
  assertTradeParticipantOrAdmin(request, input.actorUserId, input.actorRole);
  return enrichRequestWithEvidence(db, request);
}

export async function downloadTradeEvidenceContent(input: {
  evidenceId: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  const db = await readDb();
  const evidence = db.tradeEvidenceFiles.find((item) => item.id === input.evidenceId);
  if (!evidence) throw new Error("Evidence not found.");
  const request = db.purchaseRequests.find((item) => item.id === evidence.purchaseRequestId);
  if (!request) throw new Error("Trade not found.");
  assertTradeParticipantOrAdmin(request, input.actorUserId, input.actorRole);

  const actor = db.users.find((item) => item.id === input.actorUserId);
  if (input.actorRole === "admin" || input.actorRole === "owner") {
    await appendAuditLog(db, {
      action: isAlphaExchangeOwnerEmail(actor?.email ?? "") ? "trade_evidence_viewed_by_owner" : "trade_evidence_viewed_by_moderator",
      actorUserId: input.actorUserId,
      purchaseRequestId: request.id,
      listingId: request.listingId,
      details: `Viewed ${evidence.side} evidence ${evidence.id}.`,
    });
  }
  await appendAuditLog(db, {
    action: "trade_evidence_downloaded",
    actorUserId: input.actorUserId,
    purchaseRequestId: request.id,
    listingId: request.listingId,
    details: `Downloaded ${evidence.side} evidence ${evidence.id}.`,
  });
  await writeDb(db, { selectedTables: PURCHASE_REQUEST_ONLY_TABLES });

  const repository = await getAlphaExchangeRepository();
  const buffer = await repository.readEvidenceContent(evidence.id);
  if (!buffer?.length) {
    throw new Error("Evidence content not found.");
  }
  return { evidence, request, buffer };
}

function buildSellerReviewFromTrade(request: PurchaseRequest, input: { buyerUserId: string; rating: number; comment: string; sellerReviewId?: string; createdAt?: string }) {
  return {
    id: input.sellerReviewId ?? `review-${request.id}`,
    tradeId: request.tradeId ?? request.id,
    buyerId: request.buyerId,
    sellerId: request.sellerId,
    rating: Math.max(1, Math.min(5, Math.round(input.rating))),
    comment: String(input.comment ?? "").trim(),
    sellerReply: undefined,
    createdAt: input.createdAt ?? nowIso(),
    updatedAt: input.createdAt ?? nowIso(),
    hidden: false,
    hiddenReason: undefined,
    verifiedTrade: true,
    tradeAmount: request.usdtAmount,
    network: request.network,
  } satisfies SellerReviewRecord;
}

function buildSellerReviewRecordFromRequest(request: PurchaseRequest): SellerReviewRecord | null {
  if (!request.buyerReview) return null;
  return {
    id: `review-${request.id}`,
    tradeId: request.tradeId ?? request.id,
    buyerId: request.buyerId,
    sellerId: request.sellerId,
    rating: request.buyerReview.rating,
    comment: request.buyerReview.comment,
    sellerReply: request.sellerResponse?.message,
    createdAt: request.buyerReview.createdAt,
    updatedAt: request.updatedAt,
    hidden: request.buyerReview.hidden === true,
    hiddenReason: request.buyerReview.hidden === true ? request.buyerReview.hiddenReason : undefined,
    verifiedTrade: true,
    tradeAmount: request.usdtAmount,
    network: request.network,
  };
}

export async function submitBuyerTradeReview(input: {
  requestId: string;
  buyerUserId: string;
  rating: number;
  comment: string;
}) {
  const db = await readDb();
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.requestId);
  if (requestIndex === -1) throw new Error("Trade not found.");
  const request = db.purchaseRequests[requestIndex];
  if (request.buyerId !== input.buyerUserId) throw new Error("Only the buyer can submit this review.");
  if (!request.completedAt && request.status !== "review_open" && request.status !== "locked" && request.status !== "completed") {
    throw new Error("Review unlocks only after trade completion.");
  }
  if (hasBuyerReviewSubmitted(db, request)) throw new Error("Buyer review already submitted.");

  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const comment = String(input.comment ?? "").trim();
  if (!comment) throw new Error("Review comment is required.");
  if (comment.length > 500) throw new Error("Review comment is too long.");

  const review = buildSellerReviewFromTrade(request, { buyerUserId: input.buyerUserId, rating, comment });
  db.purchaseRequests[requestIndex] = {
    ...request,
    buyerReview: {
      reviewerUserId: input.buyerUserId,
      rating,
      comment,
      createdAt: review.createdAt,
      hidden: false,
      hiddenReason: undefined,
    },
    updatedAt: nowIso(),
  };

  await appendAuditLog(db, {
    action: "trade_review_submitted",
    actorUserId: input.buyerUserId,
    targetUserId: request.sellerId,
    purchaseRequestId: request.id,
    listingId: request.listingId,
    details: `Buyer review submitted for trade ${request.tradeId ?? request.id}`,
  });
  pushNotification(db, {
    userId: request.sellerId,
    category: "review",
    title: "Buyer left a review",
    message: "A buyer submitted a review for a completed trade.",
    relatedTradeId: request.tradeId ?? request.id,
    relatedListingId: request.listingId,
    relatedHref: "/usdt-exchange",
  });
  pushActivityLog(db, {
    userId: input.buyerUserId,
    category: "trade",
    title: "Review submitted",
    details: `Review submitted for trade ${request.tradeId ?? request.id}.`,
  });

  const sellerSnapshotBefore = computeSellerReputationSnapshot(db, request.sellerId);
  const sellerSnapshotAfter = computeSellerReputationSnapshot(db, request.sellerId);
  await writeDb(db, { selectedTables: TRADE_REVIEW_TABLES });
  publishRealtimeEvent({
    type: "review.count_changed",
    payload: {
      sellerId: request.sellerId,
      reviewCount: db.purchaseRequests.filter((item) => item.sellerId === request.sellerId && item.buyerReview && item.buyerReview.hidden !== true).length,
    },
  });
  return {
    review,
    sellerProgress: {
      previousRank: sellerSnapshotBefore.level,
      newRank: sellerSnapshotAfter.level,
      nextRank: sellerSnapshotAfter.nextRank,
      remainingVolumeToNextRank: sellerSnapshotAfter.remainingVolumeToNextRank ?? 0,
      progressPercent: sellerSnapshotAfter.prestigeProgressPercent ?? 0,
      promoted: sellerSnapshotBefore.level !== sellerSnapshotAfter.level,
    },
  };
}

export async function submitSellerReviewResponse(input: {
  requestId?: string;
  reviewId?: string;
  sellerUserId: string;
  message: string;
}) {
  const db = await readDb();
  const requestIndex = input.reviewId
    ? db.purchaseRequests.findIndex((item) => `review-${item.id}` === input.reviewId || (item.tradeId ? `review-${item.tradeId}` === input.reviewId : false))
    : db.purchaseRequests.findIndex((item) => item.id === input.requestId);
  if (requestIndex === -1) throw new Error("Trade not found.");
  const request = db.purchaseRequests[requestIndex];
  const reviewRecord = buildSellerReviewRecordFromRequest(request);
  if (!reviewRecord) throw new Error("Seller response is available only after buyer review.");
  if (request.sellerId !== input.sellerUserId) throw new Error("Only the seller can respond.");
  if (reviewRecord.hidden) throw new Error("Cannot reply to a hidden review.");
  if (reviewRecord.sellerReply) throw new Error("Seller response already submitted.");
  const message = String(input.message ?? "").trim();
  if (!message) throw new Error("Response message is required.");
  if (message.length > 500) throw new Error("Response message is too long.");

  db.purchaseRequests[requestIndex] = {
    ...request,
    sellerResponse: {
      responderUserId: input.sellerUserId,
      message,
      createdAt: nowIso(),
    },
    updatedAt: nowIso(),
  };
  const updatedReview = buildSellerReviewRecordFromRequest(db.purchaseRequests[requestIndex]);
  if (!updatedReview) throw new Error("Updated review could not be built.");

  await appendAuditLog(db, {
    action: "trade_review_responded",
    actorUserId: input.sellerUserId,
    targetUserId: request.buyerId,
    purchaseRequestId: request.id,
    listingId: request.listingId,
    details: `Seller response submitted for trade ${request.tradeId ?? request.id}`,
  });
  pushNotification(db, {
    userId: request.buyerId,
    category: "trade",
    title: "Seller replied to your review",
    message: "The seller responded to your completed trade review.",
    relatedTradeId: request.tradeId ?? request.id,
    relatedListingId: request.listingId,
    relatedHref: "/usdt-exchange",
  });
  pushActivityLog(db, {
    userId: input.sellerUserId,
    category: "trade",
    title: "Review response sent",
    details: `Response sent for trade ${request.tradeId ?? request.id}.`,
  });

  await writeDb(db, { selectedTables: TRADE_REVIEW_TABLES });
  return updatedReview;
}

export async function getSellerReviews(input: {
  sellerId: string;
  actorUserId?: string;
  actorRole?: UserRole;
}) {
  const db = await readDb();
  const reviews = db.purchaseRequests
    .filter((request) => request.sellerId === input.sellerId)
    .map((request) => buildSellerReviewRecordFromRequest(request))
    .filter((review): review is SellerReviewRecord => Boolean(review))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const canViewHidden = input.actorRole === "admin" || input.actorRole === "owner" || input.actorUserId === input.sellerId;
  return canViewHidden ? reviews : reviews.filter((review) => !review.hidden);
}

export async function moderateSellerReview(input: {
  reviewId: string;
  actorUserId: string;
  actorRole: UserRole;
  hidden: boolean;
  hiddenReason?: string;
}) {
  const db = await readDb();
  if (input.actorRole !== "admin" && input.actorRole !== "owner") throw new Error("Only admins can moderate reviews.");
  const requestIndex = db.purchaseRequests.findIndex((item) => `review-${item.id}` === input.reviewId || (item.tradeId ? `review-${item.tradeId}` === input.reviewId : false));
  if (requestIndex === -1) throw new Error("Review not found.");
  const request = db.purchaseRequests[requestIndex];
  if (!request.buyerReview) throw new Error("Review not found.");
  db.purchaseRequests[requestIndex] = {
    ...request,
    buyerReview: {
      ...request.buyerReview,
      hidden: input.hidden,
      hiddenReason: input.hidden ? input.hiddenReason?.trim() || "moderated" : undefined,
    },
    updatedAt: nowIso(),
  };
  const nextReview = buildSellerReviewRecordFromRequest(db.purchaseRequests[requestIndex]);
  if (!nextReview) throw new Error("Updated review could not be built.");
  await writeDb(db, { selectedTables: PURCHASE_REQUEST_ONLY_TABLES });
  publishRealtimeEvent({
    type: "review.count_changed",
    payload: {
      sellerId: request.sellerId,
      reviewCount: db.purchaseRequests.filter((item) => item.sellerId === request.sellerId && item.buyerReview && item.buyerReview.hidden !== true).length,
    },
  });
  return nextReview;
}

export async function updatePurchaseRequestStatus(input: {
  requestId: string;
  actorUserId: string;
  actorRole: UserRole;
  nextStatus: PurchaseRequestStatus;
  safetyAcknowledged?: boolean;
  traceId?: string;
}) {
  const startedAt = Date.now();
  const debugTradeRoom = process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
  const isUsdtSentTrace = input.nextStatus === "usdt_sent";
  if (debugTradeRoom && isUsdtSentTrace) {
    console.log("[usdt-sent-trace] service entry", {
      traceId: input.traceId ?? null,
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    });
  }
  let db = await readDb({ bypassCache: true });
  const readDbMs = Date.now() - startedAt;
  let timelineMs = 0;
  let chatMs = 0;
  let notificationMs = 0;
  let requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.requestId);
  if (requestIndex === -1) {
    throw new TradeBlockedError("purchase-request-not-found", "Purchase request not found.", input.requestId, {
      guard: "request-exists",
      nextStatus: input.nextStatus,
    });
  }
  let request = db.purchaseRequests[requestIndex];
  let stateBefore = request.status;
  console.log("[trade-consistency] mutation db-read", {
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    nextStatus: input.nextStatus,
    statusBefore: stateBefore,
  });

  const isSeller = request.sellerId === input.actorUserId;
  const isBuyer = request.buyerId === input.actorUserId;
  const isAdmin = input.actorRole === "admin" || input.actorRole === "owner";

  if (!isSeller && !isBuyer && !isAdmin) {
    throw new TradeBlockedError("actor-not-allowed", "You are not allowed to update this request.", request.id, {
      guard: "actor-membership",
      nextStatus: input.nextStatus,
      actorUserId: input.actorUserId,
      sellerId: request.sellerId,
      buyerId: request.buyerId,
    });
  }

  if (isSeller && !["accepted", "declined", "funds_received", "usdt_release_pending", "usdt_sent"].includes(input.nextStatus)) {
    throw new TradeBlockedError("seller-transition-not-allowed", "Seller can only set accepted, declined, funds_received, usdt_release_pending, or usdt_sent.", request.id, {
      guard: "seller-next-status-allowlist",
      nextStatus: input.nextStatus,
      actorUserId: input.actorUserId,
    });
  }
  if (isBuyer && !["cancelled", "payment_sent", "completed"].includes(input.nextStatus)) {
    throw new TradeBlockedError("buyer-transition-not-allowed", "Buyer can only set cancelled, payment_sent, or completed.", request.id, {
      guard: "buyer-next-status-allowlist",
      nextStatus: input.nextStatus,
      actorUserId: input.actorUserId,
    });
  }

  let currentStatus = request.status;
  if (input.nextStatus === "completed" && (currentStatus === "review_open" || currentStatus === "completed" || currentStatus === "locked")) {
    const enriched = enrichRequestWithEvidence(db, request);
    return {
      request: enriched,
      metrics: {
        totalMs: Date.now() - startedAt,
        readDbMs,
        timelineMs,
        chatMs,
        notificationMs,
        writeDbMs: 0,
        sseMs: 0,
        trustMs: 0,
      },
    };
  }
  if (input.nextStatus === "completed" && currentStatus !== "usdt_sent") {
    const strongDb = await readDb({ bypassCache: true });
    const strongIndex = strongDb.purchaseRequests.findIndex((item) => item.id === input.requestId);
    if (strongIndex !== -1) {
      const strongRequest = strongDb.purchaseRequests[strongIndex];
      const strongStatus = strongRequest.status;
      if (strongStatus === "review_open" || strongStatus === "completed" || strongStatus === "locked") {
        const enriched = enrichRequestWithEvidence(strongDb, strongRequest);
        return {
          request: enriched,
          metrics: {
            totalMs: Date.now() - startedAt,
            readDbMs,
            timelineMs,
            chatMs,
            notificationMs,
            writeDbMs: 0,
            sseMs: 0,
            trustMs: 0,
          },
        };
      }
      if (strongStatus === "usdt_sent") {
        db = strongDb;
        requestIndex = strongIndex;
        request = strongRequest;
        stateBefore = strongStatus;
        currentStatus = strongStatus;
      }
    }
  }
  // Nullable lookup — the listing may no longer exist for in-progress trades (admin delete, cascade, data migration).
  // Acceptance strictly requires a live listing; all other transitions use it opportunistically.
  const listing = db.marketplaceListings.find((item) => item.id === request.listingId);
  if (!listing) {
    console.warn("[trade-store] listing not found for in-progress transition", {
      requestId: input.requestId,
      listingId: request.listingId,
      nextStatus: input.nextStatus,
      currentStatus,
    });
  }
  const requestPaymentMethod = normalizeMarketplacePaymentMethod(request.paymentMethod) ?? "Bank Transfer";
  const isFaceToFaceTrade = isFaceToFacePaymentMethod(requestPaymentMethod);
  const isAtmTrade = isCardlessAtmPaymentMethod(requestPaymentMethod);
  const isBankTransferTrade = isBankTransferPaymentMethod(requestPaymentMethod);
  const allowedByStatus: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
    pending: ["accepted", "declined", "cancelled"],
    accepted: ["payment_sent", "cancelled"],
    payment_sent: ["funds_received"],
    funds_received: ["usdt_release_pending"],
    usdt_release_pending: ["usdt_sent"],
    usdt_sent: ["completed"],
    completed: ["locked"],
    locked: ["review_open"],
    review_open: [],
    declined: [],
    cancelled: [],
  };
  if (input.nextStatus === "completed" && currentStatus !== "usdt_sent") {
    throw new TradeBlockedError("confirmation-prerequisite-missing", "Buyer confirmation requires seller release (status usdt_sent) before completion.", request.id, {
      guard: "completed-requires-usdt-sent",
      currentStatus,
      expectedStatus: "usdt_sent",
      nextStatus: input.nextStatus,
      actorUserId: input.actorUserId,
    });
  }
  if (!allowedByStatus[currentStatus].includes(input.nextStatus)) {
    throw new TradeBlockedError("invalid-status-transition", `Invalid status transition from ${currentStatus} to ${input.nextStatus}.`, request.id, {
      guard: "allowed-by-status",
      currentStatus,
      nextStatus: input.nextStatus,
      allowedNextStatuses: allowedByStatus[currentStatus],
      actorUserId: input.actorUserId,
    });
  }

  const actorRole = resolveActorRole(db, input.actorUserId);
  const now = nowIso();
  const next: PurchaseRequest = {
    ...request,
    timeline: [...(request.timeline ?? [])],
    updatedAt: now,
  };

  if (input.nextStatus === "accepted") {
    if (!listing) {
      throw new TradeBlockedError("listing-not-found", "Listing not found.", request.id, {
        guard: "listing-exists",
        listingId: request.listingId,
        nextStatus: input.nextStatus,
      });
    }
    if (listing.sellerId !== input.actorUserId && !isAdmin) {
      throw new TradeBlockedError("seller-mismatch", "Only the seller can accept this trade.", request.id, {
        guard: "seller-ownership",
        listingId: listing.id,
        listingSellerId: listing.sellerId,
        actorUserId: input.actorUserId,
        nextStatus: input.nextStatus,
      });
    }
    if (listing.activeTradeRequestId && listing.activeTradeRequestId !== request.id) {
      throw new TradeBlockedError("listing-already-matched", "This listing already has another buyer in progress.", request.id, {
        guard: "listing-active-trade-slot",
        listingId: listing.id,
        listingActiveTradeRequestId: listing.activeTradeRequestId,
        thisRequestId: request.id,
        nextStatus: input.nextStatus,
      });
    }
    // Allow acceptance if: listing is active, OR listing is locked by this request (re-entry after crash),
    // OR listing is expired/paused but this request was already pending against it (expired after request was submitted).
    const listingIsOpenForAccept =
      listing.status === "active" ||
      (listing.activeTradeRequestId === request.id && isListingLocked(listing.status)) ||
      (listing.status === "expired" && !listing.activeTradeRequestId);
    if (!listingIsOpenForAccept) {
      console.error("[trade-accept-guard] listing-not-open", {
        requestId: input.requestId,
        listingId: listing.id,
        listingStatus: listing.status,
        listingApprovalStatus: listing.approvalStatus,
        activeTradeRequestId: listing.activeTradeRequestId,
        actorUserId: input.actorUserId,
      });
      throw new TradeBlockedError("listing-not-open", "This listing is not open for matching.", request.id, {
        guard: "listing-status-open",
        listingId: listing.id,
        listingStatus: listing.status,
        listingApprovalStatus: listing.approvalStatus,
        activeTradeRequestId: listing.activeTradeRequestId,
        nextStatus: input.nextStatus,
      });
    }
    if (isFaceToFaceTrade && !next.sellerSafetyAcknowledged && input.safetyAcknowledged !== true) {
      throw new TradeBlockedError("safety-acknowledgment-required", "Seller must acknowledge the Face-to-Face safety guidelines before starting this trade.", request.id, {
        guard: "face-to-face-safety",
        paymentMethod: requestPaymentMethod,
        nextStatus: input.nextStatus,
      });
    }
    const pendingCommissionCount = getSellerPendingCommissionCount(db, request.sellerId);
    if (pendingCommissionCount > 0) {
      console.error("[trade-accept-guard] commission-locked", {
        requestId: input.requestId,
        sellerId: request.sellerId,
        pendingCommissionCount,
      });
      throw new TradeBlockedError("commission-due", "You have a pending commission payment. Settle it before accepting new trades.", request.id, {
        guard: "seller-commission-clear",
        sellerId: request.sellerId,
        pendingCommissionCount,
        nextStatus: input.nextStatus,
      });
    }
    next.status = "accepted";
    if (isFaceToFaceTrade) {
      next.sellerSafetyAcknowledged = true;
    }
    next.tradeId = next.tradeId ?? `trade-${randomUUID()}`;
    next.tradeCreatedAt = now;
    listing.status = "matched";
    listing.activeTradeRequestId = request.id;
    listing.lockedAt = now;
    listing.updatedAt = now;
    appendTradeTimelineEntry(next, { type: "request_accepted", actorUserId: input.actorUserId, actorRole, message: "Seller accepted request", createdAt: now });
    appendSystemTradeMessage(db, next, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Seller accepted the trade request. Buyer can now upload the payment receipt.",
      createdAt: now,
    });
    for (let siblingIndex = 0; siblingIndex < db.purchaseRequests.length; siblingIndex += 1) {
      const sibling = db.purchaseRequests[siblingIndex];
      if (sibling.id === request.id || sibling.listingId !== request.listingId || sibling.status !== "pending") continue;
      const declinedSibling: PurchaseRequest = {
        ...sibling,
        status: "declined",
        updatedAt: now,
        timeline: [...(sibling.timeline ?? [])],
      };
      appendTradeTimelineEntry(declinedSibling, {
        type: "request_declined",
        actorUserId: input.actorUserId,
        actorRole,
        message: "Seller matched another buyer for this listing",
        createdAt: now,
      });
      db.purchaseRequests[siblingIndex] = declinedSibling;
      pushNotification(db, {
        userId: sibling.buyerId,
        category: "trade",
        title: "Listing unavailable",
        message: `Request ${sibling.id} was declined because the listing matched another buyer.`,
        relatedTradeId: sibling.tradeId,
        relatedListingId: sibling.listingId,
        relatedHref: requestDetailsHref(sibling.id),
      });
    }
    await appendListingStateAudit(db, {
      action: "listing_matched",
      actorUserId: input.actorUserId,
      targetUserId: request.sellerId,
      listingId: request.listingId,
      purchaseRequestId: request.id,
      details: `Listing ${listing.id} matched with buyer ${request.buyerId}.`,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade request accepted",
      message: isFaceToFaceTrade
        ? "Your meeting is ready. Review the safety guidelines before meeting."
        : "Seller accepted your trade request. You can now upload your payment receipt.",
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
  } else if (input.nextStatus === "declined") {
    next.status = "declined";
    appendTradeTimelineEntry(next, { type: "request_declined", actorUserId: input.actorUserId, actorRole, message: "Seller declined request", createdAt: now });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade cancelled",
      message: `Your trade request was declined by the seller.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
  } else if (input.nextStatus === "cancelled") {
    next.status = "cancelled";
    appendTradeTimelineEntry(next, { type: "request_cancelled", actorUserId: input.actorUserId, actorRole, message: "Buyer cancelled request", createdAt: now });
    if (listing && listing.activeTradeRequestId === request.id) {
      unlockListingAfterCancelledTrade(db, listing, input.actorUserId, request, "Buyer cancelled the trade.");
    }
  } else if (input.nextStatus === "payment_sent") {
    const buyerEvidence = getTradeEvidenceFile(db, request.id, "buyer");
    if (!buyerEvidence) throw new Error("Buyer evidence is required before marking payment sent.");
    next.status = "payment_sent";
    next.buyerEvidence = buyerEvidence;
    next.paymentSentAt = now;
    if (listing && listing.activeTradeRequestId === request.id) {
      listing.status = "in_trade";
      listing.updatedAt = now;
    }
    const timelineStartedAt = Date.now();
    appendTradeTimelineEntry(next, { type: "payment_sent", actorUserId: input.actorUserId, actorRole, message: "Buyer marked payment sent", createdAt: now });
    timelineMs += Date.now() - timelineStartedAt;
    const chatStartedAt = Date.now();
    appendSystemTradeMessage(db, next, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Buyer submitted payment. Seller should now confirm the money was received.",
      createdAt: now,
    });
    chatMs += Date.now() - chatStartedAt;
    const notificationStartedAt = Date.now();
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: isAtmTrade ? "Withdrawal ready" : "Buyer marked payment sent",
      message: isBankTransferTrade
        ? "Buyer marked payment as sent. Please verify the funds in your bank account."
        : isAtmTrade
          ? "Buyer has prepared the cardless withdrawal. Confirm after collecting the cash."
          : "Buyer marked payment as sent. Confirm funds in person after following safety guidelines.",
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    notificationMs += Date.now() - notificationStartedAt;
  } else if (input.nextStatus === "funds_received") {
    next.status = "funds_received";
    next.fundsReceivedAt = now;
    appendTradeTimelineEntry(next, { type: "seller_confirmed_funds", actorUserId: input.actorUserId, actorRole, message: "Seller confirmed funds received", createdAt: now });
    appendSystemTradeMessage(db, next, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Seller confirmed the funds were received. USDT release is now unlocked.",
      createdAt: now,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: isAtmTrade ? "Seller confirmed cash collected" : "Seller confirmed funds received",
      message: isBankTransferTrade
        ? "Seller verified the bank transfer and confirmed funds received."
        : isAtmTrade
          ? "Seller confirmed cash was collected from the cardless ATM."
          : "Seller confirmed in-person payment was received.",
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
  } else if (input.nextStatus === "usdt_release_pending") {
    next.status = "usdt_release_pending";
    next.usdtReleaseStartedAt = now;
    next.usdtReleaseDeadlineAt = addMinutesIso(now, 45);
    appendTradeTimelineEntry(next, { type: "usdt_release_started", actorUserId: input.actorUserId, actorRole, message: "Seller started USDT release", createdAt: now });
    appendSystemTradeMessage(db, next, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Seller started the 45-minute USDT release window.",
      createdAt: now,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "USDT release pending",
      message: `Seller started the USDT release process. The 45-minute window has begun.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
  } else if (input.nextStatus === "usdt_sent") {
    const sellerEvidence = getTradeEvidenceFile(db, request.id, "seller");
    if (isSellerEvidenceRequiredForPaymentMethod(requestPaymentMethod) && !sellerEvidence) {
      throw new Error("Seller evidence is required before marking USDT sent.");
    }
    next.status = "usdt_sent";
    if (sellerEvidence) {
      next.sellerEvidence = sellerEvidence;
    }
    next.usdtSentAt = now;
    appendTradeTimelineEntry(next, { type: "usdt_sent", actorUserId: input.actorUserId, actorRole, message: "Seller marked USDT sent", createdAt: now });
    appendSystemTradeMessage(db, next, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Seller marked USDT as sent. Buyer should now confirm receipt.",
      createdAt: now,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Seller marked USDT sent",
      message: `Seller marked USDT as sent. Please confirm receipt to complete the trade.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
  } else if (input.nextStatus === "completed") {
    next.completedAt = now;
    appendTradeTimelineEntry(next, { type: "trade_completed", actorUserId: input.actorUserId, actorRole, message: "Buyer confirmed trade completed", createdAt: now });
    next.lockedAt = now;
    appendTradeTimelineEntry(next, { type: "trade_locked", actorUserId: input.actorUserId, actorRole, message: "Trade locked", createdAt: now });
    next.reviewUnlockedAt = now;
    next.status = "review_open";
    appendTradeTimelineEntry(next, { type: "review_unlocked", actorUserId: input.actorUserId, actorRole, message: "Review window unlocked", createdAt: now });
    appendSystemTradeMessage(db, next, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Buyer confirmed USDT receipt. The trade is complete and has moved to history.",
      createdAt: now,
    });

    const remainingAmount = listing ? Math.max(0, toNumber(listing.availableAmount) - toNumber(next.usdtAmount)) : 0;
    if (listing) {
      listing.availableAmount = remainingAmount.toFixed(2).replace(/\.00$/, "");
      listing.activeTradeRequestId = undefined;
      listing.lockedAt = undefined;
      listing.updatedAt = now;
      if (remainingAmount > 0) {
        const expiresMs = listing.expiresAt ? new Date(listing.expiresAt).getTime() : 0;
        const shouldExpire = Boolean(expiresMs && !Number.isNaN(expiresMs) && expiresMs <= Date.now());
        listing.status = shouldExpire ? "expired" : "active";
        listing.expiredAt = shouldExpire ? now : undefined;
        await appendListingStateAudit(db, {
          action: shouldExpire ? "listing_expired" : "listing_reopened",
          actorUserId: input.actorUserId,
          targetUserId: request.sellerId,
          listingId: request.listingId,
          purchaseRequestId: request.id,
          details: shouldExpire
            ? `Listing ${listing.id} expired after trade completion with ${listing.availableAmount} USDT remaining.`
            : `Listing ${listing.id} reopened with ${listing.availableAmount} USDT remaining.`,
        });
      } else {
        listing.availableAmount = "0";
        listing.status = "completed";
        listing.completedAt = now;
        await appendListingStateAudit(db, {
          action: "listing_completed",
          actorUserId: input.actorUserId,
          targetUserId: request.sellerId,
          listingId: request.listingId,
          purchaseRequestId: request.id,
          details: `Listing ${listing.id} completed after selling out.`,
        });
      }
    } else {
      console.warn("[trade-store] listing not found during completion — skipping listing state update", {
        requestId: input.requestId,
        listingId: request.listingId,
      });
    }
    const hasCommission = db.commissionRecords.some((record) => record.purchaseRequestId === request.id);
    if (!hasCommission) {
      const normalizedGross = toNumber(next.fiatAmount);
      const normalizedUsdt = toNumber(next.usdtAmount);
      const commissionAmount = isQaCommissionModeEnabled() ? 1 : roundUsdt(normalizedUsdt * 0.01);
      const commission: CommissionRecord = {
        id: `commission-${randomUUID()}`,
        purchaseRequestId: request.id,
        tradeId: next.tradeId,
        listingId: request.listingId,
        sellerId: request.sellerId,
        buyerId: request.buyerId,
        rate: 0.01,
        grossAmount: normalizedGross,
        commissionAmount,
        paymentStatus: "pending",
        dueAt: addDaysIso(now, COMMISSION_GRACE_PERIOD_DAYS),
        paidAt: undefined,
        overdueNotifiedAt: undefined,
        createdAt: now,
        updatedAt: now,
      };
      db.commissionRecords.push(commission);
      appendTradeTimelineEntry(next, {
        type: "commission_recorded",
        actorUserId: input.actorUserId,
        actorRole,
        message: `Commission created (${commission.commissionAmount.toFixed(2)} USDT).`,
        createdAt: now,
      });
      appendSystemTradeMessage(db, next, {
        senderUserId: input.actorUserId,
        senderRole: actorRole,
        message: `Commission due was created for the seller (${commission.commissionAmount.toFixed(2)} USDT).`,
        createdAt: now,
      });
      await appendAuditLog(db, {
        action: "commission_recorded",
        actorUserId: input.actorUserId,
        targetUserId: request.sellerId,
        listingId: request.listingId,
        purchaseRequestId: request.id,
        details: `Commission recorded for trade ${next.tradeId ?? request.id}.`,
      });
    }
    await appendAuditLog(db, {
      action: "purchase_completed",
      actorUserId: input.actorUserId,
      targetUserId: request.sellerId,
      listingId: request.listingId,
      purchaseRequestId: request.id,
      details: `Completed trade ${next.tradeId ?? request.id}`,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade completed",
      message: `Your trade is complete and has been moved to your trade history.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Review available",
      message: `You can now leave a rating and review for this trade.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: "Trade completed",
      message: `Buyer confirmed receipt. The trade is complete. Check your commission due.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    const owner = getOwnerUser(db);
    const largeTradeThreshold = getLargeTradeThreshold();
    const gross = toNumber(next.fiatAmount);
    if (owner && gross >= largeTradeThreshold) {
      pushNotification(db, {
        userId: owner.id,
        category: "trade",
        title: "Large-value trade completed",
        message: `Trade ${next.tradeId ?? request.id} completed at ${next.currency} ${next.fiatAmount} (threshold ${largeTradeThreshold}).`,
        relatedTradeId: next.tradeId,
        relatedListingId: request.listingId,
        relatedHref: "/admin/alpha-exchange",
      });
    }
    pushActivityLog(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade completed",
      details: `Trade ${next.tradeId ?? request.id} completed.`,
    });
    pushActivityLog(db, {
      userId: request.sellerId,
      category: "trade",
      title: "Trade completed",
      details: `Trade ${next.tradeId ?? request.id} completed.`,
    });
  } else if (input.nextStatus === "locked") {
    next.lockedAt = now;
    next.status = "locked";
    appendTradeTimelineEntry(next, { type: "trade_locked", actorUserId: input.actorUserId, actorRole, message: "Trade locked", createdAt: now });
  } else if (input.nextStatus === "review_open") {
    next.reviewUnlockedAt = now;
    next.status = "review_open";
    appendTradeTimelineEntry(next, { type: "review_unlocked", actorUserId: input.actorUserId, actorRole, message: "Review window unlocked", createdAt: now });
  } else {
    next.status = input.nextStatus;
  }
  db.purchaseRequests[requestIndex] = next;
  console.log("[trade-consistency] mutation status-after", {
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    nextStatus: input.nextStatus,
    statusAfter: next.status,
  });
  if (input.nextStatus === "accepted" && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1") {
    console.log("[trade-room-open] state transition after accept", {
      requestId: next.id,
      tradeId: next.tradeId ?? null,
      purchaseRequestStatus: next.status,
      listingId: listing?.id ?? null,
      listingStatus: listing?.status ?? null,
      listingActiveTradeRequestId: listing?.activeTradeRequestId ?? null,
      sellerId: next.sellerId,
      buyerId: next.buyerId,
    });
  }
  const shouldRecalculateTrust = input.nextStatus === "completed" || input.nextStatus === "declined" || input.nextStatus === "cancelled";
  const beforeTrustMs = Date.now();
  if (shouldRecalculateTrust) {
    await recalculateTrustEngine(db, {
      reason: input.nextStatus === "completed" ? "Trade completed" : "Trade lifecycle updated",
      triggeredBy: input.actorUserId,
    });
  }
  const trustMs = Date.now() - beforeTrustMs;

  if (debugTradeRoom && isUsdtSentTrace) {
    console.log("[usdt-sent-trace] before DB write", { traceId: input.traceId ?? null, requestId: input.requestId });
  }
  const beforeWriteMs = Date.now();
  console.log("[trade-consistency] mutation db-write-start", {
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    nextStatus: input.nextStatus,
  });
  // For trust-affecting transitions, write only the core trade tables synchronously so the
  // response returns quickly (≤5s target). Trust-related tables (user profiles, snapshots,
  // activity logs) are written in a deferred task via after() in the route handler.
  await writeDb(db, {
    traceTag: debugTradeRoom && isUsdtSentTrace ? input.traceId : undefined,
    selectedTables: shouldRecalculateTrust ? TRADE_COMPLETION_CORE_TABLES : TRADE_STATUS_BASE_TABLES,
  });
  const writeDbMs = Date.now() - beforeWriteMs;
  console.log("[trade-consistency] mutation commit-complete", {
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    nextStatus: input.nextStatus,
    statusAfter: next.status,
    writeDbMs,
  });
  if (debugTradeRoom && isUsdtSentTrace) {
    console.log("[usdt-sent-trace] after DB write", { traceId: input.traceId ?? null, requestId: input.requestId });
  }
  const enriched = enrichRequestWithEvidence(db, db.purchaseRequests[requestIndex]);
  const sseStartedAt = Date.now();
  publishRealtimeEvent({
    type: "trade.status_changed",
    payload: {
      requestId: next.id,
      request: enriched,
      status: next.status,
      timeline: next.timeline,
      publishedAtEpochMs: Date.now(),
    },
  });
  const sseMs = Date.now() - sseStartedAt;
  console.log("[trade-consistency] mutation sse-publish", {
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    nextStatus: input.nextStatus,
    statusAfter: next.status,
  });
  const totalMs = Date.now() - startedAt;
  if (debugTradeRoom) {
    console.log("[trade-room-action] state-transition", {
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      nextStatus: input.nextStatus,
      stateBefore,
      stateAfter: enriched.status,
      shouldRecalculateTrust,
      metrics: {
        readDbMs,
        timelineMs,
        chatMs,
        notificationMs,
        sseMs,
        trustMs,
        writeDbMs,
        totalMs,
      },
    });
  }
  return {
    request: enriched,
    // When trust was recalculated, return a deferred task that writes the trust tables.
    // The route handler runs this via after() so the HTTP response is sent first.
    deferredTrustWrite: shouldRecalculateTrust
      ? async () => {
          await writeDb(db, { selectedTables: TRADE_COMPLETION_TRUST_TABLES });
        }
      : undefined,
    metrics: {
      readDbMs,
      timelineMs,
      chatMs,
      notificationMs,
      sseMs,
      trustMs,
      writeDbMs,
      totalMs,
    },
  };
}

export async function getPurchaseRequestsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.purchaseRequests.map((request) => enrichRequestWithEvidence(db, request));
}

export async function getCommissionRecordsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.commissionRecords;
}

// ── Blockchain Commission Verification ──────────────────────────────────────

type CommissionWalletVerificationResult = {
  verified: boolean;
  reference: string;
  notes: string;
};

/**
 * Supported stablecoin payment tokens per EVM network (all 6-decimal, ≈$1 USD value).
 * Any of these transferred to the commission wallet counts as valid commission payment.
 * Key = lowercase contract address.
 */
const EVM_SUPPORTED_TOKENS: Record<string, Record<string, { symbol: string; decimals: number }>> = {
  ERC20: {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  },
  POLYGON: {
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { symbol: "USDT", decimals: 6 },
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": { symbol: "USDC.e", decimals: 6 },  // bridged USDC
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC",   decimals: 6 },  // native USDC
  },
};
/** Primary USDT contract per network — used for cross-network probing and RPC fallback compatibility */
const EVM_USDT_CONTRACTS: Record<string, string> = {
  ERC20: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  POLYGON: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
};
/**
 * Etherscan V2 unified API endpoint.
 * V2 covers all supported chains via the `chainid` parameter using a single API key.
 * V1 per-chain endpoints (api.etherscan.io/api, api.polygonscan.com/api) are deprecated.
 */
const EVM_EXPLORER_V2_URL = "https://api.etherscan.io/v2/api";
/** EIP-155 chain IDs for each supported network */
const EVM_CHAIN_IDS: Record<string, string> = {
  ERC20: "1",     // Ethereum mainnet
  POLYGON: "137", // Polygon mainnet
};
/** Single API key env var — Etherscan V2 covers all chains with one key */
const EVM_EXPLORER_API_KEY_ENV = "ALPHA_EXCHANGE_ETHERSCAN_API_KEY";
/**
 * Public JSON-RPC fallback endpoints — no API key required.
 * Used when the primary Etherscan V2 API is rate-limited or unavailable.
 * Configure ALPHA_EXCHANGE_ETH_RPC_URL / ALPHA_EXCHANGE_POLYGON_RPC_URL to override.
 */
const EVM_RPC_FALLBACKS: Record<string, string> = {
  ERC20: "https://cloudflare-eth.com",        // Cloudflare Ethereum gateway
  POLYGON: "https://polygon-rpc.com",          // Official Polygon Labs RPC
};
const SOLANA_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export { normalizeTransactionHash } from "@/lib/tx-hash-utils";

interface EvmReceiptLog {
  address?: string;
  topics?: string[];
  data?: string;
}
interface EvmTxReceipt {
  status?: string;
  blockNumber?: string;
  logs?: EvmReceiptLog[];
}
interface EvmTx {
  blockNumber?: string | null;
}
interface SolanaTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { uiAmount?: number | null };
}

/** Logs API key presence on first use (no secret values exposed). */
function logEvmKeyDiagnostics(network: string, hasKey: boolean) {
  const rpcFallbackEnv = network === "ERC20" ? "ALPHA_EXCHANGE_ETH_RPC_URL" : "ALPHA_EXCHANGE_POLYGON_RPC_URL";
  const rpcOverride = process.env[rpcFallbackEnv];
  console.log("[commission-verify] evm-key-diagnostics", {
    network,
    chainId: EVM_CHAIN_IDS[network],
    explorerApiKeyPresent: hasKey,
    explorerEndpoint: `${EVM_EXPLORER_V2_URL}?chainid=${EVM_CHAIN_IDS[network]}`,
    rpcFallbackConfigured: Boolean(rpcOverride),
    rpcFallbackUrl: rpcOverride ? "(configured)" : EVM_RPC_FALLBACKS[network],
  });
}

/**
 * Verifies an EVM USDT transfer using a direct JSON-RPC endpoint.
 * Called as fallback when the Etherscan/Polygonscan explorer API fails.
 */
async function verifyEvmUsdtPaymentViaRpc(input: {
  network: string;
  recipientWalletAddress: string;
  txHash: string;
  amountDueUsdt: number;
  rpcUrl: string;
  networkLabel: string;
  usdtContract: string;
  minConfirmations: number;
}): Promise<CommissionWalletVerificationResult> {
  const { txHash, rpcUrl, networkLabel, minConfirmations } = input;

  const rpcPost = async (method: string, params: unknown[]) => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const data = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (data.error) throw new Error(`RPC error: ${data.error.message}`);
    return data.result;
  };

  console.log("[commission-verify] rpc-fallback-start", { network: input.network, rpcUrl, txHash });

  const receipt = (await rpcPost("eth_getTransactionReceipt", [txHash])) as EvmTxReceipt | null;
  if (!receipt) {
    // Check if tx exists but is pending
    const tx = (await rpcPost("eth_getTransactionByHash", [txHash])) as EvmTx | null;
    if (tx) {
      return { verified: false, reference: txHash, notes: "Transaction is still pending confirmations. Please wait and try again once it is confirmed." };
    }
    return { verified: false, reference: txHash, notes: `Transaction was not found on ${networkLabel}. Please verify the hash and selected network.` };
  }

  const rawStatus = receipt.status;
  const statusInt = typeof rawStatus === "string"
    ? Number.parseInt(rawStatus, 16)
    : (typeof rawStatus === "number" ? rawStatus : -1);
  if (statusInt !== 1) {
    return {
      verified: false,
      reference: txHash,
      notes: `Transaction was reverted on-chain (status: ${rawStatus ?? "unknown"}) and cannot be used as commission payment.`,
    };
  }

  const currentBlockHex = (await rpcPost("eth_blockNumber", [])) as string;
  const currentBlock = Number.parseInt(currentBlockHex ?? "0x0", 16);
  const receiptBlock = Number.parseInt(receipt.blockNumber ?? "0x0", 16);
  const confirmations = currentBlock > 0 && receiptBlock > 0 ? (currentBlock - receiptBlock + 1) : 0;
  if (confirmations < minConfirmations) {
    return {
      verified: false,
      reference: txHash,
      notes: `Transaction is confirmed but still waiting for finality (${confirmations}/${minConfirmations} confirmations). Please try again shortly.`,
    };
  }

  const recipientPadded = `0x${"0".repeat(24)}${input.recipientWalletAddress.toLowerCase().replace("0x", "")}`;
  const networkTokens = EVM_SUPPORTED_TOKENS[input.network] ?? {};

  // Find the first supported-token Transfer event where commission wallet is the recipient.
  // Scans ALL logs (including those from internal contract calls) so proxy/relay payments are covered.
  const transferLog = receipt.logs?.find(
    (log) =>
      log.address?.toLowerCase() !== undefined &&
      networkTokens[log.address.toLowerCase()] !== undefined &&
      log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
      log.topics?.[2]?.toLowerCase() === recipientPadded,
  );
  // Any ERC-20 Transfer to the commission wallet (supported or unsupported token) — for diagnostics
  const anyTokenToWallet = receipt.logs?.find(
    (log) =>
      log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
      log.topics?.[2]?.toLowerCase() === recipientPadded,
  );
  const commissionWalletInAnyTransfer = (receipt.logs ?? []).some(
    (log) =>
      log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
      (log.topics?.[1]?.toLowerCase() === recipientPadded ||
       log.topics?.[2]?.toLowerCase() === recipientPadded),
  );

  if (!transferLog?.data) {
    const supportedSymbols = Object.values(networkTokens).map((t) => t.symbol).join(", ");
    console.log("[commission-verify] rpc-transfer-not-found", {
      network: input.network, txHash, logsCount: receipt.logs?.length ?? 0,
      anyTokenToWallet: Boolean(anyTokenToWallet),
      anyTokenAddress: anyTokenToWallet?.address,
      commissionWalletInAnyTransfer,
    });
    let notes: string;
    if (anyTokenToWallet) {
      const tokenAddr = anyTokenToWallet.address?.toLowerCase() ?? "";
      const tokenSymbol = networkTokens[tokenAddr]?.symbol ?? anyTokenToWallet.address;
      notes = `This transaction sent ${tokenSymbol} to the correct wallet, but that token is not a supported payment asset on ${networkLabel}. Accepted assets: ${supportedSymbols}.`;
    } else if (!commissionWalletInAnyTransfer) {
      notes = `This transaction does not include any transfer to or from the Alpha Traders commission wallet. Please verify you submitted the correct transaction hash — the commission payment transaction, not an unrelated wallet activity.`;
    } else {
      notes = `No supported stablecoin transfer to the Alpha Traders commission wallet was found. Accepted assets: ${supportedSymbols}. Please verify the destination wallet and selected network.`;
    }
    return { verified: false, reference: txHash, notes };
  }

  const tokenMeta = networkTokens[transferLog.address?.toLowerCase() ?? ""] ?? { symbol: "USDT", decimals: 6 };
  const amountReceived = Number(BigInt(transferLog.data)) / Math.pow(10, tokenMeta.decimals);
  if (amountReceived + 0.000001 < input.amountDueUsdt) {
    return {
      verified: false,
      reference: txHash,
      notes: `Insufficient payment. Received ${amountReceived.toFixed(2)} ${tokenMeta.symbol} on ${networkLabel}, but ${input.amountDueUsdt.toFixed(2)} USD is required.`,
    };
  }
  console.log("[commission-verify] rpc-verified", {
    network: input.network, txHash, rpcUrl,
    token: tokenMeta.symbol, amountReceived, confirmations,
  });
  return { verified: true, reference: txHash, notes: `Verified: ${amountReceived.toFixed(2)} ${tokenMeta.symbol} received on ${networkLabel}.` };
}

async function verifyEvmUsdtPayment(input: {
  network: string;
  recipientWalletAddress: string;
  txHash: string;
  amountDueUsdt: number;
}): Promise<CommissionWalletVerificationResult> {
  const usdtContract = EVM_USDT_CONTRACTS[input.network];
  const chainId = EVM_CHAIN_IDS[input.network];
  if (!usdtContract || !chainId) {
    return { verified: false, reference: input.txHash, notes: `EVM verification not configured for network: ${input.network}` };
  }
  const apiKey = process.env[EVM_EXPLORER_API_KEY_ENV] ?? "";
  const networkLabel = input.network === "ERC20" ? "Ethereum" : "Polygon";
  const minConfirmations = Math.max(1, Number(process.env.ALPHA_EXCHANGE_EVM_MIN_CONFIRMATIONS ?? "3"));

  // Log key presence on every attempt so Vercel logs show configuration status.
  logEvmKeyDiagnostics(input.network, Boolean(apiKey));
  console.log("[commission-verify] evm-lookup-start", {
    network: input.network,
    txHash: input.txHash,
    recipientWalletAddress: input.recipientWalletAddress,
    amountDueUsdt: input.amountDueUsdt,
    hasApiKey: Boolean(apiKey),
  });

  // ── Primary: Etherscan V2 unified API (chainid parameter selects network) ──
  let primaryError: string | null = null;
  try {
    const params = new URLSearchParams({ chainid: chainId, module: "proxy", action: "eth_getTransactionReceipt", txhash: input.txHash });
    if (apiKey) params.set("apikey", apiKey);

    const res = await fetch(`${EVM_EXPLORER_V2_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`Explorer API HTTP ${res.status}`);
    const data = (await res.json()) as { result?: EvmTxReceipt | string | null; message?: string; status?: string };

    // Etherscan/Polygonscan return `result` as a plain string on API-level errors
    // (rate limits, invalid key, network issues). Throw so the fallback runs.
    if (typeof data.result === "string") {
      console.error("[commission-verify] evm-api-error-will-fallback", {
        network: input.network,
        txHash: input.txHash,
        apiMessage: data.message,
        apiResult: data.result,
      });
      throw new Error(`${networkLabel} explorer API error: ${data.result}`);
    }

    if (!data.result) {
      // Receipt not yet available — check if tx exists but is pending
      const txParams = new URLSearchParams({ chainid: chainId, module: "proxy", action: "eth_getTransactionByHash", txhash: input.txHash });
      if (apiKey) txParams.set("apikey", apiKey);
      const txRes = await fetch(`${EVM_EXPLORER_V2_URL}?${txParams.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!txRes.ok) throw new Error(`Explorer API HTTP ${txRes.status}`);
      const txData = (await txRes.json()) as { result?: EvmTx | string | null };
      if (txData.result && typeof txData.result === "object") {
        console.log("[commission-verify] evm-pending", { network: input.network, txHash: input.txHash });
        return { verified: false, reference: input.txHash, notes: "Transaction is still pending confirmations on the selected network. Please wait and try again once it is confirmed." };
      }
      if (typeof txData.result === "string") throw new Error(`${networkLabel} explorer API error: ${txData.result}`);
      // Before giving up, probe the OTHER supported EVM network — common mistake is selecting
      // the wrong network (e.g. paid on Polygon but selected Ethereum).
      const otherNetwork = input.network === "ERC20" ? "POLYGON" : "ERC20";
      const otherChainId = EVM_CHAIN_IDS[otherNetwork];
      const otherNetworkLabel = otherNetwork === "ERC20" ? "Ethereum" : "Polygon";
      if (otherChainId) {
        try {
          const probeParams = new URLSearchParams({ chainid: otherChainId, module: "proxy", action: "eth_getTransactionByHash", txhash: input.txHash });
          if (apiKey) probeParams.set("apikey", apiKey);
          const probeRes = await fetch(`${EVM_EXPLORER_V2_URL}?${probeParams.toString()}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(8_000),
          });
          if (probeRes.ok) {
            const probeData = (await probeRes.json()) as { result?: EvmTx | string | null };
            if (probeData.result && typeof probeData.result === "object") {
              console.log("[commission-verify] evm-wrong-network", { selected: input.network, actual: otherNetwork, txHash: input.txHash });
              return {
                verified: false,
                reference: input.txHash,
                notes: `This transaction was found on ${otherNetworkLabel}, not ${networkLabel}. Please go back and select "${otherNetworkLabel}" as your payment network, then try again.`,
              };
            }
          }
        } catch {
          // cross-network probe failed — fall through to generic not-found
        }
      }
      console.log("[commission-verify] evm-not-found", { network: input.network, txHash: input.txHash });
      return { verified: false, reference: input.txHash, notes: `Transaction was not found on the selected ${networkLabel} network. Please verify the hash and selected network.` };
    }

    const receipt = data.result as EvmTxReceipt;
    const rawStatus = receipt.status;
    const statusInt = typeof rawStatus === "string"
      ? Number.parseInt(rawStatus, 16)
      : (typeof rawStatus === "number" ? rawStatus : -1);
    if (statusInt !== 1) {
      console.log("[commission-verify] evm-tx-failed", { network: input.network, txHash: input.txHash, rawStatus });
      return { verified: false, reference: input.txHash, notes: `Transaction was reverted on-chain (status: ${rawStatus ?? "unknown"}) and cannot be used as commission payment. Please check your wallet for a failed transaction and try a new one.` };
    }

    const blockParams = new URLSearchParams({ chainid: chainId, module: "proxy", action: "eth_blockNumber" });
    if (apiKey) blockParams.set("apikey", apiKey);
    const blockRes = await fetch(`${EVM_EXPLORER_V2_URL}?${blockParams.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!blockRes.ok) throw new Error(`Explorer API HTTP ${blockRes.status}`);
    const blockData = (await blockRes.json()) as { result?: string };
    if (typeof blockData.result === "string" && !blockData.result.startsWith("0x")) {
      throw new Error(`${networkLabel} explorer API error (blockNumber): ${blockData.result}`);
    }
    const currentBlock = Number.parseInt(blockData.result ?? "0x0", 16);
    const receiptBlock = Number.parseInt(receipt.blockNumber ?? "0x0", 16);
    const confirmations = currentBlock > 0 && receiptBlock > 0 ? (currentBlock - receiptBlock + 1) : 0;
    if (confirmations < minConfirmations) {
      console.log("[commission-verify] evm-insufficient-confirmations", { network: input.network, txHash: input.txHash, confirmations, minConfirmations });
      return { verified: false, reference: input.txHash, notes: `Transaction is confirmed but still waiting for finality (${confirmations}/${minConfirmations} confirmations). Please try again shortly.` };
    }

    const recipientPadded = `0x${"0".repeat(24)}${input.recipientWalletAddress.toLowerCase().replace("0x", "")}`;
    const networkTokens = EVM_SUPPORTED_TOKENS[input.network] ?? {};

    // Find any supported-stablecoin Transfer to the commission wallet.
    // Scans ALL logs (including those from internal contract calls) so proxy/relay payments are covered.
    const transferLog = receipt.logs?.find(
      (log) =>
        log.address?.toLowerCase() !== undefined &&
        networkTokens[log.address.toLowerCase()] !== undefined &&
        log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
        log.topics?.[2]?.toLowerCase() === recipientPadded,
    );
    // Any ERC-20 Transfer to the commission wallet (supported or unsupported token) — for diagnostics
    const anyTokenToWallet = receipt.logs?.find(
      (log) =>
        log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
        log.topics?.[2]?.toLowerCase() === recipientPadded,
    );
    // Distinct token contract addresses in this tx for diagnostic logging
    const tokenAddressesInTx = [...new Set(
      (receipt.logs ?? [])
        .filter((log) => log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC)
        .map((log) => log.address?.toLowerCase())
        .filter(Boolean)
    )];
    const commissionWalletInAnyTransfer = (receipt.logs ?? []).some(
      (log) =>
        log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
        (log.topics?.[1]?.toLowerCase() === recipientPadded ||
         log.topics?.[2]?.toLowerCase() === recipientPadded),
    );

    if (!transferLog?.data) {
      const supportedSymbols = Object.values(networkTokens).map((t) => t.symbol).join(", ");
      console.log("[commission-verify] evm-transfer-not-found", {
        network: input.network, txHash: input.txHash,
        recipientWalletAddress: input.recipientWalletAddress,
        logsCount: receipt.logs?.length ?? 0,
        tokenAddressesInTx,
        anyTokenToWallet: Boolean(anyTokenToWallet),
        anyTokenAddress: anyTokenToWallet?.address,
        commissionWalletInAnyTransfer,
      });
      let notes: string;
      if (anyTokenToWallet) {
        const tokenAddr = anyTokenToWallet.address?.toLowerCase() ?? "";
        const tokenSymbol = networkTokens[tokenAddr]?.symbol ?? anyTokenToWallet.address;
        notes = `This transaction sent ${tokenSymbol} to the correct wallet, but that token is not a supported payment asset on ${networkLabel}. Accepted assets: ${supportedSymbols}.`;
      } else if (!commissionWalletInAnyTransfer) {
        notes = `This transaction does not include any transfer to or from the Alpha Traders commission wallet. Please verify you submitted the correct transaction hash — the commission payment transaction, not an unrelated wallet activity.`;
      } else {
        notes = `No supported stablecoin transfer to the Alpha Traders commission wallet was found. Accepted assets: ${supportedSymbols}. Please verify the destination wallet and selected network.`;
      }
      return { verified: false, reference: input.txHash, notes };
    }

    const tokenMeta = networkTokens[transferLog.address?.toLowerCase() ?? ""] ?? { symbol: "USDT", decimals: 6 };
    const amountReceived = Number(BigInt(transferLog.data)) / Math.pow(10, tokenMeta.decimals);
    if (amountReceived + 0.000001 < input.amountDueUsdt) {
      console.log("[commission-verify] evm-insufficient-amount", { network: input.network, txHash: input.txHash, token: tokenMeta.symbol, amountReceived, amountDueUsdt: input.amountDueUsdt });
      return { verified: false, reference: input.txHash, notes: `Insufficient payment. Received ${amountReceived.toFixed(2)} ${tokenMeta.symbol} on ${networkLabel}, but ${input.amountDueUsdt.toFixed(2)} USD is required.` };
    }
    console.log("[commission-verify] evm-verified", { network: input.network, txHash: input.txHash, token: tokenMeta.symbol, amountReceived, confirmations, via: "explorer" });
    return { verified: true, reference: input.txHash, notes: `Verified: ${amountReceived.toFixed(2)} ${tokenMeta.symbol} received on ${networkLabel}.` };
  } catch (explorerError) {
    primaryError = explorerError instanceof Error ? explorerError.message : String(explorerError);
    console.warn("[commission-verify] evm-explorer-failed-trying-rpc", { network: input.network, txHash: input.txHash, error: primaryError });
  }

  // ── Fallback: direct JSON-RPC endpoint (no API key needed) ─────────────────
  const rpcEnvKey = input.network === "ERC20" ? "ALPHA_EXCHANGE_ETH_RPC_URL" : "ALPHA_EXCHANGE_POLYGON_RPC_URL";
  const rpcUrl = process.env[rpcEnvKey] ?? EVM_RPC_FALLBACKS[input.network];
  try {
    return await verifyEvmUsdtPaymentViaRpc({
      network: input.network,
      recipientWalletAddress: input.recipientWalletAddress,
      txHash: input.txHash,
      amountDueUsdt: input.amountDueUsdt,
      rpcUrl,
      networkLabel,
      usdtContract,
      minConfirmations,
    });
  } catch (rpcError) {
    const rpcMsg = rpcError instanceof Error ? rpcError.message : String(rpcError);
    console.error("[commission-verify] evm-both-verifiers-failed", {
      network: input.network, txHash: input.txHash,
      explorerError: primaryError, rpcError: rpcMsg, rpcUrl,
    });
    throw new Error(`Both ${networkLabel} verifiers failed. Explorer: ${primaryError}. RPC: ${rpcMsg}`);
  }
}

async function verifySolanaUsdtPayment(input: {
  recipientWalletAddress: string;
  txHash: string;
  amountDueUsdt: number;
}): Promise<CommissionWalletVerificationResult> {
  const rpcUrl = process.env.ALPHA_EXCHANGE_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

  const statusRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignatureStatuses",
      params: [[input.txHash], { searchTransactionHistory: true }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!statusRes.ok) throw new Error(`Solana RPC HTTP ${statusRes.status}`);
  const statusData = (await statusRes.json()) as {
    result?: { value?: Array<{ confirmationStatus?: string | null; err?: unknown } | null> };
    error?: { message: string };
  };
  if (statusData.error) throw new Error(`Solana RPC: ${statusData.error.message}`);
  const signatureStatus = statusData.result?.value?.[0];
  if (!signatureStatus) {
    return {
      verified: false,
      reference: input.txHash,
      notes: "Transaction was not found on the selected Solana network. Please verify the hash and selected network.",
    };
  }
  if (signatureStatus.err) {
    return { verified: false, reference: input.txHash, notes: "Solana transaction failed on chain." };
  }
  if (signatureStatus.confirmationStatus !== "finalized") {
    return {
      verified: false,
      reference: input.txHash,
      notes: "Transaction is still pending final confirmation on Solana. Please try again once it is finalized.",
    };
  }

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [input.txHash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  const data = (await res.json()) as {
    result?: { meta?: { err?: unknown; postTokenBalances?: SolanaTokenBalance[]; preTokenBalances?: SolanaTokenBalance[] } } | null;
    error?: { message: string };
  };
  if (data.error) throw new Error(`Solana RPC: ${data.error.message}`);

  if (!data.result) {
    return { verified: false, reference: input.txHash, notes: "Transaction not found on Solana. It may still be pending — please wait for confirmation." };
  }
  if (data.result.meta?.err) {
    return { verified: false, reference: input.txHash, notes: "Solana transaction failed on chain." };
  }

  const post = data.result.meta?.postTokenBalances ?? [];
  const pre = data.result.meta?.preTokenBalances ?? [];

  // Sum USDT balance increases for the recipient wallet across all token accounts
  let received = 0;
  for (const postBal of post) {
    if (postBal.mint !== SOLANA_USDT_MINT || postBal.owner !== input.recipientWalletAddress) continue;
    const preBal = pre.find((b) => b.accountIndex === postBal.accountIndex);
    const postAmt = Number(postBal.uiTokenAmount?.uiAmount ?? 0);
    const preAmt = Number(preBal?.uiTokenAmount?.uiAmount ?? 0);
    received += postAmt - preAmt;
  }

  if (received <= 0) {
    return {
      verified: false,
      reference: input.txHash,
      notes: "No USDT received at the configured Alpha Traders Solana wallet in this transaction.",
    };
  }
  if (received + 0.000001 < input.amountDueUsdt) {
    return {
      verified: false,
      reference: input.txHash,
      notes: `Insufficient payment. Received ${received.toFixed(2)} USDT on Solana, but ${input.amountDueUsdt.toFixed(2)} USDT is required.`,
    };
  }

  console.log(`[commission-verify] Solana USDT received: ${received.toFixed(6)} → ${input.recipientWalletAddress}`);
  return { verified: true, reference: input.txHash, notes: `Verified: ${received.toFixed(2)} USDT received on Solana.` };
}

async function verifyCommissionWalletPayment(input: {
  amountDue: number;
  network: string;
  payerWalletAddress: string;
  recipientWalletAddress: string;
  paymentSignature: string;
  existingSignatures?: string[];
}): Promise<CommissionWalletVerificationResult> {
  const txHash = normalizeTransactionHash(input.paymentSignature);
  const logCtx = { txHash, network: input.network, amountDue: input.amountDue, payerWallet: input.payerWalletAddress };
  console.log("[commission-verify] verification-started", logCtx);

  // 1. Format check
  if (txHash.length < 24) {
    console.log("[commission-verify] rejected:hash-too-short", logCtx);
    return { verified: false, reference: txHash, notes: "Transaction hash is too short to be valid." };
  }
  if ((input.network === "ERC20" || input.network === "POLYGON") && !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    console.log("[commission-verify] rejected:invalid-evm-hash-format", logCtx);
    return { verified: false, reference: txHash, notes: "Invalid transaction hash for the selected EVM network. Please paste the full 0x transaction hash." };
  }
  if (input.network === "SOL" && !/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(txHash)) {
    console.log("[commission-verify] rejected:invalid-solana-sig-format", logCtx);
    return { verified: false, reference: txHash, notes: "Invalid Solana transaction signature. Please paste the full transaction signature from your wallet or explorer." };
  }

  // 2. Duplicate hash check — prevent re-use of a previously accepted transaction
  if (input.existingSignatures?.includes(txHash)) {
    console.log("[commission-verify] rejected:duplicate-hash", logCtx);
    return { verified: false, reference: txHash, notes: "This transaction hash has already been used for a previous commission payment." };
  }

  // 3. Recipient must be configured
  if (!input.recipientWalletAddress || input.recipientWalletAddress === "AT-COMMISSION-WALLET") {
    console.error("[commission-verify] rejected:recipient-not-configured", logCtx);
    return { verified: false, reference: txHash, notes: "Commission wallet address is not configured for this network. Please contact support." };
  }

  // 4. Network-specific on-chain verification
  let result: CommissionWalletVerificationResult;
  try {
    if (input.network === "ERC20" || input.network === "POLYGON") {
      result = await verifyEvmUsdtPayment({
        network: input.network,
        recipientWalletAddress: input.recipientWalletAddress,
        txHash,
        amountDueUsdt: input.amountDue,
      });
    } else if (input.network === "SOL") {
      result = await verifySolanaUsdtPayment({
        recipientWalletAddress: input.recipientWalletAddress,
        txHash,
        amountDueUsdt: input.amountDue,
      });
    } else {
      console.log("[commission-verify] rejected:unsupported-network", logCtx);
      result = { verified: false, reference: txHash, notes: `Network '${input.network}' is not supported. Accepted: ERC20, POLYGON, SOL.` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[commission-verify] blockchain-service-error", { ...logCtx, error: msg });
    return { verified: false, reference: txHash, notes: "Blockchain verification service temporarily unavailable. Please try again in a few minutes." };
  }
  console.log("[commission-verify] verification-complete", {
    ...logCtx,
    verified: result.verified,
    notes: result.notes,
  });
  return result;
}

export async function submitSellerCommissionWalletPayment(input: {
  sellerUserId: string;
  commissionId: string;
  payerWalletAddress: string;
  paymentSignature: string;
  network?: string;
}) {
  const startedAt = Date.now();
  const dbReadStartedAt = Date.now();
  const db = await readDb();
  const dbReadMs = Date.now() - dbReadStartedAt;
  const validationStartedAt = Date.now();
  const index = db.commissionRecords.findIndex((record) => record.id === input.commissionId);
  if (index === -1) throw new Error("Commission record not found.");
  const current = db.commissionRecords[index];
  if (current.sellerId !== input.sellerUserId) {
    throw new Error("You can only settle your own commission.");
  }
  if (normalizeCommissionPaymentStatus(current.paymentStatus, current.dueAt) === "paid") {
    throw new Error("This commission is already settled.");
  }
  const validationMs = Date.now() - validationStartedAt;

  const verificationStartedAt = Date.now();
  const chosenNetwork = (input.network ?? "ERC20").trim();
  const { getCommissionWalletForNetwork } = await import("@/lib/commission-config");
  const recipientWalletAddress =
    getCommissionWalletForNetwork(chosenNetwork) ??
    process.env.ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS ??
    process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS ??
    "AT-COMMISSION-WALLET";

  // Collect all previously accepted tx hashes to prevent re-use
  const existingSignatures = db.commissionRecords
    .filter((r) => r.paymentVerificationStatus === "verified" && r.paymentSignature)
    .map((r) => r.paymentSignature as string);

  const amountDueUsdt = getCommissionAmountDueUsdt(db, current);
  const verification = await verifyCommissionWalletPayment({
    amountDue: amountDueUsdt,
    network: chosenNetwork,
    payerWalletAddress: input.payerWalletAddress.trim(),
    recipientWalletAddress,
    paymentSignature: input.paymentSignature.trim(),
    existingSignatures,
  });
  const verificationMs = Date.now() - verificationStartedAt;
  const businessStartedAt = Date.now();
  const now = nowIso();

  const nextRecord: CommissionRecord = {
    ...current,
    paymentProvider: "crypto_wallet",
    paymentNetwork: chosenNetwork,
    payerWalletAddress: input.payerWalletAddress.trim() || undefined,
    recipientWalletAddress,
    paymentSignature: input.paymentSignature.trim(),
    paymentSubmittedAt: now,
    paymentVerificationStatus: verification.verified ? "verified" : "failed",
    paymentVerificationNotes: verification.notes,
    paymentStatus: verification.verified ? "paid" : current.paymentStatus,
    paidAt: verification.verified ? now : current.paidAt,
    updatedAt: now,
  };
  db.commissionRecords[index] = nextRecord;

  await appendAuditLog(db, {
    action: verification.verified ? "commission_paid" : "commission_recorded",
    actorUserId: input.sellerUserId,
    targetUserId: current.sellerId,
    listingId: current.listingId,
    purchaseRequestId: current.purchaseRequestId,
    details: verification.verified
      ? `Commission ${current.id} verified via ${chosenNetwork}. Amount: ${amountDueUsdt.toFixed(2)} USDT. Tx: ${input.paymentSignature.trim()}.`
      : `Commission ${current.id} payment rejected via ${chosenNetwork}. Tx: ${input.paymentSignature.trim()}. Reason: ${verification.notes}`,
  });

  if (verification.verified) {
    const request = db.purchaseRequests.find((item) => item.id === current.purchaseRequestId);
    if (request) {
      appendTradeTimelineEntry(request, {
        type: "commission_paid",
        actorUserId: input.sellerUserId,
        actorRole: resolveActorRole(db, input.sellerUserId),
        message: `Commission paid on-chain (${amountDueUsdt.toFixed(2)} USDT).`,
        createdAt: now,
      });
      publishRealtimeEvent({
        type: "trade.status_changed",
        payload: { request: enrichRequestWithEvidence(db, request) },
      });
    }
    pushNotification(db, {
      userId: current.sellerId,
      category: "trade",
      title: "Commission payment verified",
      message: `Your commission payment for trade ${current.purchaseRequestId} was verified. Your account is now fully unlocked.`,
      relatedTradeId: current.purchaseRequestId,
      relatedListingId: current.listingId,
      relatedHref: "/usdt-exchange",
    });
    // Notify owner
    const ownerUser = db.users.find((u) => isAlphaExchangeOwnerEmail(u.email));
    if (ownerUser) {
      pushNotification(db, {
        userId: ownerUser.id,
        category: "system",
        title: "Commission payment received",
        message: `Commission ${current.id} paid via ${chosenNetwork}. Amount: ${amountDueUsdt.toFixed(2)} USDT. Tx: ${input.paymentSignature.trim()}`,
        relatedTradeId: current.purchaseRequestId,
        relatedListingId: current.listingId,
        relatedHref: "/admin/commissions",
      });
    }
  }
  const businessMs = Date.now() - businessStartedAt;

  const writeStartedAt = Date.now();
  await writeDb(db, { selectedTables: COMMISSION_PAYMENT_TABLES });
  const writeMs = Date.now() - writeStartedAt;
  return {
    commission: nextRecord,
    verification,
    metrics: {
      totalMs: Date.now() - startedAt,
      readDbMs: dbReadMs,
      validationMs,
      verificationMs,
      businessMs,
      writeDbMs: writeMs,
    },
  };
}

export async function clearSellerQaCommissionDues(input: {
  sellerUserId: string;
}) {
  if (!isQaCommissionModeEnabled()) {
    throw new Error("QA commission mode is not enabled.");
  }

  const db = await readDb();
  const now = nowIso();
  const sellerPendingCommissions = db.commissionRecords.filter(
    (record) =>
      record.sellerId === input.sellerUserId &&
      normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt) !== "paid",
  );

  for (const current of sellerPendingCommissions) {
    const index = db.commissionRecords.findIndex((record) => record.id === current.id);
    if (index === -1) continue;
    const amountDueUsdt = getCommissionAmountDueUsdt(db, current);
    db.commissionRecords[index] = {
      ...current,
      paymentProvider: "qa_reset",
      paymentNetwork: "QA",
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: "Cleared automatically by QA commission mode.",
      paymentSubmittedAt: now,
      paidAt: now,
      updatedAt: now,
    };
    const request = db.purchaseRequests.find((item) => item.id === current.purchaseRequestId);
    if (request) {
      appendTradeTimelineEntry(request, {
        type: "commission_paid",
        actorUserId: input.sellerUserId,
        actorRole: resolveActorRole(db, input.sellerUserId),
        message: `QA commission cleanup cleared ${amountDueUsdt.toFixed(2)} USDT.`,
        createdAt: now,
      });
    }
    await appendAuditLog(db, {
      action: "commission_paid",
      actorUserId: input.sellerUserId,
      targetUserId: current.sellerId,
      listingId: current.listingId,
      purchaseRequestId: current.purchaseRequestId,
      details: `QA commission cleanup cleared ${current.id}.`,
    });
  }

  await writeDb(db, { selectedTables: COMMISSION_RESET_TABLES });
  return {
    clearedCount: sellerPendingCommissions.length,
  };
}

export async function clearSellerCommissionDuesByAdmin(input: {
  sellerUserIds: string[];
  adminUserId: string;
}) {
  const db = await readDb();
  const now = nowIso();
  const sellerUserIdSet = new Set(input.sellerUserIds.filter(Boolean));
  const sellerPendingCommissions = db.commissionRecords.filter(
    (record) =>
      sellerUserIdSet.has(record.sellerId) &&
      normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt) !== "paid",
  );

  for (const current of sellerPendingCommissions) {
    const index = db.commissionRecords.findIndex((record) => record.id === current.id);
    if (index === -1) continue;
    const amountDueUsdt = getCommissionAmountDueUsdt(db, current);
    db.commissionRecords[index] = {
      ...current,
      paymentProvider: "qa_reset",
      paymentNetwork: "QA",
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: "Cleared by admin reset-by-email action.",
      paymentSubmittedAt: now,
      paidAt: now,
      updatedAt: now,
    };
    const request = db.purchaseRequests.find((item) => item.id === current.purchaseRequestId);
    if (request) {
      appendTradeTimelineEntry(request, {
        type: "commission_paid",
        actorUserId: input.adminUserId,
        actorRole: resolveActorRole(db, input.adminUserId),
        message: `Admin cleared ${amountDueUsdt.toFixed(2)} USDT commission.`,
        createdAt: now,
      });
      publishRealtimeEvent({
        type: "trade.status_changed",
        payload: { request: enrichRequestWithEvidence(db, request) },
      });
    }
    await appendAuditLog(db, {
      action: "commission_paid",
      actorUserId: input.adminUserId,
      targetUserId: current.sellerId,
      listingId: current.listingId,
      purchaseRequestId: current.purchaseRequestId,
      details: `Admin reset-by-email cleared commission ${current.id}.`,
    });
  }

  await writeDb(db, { selectedTables: COMMISSION_RESET_TABLES });
  return {
    clearedCount: sellerPendingCommissions.length,
  };
}

export async function updateCommissionPaymentStatus(input: {
  commissionId: string;
  actorUserId: string;
  paymentStatus: "pending" | "paid" | "overdue";
  paymentVerificationStatus?: "pending_verification" | "verified" | "failed";
  paymentVerificationNotes?: string;
  reason?: string;
}) {
  const db = await readDb();
  const index = db.commissionRecords.findIndex((record) => record.id === input.commissionId);
  if (index === -1) throw new Error("Commission record not found.");
  const now = nowIso();
  const current = db.commissionRecords[index];
  const amountDueUsdt = getCommissionAmountDueUsdt(db, current);
  const request = db.purchaseRequests.find((item) => item.id === current.purchaseRequestId);
  db.commissionRecords[index] = {
    ...current,
    paymentStatus: input.paymentStatus,
    paymentVerificationStatus:
      input.paymentVerificationStatus
      ?? (input.paymentStatus === "paid"
        ? "verified"
        : input.paymentStatus === "pending"
          ? current.paymentVerificationStatus
          : current.paymentVerificationStatus),
    paymentVerificationNotes:
      input.paymentVerificationNotes !== undefined
        ? input.paymentVerificationNotes.trim() || undefined
        : current.paymentVerificationNotes,
    paidAt: input.paymentStatus === "paid" ? now : undefined,
    overdueNotifiedAt: input.paymentStatus === "overdue" ? current.overdueNotifiedAt ?? now : undefined,
    updatedAt: now,
  };
  await appendAuditLog(db, {
    action: input.paymentStatus === "paid" ? "commission_paid" : input.paymentStatus === "overdue" ? "commission_overdue" : "commission_recorded",
    actorUserId: input.actorUserId,
    targetUserId: current.sellerId,
    listingId: current.listingId,
    purchaseRequestId: current.purchaseRequestId,
    details: `Commission ${current.id} marked ${input.paymentStatus}.`,
    reason: input.reason?.trim() || undefined,
  });
  if (input.paymentStatus === "paid") {
    if (request) {
      appendTradeTimelineEntry(request, {
        type: "commission_paid",
        actorUserId: input.actorUserId,
        actorRole: resolveActorRole(db, input.actorUserId),
        message: `Commission marked paid (${amountDueUsdt.toFixed(2)} USDT).`,
        createdAt: now,
      });
    }
    pushNotification(db, {
      userId: current.sellerId,
      category: "trade",
      title: "Commission marked paid",
      message: `Commission for trade ${current.purchaseRequestId} has been marked paid.`,
      relatedTradeId: current.purchaseRequestId,
      relatedListingId: current.listingId,
      relatedHref: "/usdt-exchange",
    });
  }
  if (request) {
    publishRealtimeEvent({
      type: "trade.status_changed",
      payload: { request: enrichRequestWithEvidence(db, request) },
    });
  }
  await writeDb(db, { selectedTables: COMMISSION_STATUS_TABLES });
  return db.commissionRecords[index];
}

export async function getAuditLogsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.auditLogs;
}

export async function createPrivateBetaInvite(input: {
  ownerUserId: string;
  maxUses: number;
  expiresAt?: string;
}) {
  const db = await readDb();
  const maxUses = Math.max(1, Math.min(1000, Math.floor(input.maxUses)));
  const invite: PrivateBetaInviteCode = {
    id: `invite-${randomUUID()}`,
    code: `AKB-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
    status: "active",
    maxUses,
    usedCount: 0,
    expiresAt: input.expiresAt,
    createdByUserId: input.ownerUserId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.privateBetaInvites.unshift(invite);
  await appendAuditLog(db, {
    action: "beta_invite_created",
    actorUserId: input.ownerUserId,
    details: `Created invite ${invite.code} (${invite.maxUses} max uses).`,
  });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
  return invite;
}

export async function updatePrivateBetaInviteStatus(input: {
  ownerUserId: string;
  inviteId: string;
  action: "expire" | "disable";
}) {
  const db = await readDb();
  const inviteIndex = db.privateBetaInvites.findIndex((item) => item.id === input.inviteId);
  if (inviteIndex === -1) throw new Error("Invite not found.");
  const current = db.privateBetaInvites[inviteIndex];
  const nextStatus: "expired" | "disabled" = input.action === "expire" ? "expired" : "disabled";
  db.privateBetaInvites[inviteIndex] = {
    ...current,
    status: nextStatus,
    updatedAt: nowIso(),
  };
  await appendAuditLog(db, {
    action: input.action === "expire" ? "beta_invite_expired" : "beta_invite_disabled",
    actorUserId: input.ownerUserId,
    details: `${input.action === "expire" ? "Expired" : "Disabled"} invite ${current.code}.`,
  });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
  return db.privateBetaInvites[inviteIndex];
}

export async function submitBetaFeedback(input: {
  userId: string;
  category: BetaFeedbackCategory;
  message: string;
}) {
  const db = await readDb();
  const user = db.users.find((item) => item.id === input.userId);
  if (!user) throw new Error("User not found.");
  const message = String(input.message ?? "").trim();
  if (!message) throw new Error("Feedback message is required.");
  if (message.length > 1200) throw new Error("Feedback message is too long.");
  const feedback: BetaFeedbackEntry = {
    id: `feedback-${randomUUID()}`,
    userId: input.userId,
    category: input.category,
    message,
    status: "new",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.betaFeedback.unshift(feedback);
  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "system",
      title: "New marketplace feedback submitted",
      message: `${user.fullName} submitted ${input.category} feedback.`,
      relatedHref: "/admin/alpha-exchange",
    });
  }
  pushActivityLog(db, {
    userId: input.userId,
    category: "system",
    title: "Marketplace feedback submitted",
    details: `Category: ${input.category}`,
  });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
  return feedback;
}

export async function getBetaFeedbackForUser(userId: string) {
  const db = await readDb();
  return db.betaFeedback.filter((item) => item.userId === userId);
}

export async function updateBetaFeedbackStatus(input: {
  ownerUserId: string;
  feedbackId: string;
  status: BetaFeedbackStatus;
}) {
  const db = await readDb();
  const index = db.betaFeedback.findIndex((item) => item.id === input.feedbackId);
  if (index === -1) throw new Error("Feedback entry not found.");
  db.betaFeedback[index] = {
    ...db.betaFeedback[index],
    status: input.status,
    updatedAt: nowIso(),
  };
  await appendAuditLog(db, {
    action: "beta_feedback_status_updated",
    actorUserId: input.ownerUserId,
    details: `Set feedback ${input.feedbackId} status to ${input.status}.`,
  });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
  return db.betaFeedback[index];
}

export async function createBetaAnnouncement(input: {
  ownerUserId: string;
  title: string;
  message: string;
  type: BetaAnnouncementType;
}) {
  const db = await readDb();
  const title = String(input.title ?? "").trim();
  const message = String(input.message ?? "").trim();
  if (!title || !message) throw new Error("Announcement title and message are required.");
  if (title.length > 160) throw new Error("Announcement title is too long.");
  if (message.length > 2000) throw new Error("Announcement message is too long.");
  const announcement: BetaAnnouncement = {
    id: `announcement-${randomUUID()}`,
    title,
    message,
    type: input.type,
    isActive: true,
    createdByUserId: input.ownerUserId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.betaAnnouncements.unshift(announcement);
  for (const user of db.users) {
    if (!user.isFoundingMember) continue;
    pushNotification(db, {
      userId: user.id,
      category: "system",
      title: `Marketplace announcement: ${announcement.title}`,
      message: announcement.message.slice(0, 140),
      relatedHref: "/usdt-exchange",
    });
  }
  await appendAuditLog(db, {
    action: "beta_announcement_created",
    actorUserId: input.ownerUserId,
    details: `Published marketplace announcement ${announcement.id}.`,
  });
  await writeDb(db, { selectedTables: BETA_ANNOUNCEMENT_TABLES });
  return announcement;
}

export async function updateBetaAnnouncementState(input: {
  ownerUserId: string;
  announcementId: string;
  isActive: boolean;
}) {
  const db = await readDb();
  const index = db.betaAnnouncements.findIndex((item) => item.id === input.announcementId);
  if (index === -1) throw new Error("Announcement not found.");
  db.betaAnnouncements[index] = {
    ...db.betaAnnouncements[index],
    isActive: input.isActive,
    updatedAt: nowIso(),
  };
  await appendAuditLog(db, {
    action: "beta_announcement_updated",
    actorUserId: input.ownerUserId,
    details: `${input.isActive ? "Activated" : "Deactivated"} announcement ${input.announcementId}.`,
  });
  await writeDb(db, { selectedTables: BETA_ANNOUNCEMENT_STATE_TABLES });
  return db.betaAnnouncements[index];
}

export async function getActiveBetaAnnouncements() {
  const db = await readDb();
  return db.betaAnnouncements.filter((item) => item.isActive);
}

async function ensureTrustSnapshots(db: AlphaExchangeDb) {
  if (db.trustSnapshots.length) return false;
  await recalculateTrustEngine(db, { reason: "System initialization", triggeredBy: "system" });
  return true;
}

export async function getOwnerPrivateBetaDashboardData(dbInput?: AlphaExchangeDb): Promise<OwnerPrivateBetaDashboardData> {
  const db = dbInput ?? await readDb();
  const normalizedInvites = db.privateBetaInvites.map((invite) => {
    const status = resolveInviteStatus(invite);
    if (status !== invite.status) {
      invite.status = status;
    }
    return invite;
  });
  const pendingInvites = normalizedInvites.filter((invite) => resolveInviteStatus(invite) === "active");
  const commonMap = new Map<BetaFeedbackCategory, number>();
  for (const entry of db.betaFeedback) {
    commonMap.set(entry.category, (commonMap.get(entry.category) ?? 0) + 1);
  }
  const mostCommonRequests = [...commonMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([category, count]) => ({ category, count }));
  return {
    inviteCodes: normalizedInvites.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    inviteUses: [...db.privateBetaInviteUses].sort((left, right) => new Date(right.usedAt).getTime() - new Date(left.usedAt).getTime()),
    pendingInvites,
    feedback: [...db.betaFeedback].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    feedbackSummary: {
      mostCommonRequests,
      criticalBugs: db.betaFeedback.filter((item) => item.category === "bug" && item.status !== "resolved").length,
      suggestions: db.betaFeedback.filter((item) => item.category === "suggestion").length,
      resolved: db.betaFeedback.filter((item) => item.status === "resolved").length,
    },
    announcements: [...db.betaAnnouncements].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
  };
}

export async function getOwnerBusinessDashboardForAdmin(dbInput?: AlphaExchangeDb): Promise<OwnerBusinessDashboardMetrics> {
  const db = dbInput ?? await readDb();
  const trustInitialized = await ensureTrustSnapshots(db);
  if (trustInitialized && !dbInput) {
    await writeDb(db, { selectedTables: TRUST_INIT_TABLES });
  }

  const now = new Date();
  const nowMs = now.getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = nowMs - 7 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const activityStart = nowMs - 30 * 24 * 60 * 60 * 1000;

  const toMs = (value?: string) => {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const isToday = (value?: string) => {
    const ms = toMs(value);
    return ms >= dayStart && ms <= nowMs;
  };
  const isThisWeek = (value?: string) => {
    const ms = toMs(value);
    return ms >= weekStart && ms <= nowMs;
  };
  const isThisMonth = (value?: string) => {
    const ms = toMs(value);
    return ms >= monthStart && ms <= nowMs;
  };
  const isRecentActivity = (value?: string) => {
    const ms = toMs(value);
    return ms >= activityStart && ms <= nowMs;
  };
  const completionStamp = (request: PurchaseRequest) => {
    if (request.completedAt) return request.completedAt;
    if (request.status === "completed" || request.status === "locked" || request.status === "review_open") return request.updatedAt;
    return "";
  };

  const completedRequests = db.purchaseRequests.filter((request) => Boolean(completionStamp(request)));
  const completedToday = completedRequests.filter((request) => isToday(completionStamp(request)));
  const completedThisWeek = completedRequests.filter((request) => isThisWeek(completionStamp(request)));
  const evidenceByTrade = new Map(db.tradeEvidenceFiles.map((entry) => [`${entry.purchaseRequestId}:${entry.side}`, entry]));
  const hasBuyerEvidence = (requestId: string) => evidenceByTrade.has(`${requestId}:buyer`);
  const hasSellerEvidence = (requestId: string) => evidenceByTrade.has(`${requestId}:seller`);
  const evidenceRelevantStatuses = new Set<PurchaseRequestStatus>(["accepted", "payment_sent", "usdt_sent", "completed", "locked", "review_open"]);
  const evidenceTrackedTrades = db.purchaseRequests.filter((request) => evidenceRelevantStatuses.has(request.status));
  const missingBuyerEvidence = evidenceTrackedTrades.filter((request) => !hasBuyerEvidence(request.id)).length;
  const missingSellerEvidence = evidenceTrackedTrades.filter((request) => !hasSellerEvidence(request.id)).length;
  const tradesWaitingEvidence = evidenceTrackedTrades.filter((request) => !hasBuyerEvidence(request.id) || !hasSellerEvidence(request.id)).length;
  const evidenceVerified = evidenceTrackedTrades.filter((request) => hasBuyerEvidence(request.id) && hasSellerEvidence(request.id)).length;
  const evidenceMissing = missingBuyerEvidence + missingSellerEvidence;
  const buyerReviewsThisWeek = db.purchaseRequests
    .filter((request) => request.buyerReview && isThisWeek(request.buyerReview.createdAt))
    .map((request) => request.buyerReview?.rating ?? 0)
    .filter((rating) => rating > 0);
  const trustHistoryThisWeek = db.trustScoreHistory.filter((entry) => isThisWeek(entry.createdAt));

  const usersById = new Map(db.users.map((user) => [user.id, user]));
  const sellerName = (sellerId: string) => usersById.get(sellerId)?.fullName ?? "Unknown Seller";

  const weekSellerVolume = new Map<string, number>();
  for (const request of completedThisWeek) {
    weekSellerVolume.set(request.sellerId, (weekSellerVolume.get(request.sellerId) ?? 0) + toNumber(request.usdtAmount));
  }
  const [topSellerId = ""] = [...weekSellerVolume.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];

  const trustDeltaThisWeek = new Map<string, number>();
  for (const entry of trustHistoryThisWeek) {
    trustDeltaThisWeek.set(entry.sellerId, (trustDeltaThisWeek.get(entry.sellerId) ?? 0) + (entry.newScore - entry.oldScore));
  }
  const [fastestGrowingSellerId = ""] = [...trustDeltaThisWeek.entries()]
    .filter(([, delta]) => delta > 0)
    .sort((left, right) => right[1] - left[1])[0] ?? [];
  const highestTrustIncreaseEvent = [...trustHistoryThisWeek]
    .filter((entry) => entry.newScore > entry.oldScore)
    .sort((left, right) => (right.newScore - right.oldScore) - (left.newScore - left.oldScore))[0];

  const completedBuyerCountsThisWeek = new Map<string, number>();
  for (const request of completedThisWeek) {
    completedBuyerCountsThisWeek.set(request.buyerId, (completedBuyerCountsThisWeek.get(request.buyerId) ?? 0) + 1);
  }
  const repeatBuyerCount = [...completedBuyerCountsThisWeek.values()].filter((count) => count > 1).length;
  const repeatBuyersPercent = completedBuyerCountsThisWeek.size ? (repeatBuyerCount / completedBuyerCountsThisWeek.size) * 100 : 0;

  const tradeCompletionMinutes = completedThisWeek
    .map((request) => {
      const completedMs = toMs(completionStamp(request));
      const startedMs = toMs(request.tradeCreatedAt || request.createdAt);
      if (!completedMs || !startedMs || completedMs < startedMs) return 0;
      return (completedMs - startedMs) / 60000;
    })
    .filter((minutes) => minutes > 0);

  const allSellerVolumes = new Map<string, number>();
  for (const request of completedRequests) {
    allSellerVolumes.set(request.sellerId, (allSellerVolumes.get(request.sellerId) ?? 0) + toNumber(request.usdtAmount));
  }
  const [largestSellerId = ""] = [...allSellerVolumes.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];
  const largestTrade = [...completedRequests].sort((left, right) => toNumber(right.usdtAmount) - toNumber(left.usdtAmount))[0];

  const activeSellerSet = new Set<string>();
  for (const listing of db.marketplaceListings) {
    if (isRecentActivity(listing.createdAt) || isRecentActivity(listing.updatedAt)) {
      activeSellerSet.add(listing.sellerId);
    }
  }
  for (const request of db.purchaseRequests) {
    if (isRecentActivity(request.createdAt) || isRecentActivity(request.updatedAt)) {
      activeSellerSet.add(request.sellerId);
    }
  }
  const activeBuyerSet = new Set(
    db.purchaseRequests
      .filter((request) => isRecentActivity(request.createdAt) || isRecentActivity(request.updatedAt))
      .map((request) => request.buyerId),
  );

  const leaderboard = [...db.trustSnapshots]
    .map((entry) => entry.snapshot)
    .sort((left, right) => {
      if (right.trustScore !== left.trustScore) return right.trustScore - left.trustScore;
      if (right.totalUsdtVolume !== left.totalUsdtVolume) return right.totalUsdtVolume - left.totalUsdtVolume;
      if (right.completedTrades !== left.completedTrades) return right.completedTrades - left.completedTrades;
      if (right.rating !== left.rating) return right.rating - left.rating;
      return left.responseTimeMinutes - right.responseTimeMinutes;
    })
    .slice(0, 10)
    .map((snapshot) => ({
      sellerId: snapshot.sellerId,
      sellerName: sellerName(snapshot.sellerId),
      trustScore: Number(snapshot.trustScore.toFixed(1)),
      tradeVolumeUsdt: Number(snapshot.totalUsdtVolume.toFixed(2)),
      completedTrades: snapshot.completedTrades,
      averageRating: Number(snapshot.rating.toFixed(2)),
      responseTimeMinutes: Number(snapshot.responseTimeMinutes.toFixed(2)),
    }));

  const todayCommission = db.commissionRecords.filter((record) => isToday(record.createdAt)).reduce((sum, record) => sum + record.commissionAmount, 0);
  const weekCommission = db.commissionRecords.filter((record) => isThisWeek(record.createdAt)).reduce((sum, record) => sum + record.commissionAmount, 0);
  const monthCommission = db.commissionRecords.filter((record) => isThisMonth(record.createdAt)).reduce((sum, record) => sum + record.commissionAmount, 0);

  const liveActivity = [
    ...db.sellerApplications
      .filter((application) => application.status === "approved")
      .map((application) => ({
        id: `seller-${application.id}`,
        type: "new_seller_joined" as const,
        message: `${application.fullName} joined as an approved seller.`,
        createdAt: application.updatedAt || application.createdAt,
      })),
    ...completedRequests.map((request) => ({
      id: `trade-${request.id}`,
      type: "trade_completed" as const,
      message: `Trade ${request.tradeId ?? request.id} completed.`,
      createdAt: completionStamp(request),
    })),
    ...db.marketplaceListings
      .filter((listing) => listing.status === "active" && listing.ownerReviewedAt)
      .map((listing) => ({
        id: `listing-${listing.id}`,
        type: "listing_approved" as const,
        message: `Listing ${listing.id} approved for ${listing.sellerDisplayName}.`,
        createdAt: listing.ownerReviewedAt ?? listing.updatedAt,
      })),
    ...db.purchaseRequests
      .filter((request) => request.buyerReview?.createdAt)
      .map((request) => ({
        id: `review-${request.id}`,
        type: "review_submitted" as const,
        message: `Review submitted for trade ${request.tradeId ?? request.id}.`,
        createdAt: request.buyerReview?.createdAt ?? request.updatedAt,
      })),
    ...db.trustScoreHistory.map((entry) => ({
      id: `trust-${entry.id}`,
      type: "trust_score_updated" as const,
      message: `${sellerName(entry.sellerId)} trust score updated ${entry.oldScore.toFixed(1)} -> ${entry.newScore.toFixed(1)}.`,
      createdAt: entry.createdAt,
    })),
    ...db.disputes.map((dispute) => ({
      id: `dispute-${dispute.id}`,
      type: "dispute_opened" as const,
      message: `Dispute opened for trade ${dispute.tradeId}.`,
      createdAt: dispute.createdAt,
    })),
  ]
    .filter((entry) => Boolean(entry.createdAt))
    .sort((left, right) => toMs(right.createdAt) - toMs(left.createdAt))
    .slice(0, 25);

  const totalRequests = db.purchaseRequests.length;
  const completionRatePercent = totalRequests ? (completedRequests.length / totalRequests) * 100 : 0;
  const cancellationRatePercent = totalRequests ? (db.purchaseRequests.filter((request) => request.status === "cancelled").length / totalRequests) * 100 : 0;
  const disputeRatePercent = totalRequests ? (db.disputes.length / totalRequests) * 100 : 0;
  const averageTrustScore = db.trustSnapshots.length
    ? db.trustSnapshots.reduce((sum, entry) => sum + entry.snapshot.trustScore, 0) / db.trustSnapshots.length
    : 0;

  return {
    today: {
      completedTrades: completedToday.length,
      tradeVolumeUsdt: Number(completedToday.reduce((sum, request) => sum + toNumber(request.usdtAmount), 0).toFixed(2)),
      estimatedCommission: Number(todayCommission.toFixed(2)),
      newBuyers: db.users.filter((user) => hasRole(user, "buyer") && isToday(user.createdAt)).length,
      newSellers: db.sellerApplications.filter((application) => application.status === "approved" && isToday(application.updatedAt)).length,
      newListings: db.marketplaceListings.filter((listing) => isToday(listing.createdAt)).length,
      listingsApproved: db.marketplaceListings.filter((listing) => listing.status === "active" && isToday(listing.ownerReviewedAt)).length,
      listingsRejected: db.marketplaceListings.filter((listing) => listing.approvalStatus === "rejected" && isToday(listing.ownerReviewedAt)).length,
      pendingListings: db.marketplaceListings.filter((listing) => isListingPendingApproval(listing)).length,
      pendingSellerApplications: db.sellerApplications.filter((application) => application.status === "pending").length,
      openDisputes: db.disputes.filter((dispute) => dispute.status === "open").length,
      resolvedDisputes: db.disputes.filter((dispute) => dispute.status === "resolved" && isToday(dispute.updatedAt)).length,
      missingBuyerEvidence,
      missingSellerEvidence,
      tradesWaitingEvidence,
      evidenceVerified,
      evidenceMissing,
    },
    thisWeek: {
      tradeVolumeUsdt: Number(completedThisWeek.reduce((sum, request) => sum + toNumber(request.usdtAmount), 0).toFixed(2)),
      revenue: Number(weekCommission.toFixed(2)),
      topSeller: topSellerId ? sellerName(topSellerId) : "No seller activity yet",
      fastestGrowingSeller: fastestGrowingSellerId ? sellerName(fastestGrowingSellerId) : "No trust growth yet",
      highestTrustScoreIncrease:
        highestTrustIncreaseEvent
          ? `${sellerName(highestTrustIncreaseEvent.sellerId)} (+${(highestTrustIncreaseEvent.newScore - highestTrustIncreaseEvent.oldScore).toFixed(1)})`
          : "No trust changes yet",
      averageResponseTimeMinutes: Number(
        (db.trustSnapshots.length ? db.trustSnapshots.reduce((sum, entry) => sum + entry.snapshot.responseTimeMinutes, 0) / db.trustSnapshots.length : 0).toFixed(2),
      ),
      averageTradeCompletionTimeMinutes: Number(
        (tradeCompletionMinutes.length ? tradeCompletionMinutes.reduce((sum, value) => sum + value, 0) / tradeCompletionMinutes.length : 0).toFixed(2),
      ),
      averageBuyerRating: Number(
        (buyerReviewsThisWeek.length ? buyerReviewsThisWeek.reduce((sum, value) => sum + value, 0) / buyerReviewsThisWeek.length : 0).toFixed(2),
      ),
      repeatBuyersPercent: Number(repeatBuyersPercent.toFixed(2)),
    },
    sellerLeaderboard: leaderboard,
    marketplaceHealth: {
      completionRatePercent: Number(completionRatePercent.toFixed(2)),
      cancellationRatePercent: Number(cancellationRatePercent.toFixed(2)),
      disputeRatePercent: Number(disputeRatePercent.toFixed(2)),
      averageTrustScore: Number(averageTrustScore.toFixed(2)),
      activeSellers: activeSellerSet.size,
      activeBuyers: activeBuyerSet.size,
      listingsSold: db.marketplaceListings.filter((listing) => listing.status === "completed").length,
      listingsWaitingApproval: db.marketplaceListings.filter((listing) => isListingPendingApproval(listing)).length,
    },
    financialOverview: {
      estimatedCommissionToday: Number(todayCommission.toFixed(2)),
      estimatedCommissionThisWeek: Number(weekCommission.toFixed(2)),
      estimatedCommissionThisMonth: Number(monthCommission.toFixed(2)),
      largestTradeUsdt: Number(toNumber(largestTrade?.usdtAmount).toFixed(2)),
      largestTradeId: largestTrade?.tradeId ?? largestTrade?.id ?? "N/A",
      largestSeller: largestSellerId ? sellerName(largestSellerId) : "N/A",
      averageTradeSizeUsdt: Number(
        (completedRequests.length ? completedRequests.reduce((sum, request) => sum + toNumber(request.usdtAmount), 0) / completedRequests.length : 0).toFixed(2),
      ),
    },
    liveActivity,
  };
}

export async function getNotificationsForUser(input: {
  userId: string;
  category?: NotificationCategory;
  centerCategory?: NotificationCenterCategory;
  state?: NotificationState;
  unreadOnly?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
  includeActivity?: boolean;
}) {
  const db = await readDb();
  const now = nowIso();
  let changed = false;

  // Build the display-number lookup ONCE for the entire function so that every
  // enrichNotification call below shares it rather than rebuilding it per call.
  const sharedDisplayLookup = createExchangeDisplayLookup({
    listings: db.marketplaceListings,
    requests: db.purchaseRequests,
    commissions: db.commissionRecords,
    disputes: db.disputes,
    applications: db.sellerApplications,
  });

  db.notifications = db.notifications.map((notification) => {
    if (notification.userId !== input.userId) return notification;
    if (notification.state === "archived") return notification;
    const tradeRequest = resolveTradeContextForNotification(db, {
      userId: notification.userId,
      relatedRequestId: notification.relatedRequestId,
      relatedTradeId: notification.relatedTradeId,
      relatedListingId: notification.relatedListingId,
    });
    if (!tradeRequest) return notification;
    if (tradeRequest.status !== "completed" && tradeRequest.status !== "review_open" && tradeRequest.status !== "locked") {
      return notification;
    }
    changed = true;
    return enrichNotification(db, {
      ...notification,
      state: "archived",
      isRead: true,
      archivedAt: notification.archivedAt ?? now,
      updatedAt: now,
    }, sharedDisplayLookup);
  });
  if (changed) {
    await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
  }
  const category = input.category;
  const centerCategory = input.centerCategory;
  const query = String(input.query ?? "").trim().toLowerCase();
  // Pre-filter by userId before enriching to avoid O(all_notifications × lookup_size) work.
  const notifications = db.notifications
    .filter((notification) => notification.userId === input.userId)
    .map((notification) => enrichNotification(db, notification, sharedDisplayLookup))
    .filter((notification) => {
      if (category && notification.category !== category) return false;
      if (centerCategory && notification.centerCategory !== centerCategory) return false;
      if (input.state && notification.state !== input.state) return false;
      if (!input.state && notification.state === "archived") return false;
      if (input.unreadOnly && notification.state !== "unread") return false;
      if (!query) return true;
      const haystack = `${notification.title} ${notification.message} ${notification.relatedTradeId ?? ""} ${notification.relatedRequestId ?? ""} ${notification.relatedListingId ?? ""} ${notification.tradeSnapshot?.counterpartyName ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  const sortedNotifications = [...notifications].sort((left, right) => {
    const leftRank = typeof left.priorityRank === "number" ? left.priorityRank : 99;
    const rightRank = typeof right.priorityRank === "number" ? right.priorityRank : 99;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftUnread = left.state === "unread" ? 0 : left.state === "read" ? 1 : 2;
    const rightUnread = right.state === "unread" ? 0 : right.state === "read" ? 1 : 2;
    if (leftUnread !== rightUnread) return leftUnread - rightUnread;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
  const safeOffset = Math.max(0, Math.floor(input.offset ?? 0));
  const safeLimit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 200)));
  const unreadCount = sortedNotifications.filter((item) => item.state === "unread").length;
  const activity = input.includeActivity === false ? [] : db.activityLog.filter((entry) => entry.userId === input.userId).slice(0, 120);
  return {
    notifications: sortedNotifications.slice(safeOffset, safeOffset + safeLimit),
    total: sortedNotifications.length,
    unreadCount,
    activity,
  };
}

export async function markNotificationReadState(input: { userId: string; notificationId: string; isRead: boolean }) {
  const db = await readDb();
  const index = db.notifications.findIndex((item) => item.id === input.notificationId && item.userId === input.userId);
  if (index === -1) throw new Error("Notification not found.");
  const state: NotificationState = input.isRead ? "read" : "unread";
  db.notifications[index] = enrichNotification(db, {
    ...db.notifications[index],
    isRead: input.isRead,
    state,
    archivedAt: undefined,
    updatedAt: nowIso(),
  });
  publishRealtimeEvent({ type: "notification.updated", payload: { notification: db.notifications[index] } });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
  return db.notifications[index];
}

export async function updateNotificationState(input: { userId: string; notificationId: string; state: NotificationState }) {
  const db = await readDb();
  const index = db.notifications.findIndex((item) => item.id === input.notificationId && item.userId === input.userId);
  if (index === -1) throw new Error("Notification not found.");
  const now = nowIso();
  const state = normalizeNotificationState(input.state, db.notifications[index].isRead);
  db.notifications[index] = enrichNotification(db, {
    ...db.notifications[index],
    state,
    isRead: state !== "unread",
    archivedAt: state === "archived" ? now : undefined,
    updatedAt: now,
  });
  publishRealtimeEvent({ type: "notification.updated", payload: { notification: db.notifications[index] } });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
  return db.notifications[index];
}

export async function markAllNotificationsRead(userId: string) {
  const db = await readDb();
  const now = nowIso();
  const sharedLookup = createExchangeDisplayLookup({
    listings: db.marketplaceListings,
    requests: db.purchaseRequests,
    commissions: db.commissionRecords,
    disputes: db.disputes,
    applications: db.sellerApplications,
  });
  db.notifications = db.notifications.map((item) => {
    if (item.userId !== userId || item.state === "archived") return item;
    return enrichNotification(db, { ...item, isRead: true, state: "read", updatedAt: now }, sharedLookup);
  });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
}

export async function archiveReadNotifications(userId: string) {
  const db = await readDb();
  const now = nowIso();
  db.notifications = db.notifications.map((item) => {
    if (item.userId !== userId || item.state === "archived" || item.state === "unread") return item;
    return enrichNotification(db, { ...item, state: "archived", isRead: true, archivedAt: now, updatedAt: now });
  });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
}

export async function deleteNotification(input: { userId: string; notificationId: string }) {
  const db = await readDb();
  const exists = db.notifications.some((item) => item.id === input.notificationId && item.userId === input.userId);
  if (!exists) throw new Error("Notification not found.");
  db.notifications = db.notifications.filter((item) => !(item.id === input.notificationId && item.userId === input.userId));
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
}

export async function updateNotificationPreferences(
  input: { userId: string; preferences: Partial<NotificationPreferences> },
) {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const current = normalizeNotificationPreferences(db.users[index].notificationPreferences);
  const next = normalizeNotificationPreferences({
    inApp: typeof input.preferences.inApp === "boolean" ? input.preferences.inApp : current.inApp,
    email: typeof input.preferences.email === "boolean" ? input.preferences.email : current.email,
    sms: typeof input.preferences.sms === "boolean" ? input.preferences.sms : current.sms,
  });
  db.users[index] = {
    ...db.users[index],
    notificationPreferences: next,
    updatedAt: nowIso(),
  };
  pushActivityLog(db, {
    userId: input.userId,
    category: "account",
    title: "Notification preferences updated",
    details: `inApp=${next.inApp}, email=${next.email}, sms=${next.sms}`,
  });
  await writeDb(db, { selectedTables: NOTIFICATION_PREFERENCES_TABLES });
  return next;
}

export async function openTradeDispute(input: {
  purchaseRequestId: string;
  openedByUserId: string;
  reason: string;
}) {
  const db = await readDb();
  const request = db.purchaseRequests.find((item) => item.id === input.purchaseRequestId);
  if (!request) throw new Error("Trade not found.");
  const isParticipant = request.buyerId === input.openedByUserId || request.sellerId === input.openedByUserId;
  if (!isParticipant) throw new Error("Only trade participants can open a dispute.");
  if (request.status === "pending" || request.status === "declined" || request.status === "cancelled") {
    throw new Error("Dispute can be opened only after trade is accepted.");
  }
  const existingOpen = db.disputes.find((item) => item.purchaseRequestId === request.id && item.status === "open");
  if (existingOpen) throw new Error("An open dispute already exists for this trade.");
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new Error("Dispute reason is required.");
  if (reason.length > 500) throw new Error("Dispute reason is too long.");

  const dispute: TradeDisputeCase = {
    id: `dispute-${randomUUID()}`,
    tradeId: request.tradeId ?? request.id,
    purchaseRequestId: request.id,
    openedByUserId: input.openedByUserId,
    sellerId: request.sellerId,
    buyerId: request.buyerId,
    reason,
    buyerEvidenceId: getTradeEvidenceFile(db, request.id, "buyer")?.id,
    sellerEvidenceId: getTradeEvidenceFile(db, request.id, "seller")?.id,
    status: "open",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.disputes.unshift(dispute);
  appendTradeTimelineEntry(request, {
    type: "dispute_opened",
    actorUserId: input.openedByUserId,
    actorRole: resolveActorRole(db, input.openedByUserId),
    message: "Dispute opened for this trade.",
    createdAt: dispute.createdAt,
  });

  for (const adminUser of getAdminNotificationRecipients(db)) {
    pushNotification(db, {
      userId: adminUser.id,
      category: "dispute",
      title: "Dispute opened",
      message: `Dispute opened for trade ${dispute.tradeId}.`,
      relatedTradeId: dispute.tradeId,
      relatedHref: "/admin/alpha-exchange",
    });
  }
  pushNotification(db, {
    userId: request.buyerId,
    category: "dispute",
    title: "Dispute opened",
    message: `A dispute was opened for trade ${dispute.tradeId}.`,
    relatedTradeId: dispute.tradeId,
    relatedHref: requestDetailsHref(request.id),
  });
  pushNotification(db, {
    userId: request.sellerId,
    category: "dispute",
    title: "Dispute opened",
    message: `A dispute was opened for trade ${dispute.tradeId}.`,
    relatedTradeId: dispute.tradeId,
    relatedHref: requestDetailsHref(request.id),
  });
  pushActivityLog(db, {
    userId: input.openedByUserId,
    category: "dispute",
    title: "Dispute opened",
    details: `Dispute opened for trade ${dispute.tradeId}.`,
  });
  publishRealtimeEvent({
    type: "trade.status_changed",
    payload: { request: enrichRequestWithEvidence(db, request) },
  });
  await writeDb(db, { selectedTables: DISPUTE_WRITE_TABLES });
  return dispute;
}

export async function reportSeller(input: {
  reporterUserId: string;
  sellerId: string;
  reason: string;
  purchaseRequestId?: string;
}) {
  const db = await readDb();
  const reporter = db.users.find((item) => item.id === input.reporterUserId);
  if (!reporter) throw new Error("Reporter account not found.");
  const seller = db.users.find((item) => item.id === input.sellerId);
  if (!seller) throw new Error("Seller account not found.");
  if (input.reporterUserId === input.sellerId) throw new Error("You cannot report your own account.");
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new Error("Report reason is required.");
  if (reason.length > 500) throw new Error("Report reason is too long.");

  if (input.purchaseRequestId) {
    const request = db.purchaseRequests.find((item) => item.id === input.purchaseRequestId);
    if (!request) throw new Error("Related trade not found.");
    if (request.sellerId !== input.sellerId) throw new Error("Related trade does not match seller.");
    const isBuyerParticipant = request.buyerId === input.reporterUserId;
    if (!isBuyerParticipant) throw new Error("Only the trade buyer can file this report.");
  }

  const duplicateRecent = db.sellerReports.find((item) => item.reporterUserId === input.reporterUserId && item.sellerId === input.sellerId && item.reason === reason);
  if (duplicateRecent) throw new Error("Duplicate report detected.");

  const report: SellerReport = {
    id: `report-${randomUUID()}`,
    reporterUserId: input.reporterUserId,
    sellerId: input.sellerId,
    purchaseRequestId: input.purchaseRequestId,
    reason,
    createdAt: nowIso(),
  };
  db.sellerReports.unshift(report);

  const owner = getOwnerUser(db);
  if (owner) {
    const reportsForSeller = db.sellerReports.filter((item) => item.sellerId === input.sellerId);
    if (reportsForSeller.length >= 2) {
      pushNotification(db, {
        userId: owner.id,
        category: "report",
        title: "Multiple buyer reports detected",
        message: `Seller ${seller.fullName} has ${reportsForSeller.length} buyer reports.`,
        relatedHref: "/admin/alpha-exchange",
      });
    }
  }

  pushActivityLog(db, {
    userId: input.reporterUserId,
    category: "report",
    title: "Seller reported",
    details: `Report submitted against seller ${seller.fullName}.`,
  });
  await writeDb(db, { selectedTables: SELLER_REPORT_TABLES });
  return report;
}

export async function getAlphaExchangeSummaryForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const trustInitialized = await ensureTrustSnapshots(db);
  if (trustInitialized && !dbInput) {
    await writeDb(db, { selectedTables: TRUST_INIT_TABLES });
  }
  return {
    usersCount: db.users.length,
    approvedSellersCount: db.users.filter((user) => user.sellerStatus === "approved_seller").length,
    pendingApplicationsCount: db.sellerApplications.filter((item) => item.status === "pending").length,
    pendingListingsCount: db.marketplaceListings.filter((item) => isListingPendingApproval(item)).length,
    rejectedApplicationsCount: db.sellerApplications.filter((item) => item.status === "rejected").length,
    suspendedSellersCount: db.users.filter((user) => user.sellerStatus === "suspended").length,
    listingsCount: db.marketplaceListings.length,
    pendingRequestsCount: db.purchaseRequests.filter((item) => item.status === "pending").length,
    completedRequestsCount: db.purchaseRequests.filter((item) => item.status === "completed" || item.status === "review_open" || Boolean(item.completedAt)).length,
    totalCommissionAmount: db.commissionRecords.reduce((acc, item) => acc + item.commissionAmount, 0),
  };
}

export async function getTrustEngineOverviewForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const trustInitialized = await ensureTrustSnapshots(db);
  if (trustInitialized && !dbInput) {
    await writeDb(db, { selectedTables: TRUST_INIT_TABLES });
  }
  const snapshots = db.trustSnapshots.map((entry) => entry.snapshot);
  const byScoreDesc = [...snapshots].sort((a, b) => b.trustScore - a.trustScore);
  const byScoreAsc = [...snapshots].sort((a, b) => a.trustScore - b.trustScore);
  const historyWindow = db.trustScoreHistory.slice(0, 500);

  const growthMap = new Map<string, number>();
  const sellerName = new Map(db.users.map((user) => [user.id, user.fullName]));
  for (const entry of historyWindow) {
    growthMap.set(entry.sellerId, (growthMap.get(entry.sellerId) ?? 0) + (entry.newScore - entry.oldScore));
  }
  const growthRows = [...growthMap.entries()].map(([sellerId, change]) => ({
    sellerId,
    sellerName: sellerName.get(sellerId) ?? "Unknown Seller",
    trustDelta: Number(change.toFixed(2)),
    trustScore: Number((snapshots.find((item) => item.sellerId === sellerId)?.trustScore ?? 0).toFixed(1)),
  }));

  const flagged = snapshots
    .filter((snapshot) => snapshot.trustScore < 55 || snapshot.marketplaceViolations > 0 || snapshot.disputesLost >= 3 || snapshot.cancellationRate >= 20)
    .sort((a, b) => a.trustScore - b.trustScore)
    .slice(0, 5)
    .map((snapshot) => ({
      sellerId: snapshot.sellerId,
      sellerName: sellerName.get(snapshot.sellerId) ?? "Unknown Seller",
      trustScore: Number(snapshot.trustScore.toFixed(1)),
      level: snapshot.level,
      reason:
        snapshot.marketplaceViolations > 0
          ? "Marketplace violations"
          : snapshot.disputesLost >= 3
            ? "Disputes lost"
            : snapshot.cancellationRate >= 20
              ? "High cancellation rate"
              : "Low trust score",
    }));

  const toRow = (snapshot: SellerReputationSnapshot) => ({
    sellerId: snapshot.sellerId,
    sellerName: sellerName.get(snapshot.sellerId) ?? "Unknown Seller",
    trustScore: Number(snapshot.trustScore.toFixed(1)),
    level: snapshot.level,
    summary: `${snapshot.reputationSummary} (${Math.round(snapshot.trustScore)}/100)`,
  });

  const averageTrustScore = snapshots.length ? snapshots.reduce((sum, snapshot) => sum + snapshot.trustScore, 0) / snapshots.length : 0;
  const healthySellers = snapshots.filter((snapshot) => snapshot.trustScore >= 75).length;

  return {
    highestTrustSellers: byScoreDesc.slice(0, 5).map(toRow),
    lowestTrustSellers: byScoreAsc.slice(0, 5).map(toRow),
    fastestGrowingSellers: growthRows.filter((item) => item.trustDelta > 0).sort((a, b) => b.trustDelta - a.trustDelta).slice(0, 5),
    recentlyImprovedSellers: historyWindow
      .filter((entry) => entry.newScore > entry.oldScore)
      .slice(0, 20)
      .map((entry) => ({
        sellerId: entry.sellerId,
        sellerName: sellerName.get(entry.sellerId) ?? "Unknown Seller",
        oldScore: Number(entry.oldScore.toFixed(1)),
        newScore: Number(entry.newScore.toFixed(1)),
        reason: entry.reason,
        createdAt: entry.createdAt,
      })),
    accountsLosingTrust: growthRows.filter((item) => item.trustDelta < 0).sort((a, b) => a.trustDelta - b.trustDelta).slice(0, 5),
    flaggedSellers: flagged,
    marketplaceHealth: {
      averageTrustScore: Number(averageTrustScore.toFixed(1)),
      sellerCount: snapshots.length,
      healthySellerCount: healthySellers,
      atRiskSellerCount: snapshots.filter((snapshot) => snapshot.trustScore < 60).length,
    },
    scoreChangeLog: historyWindow.slice(0, 100),
  };
}

export async function forceCompleteTradeByAdmin(input: { requestId: string; reason: string; actorUserId: string }) {
  const db = await readDb();
  const index = db.purchaseRequests.findIndex((r) => r.id === input.requestId);
  if (index === -1) throw new Error("Purchase request not found.");
  const request = db.purchaseRequests[index];
  const now = nowIso();
  db.purchaseRequests[index] = { ...request, status: "completed", completedAt: now, updatedAt: now };
  appendTradeTimelineEntry(db.purchaseRequests[index], {
    type: "trade_completed",
    actorUserId: input.actorUserId,
    actorRole: resolveActorRole(db, input.actorUserId),
    message: "Admin force-completed this trade",
  });
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    purchaseRequestId: input.requestId,
    details: "Admin force-completed trade",
    reason: input.reason,
  });
  await writeDb(db, { selectedTables: TRADE_REVIEW_TABLES });
}

export async function forceCancelTradeByAdmin(input: { requestId: string; reason: string; actorUserId: string }) {
  const db = await readDb();
  const index = db.purchaseRequests.findIndex((r) => r.id === input.requestId);
  if (index === -1) throw new Error("Purchase request not found.");
  const request = db.purchaseRequests[index];
  const now = nowIso();
  db.purchaseRequests[index] = { ...request, status: "cancelled", updatedAt: now };
  appendTradeTimelineEntry(db.purchaseRequests[index], {
    type: "request_cancelled",
    actorUserId: input.actorUserId,
    actorRole: resolveActorRole(db, input.actorUserId),
    message: "Admin cancelled this trade",
  });
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    purchaseRequestId: input.requestId,
    details: "Admin force-cancelled trade",
    reason: input.reason,
  });
  await writeDb(db, { selectedTables: TRADE_REVIEW_TABLES });
}

export async function unlockTradeReviewByAdmin(input: { requestId: string; reason: string; actorUserId: string }) {
  const db = await readDb();
  const index = db.purchaseRequests.findIndex((r) => r.id === input.requestId);
  if (index === -1) throw new Error("Purchase request not found.");
  const request = db.purchaseRequests[index];
  const now = nowIso();
  db.purchaseRequests[index] = { ...request, reviewUnlockedAt: now, updatedAt: now };
  appendTradeTimelineEntry(db.purchaseRequests[index], {
    type: "review_unlocked",
    actorUserId: input.actorUserId,
    actorRole: resolveActorRole(db, input.actorUserId),
    message: "Admin unlocked review window",
  });
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    purchaseRequestId: input.requestId,
    details: "Admin unlocked review window",
    reason: input.reason,
  });
  await writeDb(db, { selectedTables: PURCHASE_REQUEST_ONLY_TABLES });
}

export async function changeUserRoleByAdmin(input: { userId: string; role: AlphaExchangeUser["role"]; reason: string; actorUserId: string }) {
  const db = await readDb();
  const index = db.users.findIndex((u) => u.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  if (hasRole(user, "owner")) throw new Error("Owner account role cannot be changed.");
  const oldRole = user.role;
  db.users[index] = { ...user, role: input.role, updatedAt: nowIso() };
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    targetUserId: input.userId,
    details: `User role changed from ${oldRole} to ${input.role}`,
    oldValue: oldRole,
    newValue: input.role,
    reason: input.reason,
  });
  await writeDb(db, { selectedTables: SELLER_PROFILE_STATE_TABLES });
}

export async function disableUserAccountByAdmin(input: { userId: string; disabled: boolean; reason: string; actorUserId: string }) {
  const db = await readDb();
  const index = db.users.findIndex((u) => u.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  if (hasRole(user, "owner")) throw new Error("Owner account cannot be disabled.");
  db.users[index] = { ...user, disabled: input.disabled, updatedAt: nowIso() };
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    targetUserId: input.userId,
    details: `User account ${input.disabled ? "disabled" : "enabled"}`,
    reason: input.reason,
  });
  await writeDb(db, { selectedTables: SELLER_PROFILE_STATE_TABLES });
}

export async function setSellerVacationModeByAdmin(input: { userId: string; enabled: boolean; actorUserId: string; reason?: string }) {
  const db = await readDb();
  const index = db.users.findIndex((u) => u.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  const nextStatus: SellerAvailabilityStatus = input.enabled ? "vacation" : "available";
  db.users[index] = { ...user, availabilityStatus: nextStatus, updatedAt: nowIso() };
  await appendAuditLog(db, {
    action: input.enabled ? "seller_vacation_enabled" : "seller_vacation_disabled",
    actorUserId: input.actorUserId,
    targetUserId: input.userId,
    details: `Admin ${input.enabled ? "enabled" : "disabled"} vacation mode for seller`,
    reason: input.reason?.trim() || undefined,
  });
  await writeDb(db, { selectedTables: SELLER_PROFILE_STATE_TABLES });
}

export async function broadcastNotificationByAdmin(input: { title: string; body: string; type: "info" | "warning" | "success"; actorUserId: string; reason?: string }) {
  const db = await readDb();
  for (const user of db.users) {
    pushNotification(db, {
      userId: user.id,
      category: "system",
      title: input.title,
      message: input.body,
      priority: input.type === "warning" ? "high" : "normal",
    });
  }
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    details: `Broadcast notification sent: ${input.title}`,
    reason: input.reason?.trim() || undefined,
  });
  await writeDb(db, { selectedTables: NOTIFICATION_ONLY_TABLES });
}

export async function reverifyCommissionByAdmin(input: { commissionId: string; actorUserId: string; reason?: string }) {
  const db = await readDb();
  const index = db.commissionRecords.findIndex((r) => r.id === input.commissionId);
  if (index === -1) throw new Error("Commission record not found.");
  const record = db.commissionRecords[index];
  if (!record.paymentSignature || !record.payerWalletAddress || !record.recipientWalletAddress || !record.paymentNetwork) {
    throw new Error("Commission has no payment details to reverify.");
  }
  const existingSignatures = db.commissionRecords
    .filter((r) => r.id !== input.commissionId && r.paymentVerificationStatus === "verified")
    .map((r) => r.paymentSignature)
    .filter((s): s is string => Boolean(s));
  const result = await verifyCommissionWalletPayment({
    amountDue: record.commissionAmount,
    network: record.paymentNetwork,
    payerWalletAddress: record.payerWalletAddress,
    recipientWalletAddress: record.recipientWalletAddress,
    paymentSignature: record.paymentSignature,
    existingSignatures,
  });
  db.commissionRecords[index] = {
    ...record,
    paymentVerificationStatus: result.verified ? "verified" : "failed",
    paymentVerificationNotes: result.notes,
    updatedAt: nowIso(),
  };
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    purchaseRequestId: record.purchaseRequestId,
    details: `Commission ${input.commissionId} reverified: ${result.verified ? "verified" : "failed"} — ${result.notes}`,
    reason: input.reason?.trim() || undefined,
  });
  await writeDb(db, { selectedTables: COMMISSION_STATUS_TABLES });
  return result;
}

export async function recalculateAllTrustByAdmin(input: { actorUserId: string; reason: string }) {
  const db = await readDb();
  const trimmedReason = input.reason.trim();
  if (!trimmedReason) throw new Error("Reason is required.");
  await recalculateTrustEngine(db, { reason: trimmedReason, triggeredBy: input.actorUserId });
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    details: "Admin triggered full trust recalculation.",
    reason: trimmedReason,
  });
  await writeDb(db, { selectedTables: SELLER_STATUS_TRUST_TABLES });
  return {
    sellerCount: db.trustSnapshots.length,
  };
}

export async function getAdminPrepDashboardData() {
  const db = await readDb();
  const trustInitialized = await ensureTrustSnapshots(db);
  if (trustInitialized) {
    await writeDb(db, { selectedTables: TRUST_INIT_TABLES });
  }

  const [summary, applications, approvedSellers, listings, purchaseRequests, commissionRecords, auditLogs, trustEngine, ownerBusiness, privateBeta] = await Promise.all([
    getAlphaExchangeSummaryForAdmin(db),
    getAllSellerApplicationsForAdmin(db),
    getApprovedSellersForAdmin(db),
    getMarketplaceListingsForAdmin(db),
    getPurchaseRequestsForAdmin(db),
    getCommissionRecordsForAdmin(db),
    getAuditLogsForAdmin(db),
    getTrustEngineOverviewForAdmin(db),
    getOwnerBusinessDashboardForAdmin(db),
    getOwnerPrivateBetaDashboardData(db),
  ]);
  const notifications = [...db.notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250);
  const activityLog = [...db.activityLog].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const users = db.users.map(({ passwordHash: _ph, ...rest }) => rest);
  const sellerReviews = db.sellerReviews ?? [];

  return {
    summary,
    applications,
    approvedSellers,
    listings,
    purchaseRequests,
    commissionRecords,
    auditLogs,
    notifications,
    activityLog,
    trustEngine,
    ownerBusiness,
    privateBeta,
    users,
    sellerReviews,
  };
}

export async function getOwnerPendingListingsDashboardData() {
  const db = await readDb();
  const [pendingListings, allListings, purchaseRequests] = await Promise.all([
    getPendingMarketplaceListingsForOwner(db),
    getMarketplaceListingsForAdmin(db),
    getPurchaseRequestsForAdmin(db),
  ]);

  return {
    pendingListings,
    allListings,
    purchaseRequests,
  };
}
