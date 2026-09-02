                  import { appendFileSync, mkdirSync } from "fs";
import path from "path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { after } from "next/server";
import { normalizeTransactionHash } from "@/lib/tx-hash-utils";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { createExchangeDisplayLookup, normalizeDisplayNumber, replaceExchangeEntityIds } from "./alpha-exchange-display";
import { calculateSellerTrustSnapshot, rankTrustSnapshots } from "@/lib/trust-engine";
import { computeListingReliability, RELIABILITY_NEUTRAL_BASELINE, type ListingReliability } from "@/lib/listing-reliability";
import { getSellerPrestigeProgress, getSellerPublicVolumeLabel, resolveSellerPrestigeRank, resolveSellerPrestigeRankWithFloor, sellerPrestigeRankWeight } from "@/lib/seller-prestige";
import {
  ALLOWED_LISTING_EXPIRATION_HOURS,
  BUYER_CONFIRMATION_TIMEOUT_MINUTES,
  COMMISSION_GRACE_PERIOD_DAYS,
  COMMISSION_RATE,
  DEFAULT_LISTING_EXPIRATION_HOURS,
  MAX_ACTIVE_LISTINGS_PER_SELLER,
} from "@/lib/marketplace-policy";
import { evaluateSellerAchievements } from "@/lib/seller-achievements";
import { runEnvValidation } from "@/lib/env-validation";
import { getAlphaExchangeRepository, type SnapshotTableName } from "@/lib/alpha-exchange-repository";
import { addRole, hasRole, isUserRole, normalizeRolesForUser, removeRole, resolvePrimaryRole } from "@/lib/roles";
import { publishRealtimeEvent } from "@/lib/realtime";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import {
  sendMarketplaceEmail,
  type MarketplaceEmailEvent,
  type MarketplaceEmailLocalizedText,
} from "@/lib/marketplace-email-delivery";
import {
  isRetryableAnnouncementDeliveryFailure,
  sendAdminAnnouncementBatch,
  sendAdminAnnouncementEmail,
  validateAdminAnnouncementContent,
  type AdminAnnouncementEmailContent,
} from "@/lib/admin-announcement-email";
import { getSiteUrl } from "@/lib/site-url";
import { normalizePublicProfileUsername } from "@/lib/public-profile-username";
import { formatIsraelCalendarDateKey } from "@/lib/israel-calendar";
import { assertNoDirectContactContent, containsDirectContactContent, redactPrivateContactDetails } from "@/lib/privacy-redaction";
import { getSmsTemplate, normalizeE164, resolveSmsDeliveryStatusTransition, sendTwilioMessageWithRetry, twilioStatusCallbackUrl } from "@/lib/notification-platform";
import { normalizeSellerLevel } from "@/types/alpha-exchange";
import { validateUploadContent } from "@/lib/file-content-validation";
import { toAdminSellerSummary, toAdminUserSummary } from "@/lib/client-session-user";
import { allowsRuntimeDiagnostics, allowsTestOnlyRuntime, isProductionSecurityRuntime } from "@/lib/runtime-safety";
import { logEvent } from "@/lib/structured-logging";
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
  AdminAnnouncementAudience,
  AdminAnnouncementRecipient,
  AdminAnnouncementRun,
  AdminAnnouncementStatus,
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
  SellerBankAccount,
  SellerPromotionHistoryEntry,
  SellerAchievement,
  TradeDisputeCase,
  TradeEvidenceFile,
  TradeEvidenceSide,
  TradeChatMessage,
  TradeTimelineEntry,
  TradeRoomPokeState,
  TradeTimelineEventType,
  AlphaExchangeTradeReminder,
  OwnerPrivateBetaDashboardData,
  OnboardingSelection,
  PreferredLocale,
  UserRole,
  SellerReviewRecord,
  TrustSnapshotRecord,
  TrustScoreChangeLog,
  SmsDeliveryRecord,
  SmsDeliveryStatus,
  SmsEventType,
  CompliancePaymentRail,
  MarketplaceComplianceEvidenceReference,
  MarketplaceComplianceRecoveryWalletConfig,
  MarketplaceEnforcementAuditEntry,
  MarketplaceEnforcementAuditAction,
  MarketplaceEnforcementRecord,
  MarketplaceEnforcementStatus,
  OwnerSettings,
} from "@/types/alpha-exchange";
import { getWalletAddressValidationError, normalizeWalletAddress } from "@/lib/wallet-address";
import {
  adminCommissionDestination,
  adminMarketplaceEnforcementDestination,
  adminMarketplaceListingsDestination,
  adminPurchaseRequestsDestination,
  listingDestination,
  sellerApplicationReviewDestination,
  sellerApplicationStatusDestination,
  sellerListingWorkspaceDestination,
  sellerProfileDestination,
} from "@/lib/action-destinations";
import { COMMISSION_PAYMENT_DUE_NOTIFICATION_REASON, commissionPaymentDestination } from "@/lib/commission-payment-destination";
import { normalizePreferredLocale } from "@/lib/preferred-locale";

const SELLER_EVIDENCE_TRACE_PATH = path.join(process.cwd(), "tmp", "seller-evidence-server.log");

function writeSellerEvidenceTrace(label: string, payload: unknown) {
  if (!allowsRuntimeDiagnostics() || process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM !== "1") return;
  mkdirSync(path.dirname(SELLER_EVIDENCE_TRACE_PATH), { recursive: true });
  appendFileSync(SELLER_EVIDENCE_TRACE_PATH, `${JSON.stringify({ label, payload }, null, 2)}\n`, "utf8");
}

/**
 * Detailed trade and payment diagnostics may contain identifiers, wallet data,
 * or provider responses. They are available only to local development/E2E;
 * production retains a redacted operational event for warnings and failures.
 */
function logLocalMarketplaceDiagnostic(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {},
) {
  if (allowsRuntimeDiagnostics()) {
    console[level](event, details);
    return;
  }
  if (level === "info") return;
  const error = details.error;
  logEvent(level, {
    event: "alpha_exchange_runtime_diagnostic",
    outcome: "failed",
    reason: event,
    metadata: {
      errorType: error instanceof Error ? error.name : typeof error === "string" ? "error_string" : undefined,
      diagnosticCategory: "marketplace",
    },
  });
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
const supportedComplianceEvidenceMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

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
  adminAnnouncementRuns: [],
  sellerReviews: [],
  smsDeliveries: [],
  marketplaceEnforcementRecords: [],
  marketplaceEnforcementAuditLog: [],
};

// Cache TTL: writeDb() always updates the cache on write, so correctness is
// maintained even with a long TTL. Raising from 1 s to 15 s eliminates the
// full 22-table snapshot reload that was occurring on nearly every request.
const DB_CACHE_TTL_MS = 15_000;
const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
const SYSTEM_ACTOR_USER_ID = "system:marketplace";
const MAX_SELLER_BANK_ACCOUNTS = 2;
const TRADE_INACTIVITY_WARNING_MINUTES = 15;
export const TRADE_ROOM_POKE_COOLDOWN_MS = 5 * 60_000;
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

class ConcurrentTradeMutationError extends Error {
  constructor() {
    super("Trade state changed while this action was being committed.");
    this.name = "ConcurrentTradeMutationError";
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

function normalizeDigits(value: string | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function maskBankAccountNumber(accountNumber: string) {
  const digits = normalizeDigits(accountNumber);
  if (!digits) return "";
  const last4 = digits.slice(-4);
  return `${"*".repeat(Math.max(0, digits.length - 4))}${last4}`;
}

function sanitizeSellerBankAccountInput(input: {
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
}) {
  const accountHolderName = String(input.accountHolderName ?? "").trim();
  const bankName = String(input.bankName ?? "").trim();
  const branchNumber = normalizeDigits(input.branchNumber);
  const accountNumber = normalizeDigits(input.accountNumber);
  if (!accountHolderName) throw new Error("Account holder name is required.");
  if (!bankName) throw new Error("Bank name is required.");
  if (branchNumber.length < 2 || branchNumber.length > 6) throw new Error("Branch number must be 2-6 digits.");
  if (accountNumber.length < 6 || accountNumber.length > 16) throw new Error("Account number must be 6-16 digits.");
  return {
    accountHolderName,
    bankName,
    branchNumber,
    accountNumber,
    accountLast4: accountNumber.slice(-4),
  };
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
    browserPush: input?.browserPush === true,
    browserPushTradeUpdates: input?.browserPushTradeUpdates !== false,
    browserPushChatMessages: input?.browserPushChatMessages !== false,
    browserPushListings: input?.browserPushListings !== false,
    browserPushFeedback: input?.browserPushFeedback !== false,
    browserPushAdminAlerts: input?.browserPushAdminAlerts === true,
    browserPushPermissionState: input?.browserPushPermissionState ?? "default",
    browserPushPromptDismissedAt: input?.browserPushPromptDismissedAt,
    browserPushSubscriptionHash: input?.browserPushSubscriptionHash,
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
    counterpartyName: redactExchangeUserContent(counterparty?.fullName?.trim() || (recipientIsSeller ? "Buyer" : "Seller")),
    counterpartyAvatarUrl: sanitizeCounterpartyMediaUrl(counterparty?.profilePhotoUrl),
    usdtAmount: request.usdtAmount,
    fiatAmount: request.fiatAmount,
    currency: request.currency,
    currentStage: request.status,
    requiredAction: resolveTradeRequiredAction(request, recipientIsSeller),
  };
}

function sanitizeNotificationTradeSnapshot(snapshot: NotificationTradeSnapshot | undefined) {
  if (!snapshot) return undefined;
  return {
    ...snapshot,
    counterpartyName: redactExchangeUserContent(snapshot.counterpartyName),
    counterpartyAvatarUrl: sanitizeCounterpartyMediaUrl(snapshot.counterpartyAvatarUrl) || undefined,
  };
}

function sanitizeInternalNotificationHref(value?: string) {
  const href = value?.trim();
  if (!href || !href.startsWith("/") || href.startsWith("//")) return undefined;
  return href;
}

type NotificationSellerContext = {
  displayName: string;
  username: string;
  profileHref: string;
  user?: AlphaExchangeUser;
};

function buildNotificationSellerContext(user: AlphaExchangeUser): NotificationSellerContext {
  const displayName = redactPrivateContactDetails(user.fullName?.trim() || user.buyerDisplayName?.trim() || "Seller");
  const username = derivePublicProfileUsername({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    publicTradingName: user.buyerDisplayName,
  });
  return {
    displayName,
    username,
    profileHref: sellerProfileDestination(username),
    user,
  };
}

function resolveNotificationSellerContext(db: AlphaExchangeDb, notification: AlphaExchangeNotification): NotificationSellerContext | null {
  const recipient = db.users.find((user) => user.id === notification.userId);
  if (!recipient || (!hasRole(recipient, "owner") && !hasRole(recipient, "admin"))) return null;

  const relatedUsername = normalizePublicProfileUsername(notification.relatedSellerUsername);
  const byUsername = notification.relatedSellerUsername
    ? db.users.find((user) => matchesPublicProfileUsername({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        publicTradingName: user.buyerDisplayName,
      }, relatedUsername))
    : undefined;
  const notificationText = `${notification.title ?? ""} ${notification.message ?? ""}`;
  const legacySeller = byUsername ?? db.users.find((user) => isTrustEligibleSeller(user) && notificationText.includes(user.id));
  if (legacySeller) return buildNotificationSellerContext(legacySeller);

  const displayName = redactPrivateContactDetails(notification.relatedSellerName?.trim() || "");
  if (!displayName || !notification.relatedSellerUsername) return null;
  return {
    displayName,
    username: relatedUsername,
    profileHref: sellerProfileDestination(relatedUsername),
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
  const recipientIsTradeParticipant = Boolean(request && (request.buyerId === notification.userId || request.sellerId === notification.userId));
  const matchingSellerCommission = request && request.sellerId === notification.userId
    ? getUnpaidSellerCommissionRecords(db, notification.userId).find((record) => record.purchaseRequestId === request.id)
    : undefined;
  const commissionDueText = `${notification.title} ${notification.message}`.toLowerCase();
  const isCommissionPaymentDue = Boolean(matchingSellerCommission) && (
    notification.reason === COMMISSION_PAYMENT_DUE_NOTIFICATION_REASON
    || /\bcommission\s+(?:due|overdue)\b/.test(commissionDueText)
  );
  const commissionPaymentHref = isCommissionPaymentDue && matchingSellerCommission
    ? commissionPaymentDestination(matchingSellerCommission.id)
    : undefined;
  const sellerContext = resolveNotificationSellerContext(db, notification);
  const sellerProfileHref = notification.category === "trust" ? sellerContext?.profileHref : undefined;
  const relatedHref = commissionPaymentHref
    ?? (isTradeNotification && request && recipientIsTradeParticipant
      ? requestDetailsHref(request.id)
      : sanitizeInternalNotificationHref(notification.relatedHref) ?? sellerProfileHref);
  const actionHref = commissionPaymentHref ?? (sanitizeInternalNotificationHref(notification.actionHref) || relatedHref);
  const listing = request ? db.marketplaceListings.find((item) => item.id === request.listingId) : undefined;
  // Reuse a pre-built lookup when available (batch calls) to avoid O(n) per notification.
  const displayLookup = cachedLookup ?? createExchangeDisplayLookup({
    listings: db.marketplaceListings,
    requests: db.purchaseRequests,
    commissions: db.commissionRecords,
    disputes: db.disputes,
    applications: db.sellerApplications,
  });
  const fallbackTitle = notification.category === "trade"
    ? "Trade update"
    : notification.category === "listing"
      ? "Listing update"
      : notification.category === "application"
        ? "Application update"
        : "Alpha Exchange update";
  let title = redactPrivateContactDetails(notification.title?.trim() || fallbackTitle);
  let message = redactPrivateContactDetails(notification.message?.trim() || "Open notifications for the latest account update.");
  const localizedCopy = {
    titleEn: notification.titleEn ? redactPrivateContactDetails(notification.titleEn.trim()) : undefined,
    messageEn: notification.messageEn ? redactPrivateContactDetails(notification.messageEn.trim()) : undefined,
    titleAr: notification.titleAr ? redactPrivateContactDetails(notification.titleAr.trim()) : undefined,
    messageAr: notification.messageAr ? redactPrivateContactDetails(notification.messageAr.trim()) : undefined,
  };
  if (sellerContext?.user) {
    title = title.split(sellerContext.user.id).join(sellerContext.displayName);
    message = message.split(sellerContext.user.id).join(sellerContext.displayName);
  }
  if (sellerContext && notification.category === "trust" && title.toLowerCase().includes("flagged seller")) {
    const trustScore = db.trustSnapshots.find((entry) => entry.sellerId === sellerContext.user?.id)?.snapshot.trustScore;
    title = `Flagged seller: ${sellerContext.displayName}`;
    message = `${sellerContext.displayName} triggered trust/risk signals.${typeof trustScore === "number" ? ` Trust score: ${trustScore.toFixed(1)}/100.` : ""}`;
  } else if (sellerContext && notification.category === "trust" && title.toLowerCase().includes("trust score drop")) {
    title = `Trust score drop: ${sellerContext.displayName}`;
  }
  return {
    ...notification,
    title: replaceExchangeEntityIds(title, displayLookup),
    message: replaceExchangeEntityIds(message, displayLookup),
    titleEn: localizedCopy.titleEn ? replaceExchangeEntityIds(localizedCopy.titleEn, displayLookup) : undefined,
    messageEn: localizedCopy.messageEn ? replaceExchangeEntityIds(localizedCopy.messageEn, displayLookup) : undefined,
    titleAr: localizedCopy.titleAr ? replaceExchangeEntityIds(localizedCopy.titleAr, displayLookup) : undefined,
    messageAr: localizedCopy.messageAr ? replaceExchangeEntityIds(localizedCopy.messageAr, displayLookup) : undefined,
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
    relatedSellerName: sellerContext?.displayName ?? notification.relatedSellerName,
    relatedSellerUsername: sellerContext?.username ?? notification.relatedSellerUsername,
    relatedHref,
    actionHref,
    actionLabel: commissionPaymentHref
      ? "Pay Commission"
      : notification.actionLabel?.trim() || (sellerProfileHref ? "Review Seller" : resolveNotificationActionLabel(notification, request)),
    reason: commissionPaymentHref ? COMMISSION_PAYMENT_DUE_NOTIFICATION_REASON : notification.reason,
    tradeSnapshot: isTradeNotification && recipientIsTradeParticipant
      ? sanitizeNotificationTradeSnapshot(notification.tradeSnapshot ?? buildTradeSnapshotForNotification(db, notification.userId, request))
      : undefined,
    updatedAt: notification.updatedAt ?? notification.createdAt,
  };
}

const MAX_NOTIFICATIONS_PER_USER = 600;
const MAX_NOTIFICATIONS_GLOBAL = 2400;

function pruneNotificationBacklog(db: AlphaExchangeDb) {
  if (!Array.isArray(db.notifications) || db.notifications.length <= MAX_NOTIFICATIONS_GLOBAL) return;
  const perUserKept = new Map<string, number>();
  const kept: AlphaExchangeNotification[] = [];
  for (const notification of db.notifications) {
    const userId = String(notification.userId ?? "");
    const current = perUserKept.get(userId) ?? 0;
    if (current >= MAX_NOTIFICATIONS_PER_USER) continue;
    kept.push(notification);
    perUserKept.set(userId, current + 1);
    if (kept.length >= MAX_NOTIFICATIONS_GLOBAL) break;
  }
  db.notifications = kept;
}

function getLargeTradeThreshold() {
  const raw = Number(process.env.ALPHA_EXCHANGE_LARGE_TRADE_THRESHOLD ?? "50000");
  if (Number.isNaN(raw) || raw <= 0) return 50000;
  return raw;
}

function getMaxEvidenceSizeBytes() {
  const raw = Number(process.env.ALPHA_EXCHANGE_EVIDENCE_MAX_SIZE_MB ?? "8");
  const configuredMb = Number.isFinite(raw) && raw > 0 ? raw : 8;
  // Production configuration can make uploads stricter but not create an
  // unreviewed availability exposure through an oversized upload limit.
  const maxMb = isProductionSecurityRuntime() ? Math.min(configuredMb, 8) : configuredMb;
  return Math.round(maxMb * 1024 * 1024);
}

export class TradeRoomPokeError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly cooldownUntil: string | null;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    retryAfterSeconds?: number | null;
    cooldownUntil?: string | null;
  }) {
    super(input.message);
    this.name = "TradeRoomPokeError";
    this.code = input.code;
    this.status = input.status;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.cooldownUntil = input.cooldownUntil ?? null;
  }
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
  return TRADE_INACTIVITY_WARNING_MINUTES;
}

function extensionForEvidenceMimeType(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "pdf";
}

const TRADE_ROOM_CHAT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TRADE_ROOM_IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;

function assertNoExchangeDirectContact(...values: Array<string | undefined>) {
  for (const value of values) {
    if (value !== undefined) assertNoDirectContactContent(value);
  }
}

function redactExchangeUserContent(value: string | undefined) {
  return redactPrivateContactDetails(String(value ?? ""));
}

function sanitizeCounterpartyMediaUrl(value: string | undefined) {
  const url = String(value ?? "").trim();
  return url && !containsDirectContactContent(url) ? url : "";
}

function evidenceDisplayFileName(side: TradeEvidenceSide, mimeType: string) {
  const label = side === "buyer" ? "buyer-payment-evidence" : "seller-release-evidence";
  return `${label}.${extensionForEvidenceMimeType(mimeType)}`;
}

function sanitizeTradeEvidenceForCounterparty(evidence: TradeEvidenceFile | undefined) {
  if (!evidence) return undefined;
  return {
    ...evidence,
    // The original upload name is neither needed to retrieve the blob nor safe
    // to show another participant. Storage already uses a server UUID.
    fileName: evidenceDisplayFileName(evidence.side, evidence.mimeType),
  };
}

function isSafeStoredTradeRoomImageUrl(value: string | undefined) {
  const match = TRADE_ROOM_IMAGE_DATA_URL_PATTERN.exec(String(value ?? "").trim());
  if (!match) return false;
  const mimeType = match[1]!.toLowerCase();
  if (!TRADE_ROOM_CHAT_IMAGE_MIME_TYPES.has(mimeType)) return false;
  const raw = Buffer.from(match[2]!, "base64");
  return raw.length > 0
    && raw.length <= getMaxEvidenceSizeBytes()
    && validateUploadContent(raw, mimeType as "image/jpeg" | "image/png" | "image/webp");
}

function sanitizeTradeRoomMessageForCounterparty(message: TradeChatMessage, canViewPrivateContent: boolean) {
  const imageMimeType = TRADE_ROOM_CHAT_IMAGE_MIME_TYPES.has(String(message.imageMimeType ?? "").toLowerCase())
    ? String(message.imageMimeType).toLowerCase()
    : undefined;
  const hasSafeImage = Boolean(imageMimeType && isSafeStoredTradeRoomImageUrl(message.imageUrl));
  return {
    ...message,
    message: canViewPrivateContent ? message.message : redactExchangeUserContent(message.message),
    imageUrl: hasSafeImage ? message.imageUrl : undefined,
    imageMimeType: hasSafeImage ? imageMimeType : undefined,
    imageName: hasSafeImage ? `trade-room-attachment.${extensionForEvidenceMimeType(imageMimeType!)}` : undefined,
  };
}

function sanitizeTradeTimelineForCounterparty(entry: TradeTimelineEntry, canViewPrivateContent: boolean) {
  return {
    ...entry,
    message: canViewPrivateContent ? entry.message : redactExchangeUserContent(entry.message),
  };
}

function parseTradeRoomImageDataUrl(value: string | undefined, declaredMimeType: string | undefined) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return null;
  const match = TRADE_ROOM_IMAGE_DATA_URL_PATTERN.exec(rawValue);
  if (!match) {
    throw new Error("Trade Room attachments must be PNG, JPEG, or WebP images.");
  }
  const mimeType = match[1]!.toLowerCase();
  const declared = String(declaredMimeType ?? "").trim().toLowerCase();
  if (!TRADE_ROOM_CHAT_IMAGE_MIME_TYPES.has(mimeType) || (declared && declared !== mimeType)) {
    throw new Error("Trade Room attachment type is invalid.");
  }
  const raw = Buffer.from(match[2]!, "base64");
  if (!raw.length || raw.length > getMaxEvidenceSizeBytes()) {
    throw new Error(`Trade Room attachment exceeds limit (${Math.round(getMaxEvidenceSizeBytes() / (1024 * 1024))}MB).`);
  }
  if (!validateUploadContent(raw, mimeType as "image/jpeg" | "image/png" | "image/webp")) {
    throw new Error("Trade Room attachment content does not match its declared file type.");
  }
  return { dataUrl: rawValue, mimeType };
}

function toNumber(value: string | number | null | undefined) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function roundUsdt(value: number) {
  return Number(value.toFixed(2));
}

function isQaCommissionModeEnabled() {
  return allowsTestOnlyRuntime() && process.env.ALPHA_EXCHANGE_QA_COMMISSION_MODE === "1";
}

function isQaResetModeEnabled() {
  return allowsTestOnlyRuntime() && process.env.ALPHA_EXCHANGE_QA_MODE === "1";
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

function getUnpaidSellerCommissionRecords(db: AlphaExchangeDb, sellerId: string) {
  return db.commissionRecords
    .filter((record) => record.sellerId === sellerId)
    .map((record) => ({
      ...record,
      paymentStatus: normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt),
    }))
    .filter((record) => record.paymentStatus !== "paid")
    .sort((left, right) => {
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
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
  return getUnpaidSellerCommissionRecords(db, sellerId).length;
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

function getMarketplaceEnforcementRecords(db: AlphaExchangeDb) {
  return db.marketplaceEnforcementRecords ?? [];
}

function getMarketplaceEnforcementAuditLog(db: AlphaExchangeDb) {
  return db.marketplaceEnforcementAuditLog ?? [];
}

function getOwnerComplianceRecoveryWalletConfig(db: AlphaExchangeDb): MarketplaceComplianceRecoveryWalletConfig | null {
  const owner = db.users.find((user) => hasRole(user, "owner"));
  const config = owner?.ownerSettings?.marketplaceComplianceRecoveryWallet;
  if (!config) return null;
  const walletAddress = normalizeWalletAddress(config.walletAddress ?? "");
  if (!walletAddress || !isSupportedNetwork(config.network)) return null;
  return {
    network: config.network,
    walletAddress,
    defaultPaymentRail: config.defaultPaymentRail === "alpha_wallet_one_click" ? "alpha_wallet_one_click" : "manual_wallet_transfer",
    updatedAt: config.updatedAt,
    updatedByUserId: config.updatedByUserId,
  };
}

function getRecoveryFeePaymentStatus(record: MarketplaceEnforcementRecord) {
  if (record.recoveryPaymentStatus === "awaiting_verification") return "awaiting_verification" as const;
  if (record.recoveryPaymentStatus === "confirmed_paid") return "confirmed_paid" as const;
  return "pending_payment" as const;
}

function getSellerLatestEnforcementRecord(db: AlphaExchangeDb, sellerId: string) {
  return getMarketplaceEnforcementRecords(db)
    .filter((record) => record.sellerId === sellerId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
}

function getSellerActiveEnforcementRecord(db: AlphaExchangeDb, sellerId: string) {
  return getMarketplaceEnforcementRecords(db)
    .filter((record) => record.sellerId === sellerId && record.status === "active")
    .sort((left, right) => new Date(right.issuedAt).getTime() - new Date(left.issuedAt).getTime())[0];
}

function appendMarketplaceEnforcementAudit(db: AlphaExchangeDb, input: {
  sellerId: string;
  enforcementRecordId?: string;
  action: MarketplaceEnforcementAuditAction;
  actorUserId: string;
  reason?: string;
  notes?: string;
  evidenceReferences?: MarketplaceComplianceEvidenceReference[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
}) {
  const entry: MarketplaceEnforcementAuditEntry = {
    id: `enforcement-audit-${randomUUID()}`,
    sellerId: input.sellerId,
    enforcementRecordId: input.enforcementRecordId,
    action: input.action,
    actorUserId: input.actorUserId,
    reason: input.reason,
    notes: input.notes,
    evidenceReferences: input.evidenceReferences,
    metadata: input.metadata,
    createdAt: nowIso(),
  };
  const existing = db.marketplaceEnforcementAuditLog ?? [];
  db.marketplaceEnforcementAuditLog = [entry, ...existing];
}

function getSellerEnforcementRestrictionMessage(db: AlphaExchangeDb, sellerId: string) {
  const activeRecord = getSellerActiveEnforcementRecord(db, sellerId);
  if (!activeRecord) return null;
  const paymentStatus = getRecoveryFeePaymentStatus(activeRecord);
  const statusText = paymentStatus === "awaiting_verification"
    ? " Payment is awaiting owner verification."
    : "";
  const dueText = activeRecord.dueAt
    ? ` Due by ${new Date(activeRecord.dueAt).toLocaleString("en-IL", { dateStyle: "medium", timeStyle: "short" })}.`
    : "";
  return `Your seller account is temporarily restricted due to marketplace policy violation #${activeRecord.violationNumber}. Pay the Marketplace Recovery Fee (${activeRecord.feeAmount.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${activeRecord.feeCurrency}) to restore listing and publishing access.${statusText}${dueText}`;
}

function getSellerListingBlockReason(db: AlphaExchangeDb, sellerId: string) {
  const enforcementRestriction = getSellerEnforcementRestrictionMessage(db, sellerId);
  if (enforcementRestriction) {
    return enforcementRestriction;
  }
  const pendingCommissionCount = getSellerPendingCommissionCount(db, sellerId);
  if (pendingCommissionCount > 0) {
    return "You have commission payments pending. Clear them before creating or renewing listings.";
  }
  const openListingCount = getSellerOpenListingCount(db, sellerId);
  if (openListingCount >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
    return "You already have 2 open listings, including listings awaiting review. Close one before creating another.";
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
  if (rank === "diamond") return "Premium placement and increased visibility with serious buyers.";
  if (rank === "elite") return "Elite recognition across Alpha Exchange and maximum buyer trust.";
  return "Starter prestige level unlocked.";
}

function summarizePromotionBenefitsAr(rank: SellerLevel) {
  if (rank === "silver") return "ظهور أعلى في السوق وثقة أقوى لدى المشترين.";
  if (rank === "gold") return "ترتيب ذو أولوية وإشارة ثقة أقوى على بطاقات البائعين.";
  if (rank === "diamond") return "ترتيب مميّز وظهور أكبر أمام المشترين الجادّين.";
  if (rank === "elite") return "تقدير النخبة في Alpha Exchange وأعلى مستوى من ثقة المشترين.";
  return "تم فتح مستوى المكانة الأول.";
}

function sellerRankAr(rank: SellerLevel) {
  if (rank === "bronze") return "البرونزية";
  if (rank === "silver") return "الفضية";
  if (rank === "gold") return "الذهبية";
  if (rank === "diamond") return "الماسية";
  return "النخبة";
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
  const rank = normalizeSellerLevel(String(entry.rank ?? ""));
  if (!rank) return null;
  const previousRankRaw = String(entry.previousRank ?? "");
  const previousRank = normalizeSellerLevel(previousRankRaw) ?? undefined;
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
    sellerName: redactExchangeUserContent(user.fullName),
    fullName: redactExchangeUserContent(user.fullName),
    profilePhotoUrl: sanitizeCounterpartyMediaUrl(user.profilePhotoUrl),
    memberSince: user.createdAt,
    languages: (user.languages ?? []).map((language) => redactExchangeUserContent(language)),
    preferredNetworks: user.preferredNetworks,
    bio: redactExchangeUserContent(user.bio),
    tradingExperience: redactExchangeUserContent(user.tradingExperience),
    workingHours: redactExchangeUserContent(user.workingHours),
    preferredPaymentMethods: (user.preferredPaymentMethods ?? []).map((method) => redactExchangeUserContent(method)),
    country: redactExchangeUserContent(user.country),
    city: redactExchangeUserContent(user.city),
    coverBannerUrl: sanitizeCounterpartyMediaUrl(user.coverBannerUrl),
    isFoundingSeller: user.isFoundingSeller === true,
    isFoundingMember: user.isFoundingMember === true,
    isFeaturedSeller: user.isFeaturedSeller === true,
    isProfileHidden: user.isProfileHidden === true,
    isOwner: isAlphaExchangeOwnerEmail(user.email),
    role: user.role,
    roles: user.roles ?? [user.role],
    sellerStatus: user.sellerStatus,
    allowDirectMessages: user.allowDirectMessages !== false,
    onlineStatus: user.onlineStatus,
    availabilityStatus: user.availabilityStatus,
    lastActiveAt: user.lastActiveAt,
    emailVerified: user.emailVerified === true,
  };
}

function buildPublicUserProfileDataForUser(input: {
  db: AlphaExchangeDb;
  user: AlphaExchangeUser;
  viewerUserId?: string;
  viewerRole?: UserRole;
  enforceSearchVisibility?: boolean;
  trustSnapshot?: SellerReputationSnapshot;
}) {
  const { db, enforceSearchVisibility = true, user, viewerRole, viewerUserId } = input;
  const viewerIsPrivileged = viewerRole === "admin" || viewerRole === "owner";
  const viewerIsOwner = viewerUserId === user.id;
  const canBypassVisibility = viewerIsOwner || viewerIsPrivileged;

  if (user.isProfileHidden === true && !canBypassVisibility) return null;
  if (enforceSearchVisibility && user.allowProfileSearch === false && !canBypassVisibility) return null;

  const username = derivePublicProfileUsername({ fullName: user.fullName, email: user.email, id: user.id, publicTradingName: user.buyerDisplayName });
  const trustSnapshot = input.trustSnapshot ?? (isTrustEligibleSeller(user) ? computeSellerReputationSnapshot(db, user.id) : null);
  const buyerRequests = db.purchaseRequests.filter((request) => request.buyerId === user.id);
  const sellerRequests = db.purchaseRequests.filter((request) => request.sellerId === user.id);
  const completedAsBuyer = buyerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length;
  const completedAsSeller = sellerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length;
  const reviewsWritten = buyerRequests.filter((request) => Boolean(request.buyerReview)).length;
  const reviewsReceived = sellerRequests.filter((request) => Boolean(request.buyerReview)).length;

  const showStats = user.showTradeStats !== false || canBypassVisibility;
  const showLastActive = user.showLastActive !== false || canBypassVisibility;
  const canViewSensitiveProfileDetails = canBypassVisibility;
  const explicitPublicTradingName = user.buyerDisplayName?.trim() || "";
  const fallbackPublicTradingName = isTrustEligibleSeller(user) ? "Verified Seller" : "Verified Member";
  const publicTradingName = canBypassVisibility || !containsDirectContactContent(explicitPublicTradingName)
    ? (explicitPublicTradingName || fallbackPublicTradingName)
    : fallbackPublicTradingName;
  const visibleText = (value: string | undefined) => canBypassVisibility ? String(value ?? "") : redactExchangeUserContent(value);

  return {
    profile: {
      id: user.id,
      username: canViewSensitiveProfileDetails ? username : derivePublicProfileUsername({ id: user.id, publicTradingName }),
      fullName: canViewSensitiveProfileDetails ? user.fullName : "",
      publicTradingName,
      role: user.role,
      roles: user.roles ?? [user.role],
      sellerStatus: user.sellerStatus,
      memberSince: user.createdAt,
      lastActiveAt: showLastActive ? user.lastActiveAt ?? user.updatedAt : null,
      country: visibleText(user.country),
      city: canViewSensitiveProfileDetails ? user.city ?? "" : "",
      languages: (user.languages ?? []).map((language) => visibleText(language)),
      bio: visibleText(user.bio),
      profilePhotoUrl: canBypassVisibility ? user.profilePhotoUrl ?? "" : sanitizeCounterpartyMediaUrl(user.profilePhotoUrl),
      coverBannerUrl: canBypassVisibility ? user.coverBannerUrl ?? "" : sanitizeCounterpartyMediaUrl(user.coverBannerUrl),
      isFeaturedSeller: user.isFeaturedSeller === true,
      isFoundingMember: user.isFoundingMember === true,
      isFoundingSeller: user.isFoundingSeller === true,
      allowDirectMessages: user.allowDirectMessages !== false || canBypassVisibility,
      isEmailVerified: user.emailVerified === true,
      contact: {
        email: canViewSensitiveProfileDetails ? user.email : "",
        phone: canViewSensitiveProfileDetails ? user.whatsappNumber : "",
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

function deriveStablePublicAliasFromId(id: string | undefined) {
  const normalized = String(id ?? "").trim();
  if (!normalized) return "seller";
  return `seller-${createHash("sha256").update(normalized).digest("hex").slice(0, 8)}`;
}

function deriveLegacyPublicProfileUsername(input: { fullName?: string; email?: string; id?: string }) {
  return normalizePublicProfileUsername(input.email || input.fullName || input.id);
}

export function derivePublicProfileUsername(input: { fullName?: string; email?: string; id?: string; publicTradingName?: string }) {
  const safeSource = input.publicTradingName || deriveStablePublicAliasFromId(input.id);
  return normalizePublicProfileUsername(safeSource);
}

export function matchesPublicProfileUsername(
  input: { fullName?: string; email?: string; id?: string; publicTradingName?: string },
  username: string,
) {
  const normalizedUsername = normalizePublicProfileUsername(username);
  const aliases = new Set([
    derivePublicProfileUsername(input),
    deriveLegacyPublicProfileUsername(input),
    normalizePublicProfileUsername(input.fullName || input.email || input.id),
  ]);
  return aliases.has(normalizedUsername);
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

const LISTING_END_STATUSES = new Set<ListingStatus>(["completed", "cancelled", "closed", "expired"]);
const LISTING_REMOVAL_AUDIT_ACTIONS = new Set<AuditAction>(["listing_closed", "listing_cancelled", "listing_removed"]);
const LISTING_HISTORY_AUDIT_ACTIONS = new Set<AuditAction>([
  "listing_edited",
  "listing_closed",
  "listing_cancelled",
  "listing_removed",
  "listing_paused",
  "listing_resumed",
  "listing_renewed",
]);

function listingEndTimestamp(listing: MarketplaceListing): number | null {
  const end = listing.closedAt ?? listing.cancelledAt ?? listing.completedAt ?? listing.expiredAt;
  if (!end) return null;
  const ms = new Date(end).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

interface SellerReliabilityAggregate {
  reliability: ListingReliability;
  completedTrades: number;
  cancelledTrades: number;
  totalListings: number;
  editCount: number;
  removalCount: number;
  recentHistory: AuditLogEntry[];
}

/**
 * Build deterministic listing-reliability aggregates for every seller in a
 * single linear pass over requests, listings and the audit trail — no
 * per-seller rescans — so it stays cheap at 500–1,000+ active users.
 */
function buildSellerReliabilityMap(db: AlphaExchangeDb): Map<string, SellerReliabilityAggregate> {
  const completed = new Map<string, number>();
  const cancelled = new Map<string, number>();
  for (const request of db.purchaseRequests) {
    if (request.status === "review_open" || Boolean(request.completedAt)) {
      completed.set(request.sellerId, (completed.get(request.sellerId) ?? 0) + 1);
    } else if (request.status === "cancelled") {
      cancelled.set(request.sellerId, (cancelled.get(request.sellerId) ?? 0) + 1);
    }
  }

  const totalListings = new Map<string, number>();
  const lifetimes = new Map<string, number[]>();
  for (const listing of db.marketplaceListings) {
    totalListings.set(listing.sellerId, (totalListings.get(listing.sellerId) ?? 0) + 1);
    if (!LISTING_END_STATUSES.has(listing.status)) continue;
    const end = listingEndTimestamp(listing);
    const start = new Date(listing.createdAt).getTime();
    if (end !== null && Number.isFinite(start) && end > start) {
      const rows = lifetimes.get(listing.sellerId) ?? [];
      rows.push(end - start);
      lifetimes.set(listing.sellerId, rows);
    }
  }

  const editCounts = new Map<string, number>();
  const removalCounts = new Map<string, number>();
  const history = new Map<string, AuditLogEntry[]>();
  for (const entry of db.auditLogs) {
    const sellerId = entry.targetUserId;
    if (!sellerId || !LISTING_HISTORY_AUDIT_ACTIONS.has(entry.action)) continue;
    if (entry.action === "listing_edited") editCounts.set(sellerId, (editCounts.get(sellerId) ?? 0) + 1);
    else if (LISTING_REMOVAL_AUDIT_ACTIONS.has(entry.action)) removalCounts.set(sellerId, (removalCounts.get(sellerId) ?? 0) + 1);
    const rows = history.get(sellerId);
    if (rows) {
      if (rows.length < 20) rows.push(entry);
    } else {
      history.set(sellerId, [entry]);
    }
  }

  const sellerIds = new Set<string>();
  db.users.forEach((user) => { if (isTrustEligibleSeller(user)) sellerIds.add(user.id); });
  totalListings.forEach((_, id) => sellerIds.add(id));

  const result = new Map<string, SellerReliabilityAggregate>();
  for (const sellerId of sellerIds) {
    const completedTrades = completed.get(sellerId) ?? 0;
    const cancelledTrades = cancelled.get(sellerId) ?? 0;
    const listingsCount = totalListings.get(sellerId) ?? 0;
    const editCount = editCounts.get(sellerId) ?? 0;
    const removalCount = removalCounts.get(sellerId) ?? 0;
    result.set(sellerId, {
      reliability: computeListingReliability({
        completedTrades,
        cancelledTrades,
        totalListings: listingsCount,
        editCount,
        removalCount,
        listingLifetimesMs: lifetimes.get(sellerId) ?? [],
      }),
      completedTrades,
      cancelledTrades,
      totalListings: listingsCount,
      editCount,
      removalCount,
      recentHistory: history.get(sellerId) ?? [],
    });
  }
  return result;
}

export interface SellerListingReliabilityReport {
  sellerId: string;
  sellerName: string;
  reliability: ListingReliability;
  completedTrades: number;
  cancelledTrades: number;
  totalListings: number;
  editCount: number;
  removalCount: number;
  recentHistory: AuditLogEntry[];
}

/**
 * Admin view: deterministic listing-reliability metrics + recent listing
 * change/removal history for every seller, ordered by reliability score.
 */
export async function getListingReliabilityForAdmin(dbInput?: AlphaExchangeDb): Promise<SellerListingReliabilityReport[]> {
  const db = dbInput ?? await readDb();
  const reliabilityMap = buildSellerReliabilityMap(db);
  const namesById = new Map(db.users.map((user) => [user.id, user.fullName]));
  const reports = db.users
    .filter((user) => isTrustEligibleSeller(user))
    .map((seller) => {
      const aggregate = reliabilityMap.get(seller.id);
      return {
        sellerId: seller.id,
        sellerName: namesById.get(seller.id) ?? seller.fullName,
        reliability: aggregate?.reliability ?? computeListingReliability({ completedTrades: 0, cancelledTrades: 0, totalListings: 0, editCount: 0, removalCount: 0, listingLifetimesMs: [] }),
        completedTrades: aggregate?.completedTrades ?? 0,
        cancelledTrades: aggregate?.cancelledTrades ?? 0,
        totalListings: aggregate?.totalListings ?? 0,
        editCount: aggregate?.editCount ?? 0,
        removalCount: aggregate?.removalCount ?? 0,
        recentHistory: aggregate?.recentHistory ?? [],
      };
    });
  return reports.sort((a, b) => a.reliability.reliabilityScore - b.reliability.reliabilityScore);
}

function qualitySortListings(
  db: AlphaExchangeDb,
  listings: MarketplaceListing[],
  snapshots = computeTrustSnapshotMap(db),
) {
  const reliabilityMap = buildSellerReliabilityMap(db);
  const reliabilityScoreFor = (sellerId: string) =>
    reliabilityMap.get(sellerId)?.reliability.reliabilityScore ?? RELIABILITY_NEUTRAL_BASELINE;
  const score = (reputation: SellerReputationSnapshot, listingReliabilityScore: number) => {
    const responseSpeedScore = Math.max(0, 100 - Math.min(60, reputation.responseTimeMinutes) * 1.5);
    const normalizedTrades = Math.min(100, reputation.completedTrades / 8);
    return (
      reputation.completionRate * 0.25
      + reputation.rating * 20 * 0.18
      + responseSpeedScore * 0.13
      + reputation.recentActivityScore * 0.12
      + normalizedTrades * 0.1
      + levelRank(reputation.level) * (100 / 6) * 0.1
      + listingReliabilityScore * 0.12
    );
  };
  return [...listings].sort((left, right) => {
    const leftRep = snapshots.get(left.sellerId) ?? computeSellerReputationSnapshot(db, left.sellerId);
    const rightRep = snapshots.get(right.sellerId) ?? computeSellerReputationSnapshot(db, right.sellerId);
    const leftReliability = reliabilityScoreFor(left.sellerId);
    const rightReliability = reliabilityScoreFor(right.sellerId);

    const scoreDiff = score(rightRep, rightReliability) - score(leftRep, leftReliability);
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    if (rightReliability !== leftReliability) return rightReliability - leftReliability;
    if (rightRep.trustScore !== leftRep.trustScore) return rightRep.trustScore - leftRep.trustScore;
    if (levelRank(rightRep.level) !== levelRank(leftRep.level)) return levelRank(rightRep.level) - levelRank(leftRep.level);
    if (rightRep.rating !== leftRep.rating) return rightRep.rating - leftRep.rating;
    if (rightRep.completionRate !== leftRep.completionRate) return rightRep.completionRate - leftRep.completionRate;
    if (leftRep.responseTimeMinutes !== rightRep.responseTimeMinutes) return leftRep.responseTimeMinutes - rightRep.responseTimeMinutes;
    if (rightRep.completedTrades !== leftRep.completedTrades) return rightRep.completedTrades - leftRep.completedTrades;
    return rightRep.recentActivityScore - leftRep.recentActivityScore;
  });
}

function enrichListingsWithSellerData(
  db: AlphaExchangeDb,
  listings: MarketplaceListing[],
  snapshots = computeTrustSnapshotMap(db),
) {
  const usersById = new Map(db.users.map((user) => [user.id, user]));
  return listings.map((listing) => {
    const seller = usersById.get(listing.sellerId);
    const publicListing: MarketplaceListing = {
      ...listing,
      sellerDisplayName: redactExchangeUserContent(listing.sellerDisplayName),
      notes: redactExchangeUserContent(listing.notes),
      sellerDescription: redactExchangeUserContent(listing.sellerDescription),
      photos: (listing.photos ?? []).map((photo) => sanitizeCounterpartyMediaUrl(photo)).filter(Boolean),
    };
    delete publicListing.bankAccountId;
    if (publicListing.sellerProfile) {
      const sellerProfile = { ...publicListing.sellerProfile };
      delete sellerProfile.contact;
      publicListing.sellerProfile = sellerProfile;
    }
    if (!seller) return publicListing;
    return {
      ...publicListing,
      sellerDisplayName: redactExchangeUserContent(seller.fullName),
      sellerProfile: buildSellerPublicProfile(seller),
      sellerReputation: snapshots.get(seller.id) ?? computeSellerReputationSnapshot(db, seller.id),
    };
  });
}

export async function getSellerProfileRouteData(input: {
  username: string;
  viewerUserId?: string;
  viewerRole?: UserRole;
  viewerEmail?: string;
}) {
  const db = await readDb();
  const normalizedUsername = input.username.trim().toLowerCase();
  const seller = db.users.find((user) => matchesPublicProfileUsername({ fullName: user.fullName, email: user.email, id: user.id, publicTradingName: user.buyerDisplayName }, normalizedUsername));
  if (!seller || (seller.sellerStatus !== "approved_seller" && seller.sellerStatus !== "suspended")) {
    return null;
  }

  const profile = await getPremiumSellerProfile({
    sellerId: seller.id,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
    viewerEmail: input.viewerEmail,
    dbInput: db,
  });

  const listings = await getMarketplaceListings("active", db);
  const sellerListings = listings.filter((listing) => listing.sellerId === seller.id).slice(0, 6);
  const usersById = new Map(db.users.map((user) => [user.id, user]));
  const similarSellers = listings
    .filter((listing) => listing.sellerId !== seller.id)
    .slice(0, 4)
    .map((listing) => {
      const similarSeller = usersById.get(listing.sellerId);
      const sellerUsername = derivePublicProfileUsername({
        id: similarSeller?.id,
        fullName: similarSeller?.fullName,
        email: similarSeller?.email,
        publicTradingName: similarSeller?.buyerDisplayName,
      });
      return {
        sellerUsername,
        sellerName: listing.sellerDisplayName,
        sellerLevel: listing.sellerReputation?.level ?? "bronze",
        trustScore: listing.sellerReputation?.trustScore ?? 0,
        profilePhotoUrl: listing.sellerProfile?.profilePhotoUrl ?? "",
        publicVolumeRange: listing.sellerReputation?.publicVolumeRange ?? "0+",
      };
    });

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
  const user = db.users.find((row) => matchesPublicProfileUsername({ fullName: row.fullName, email: row.email, id: row.id, publicTradingName: row.buyerDisplayName }, normalizedUsername));
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
  dbInput?: AlphaExchangeDb;
}): Promise<PremiumSellerProfileData | null> {
  const db = input.dbInput ?? await readDb();
  const usersById = new Map(db.users.map((user) => [user.id, user]));
  const seller = db.users.find((user) => user.id === input.sellerId);
  if (!seller) return null;
  if (seller.sellerStatus !== "approved_seller" && seller.sellerStatus !== "suspended") return null;
  const trustSnapshot = computeSellerReputationSnapshot(db, seller.id);
  const publicAccount = buildPublicUserProfileDataForUser({
    db,
    user: seller,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
    enforceSearchVisibility: false,
    trustSnapshot,
  });
  if (!publicAccount) return null;
  const viewerIsOwner = input.viewerRole === "owner" || (input.viewerRole === "admin" && isAlphaExchangeOwnerEmail(input.viewerEmail ?? ""));
  const viewerIsSellerOwner = input.viewerUserId === seller.id;
  const viewerCanViewPrivateContent = input.viewerRole === "admin" || input.viewerRole === "owner";
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
      comment: viewerCanViewPrivateContent ? request.buyerReview!.comment : redactExchangeUserContent(request.buyerReview!.comment),
      createdAt: request.buyerReview!.createdAt,
      buyerId: request.buyerId,
      buyerName: viewerCanViewPrivateContent
        ? usersById.get(request.buyerId)?.fullName ?? request.buyerName ?? "Buyer"
        : redactExchangeUserContent(usersById.get(request.buyerId)?.fullName ?? request.buyerName ?? "Buyer"),
      verifiedPurchase: true,
      sellerResponse: request.sellerResponse && !viewerCanViewPrivateContent
        ? { ...request.sellerResponse, message: redactExchangeUserContent(request.sellerResponse.message) }
        : request.sellerResponse,
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
    sellerName: publicAccount.profile.publicTradingName,
    publicTradingName: publicAccount.profile.publicTradingName,
    fullName: publicAccount.profile.fullName,
    username: publicAccount.profile.fullName ? publicAccount.profile.username : "",
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
    isEmailVerified: publicAccount.profile.isEmailVerified,
    lastActiveAt: publicAccount.profile.lastActiveAt ?? undefined,
  };
  const lifetimeCompletedVolumeUsdt = Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? trustSnapshot.totalUsdtVolume));
  const sellerAchievements = seller.sellerAchievements ?? [];
  const hallOfFameEligible = (seller.sellerPrestigeRank ?? trustSnapshot.level) === "elite";
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
        marketplaceEnforcement: {
          restricted: Boolean(getSellerActiveEnforcementRecord(db, seller.id)),
          blockReason: getSellerEnforcementRestrictionMessage(db, seller.id),
          activeRecord: getSellerActiveEnforcementRecord(db, seller.id),
          latestRecord: getSellerLatestEnforcementRecord(db, seller.id),
          recentAuditEntries: getMarketplaceEnforcementAuditLog(db)
            .filter((entry) => entry.sellerId === seller.id)
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
            .slice(0, 20),
          totalCases: getMarketplaceEnforcementRecords(db).filter((entry) => entry.sellerId === seller.id).length,
        },
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
    value === "request_cancelled" ||
    value === "trade_closed_manually" ||
    value === "trade_inactivity_warning_sent" ||
    value === "bank_details_revealed"
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

export type BetaAnnouncementLocale = "ar" | "en";

function announcementText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves old, single-language rows without discarding their copy. Locale
 * fields are authoritative when present; legacy aliases are only fallbacks.
 */
function normalizeBetaAnnouncement(item: BetaAnnouncement): BetaAnnouncement {
  const legacyTitle = announcementText((item as { title?: unknown }).title);
  const legacyMessage = announcementText((item as { message?: unknown }).message);
  const explicitTitleEn = announcementText((item as { titleEn?: unknown }).titleEn);
  const explicitMessageEn = announcementText((item as { messageEn?: unknown }).messageEn);
  const explicitTitleAr = announcementText((item as { titleAr?: unknown }).titleAr);
  const explicitMessageAr = announcementText((item as { messageAr?: unknown }).messageAr);

  const titleEn = explicitTitleEn || legacyTitle || explicitTitleAr;
  const messageEn = explicitMessageEn || legacyMessage || explicitMessageAr;
  const titleAr = explicitTitleAr || legacyTitle || explicitTitleEn;
  const messageAr = explicitMessageAr || legacyMessage || explicitMessageEn;

  return {
    ...item,
    // Keep the established aliases stable for older admin/public clients.
    title: legacyTitle || titleEn || titleAr,
    message: legacyMessage || messageEn || messageAr,
    titleEn,
    messageEn,
    titleAr,
    messageAr,
  };
}

export function getLocalizedBetaAnnouncementCopy(
  announcement: Pick<BetaAnnouncement, "title" | "message" | "titleEn" | "messageEn" | "titleAr" | "messageAr">,
  locale: BetaAnnouncementLocale,
) {
  const normalized = normalizeBetaAnnouncement(announcement as BetaAnnouncement);
  if (locale === "ar") {
    return {
      title: normalized.titleAr || normalized.titleEn || normalized.title,
      message: normalized.messageAr || normalized.messageEn || normalized.message,
    };
  }
  return {
    title: normalized.titleEn || normalized.title || normalized.titleAr,
    message: normalized.messageEn || normalized.message || normalized.messageAr,
  };
}

export function resolveBetaAnnouncementLocale(language: string | null | undefined): BetaAnnouncementLocale {
  const normalized = announcementText(language).toLocaleLowerCase("en-US");
  if (
    normalized === "ar"
    || normalized.startsWith("ar-")
    || normalized === "arabic"
    || normalized === "العربية"
    || normalized === "عربي"
    || normalized === "عربية"
  ) return "ar";
  return "en";
}

function isMarketplaceEnforcementStatus(value: string | undefined): value is MarketplaceEnforcementStatus {
  return value === "active" || value === "resolved_paid" || value === "resolved_removed" || value === "revoked";
}

function isMarketplaceEnforcementAuditAction(value: string | undefined): value is MarketplaceEnforcementAuditAction {
  return value === "fee_issued"
    || value === "payment_submitted"
    || value === "fee_paid"
    || value === "appeal_submitted"
    || value === "appeal_decided"
    || value === "restriction_removed"
    || value === "seller_revoked"
    || value === "admin_note";
}

function inferSellerStatus(role: UserRole): SellerStatus {
  if (role === "approved_seller") return "approved_seller";
  if (role === "pending_seller_approval") return "pending_seller_approval";
  return "buyer";
}

function isOnboardingSelection(value: string): value is OnboardingSelection {
  return value === "guest" || value === "student" || value === "buyer" || value === "seller_applicant";
}

function normalizeOwnerSettings(
  ownerSettings: OwnerSettings | undefined,
  fallbackUpdatedAt: string,
  fallbackUpdatedByUserId: string,
): OwnerSettings | undefined {
  const config = ownerSettings?.marketplaceComplianceRecoveryWallet;
  if (!config) return undefined;
  if (!isSupportedNetwork(config.network)) return undefined;
  const walletAddress = normalizeWalletAddress(config.walletAddress ?? "");
  if (!walletAddress) return undefined;
  return {
    marketplaceComplianceRecoveryWallet: {
      network: config.network,
      walletAddress,
      defaultPaymentRail: config.defaultPaymentRail === "alpha_wallet_one_click" ? "alpha_wallet_one_click" : "manual_wallet_transfer",
      updatedAt: typeof config.updatedAt === "string" ? config.updatedAt : fallbackUpdatedAt,
      updatedByUserId: typeof config.updatedByUserId === "string" ? config.updatedByUserId : fallbackUpdatedByUserId,
    },
  };
}

function normalizeDb(db: AlphaExchangeDb): AlphaExchangeDb {
  const runtimeVersion = (db as { __runtimeVersion?: unknown }).__runtimeVersion;
  // Legacy seller applications could replace, rather than retain, Buyer membership.
  // Only a persisted pending application authorizes this compatibility repair.
  const legacyPendingApplicantIds = new Set((db.sellerApplications ?? [])
    .filter((application) => application.status === "pending")
    .map((application) => application.userId));
  const sellerApplicationUserIds = new Set((db.sellerApplications ?? []).map((application) => application.userId));
  const normalized: AlphaExchangeDb = {
    ...defaultDb,
    ...db,
    users: (db.users ?? []).map((user) => {
      const email = normalizeEmail(typeof user.email === "string" ? user.email : "");
      const fallbackRole = isUserRole(String(user.role ?? "")) ? (user.role as UserRole) : "guest";
      const sellerStatus = isValidSellerStatus((user as { sellerStatus?: string }).sellerStatus ?? "") ? (user as { sellerStatus: SellerStatus }).sellerStatus : inferSellerStatus(fallbackRole);
      const persistedRoles = Array.isArray((user as { roles?: unknown[] }).roles)
        ? (user as { roles: unknown[] }).roles
        : [];
      const storedRoles = persistedRoles.map((item) => String(item)).filter(isUserRole);
      const isStrictLegacySellerApplicantOrphan =
        sellerStatus === "pending_seller_approval"
        && fallbackRole === "pending_seller_approval"
        && persistedRoles.length === 1
        && persistedRoles[0] === "pending_seller_approval"
        && (user as { onboardingSelection?: unknown }).onboardingSelection === "seller_applicant"
        && typeof (user as { onboardingCompletedAt?: unknown }).onboardingCompletedAt === "string"
        && (user as { onboardingCompletedAt: string }).onboardingCompletedAt.trim().length > 0
        && !sellerApplicationUserIds.has(user.id)
        && !isAlphaExchangeOwnerEmail(email)
        && (user as { disabled?: unknown }).disabled !== true;
      const effectiveSellerStatus: SellerStatus = isStrictLegacySellerApplicantOrphan ? "buyer" : sellerStatus;
      const effectiveRole: UserRole = isStrictLegacySellerApplicantOrphan ? "buyer" : fallbackRole;
      const effectiveStoredRoles: UserRole[] = isStrictLegacySellerApplicantOrphan ? ["buyer"] : storedRoles;
      if (effectiveSellerStatus === "pending_seller_approval" && legacyPendingApplicantIds.has(user.id) && !effectiveStoredRoles.includes("buyer")) {
        effectiveStoredRoles.push("buyer");
      }
      const normalizedRoles = normalizeRolesForUser({
        email,
        role: effectiveRole,
        roles: effectiveStoredRoles,
        sellerStatus: effectiveSellerStatus,
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
      const sellerPrestigeRank = normalizeSellerLevel(sellerPrestigeRankRaw) ?? resolveSellerPrestigeRank(lifetimeCompletedVolumeUsdt);
      const sellerRankOverrideRaw = (user as { sellerRankOverride?: { rank?: string; reason?: string; setAt?: string; setByUserId?: string } }).sellerRankOverride;
      const normalizedOverrideRank = normalizeSellerLevel(String(sellerRankOverrideRaw?.rank ?? ""));
      const sellerRankOverride =
        sellerRankOverrideRaw && normalizedOverrideRank
          ? {
              rank: normalizedOverrideRank,
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
      const normalizedLanguages = Array.isArray((user as { languages?: string[] }).languages)
        ? (user as { languages: string[] }).languages.map((language) => String(language).trim()).filter(Boolean)
        : ["English"];
      return {
        ...user,
        email,
        roles: normalizedRoles,
        role: normalizedRole,
        sellerStatus: effectiveSellerStatus,
        preferredNetworks: Array.isArray((user as { preferredNetworks?: string[] }).preferredNetworks)
          ? ((user as { preferredNetworks: string[] }).preferredNetworks.filter((network) => isSupportedNetwork(network)) as SupportedNetwork[])
          : [],
        profilePhotoUrl: typeof (user as { profilePhotoUrl?: string }).profilePhotoUrl === "string" ? (user as { profilePhotoUrl: string }).profilePhotoUrl : "",
        languages: normalizedLanguages,
        preferredLocale: normalizePreferredLocale((user as { preferredLocale?: unknown }).preferredLocale),
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
        // Email verification is a security boundary for marketplace actions.
        // Legacy records without an explicit marker must fail closed rather
        // than acquiring verified-email trading access during normalization.
        emailVerified: (user as { emailVerified?: boolean }).emailVerified === true,
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
        ownerSettings: normalizeOwnerSettings(
          (user as { ownerSettings?: OwnerSettings }).ownerSettings,
          typeof user.updatedAt === "string" ? user.updatedAt : nowIso(),
          typeof user.id === "string" ? user.id : SYSTEM_ACTOR_USER_ID,
        ),
        sellerBankAccounts: Array.isArray((user as { sellerBankAccounts?: unknown[] }).sellerBankAccounts)
          ? (user as { sellerBankAccounts: unknown[] }).sellerBankAccounts
              .filter((entry) => entry && typeof entry === "object")
              .map((entry) => {
                const value = entry as Record<string, unknown>;
                const accountNumber = String(value.accountNumber ?? "").replace(/\D/g, "");
                const branchNumber = String(value.branchNumber ?? "").replace(/\D/g, "");
                return {
                  id: String(value.id ?? `bank-${randomUUID()}`),
                  sellerId: typeof user.id === "string" ? user.id : "",
                  accountHolderName: String(value.accountHolderName ?? "").trim(),
                  bankName: String(value.bankName ?? "").trim(),
                  branchNumber,
                  accountNumber,
                  accountLast4: accountNumber.slice(-4),
                  isDefault: value.isDefault === true,
                  createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
                  updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
                } satisfies SellerBankAccount;
              })
              .filter((entry) => Boolean(entry.bankName) && Boolean(entry.accountNumber) && Boolean(entry.branchNumber))
              .slice(0, 2)
          : [],
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
      buyerReceivingWalletAddress:
        typeof (request as { buyerReceivingWalletAddress?: string }).buyerReceivingWalletAddress === "string"
         ? normalizeWalletAddress((request as { buyerReceivingWalletAddress: string }).buyerReceivingWalletAddress) || undefined
         : undefined,
      paymentMethod:
        normalizeMarketplacePaymentMethod((request as { paymentMethod?: string }).paymentMethod) ??
        "Bank Transfer",
      sellerBankAccountId:
        typeof (request as { sellerBankAccountId?: string }).sellerBankAccountId === "string"
          ? (request as { sellerBankAccountId: string }).sellerBankAccountId
          : undefined,
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
      inactivityWarningSentAt:
        typeof (request as { inactivityWarningSentAt?: string }).inactivityWarningSentAt === "string"
          ? (request as { inactivityWarningSentAt: string }).inactivityWarningSentAt
          : undefined,
      pokeState: (() => {
        const value = (request as { pokeState?: unknown }).pokeState;
        if (!value || typeof value !== "object") return undefined;
        const raw = value as { buyerToSellerAt?: unknown; sellerToBuyerAt?: unknown };
        const buyerToSellerAt = typeof raw.buyerToSellerAt === "string" ? raw.buyerToSellerAt : undefined;
        const sellerToBuyerAt = typeof raw.sellerToBuyerAt === "string" ? raw.sellerToBuyerAt : undefined;
        return buyerToSellerAt || sellerToBuyerAt
          ? { buyerToSellerAt, sellerToBuyerAt } satisfies TradeRoomPokeState
          : undefined;
      })(),
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
      closedAt: typeof (request as { closedAt?: string }).closedAt === "string" ? (request as { closedAt: string }).closedAt : undefined,
      closedByUserId:
        typeof (request as { closedByUserId?: string }).closedByUserId === "string"
          ? (request as { closedByUserId: string }).closedByUserId
          : undefined,
      closeReason:
        typeof (request as { closeReason?: string }).closeReason === "string"
          ? (request as { closeReason: string }).closeReason.trim()
          : undefined,
      closeExplanation:
        typeof (request as { closeExplanation?: string }).closeExplanation === "string"
          ? (request as { closeExplanation: string }).closeExplanation.trim()
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
    betaAnnouncements: (db.betaAnnouncements ?? []).map((item) => normalizeBetaAnnouncement({
      ...item,
      type: isValidAnnouncementType(String((item as { type?: string }).type ?? "")) ? (item as { type: BetaAnnouncementType }).type : "maintenance",
      isActive: (item as { isActive?: boolean }).isActive !== false,
    })),
    adminAnnouncementRuns: (db.adminAnnouncementRuns ?? []).map((run) => ({
      ...run,
      requestKey: String(run.requestKey ?? run.id),
      recipients: Array.isArray(run.recipients)
        ? run.recipients.map((recipient, index) => ({
          ...recipient,
          batchIndex: Number.isInteger(recipient.batchIndex)
            ? recipient.batchIndex
            : Math.floor(index / ANNOUNCEMENT_BATCH_SIZE),
        }))
        : [],
      recipientCount: Math.max(0, Number(run.recipientCount ?? 0)),
      successCount: Math.max(0, Number(run.successCount ?? 0)),
      failureCount: Math.max(0, Number(run.failureCount ?? 0)),
      retryCount: Math.max(0, Number(run.retryCount ?? 0)),
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
    marketplaceEnforcementRecords: (db.marketplaceEnforcementRecords ?? [])
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.sellerId === "string")
      .map((entry) => {
        const recoveryWalletNetworkValue = (entry as { recoveryWalletNetwork?: string }).recoveryWalletNetwork;
        return {
          ...entry,
          violationNumber: Math.max(1, Math.floor(Number((entry as { violationNumber?: number }).violationNumber ?? 1))),
          status: isMarketplaceEnforcementStatus((entry as { status?: string }).status) ? (entry as { status: MarketplaceEnforcementStatus }).status : "active",
          feeAmount: Math.max(0, Number((entry as { feeAmount?: number }).feeAmount ?? 0)),
          feeCurrency: "USDT" as const,
          recoveryWalletNetwork: typeof recoveryWalletNetworkValue === "string" && isSupportedNetwork(recoveryWalletNetworkValue)
            ? recoveryWalletNetworkValue
            : undefined,
        recoveryWalletAddress: typeof (entry as { recoveryWalletAddress?: string }).recoveryWalletAddress === "string"
          ? normalizeWalletAddress((entry as { recoveryWalletAddress: string }).recoveryWalletAddress) || undefined
          : undefined,
        recoveryPaymentRail: (entry as { recoveryPaymentRail?: string }).recoveryPaymentRail === "alpha_wallet_one_click"
          ? "alpha_wallet_one_click"
          : "manual_wallet_transfer",
        recoveryPaymentStatus:
          (entry as { recoveryPaymentStatus?: string }).recoveryPaymentStatus === "awaiting_verification"
            ? "awaiting_verification"
            : (entry as { recoveryPaymentStatus?: string }).recoveryPaymentStatus === "confirmed_paid"
              ? "confirmed_paid"
              : "pending_payment",
        recoveryPaymentRequestedAt: typeof (entry as { recoveryPaymentRequestedAt?: string }).recoveryPaymentRequestedAt === "string"
          ? (entry as { recoveryPaymentRequestedAt: string }).recoveryPaymentRequestedAt
          : undefined,
        recoveryPaymentSubmittedAt: typeof (entry as { recoveryPaymentSubmittedAt?: string }).recoveryPaymentSubmittedAt === "string"
          ? (entry as { recoveryPaymentSubmittedAt: string }).recoveryPaymentSubmittedAt
          : undefined,
        recoveryPaymentSubmittedByUserId: typeof (entry as { recoveryPaymentSubmittedByUserId?: string }).recoveryPaymentSubmittedByUserId === "string"
          ? (entry as { recoveryPaymentSubmittedByUserId: string }).recoveryPaymentSubmittedByUserId
          : undefined,
        recoveryPaymentSubmissionNote: typeof (entry as { recoveryPaymentSubmissionNote?: string }).recoveryPaymentSubmissionNote === "string"
          ? (entry as { recoveryPaymentSubmissionNote: string }).recoveryPaymentSubmissionNote.trim() || undefined
          : undefined,
        recoveryPaymentConfirmedAt: typeof (entry as { recoveryPaymentConfirmedAt?: string }).recoveryPaymentConfirmedAt === "string"
          ? (entry as { recoveryPaymentConfirmedAt: string }).recoveryPaymentConfirmedAt
          : undefined,
        recoveryPaymentConfirmedByUserId: typeof (entry as { recoveryPaymentConfirmedByUserId?: string }).recoveryPaymentConfirmedByUserId === "string"
          ? (entry as { recoveryPaymentConfirmedByUserId: string }).recoveryPaymentConfirmedByUserId
          : undefined,
        recoveryPaymentQrPayload: typeof (entry as { recoveryPaymentQrPayload?: string }).recoveryPaymentQrPayload === "string"
          ? (entry as { recoveryPaymentQrPayload: string }).recoveryPaymentQrPayload
          : undefined,
        appealStatus:
          (entry as { appealStatus?: string }).appealStatus === "submitted"
            ? "submitted"
            : (entry as { appealStatus?: string }).appealStatus === "accepted"
              ? "accepted"
              : (entry as { appealStatus?: string }).appealStatus === "rejected"
                ? "rejected"
                : "none",
        appealMessage: typeof (entry as { appealMessage?: string }).appealMessage === "string"
          ? (entry as { appealMessage: string }).appealMessage.trim() || undefined
          : undefined,
        appealSubmittedAt: typeof (entry as { appealSubmittedAt?: string }).appealSubmittedAt === "string"
          ? (entry as { appealSubmittedAt: string }).appealSubmittedAt
          : undefined,
        appealSubmittedByUserId: typeof (entry as { appealSubmittedByUserId?: string }).appealSubmittedByUserId === "string"
          ? (entry as { appealSubmittedByUserId: string }).appealSubmittedByUserId
          : undefined,
        appealDecisionByUserId: typeof (entry as { appealDecisionByUserId?: string }).appealDecisionByUserId === "string"
          ? (entry as { appealDecisionByUserId: string }).appealDecisionByUserId
          : undefined,
        appealDecisionAt: typeof (entry as { appealDecisionAt?: string }).appealDecisionAt === "string"
          ? (entry as { appealDecisionAt: string }).appealDecisionAt
          : undefined,
        appealDecisionNotes: typeof (entry as { appealDecisionNotes?: string }).appealDecisionNotes === "string"
          ? (entry as { appealDecisionNotes: string }).appealDecisionNotes.trim() || undefined
          : undefined,
        reason: String((entry as { reason?: string }).reason ?? "").trim(),
          adminNotes: typeof (entry as { adminNotes?: string }).adminNotes === "string"
            ? (entry as { adminNotes: string }).adminNotes.trim() || undefined
            : undefined,
        };
      }),
    marketplaceEnforcementAuditLog: (db.marketplaceEnforcementAuditLog ?? [])
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.sellerId === "string")
      .map((entry) => ({
        ...entry,
        action: isMarketplaceEnforcementAuditAction((entry as { action?: string }).action)
          ? (entry as { action: MarketplaceEnforcementAuditAction }).action
          : "admin_note",
        reason: typeof (entry as { reason?: string }).reason === "string" ? (entry as { reason: string }).reason.trim() || undefined : undefined,
        notes: typeof (entry as { notes?: string }).notes === "string" ? (entry as { notes: string }).notes.trim() || undefined : undefined,
        evidenceReferences: Array.isArray((entry as { evidenceReferences?: unknown[] }).evidenceReferences)
          ? (entry as { evidenceReferences: unknown[] }).evidenceReferences
              .filter((item) => item && typeof item === "object")
              .map((item) => {
                const value = item as Record<string, unknown>;
                return {
                  id: String(value.id ?? ""),
                  fileName: String(value.fileName ?? ""),
                  mimeType: String(value.mimeType ?? ""),
                  sizeBytes: Math.max(0, Number(value.sizeBytes ?? 0)),
                  url: String(value.url ?? ""),
                  uploadedByUserId: String(value.uploadedByUserId ?? ""),
                  uploadedAt: String(value.uploadedAt ?? nowIso()),
                } satisfies MarketplaceComplianceEvidenceReference;
              })
              .filter((item) => Boolean(item.id) && Boolean(item.url) && Boolean(item.fileName))
          : undefined,
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
      bankAccountId: typeof (listing as { bankAccountId?: string }).bankAccountId === "string"
        ? (listing as { bankAccountId: string }).bankAccountId
        : undefined,
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

async function readDb(options?: { bypassCache?: boolean; skipMaintenance?: boolean }): Promise<AlphaExchangeDb> {
  if (options?.bypassCache) {
    const repository = await getAlphaExchangeRepository();
    const parsed = await repository.loadSnapshot();
    const normalized = normalizeDb(parsed);
    ensureDisplayNumbers(normalized);
    return normalized;
  }
  const now = Date.now();
  if (dbCache && now - dbCache.updatedAt <= DB_CACHE_TTL_MS) {
    const cached = structuredClone(dbCache.value);
    if (options?.skipMaintenance) {
      return cached;
    }
    const numberingChanged = ensureDisplayNumbers(cached);
    const changed = await applyMarketplaceReliabilityRules(cached);
    if (changed || numberingChanged) {
      await writeDb(cached);
      return cached;
    }
    return cached;
  }
  if (!dbReadInFlight) {
    dbReadInFlight = (async () => {
      try {
        const repository = await getAlphaExchangeRepository();
        const parsed = await repository.loadSnapshot();
        const normalized = normalizeDb(parsed);
        if (options?.skipMaintenance) {
          dbCache = { value: normalized, updatedAt: Date.now() };
          return normalized;
        }
        const numberingChanged = ensureDisplayNumbers(normalized);
        const changed = await applyMarketplaceReliabilityRules(normalized);
        if (changed || numberingChanged) {
          await writeDb(normalized);
        }
        for (const listing of normalized.marketplaceListings) {
          if (!listing.expirationEmailPendingAt || listing.expirationEmailSentAt) continue;
          await sendListingOwnerLifecycleEmail(normalized, listing, {
            event: "listing_expired",
            title: { ar: "انتهت صلاحية الإعلان", en: "Listing Expired" },
            message: {
              ar: "انتهت صلاحية إعلانك ولم يعد ظاهرًا للمشترين. جدّده عندما تصبح جاهزًا للتداول مجددًا.",
              en: "Your listing expired and is no longer visible to buyers. Renew it when you are ready to trade again.",
            },
            idempotencyKey: `listing-${listing.id}-expired-${listing.expirationEmailPendingAt}`,
          });
        }
        if (!changed && !numberingChanged) {
          dbCache = { value: normalized, updatedAt: Date.now() };
        }
        return normalized;
      } finally {
        dbReadInFlight = null;
      }
    })();
  }
  const normalized = await dbReadInFlight;
  return structuredClone(normalized);
}

export async function runAlphaExchangeMaintenance() {
  const db = await readDb({ bypassCache: true });
  const numberingChanged = ensureDisplayNumbers(db);
  const changed = await applyMarketplaceReliabilityRules(db);
  if (changed || numberingChanged) {
    await writeDb(db);
  }
  return { changed: changed || numberingChanged };
}

const USER_PROFILE_TABLES = ["users", "seller_profiles", "seller_settings"] as const satisfies readonly SnapshotTableName[];
const MARKETPLACE_ENFORCEMENT_TABLES = ["marketplace_enforcement_records", "marketplace_enforcement_audit_log"] as const satisfies readonly SnapshotTableName[];
const TRUST_INIT_TABLES = [...USER_PROFILE_TABLES, "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const LISTING_WRITE_TABLES = ["listings", "audit_logs", "notifications"] as const satisfies readonly SnapshotTableName[];
const LISTING_TRUST_WRITE_TABLES = [...USER_PROFILE_TABLES, "listings", "audit_logs", "notifications", "activity_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const SELLER_APPLICATION_REVIEW_TABLES = [...USER_PROFILE_TABLES, "seller_applications", "notifications", "audit_logs", "activity_logs", "trust_snapshots", "trust_score_history", "sms_deliveries"] as const satisfies readonly SnapshotTableName[];
const SELLER_STATUS_TRUST_TABLES = [...USER_PROFILE_TABLES, "audit_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const SELLER_STATUS_NOTIFICATION_TABLES = [...USER_PROFILE_TABLES, "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const SELLER_PROFILE_STATE_TABLES = [...USER_PROFILE_TABLES, "audit_logs"] as const satisfies readonly SnapshotTableName[];
const SELLER_PRESTIGE_TABLES = [...USER_PROFILE_TABLES, "notifications", "audit_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const PURCHASE_REQUEST_CREATE_TABLES = ["purchase_requests", "notifications", "audit_logs", "activity_logs", "sms_deliveries"] as const satisfies readonly SnapshotTableName[];
const PASSWORD_RESET_TABLES = ["password_reset_tokens"] as const satisfies readonly SnapshotTableName[];
const TRADE_STATUS_BASE_TABLES = ["purchase_requests", "listings", "notifications", "audit_logs", "sms_deliveries"] as const satisfies readonly SnapshotTableName[];
// For completed/declined/cancelled: core trade state written synchronously (critical path).
const TRADE_COMPLETION_CORE_TABLES = ["purchase_requests", "listings", "notifications", "audit_logs", "commissions", "sms_deliveries"] as const satisfies readonly SnapshotTableName[];
// For completed/declined/cancelled: trust data written after the response via after() (non-critical path).
const TRADE_COMPLETION_TRUST_TABLES = [...USER_PROFILE_TABLES, "activity_logs", "trust_snapshots", "trust_score_history"] as const satisfies readonly SnapshotTableName[];
const TRADE_EVIDENCE_BASE_TABLES = ["purchase_requests", "audit_logs", "activity_logs", "evidence"] as const satisfies readonly SnapshotTableName[];
const TRADE_EVIDENCE_PAYMENT_TABLES = ["purchase_requests", "listings", "notifications", "audit_logs", "activity_logs", "evidence"] as const satisfies readonly SnapshotTableName[];
const TRADE_REVIEW_TABLES = ["purchase_requests", "notifications", "audit_logs", "activity_logs"] as const satisfies readonly SnapshotTableName[];
const COMMISSION_PAYMENT_TABLES = ["purchase_requests", "commissions", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const PURCHASE_REQUEST_ONLY_TABLES = ["purchase_requests"] as const satisfies readonly SnapshotTableName[];
const TRADE_BANK_DETAILS_AUDIT_TABLES = ["purchase_requests", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const COMMISSION_RESET_TABLES = ["purchase_requests", "commissions", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const COMMISSION_STATUS_TABLES = ["purchase_requests", "commissions", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const TRADE_ROOM_INTERACTION_TABLES = ["purchase_requests", "notifications"] as const satisfies readonly SnapshotTableName[];
const AUDIT_LOG_ONLY_TABLES = ["audit_logs"] as const satisfies readonly SnapshotTableName[];
const NOTIFICATION_ONLY_TABLES = ["notifications"] as const satisfies readonly SnapshotTableName[];
const NOTIFICATION_PREFERENCES_TABLES = [...USER_PROFILE_TABLES, "activity_logs"] as const satisfies readonly SnapshotTableName[];
const DISPUTE_WRITE_TABLES = ["purchase_requests", "disputes", "notifications", "activity_logs", "sms_deliveries"] as const satisfies readonly SnapshotTableName[];
const SELLER_REPORT_TABLES = ["seller_reports", "notifications", "activity_logs"] as const satisfies readonly SnapshotTableName[];
const BETA_ANNOUNCEMENT_TABLES = ["beta_announcements", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const BETA_ANNOUNCEMENT_STATE_TABLES = ["beta_announcements", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const ADMIN_ANNOUNCEMENT_TABLES = ["admin_announcement_runs", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const ADMIN_LISTING_OVERRIDE_TABLES = ["listings", "purchase_requests", "notifications", "audit_logs"] as const satisfies readonly SnapshotTableName[];
const ENFORCEMENT_MUTATION_TABLES = [...USER_PROFILE_TABLES, "listings", "notifications", "audit_logs", ...MARKETPLACE_ENFORCEMENT_TABLES] as const satisfies readonly SnapshotTableName[];

async function writeDb(
  db: AlphaExchangeDb,
  options?: {
    evidenceOverrides?: Map<string, Buffer>;
    traceTag?: string;
    selectedTables?: readonly SnapshotTableName[];
    validateBeforeCommit?: (snapshot: AlphaExchangeDb) => void;
    validateLatestBeforeCommit?: (snapshot: AlphaExchangeDb) => void;
    rebaseOnLatest?: (snapshot: AlphaExchangeDb) => AlphaExchangeDb | Promise<AlphaExchangeDb>;
  },
) {
  const normalized = normalizeDb(db);
  ensureDisplayNumbers(normalized);
  const tables = options?.selectedTables ?? ["(all)"];
  const storeWriteStart = allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_PERF === "1" ? Date.now() : 0;
  const writeTask = dbWriteInFlight.then(async () => {
    if (storeWriteStart) {
      const waitedMs = Date.now() - storeWriteStart;
      console.log(`[STORE-PERF] writeDb[${tables.join(",")}] waited_for_prev_write ${waitedMs}ms`);
    }
    const repository = await getAlphaExchangeRepository();
    await repository.saveSnapshot(normalized, {
      evidenceOverrides: options?.evidenceOverrides,
      traceTag: options?.traceTag,
      selectedTables: options?.selectedTables,
      validateBeforeCommit: options?.validateBeforeCommit,
      validateLatestBeforeCommit: options?.validateLatestBeforeCommit,
      rebaseOnLatest: options?.rebaseOnLatest
        ? async (persistedSnapshot) => {
          const rebased = normalizeDb(await options.rebaseOnLatest!(structuredClone(persistedSnapshot)));
          Object.assign(normalized, rebased);
          return normalized;
        }
        : undefined,
    });
  });
  dbWriteInFlight = writeTask.catch(() => undefined);
  try {
    await writeTask;
    if (storeWriteStart) {
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

function archiveAdminActionNotifications(
  db: AlphaExchangeDb,
  matchesAction: (notification: AlphaExchangeNotification) => boolean,
) {
  const now = nowIso();
  const adminUserIds = new Set(getAdminNotificationRecipients(db).map((user) => user.id));
  const archived: AlphaExchangeNotification[] = [];
  db.notifications = db.notifications.map((notification) => {
    if (
      !adminUserIds.has(notification.userId)
      || notification.state === "archived"
      || !matchesAction(notification)
    ) {
      return notification;
    }
    const next = enrichNotification(db, {
      ...notification,
      state: "archived",
      isRead: true,
      archivedAt: now,
      updatedAt: now,
    });
    archived.push(next);
    return next;
  });
  return archived;
}

function publishArchivedNotifications(notifications: AlphaExchangeNotification[]) {
  for (const notification of notifications) {
    publishRealtimeEvent({ type: "notification.updated", payload: { notification } });
  }
}

function pushAdminTradeActivityNotifications(
  db: AlphaExchangeDb,
  input: {
    title: string;
    message: string;
    request: Pick<PurchaseRequest, "id" | "tradeId" | "listingId">;
    actionLabel?: string;
    actorUserId?: string;
  },
) {
  const destination = adminPurchaseRequestsDestination(input.request.id);
  for (const adminUser of getAdminNotificationRecipients(db)) {
    if (adminUser.id === input.actorUserId) continue;
    pushNotification(db, {
      userId: adminUser.id,
      category: "trade",
      title: input.title,
      message: input.message,
      relatedRequestId: input.request.id,
      relatedTradeId: input.request.tradeId ?? input.request.id,
      relatedListingId: input.request.listingId,
      relatedHref: destination,
      actionHref: destination,
      actionLabel: input.actionLabel ?? "View Trade",
      forceInApp: true,
    });
  }
}

type OwnerActionEmailEvent = Extract<
  MarketplaceEmailEvent,
  "owner_listing_review_required" | "owner_seller_application_review_required"
>;

async function dispatchOwnerActionRequiredEmails(
  db: AlphaExchangeDb,
  input: {
    event: OwnerActionEmailEvent;
    title: MarketplaceEmailLocalizedText;
    message: MarketplaceEmailLocalizedText;
    actionLabel: MarketplaceEmailLocalizedText;
    actionHref: string;
    referenceLabel: string;
    idempotencyKey?: string;
  },
) {
  const recipients = getAdminNotificationRecipients(db);
  if (!recipients.length) return;

  // Approval alerts are transactional owner-safety messages. They are sent even
  // when optional marketplace-marketing email is disabled so phone-only owners
  // cannot miss a seller or listing waiting for approval.
  const task = async () => {
    await Promise.all(recipients.map(async (recipient) => {
      const result = await sendMarketplaceEmail({
        event: input.event,
        to: recipient.email,
        recipientName: recipient.fullName,
        recipientLocale: normalizePreferredLocale(recipient.preferredLocale),
        title: input.title,
        message: input.message,
        actionLabel: input.actionLabel,
        actionPath: input.actionHref,
        referenceLabel: input.referenceLabel,
        idempotencyKey: `${input.idempotencyKey ?? `${input.event}:${input.referenceLabel}`}:${recipient.id}`,
      });
      if (!result.ok) {
        logEvent("error", {
          event: "owner_action_email_delivery",
          targetUserId: recipient.id,
          resourceId: input.referenceLabel,
          outcome: "failed",
          reason: input.event,
          metadata: {
            providerStatus: "providerStatus" in result ? result.providerStatus : undefined,
            deliveryReason: result.reason,
          },
        });
      }
    }));
  };

  try {
    after(task);
  } catch {
    // Store-level tests and scripts run outside a Next.js request context.
    await task();
  }
}

export function isEligibleBuyerForListingBroadcast(
  user: Pick<AlphaExchangeUser, "id" | "role" | "roles" | "sellerStatus" | "disabled">,
  creatorUserId: string,
) {
  if (user.id === creatorUserId) return false;
  if (user.sellerStatus === "suspended") return false;
  if (user.disabled === true) return false;
  const roles = user.roles ?? [user.role];
  return roles.includes("buyer");
}

function getListingBroadcastRecipients(db: AlphaExchangeDb, creatorUserId: string) {
  const byUserId = new Map<string, AlphaExchangeUser>();
  for (const user of db.users) {
    if (!isEligibleBuyerForListingBroadcast(user, creatorUserId)) continue;
    if (!byUserId.has(user.id)) byUserId.set(user.id, user);
  }
  return [...byUserId.values()];
}

async function sendListingOwnerLifecycleEmail(
  db: AlphaExchangeDb,
  listing: MarketplaceListing,
  input: {
    event: Extract<MarketplaceEmailEvent, "listing_submitted" | "listing_expired" | "listing_renewed">;
    title: MarketplaceEmailLocalizedText;
    message: MarketplaceEmailLocalizedText;
    idempotencyKey?: string;
  },
) {
  const seller = db.users.find((user) => user.id === listing.sellerId);
  if (!seller || seller.notificationPreferences?.email !== true) return true;
  const result = await sendMarketplaceEmail({
    event: input.event,
    to: seller.email,
    recipientName: seller.fullName,
    recipientLocale: normalizePreferredLocale(seller.preferredLocale),
    title: input.title,
    message: input.message,
    actionLabel: { ar: "فتح إعلانات البائع", en: "Open Seller Listings" },
    actionPath: sellerListingWorkspaceDestination(listing),
    referenceLabel: listing.id,
    idempotencyKey: input.idempotencyKey,
  });
  if (!result.ok) {
    logEvent("error", {
      event: "marketplace_email_delivery",
      targetUserId: seller.id,
      resourceId: listing.id,
      outcome: "failed",
      reason: input.event,
      metadata: {
        providerStatus: "providerStatus" in result ? result.providerStatus : undefined,
        deliveryReason: result.reason,
      },
    });
  }
  return result.ok;
}

async function sendSellerPrestigePromotionEmail(input: {
  seller: AlphaExchangeUser;
  rank: SellerLevel;
  promotionId: string;
}) {
  if (input.seller.notificationPreferences?.email !== true) return true;
  const result = await sendMarketplaceEmail({
    event: "seller_prestige_promoted",
    to: input.seller.email,
    recipientName: input.seller.fullName,
    recipientLocale: normalizePreferredLocale(input.seller.preferredLocale),
    title: {
      ar: "تهانينا على رتبتك الجديدة كبائع",
      en: "Congratulations on your new seller rank",
    },
    message: {
      ar: `وصلت إلى رتبة البائع ${sellerRankAr(input.rank)}. ${summarizePromotionBenefitsAr(input.rank)}`,
      en: `You reached ${input.rank} seller. ${summarizePromotionBenefits(input.rank)}`,
    },
    actionLabel: { ar: "عرض إحصاءات البائع", en: "View Seller Insights" },
    actionPath: "/usdt-exchange#market-overview",
    referenceLabel: input.promotionId,
    idempotencyKey: `seller-prestige-${input.promotionId}`,
  });
  if (!result.ok) {
    logEvent("error", {
      event: "marketplace_email_delivery",
      targetUserId: input.seller.id,
      resourceId: input.promotionId,
      outcome: "failed",
      reason: "seller_prestige_promoted",
      metadata: { deliveryReason: result.reason },
    });
  }
  return result.ok;
}

export async function getListingBroadcastEmailRecipients(creatorUserId: string) {
  const db = await readDb();
  return getListingBroadcastRecipients(db, creatorUserId)
    .map((user) => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      preferredLocale: normalizePreferredLocale(user.preferredLocale),
    }));
}

async function sendSellerEnforcementEmail(
  db: AlphaExchangeDb,
  sellerId: string,
  input: {
    event: Extract<MarketplaceEmailEvent, "marketplace_enforcement_fee_issued" | "marketplace_enforcement_fee_paid" | "marketplace_enforcement_seller_revoked">;
    title: MarketplaceEmailLocalizedText;
    message: MarketplaceEmailLocalizedText;
    referenceLabel: string;
    idempotencyKey?: string;
  },
) {
  const seller = db.users.find((user) => user.id === sellerId);
  if (!seller || seller.notificationPreferences?.email !== true) return true;
  const paymentRequired = input.event === "marketplace_enforcement_fee_issued";
  const result = await sendMarketplaceEmail({
    event: input.event,
    to: seller.email,
    recipientName: seller.fullName,
    recipientLocale: normalizePreferredLocale(seller.preferredLocale),
    title: input.title,
    message: input.message,
    actionLabel: paymentRequired
      ? { ar: "فتح دفع الامتثال", en: "Open Compliance Payment" }
      : { ar: "فتح الحساب", en: "Open Account" },
    actionPath: paymentRequired
      ? "/dashboard/seller/compliance-payment"
      : "/dashboard",
    referenceLabel: input.referenceLabel,
    idempotencyKey: input.idempotencyKey,
  });
  if (!result.ok) {
    logEvent("error", {
      event: "marketplace_email_delivery",
      targetUserId: seller.id,
      resourceId: input.referenceLabel,
      outcome: "failed",
      reason: input.event,
      metadata: {
        providerStatus: "providerStatus" in result ? result.providerStatus : undefined,
        deliveryReason: result.reason,
      },
    });
  }
  return result.ok;
}

type DeferredNotificationPublication = {
  type: "notification.created" | "notification.updated";
  notification: AlphaExchangeNotification;
};

function publishNotificationPublication(publication: DeferredNotificationPublication | null | undefined) {
  if (!publication) return;
  publishRealtimeEvent({
    type: publication.type,
    payload: { notification: publication.notification },
  });
}

function pushNotification(
  db: AlphaExchangeDb,
  input: {
    userId: string;
    category: NotificationCategory;
    title: string;
    message: string;
    titleEn?: string;
    messageEn?: string;
    titleAr?: string;
    messageAr?: string;
    relatedTradeId?: string;
    relatedRequestId?: string;
    relatedListingId?: string;
    relatedSellerName?: string;
    relatedSellerUsername?: string;
    relatedHref?: string;
    actionLabel?: string;
    actionHref?: string;
    reason?: string;
    priority?: NotificationPriorityLevel;
    state?: NotificationState;
    /** Transactional trade communication may not be silently hidden by a stale UI preference. */
    forceInApp?: boolean;
    /** Persist first, then emit the notification event from the caller. */
    deferRealtime?: boolean;
  },
): DeferredNotificationPublication | null {
  ensureDisplayNumbers(db);
  const user = db.users.find((item) => item.id === input.userId);
  if (!user) return null;
  if (user.notificationPreferences?.inApp === false && input.forceInApp !== true) return null;
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
  const relatedHref = sanitizeInternalNotificationHref(input.relatedHref) || (relatedRequestId ? requestDetailsHref(relatedRequestId) : undefined);
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
        title: input.title,
        message: input.message,
        titleEn: input.titleEn ?? duplicate.titleEn,
        messageEn: input.messageEn ?? duplicate.messageEn,
        titleAr: input.titleAr ?? duplicate.titleAr,
        messageAr: input.messageAr ?? duplicate.messageAr,
        state: nextState,
        isRead: nextState !== "unread",
        relatedTradeId: input.relatedTradeId ?? duplicate.relatedTradeId,
        relatedRequestId: relatedRequestId ?? duplicate.relatedRequestId,
        relatedListingId: input.relatedListingId ?? duplicate.relatedListingId,
        relatedSellerName: input.relatedSellerName ?? duplicate.relatedSellerName,
        relatedSellerUsername: input.relatedSellerUsername ?? duplicate.relatedSellerUsername,
        relatedHref: relatedHref ?? duplicate.relatedHref,
        centerCategory,
        priority: input.priority ?? inferredPriority.priority,
        priorityRank: inferredPriority.rank,
        actionLabel: input.actionLabel ?? duplicate.actionLabel,
        actionHref: sanitizeInternalNotificationHref(input.actionHref) ?? sanitizeInternalNotificationHref(duplicate.actionHref) ?? relatedHref,
        reason: input.reason ?? duplicate.reason,
        archivedAt: nextState === "archived" ? createdAt : undefined,
        updatedAt: createdAt,
      });
      db.notifications[duplicateIndex] = updated;
      const publication = { type: "notification.updated" as const, notification: updated };
      if (input.deferRealtime !== true) publishNotificationPublication(publication);
      return publication;
    }
  }

  const notification = enrichNotification(db, {
    id: `notif-${randomUUID()}`,
    userId: input.userId,
    category: input.category,
    title: input.title,
    message: input.message,
    titleEn: input.titleEn,
    messageEn: input.messageEn,
    titleAr: input.titleAr,
    messageAr: input.messageAr,
    isRead: nextState !== "unread",
    state: nextState,
    priority: input.priority ?? inferredPriority.priority,
    priorityRank: inferredPriority.rank,
    actionLabel: input.actionLabel,
    actionHref: sanitizeInternalNotificationHref(input.actionHref) ?? relatedHref,
    reason: input.reason,
    relatedTradeId: input.relatedTradeId,
    relatedRequestId,
    relatedListingId: input.relatedListingId,
    relatedSellerName: input.relatedSellerName,
    relatedSellerUsername: input.relatedSellerUsername,
    relatedHref,
    tradeSnapshot: buildTradeSnapshotForNotification(db, input.userId, inferredRequest),
    archivedAt: nextState === "archived" ? createdAt : undefined,
    updatedAt: createdAt,
    createdAt,
  });
  db.notifications.unshift(notification);
  pruneNotificationBacklog(db);
  const publication = { type: "notification.created" as const, notification };
  if (input.deferRealtime !== true) publishNotificationPublication(publication);
  return publication;
}

export function hasVerifiedPhoneForSms(user: Pick<AlphaExchangeUser, "verifiedPhone" | "phoneVerifiedAt">) {
  return Boolean(user.verifiedPhone && user.phoneVerifiedAt && normalizeE164(user.verifiedPhone));
}

function queueSmsDelivery(db: AlphaExchangeDb, input: { eventType: SmsEventType; eventKey: string; recipientUserId: string; destinationPath: string }) {
  const user = db.users.find((item) => item.id === input.recipientUserId);
  if (!user || user.notificationPreferences?.sms !== true || !hasVerifiedPhoneForSms(user)) return;
  const phone = normalizeE164(user.verifiedPhone ?? "");
  if (!phone || (db.smsDeliveries ?? []).some((item) => item.eventKey === input.eventKey)) return;
  const now = nowIso();
  const destination = new URL(input.destinationPath, getSiteUrl()).toString();
  const record: SmsDeliveryRecord = {
    id: `sms-${randomUUID()}`, eventKey: input.eventKey, eventType: input.eventType, recipientUserId: user.id,
    recipientPhone: phone, body: getSmsTemplate(input.eventType, destination), status: "queued", retryCount: 0, createdAt: now, updatedAt: now,
  };
  (db.smsDeliveries ??= []).push(record);
}

async function dispatchSmsDelivery(deliveryIds: string[]) {
  const db = await readDb({ bypassCache: true });
  const deliveryIdSet = new Set(deliveryIds);
  const pending = (db.smsDeliveries ?? [])
    .map((delivery, index) => ({ delivery, index }))
    .filter(({ delivery }) => deliveryIdSet.has(delivery.id) && delivery.status === "queued" && delivery.retryCount === 0);
  if (pending.length === 0) return;
  const results = await Promise.all(pending.map(({ delivery }) => (
    sendTwilioMessageWithRetry({
      to: delivery.recipientPhone,
      body: delivery.body,
      statusCallback: twilioStatusCallbackUrl(delivery.id),
    })
  )));
  const now = nowIso();
  pending.forEach(({ delivery, index }, resultIndex) => {
    const result = results[resultIndex];
    db.smsDeliveries![index] = result.ok
      ? { ...delivery, status: result.status === "delivered" ? "delivered" : "sent", twilioMessageSid: result.sid, providerStatus: result.status, retryCount: result.attempts - 1, sentAt: now, deliveredAt: result.status === "delivered" ? now : undefined, updatedAt: now }
      : { ...delivery, status: "failed", retryCount: result.attempts, providerStatus: result.providerStatus, lastError: result.error, failedAt: now, updatedAt: now };
  });
  await writeDb(db, { selectedTables: ["sms_deliveries"] });
}

async function dispatchCommittedSms(db: AlphaExchangeDb, previousCount: number) {
  const deliveryIds = (db.smsDeliveries ?? []).slice(previousCount).map((delivery) => delivery.id);
  if (deliveryIds.length === 0) return;
  const task = async () => {
    try {
      await dispatchSmsDelivery(deliveryIds);
    } catch (error) {
      logEvent("error", {
        event: "sms_delivery_dispatch",
        outcome: "failed",
        reason: "post_commit_dispatch_failed",
        metadata: {
          deliveryCount: deliveryIds.length,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
    }
  };
  try {
    after(task);
  } catch {
    // Direct store invocations outside a Next.js request still complete delivery.
    await task();
  }
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
  listing.expirationEmailPendingAt = listing.expiresAt ?? now;

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
    message: `Listing ${listing.id} expired and is no longer visible to buyers. Open My Listings to renew it when you are ready.`,
    relatedListingId: listing.id,
    relatedHref: sellerListingWorkspaceDestination(listing),
    actionLabel: "Manage Listing",
  });
  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "listing",
      title: "Listing expired",
      message: `${listing.sellerDisplayName}'s listing ${listing.id} expired.`,
      relatedListingId: listing.id,
      relatedHref: adminMarketplaceListingsDestination(listing.id),
      actionHref: adminMarketplaceListingsDestination(listing.id),
      actionLabel: "Review Listing",
    });
  }
}

async function unlockListingAfterCancelledTrade(db: AlphaExchangeDb, listing: MarketplaceListing, actorUserId: string, request: PurchaseRequest, reason: string) {
  const now = nowIso();
  const hadExpiredClock = Boolean(listing.expiresAt) && new Date(listing.expiresAt!).getTime() <= Date.now();
  if (hadExpiredClock) {
    await expireListing(db, listing, actorUserId, reason);
    return;
  }
  const previousActiveTradeRequestId = listing.activeTradeRequestId;
  listing.activeTradeRequestId = undefined;
  listing.lockedAt = undefined;
  listing.updatedAt = now;
  listing.status = "active";
  await appendAuditLog(db, {
    action: "listing_reopened",
    actorUserId,
    targetUserId: listing.sellerId,
    listingId: listing.id,
    purchaseRequestId: request.id,
    details: `Listing ${listing.id} reopened after trade cancellation.`,
    oldValue: { status: request.status, activeTradeRequestId: previousActiveTradeRequestId },
    newValue: { status: "active" },
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
    relatedRequestId: record.purchaseRequestId,
    relatedTradeId: record.purchaseRequestId,
    relatedListingId: record.listingId,
    relatedHref: commissionPaymentDestination(record.id),
    actionHref: commissionPaymentDestination(record.id),
    actionLabel: "Pay Commission",
    reason: COMMISSION_PAYMENT_DUE_NOTIFICATION_REASON,
  });
  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "trade",
      title: "Commission overdue",
      message: `Commission for trade ${record.purchaseRequestId} is now overdue.`,
      relatedRequestId: record.purchaseRequestId,
      relatedTradeId: record.purchaseRequestId,
      relatedListingId: record.listingId,
      relatedHref: adminCommissionDestination(record.id),
      actionHref: adminCommissionDestination(record.id),
      actionLabel: "Review Commission",
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
    const startedAtMs = new Date(request.updatedAt ?? request.tradeCreatedAt ?? request.createdAt).getTime();
    if (!startedAtMs || Number.isNaN(startedAtMs) || startedAtMs + timeoutWindowMs > nowMs) continue;
    if (request.inactivityWarningSentAt) {
      const warningAtMs = new Date(request.inactivityWarningSentAt).getTime();
      if (Number.isFinite(warningAtMs) && warningAtMs >= startedAtMs) {
        continue;
      }
    }
    changed = true;
    const now = nowIso();
    request.inactivityWarningSentAt = now;
    request.updatedAt = now;
    appendTradeTimelineEntry(request, {
      type: "trade_inactivity_warning_sent",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      actorRole: "admin",
      message: `Inactivity warning sent after ${TRADE_INACTIVITY_WARNING_MINUTES} minutes without buyer progress.`,
      createdAt: now,
    });
    await appendAuditLog(db, {
      action: "trade_inactivity_warning_sent",
      actorUserId: SYSTEM_ACTOR_USER_ID,
      targetUserId: request.buyerId,
      listingId: request.listingId,
      purchaseRequestId: request.id,
      details: `Trade ${request.tradeId ?? request.id} received inactivity warning after ${TRADE_INACTIVITY_WARNING_MINUTES} minutes.`,
      oldValue: { status: "accepted" },
      newValue: { status: "accepted", inactivityWarningSentAt: now },
      reason: "Buyer inactivity warning.",
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Action required on your trade",
      message: `Trade ${request.tradeId ?? request.id} is still active, but requires your next step. Please upload payment proof to continue.`,
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: "Buyer inactivity warning sent",
      message: `Trade ${request.tradeId ?? request.id} is still active. We reminded the buyer to continue the flow.`,
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    const buyer = db.users.find((user) => user.id === request.buyerId);
    if (buyer?.notificationPreferences?.email === true) {
      await sendMarketplaceEmail({
        event: "trade_cancelled",
        to: buyer.email,
        recipientName: buyer.fullName,
        recipientLocale: normalizePreferredLocale(buyer.preferredLocale),
        title: {
          ar: "إجراء مطلوب: الصفقة ما زالت بانتظارك",
          en: "Action Required: Trade Still Waiting",
        },
        message: {
          ar: `الصفقة ${request.tradeId ?? request.id} ما زالت نشطة وبانتظار تأكيد الدفع منك.`,
          en: `Trade ${request.tradeId ?? request.id} is still active and waiting for your payment confirmation.`,
        },
        actionLabel: { ar: "فتح غرفة الصفقة", en: "Open Trade Room" },
        actionPath: `/trade-room/${encodeURIComponent(request.id)}`,
        referenceLabel: request.tradeId ?? request.id,
        idempotencyKey: `trade-${request.id}-inactivity-warning-buyer-${request.updatedAt}`,
      });
    }
    const seller = db.users.find((user) => user.id === request.sellerId);
    if (seller?.notificationPreferences?.email === true) {
      await sendMarketplaceEmail({
        event: "trade_cancelled",
        to: seller.email,
        recipientName: seller.fullName,
        recipientLocale: normalizePreferredLocale(seller.preferredLocale),
        title: {
          ar: "تحديث الصفقة: تم تذكير المشتري",
          en: "Trade Update: Buyer Reminder Sent",
        },
        message: {
          ar: `الصفقة ${request.tradeId ?? request.id} ما زالت نشطة. تلقّى المشتري تذكيرًا بسبب عدم النشاط.`,
          en: `Trade ${request.tradeId ?? request.id} remains active. The buyer received an inactivity reminder.`,
        },
        actionLabel: { ar: "فتح غرفة الصفقة", en: "Open Trade Room" },
        actionPath: `/trade-room/${encodeURIComponent(request.id)}`,
        referenceLabel: request.tradeId ?? request.id,
        idempotencyKey: `trade-${request.id}-inactivity-warning-seller-${request.updatedAt}`,
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
        relatedHref: adminPurchaseRequestsDestination(request.id),
        actionHref: adminPurchaseRequestsDestination(request.id),
        actionLabel: "Review Trade",
        priority: "critical",
        forceInApp: true,
      });
    }
    publishRealtimeEvent({
      type: "trade.status_changed",
      payload: { request: enrichRequestWithEvidence(db, request) },
    });
  }

  const buyerConfirmationTimeoutMs = BUYER_CONFIRMATION_TIMEOUT_MINUTES * 60 * 1000;
  const buyerConfirmationTimeoutRequestIds: string[] = [];
  for (const request of db.purchaseRequests) {
    if (request.status !== "usdt_sent") continue;
    if (request.completedAt) continue;
    if (!request.usdtSentAt) continue;
    const usdtSentMs = new Date(request.usdtSentAt).getTime();
    if (!usdtSentMs || Number.isNaN(usdtSentMs) || usdtSentMs + buyerConfirmationTimeoutMs > nowMs) continue;
    buyerConfirmationTimeoutRequestIds.push(request.id);
  }

  for (const requestId of buyerConfirmationTimeoutRequestIds) {
    await updatePurchaseRequestStatus({
      requestId,
      actorUserId: SYSTEM_ACTOR_USER_ID,
      actorRole: "admin",
      nextStatus: "completed",
    });
  }
  if (buyerConfirmationTimeoutRequestIds.length > 0) {
    const refreshed = await readDb({ bypassCache: true });
    Object.assign(db, refreshed);
    changed = true;
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
      if (shouldExpire) {
        await expireListing(db, listing, SYSTEM_ACTOR_USER_ID, "Stale listing lock expired after recovery.");
        continue;
      }
      listing.status = "active";
      listing.expiredAt = undefined;
    }

    await appendAuditLog(db, {
      action: listing.status === "completed" ? "listing_completed" : "listing_reopened",
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
  if (actorUserId === SYSTEM_ACTOR_USER_ID) return "admin";
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
        const effectiveRank = seller.sellerRankOverride?.rank ?? resolveSellerPrestigeRankWithFloor(snapshot.totalUsdtVolume, seller.sellerPrestigeRank);
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
    const sellerNotificationContext = seller ? buildNotificationSellerContext(seller) : null;
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
      await sendSellerPrestigePromotionEmail({ seller: db.users[sellerIndex], rank: snapshot.level, promotionId: entry.id });
    }

    if (owner && sharpDrop && sellerNotificationContext) {
      pushNotification(db, {
        userId: owner.id,
        category: "trust",
        priority: "high",
        title: `Trust score drop: ${sellerNotificationContext.displayName}`,
        message: `${sellerNotificationContext.displayName} dropped from ${oldScore.toFixed(1)} to ${newScore.toFixed(1)}.`,
        relatedSellerName: sellerNotificationContext.displayName,
        relatedSellerUsername: sellerNotificationContext.username,
        relatedHref: sellerNotificationContext.profileHref,
        actionHref: sellerNotificationContext.profileHref,
        actionLabel: "Review Seller",
        forceInApp: true,
      });
    }

    if (owner && flagged && sellerNotificationContext) {
      const alreadyNotifiedRecently = db.notifications.some(
        (notification) =>
          notification.userId === owner.id &&
          notification.category === "trust" &&
          (notification.relatedSellerUsername === sellerNotificationContext.username || notification.message.includes(snapshot.sellerId)) &&
          formatIsraelCalendarDateKey(now) === formatIsraelCalendarDateKey(notification.createdAt),
      );
      if (!alreadyNotifiedRecently) {
        pushNotification(db, {
          userId: owner.id,
          category: "trust",
          priority: "high",
          title: `Flagged seller: ${sellerNotificationContext.displayName}`,
          message: `${sellerNotificationContext.displayName} triggered trust/risk signals. Trust score: ${newScore.toFixed(1)}/100.`,
          relatedSellerName: sellerNotificationContext.displayName,
          relatedSellerUsername: sellerNotificationContext.username,
          relatedHref: sellerNotificationContext.profileHref,
          actionHref: sellerNotificationContext.profileHref,
          actionLabel: "Review Seller",
          forceInApp: true,
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
  preferredLocale?: PreferredLocale;
}) {
  assertNoExchangeDirectContact(input.fullName);
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
    preferredLocale: normalizePreferredLocale(input.preferredLocale),
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
  preferredLocale?: PreferredLocale;
}) {
  const db = await readDb({ skipMaintenance: true });
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
    // Preserve a legacy display value during auth synchronization so a user is
    // not locked out before the privacy projection can redact it. Any actual
    // new display-name change remains subject to the content policy.
    if (nextFullName !== existing.fullName) assertNoExchangeDirectContact(nextFullName);
    const nextWhatsappNumber = input.whatsappNumber.trim() || existing.whatsappNumber;
    const nextPasswordHash = input.passwordHash ?? existing.passwordHash;
    const nextRole = resolvePrimaryRole(normalizedRoles);
    const nextEmailVerified = input.emailVerified === true ? true : existing.emailVerified === true;
    const nextEmailVerifiedAt = input.emailVerified === true
      ? (existing.emailVerifiedAt ?? timestamp)
      : existing.emailVerifiedAt;
    const nextPreferredLocale = input.preferredLocale ?? normalizePreferredLocale(existing.preferredLocale);

    const unchanged =
      existing.fullName === nextFullName
      && existing.whatsappNumber === nextWhatsappNumber
      && existing.passwordHash === nextPasswordHash
      && existing.role === nextRole
      && existing.emailVerified === nextEmailVerified
      && existing.emailVerifiedAt === nextEmailVerifiedAt
      && existing.preferredLocale === nextPreferredLocale
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
      preferredLocale: nextPreferredLocale,
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
  assertNoExchangeDirectContact(input.fullName);
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
    preferredLocale: normalizePreferredLocale(input.preferredLocale),
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

function hashPhoneOtp(phone: string, code: string, salt: string) {
  return createHash("sha256").update(`${phone}:${code}:${salt}`).digest("hex");
}

export async function beginProfilePhoneVerification(input: { userId: string; phone: string }) {
  const phone = normalizeE164(input.phone);
  if (!phone) throw new Error("Enter a valid international E.164 phone number.");
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  if (db.users.some((user) => user.id !== input.userId && user.verifiedPhone === phone)) {
    throw new Error("This phone number is already linked to another account.");
  }
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  const now = nowIso();
  db.users[index] = {
    ...db.users[index], phoneOtpPhone: phone, phoneOtpSalt: salt, phoneOtpHash: hashPhoneOtp(phone, code, salt),
    phoneOtpExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), phoneOtpAttempts: 0, updatedAt: now,
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return { phone, code };
}

export async function confirmProfilePhoneVerification(input: { userId: string; phone: string; code: string }) {
  const phone = normalizeIsraeliPhone(input.phone) ?? normalizeE164(input.phone);
  if (!phone || !/^\d{6}$/.test(input.code)) throw new Error("Invalid verification code.");
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  const expiresAt = new Date(user.phoneOtpExpiresAt ?? 0).getTime();
  const attempts = Number(user.phoneOtpAttempts ?? 0);
  if (user.phoneOtpPhone !== phone || !user.phoneOtpHash || !user.phoneOtpSalt || !Number.isFinite(expiresAt) || expiresAt < Date.now() || attempts >= 5) {
    throw new Error("Verification code expired or invalid. Request a new code.");
  }
  const expected = Buffer.from(user.phoneOtpHash, "hex");
  const actual = Buffer.from(hashPhoneOtp(phone, input.code, user.phoneOtpSalt), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    db.users[index] = { ...user, phoneOtpAttempts: attempts + 1, updatedAt: nowIso() };
    await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
    throw new Error("Invalid verification code.");
  }
  if (db.users.some((item) => item.id !== user.id && item.verifiedPhone === phone)) throw new Error("This phone number is already linked to another account.");
  db.users[index] = {
    ...user, verifiedPhone: phone, phoneVerifiedAt: nowIso(),
    phoneOtpHash: undefined, phoneOtpSalt: undefined, phoneOtpExpiresAt: undefined, phoneOtpPhone: undefined, phoneOtpAttempts: undefined,
    updatedAt: nowIso(),
  };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
  return db.users[index];
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
  assertNoExchangeDirectContact(firstName, lastName, input.displayName);

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
  assertNoExchangeDirectContact(input.firstName, input.lastName, input.displayName);
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === input.userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  const normalizedPhone = normalizeIsraeliPhone(input.phone);
  if (!normalizedPhone) {
    throw new Error("This marketplace is currently available only for verified Israeli buyers.");
  }

  const today = formatIsraelCalendarDateKey(Date.now());
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

function getSellerBankAccounts(user: AlphaExchangeUser) {
  return [...(user.sellerBankAccounts ?? [])].slice(0, MAX_SELLER_BANK_ACCOUNTS);
}

function getSellerBankAccountById(user: AlphaExchangeUser, bankAccountId: string) {
  return getSellerBankAccounts(user).find((account) => account.id === bankAccountId);
}

function isTradeStatusUsingBankDetails(status: PurchaseRequestStatus) {
  return status === "accepted"
    || status === "payment_sent"
    || status === "funds_received"
    || status === "usdt_release_pending"
    || status === "usdt_sent";
}

function hasActiveUsageForSellerBankAccount(db: AlphaExchangeDb, sellerId: string, bankAccountId: string) {
  const activeTrade = db.purchaseRequests.find((request) =>
    request.sellerId === sellerId
    && request.sellerBankAccountId === bankAccountId
    && isTradeStatusUsingBankDetails(request.status),
  );
  if (activeTrade) return true;
  return db.marketplaceListings.some((listing) =>
    listing.sellerId === sellerId
    && listing.bankAccountId === bankAccountId
    && listing.status !== "cancelled"
    && listing.status !== "closed"
    && listing.status !== "completed",
  );
}

function toPublicSellerBankAccount(account: SellerBankAccount) {
  return {
    id: account.id,
    accountHolderName: account.accountHolderName,
    bankName: account.bankName,
    branchNumber: account.branchNumber,
    accountLast4: account.accountLast4,
    maskedAccountNumber: maskBankAccountNumber(account.accountNumber),
    isDefault: account.isDefault === true,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function getSellerBankAccountsForUser(userId: string) {
  const db = await readDb();
  const user = db.users.find((item) => item.id === userId);
  if (!user) throw new Error("User not found.");
  return getSellerBankAccounts(user).map(toPublicSellerBankAccount);
}

export async function addSellerBankAccount(input: {
  sellerId: string;
  actorUserId: string;
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  isDefault?: boolean;
}) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === input.sellerId);
  if (userIndex === -1) throw new Error("Seller not found.");
  const user = db.users[userIndex];
  const existing = getSellerBankAccounts(user);
  if (existing.length >= MAX_SELLER_BANK_ACCOUNTS) {
    throw new Error(`You can save up to ${MAX_SELLER_BANK_ACCOUNTS} bank accounts.`);
  }
  const sanitized = sanitizeSellerBankAccountInput(input);
  const now = nowIso();
  const newAccount: SellerBankAccount = {
    id: `seller-bank-${randomUUID()}`,
    sellerId: input.sellerId,
    accountHolderName: sanitized.accountHolderName,
    bankName: sanitized.bankName,
    branchNumber: sanitized.branchNumber,
    accountNumber: sanitized.accountNumber,
    accountLast4: sanitized.accountLast4,
    isDefault: input.isDefault === true || existing.length === 0,
    createdAt: now,
    updatedAt: now,
  };
  const nextAccounts = [newAccount, ...existing].map((account, index) => ({
    ...account,
    isDefault: index === 0 ? newAccount.isDefault === true : (newAccount.isDefault === true ? false : account.isDefault === true),
  }));
  if (!nextAccounts.some((account) => account.isDefault === true) && nextAccounts.length > 0) {
    nextAccounts[0] = { ...nextAccounts[0], isDefault: true, updatedAt: now };
  }
  db.users[userIndex] = {
    ...user,
    sellerBankAccounts: nextAccounts,
    updatedAt: now,
  };
  await appendAuditLog(db, {
    action: "seller_bank_account_added",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: `Seller added bank account ${newAccount.id}.`,
    newValue: { bankAccountId: newAccount.id, bankName: newAccount.bankName, branchNumber: newAccount.branchNumber, accountLast4: newAccount.accountLast4 },
  });
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  return toPublicSellerBankAccount(newAccount);
}

export async function updateSellerBankAccount(input: {
  sellerId: string;
  actorUserId: string;
  bankAccountId: string;
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  isDefault?: boolean;
}) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === input.sellerId);
  if (userIndex === -1) throw new Error("Seller not found.");
  const user = db.users[userIndex];
  const accounts = getSellerBankAccounts(user);
  const accountIndex = accounts.findIndex((account) => account.id === input.bankAccountId);
  if (accountIndex === -1) throw new Error("Bank account not found.");
  const sanitized = sanitizeSellerBankAccountInput(input);
  const now = nowIso();
  const updatedAccount: SellerBankAccount = {
    ...accounts[accountIndex],
    accountHolderName: sanitized.accountHolderName,
    bankName: sanitized.bankName,
    branchNumber: sanitized.branchNumber,
    accountNumber: sanitized.accountNumber,
    accountLast4: sanitized.accountLast4,
    isDefault: input.isDefault === true ? true : accounts[accountIndex].isDefault === true,
    updatedAt: now,
  };
  const nextAccounts = accounts.map((account, index) => {
    if (index === accountIndex) return updatedAccount;
    if (updatedAccount.isDefault === true) return { ...account, isDefault: false, updatedAt: now };
    return account;
  });
  if (!nextAccounts.some((account) => account.isDefault === true) && nextAccounts.length > 0) {
    nextAccounts[0] = { ...nextAccounts[0], isDefault: true, updatedAt: now };
  }
  db.users[userIndex] = {
    ...user,
    sellerBankAccounts: nextAccounts,
    updatedAt: now,
  };

  for (const listing of db.marketplaceListings) {
    if (listing.sellerId !== input.sellerId || listing.bankAccountId !== updatedAccount.id) continue;
    listing.bankName = updatedAccount.bankName;
    listing.updatedAt = now;
  }
  for (const request of db.purchaseRequests) {
    if (request.sellerId !== input.sellerId || request.sellerBankAccountId !== updatedAccount.id) continue;
    request.bankName = updatedAccount.bankName;
    request.updatedAt = now;
  }

  await appendAuditLog(db, {
    action: "seller_bank_account_updated",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: `Seller updated bank account ${updatedAccount.id}.`,
    newValue: { bankAccountId: updatedAccount.id, bankName: updatedAccount.bankName, branchNumber: updatedAccount.branchNumber, accountLast4: updatedAccount.accountLast4 },
  });
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  return toPublicSellerBankAccount(updatedAccount);
}

export async function deleteSellerBankAccount(input: {
  sellerId: string;
  actorUserId: string;
  bankAccountId: string;
}) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === input.sellerId);
  if (userIndex === -1) throw new Error("Seller not found.");
  const user = db.users[userIndex];
  const accounts = getSellerBankAccounts(user);
  const account = accounts.find((item) => item.id === input.bankAccountId);
  if (!account) throw new Error("Bank account not found.");
  if (hasActiveUsageForSellerBankAccount(db, input.sellerId, input.bankAccountId)) {
    throw new Error("This bank account is linked to active trades or listings and cannot be deleted right now.");
  }
  const now = nowIso();
  const nextAccounts = accounts.filter((item) => item.id !== input.bankAccountId);
  if (!nextAccounts.some((item) => item.isDefault === true) && nextAccounts.length > 0) {
    nextAccounts[0] = { ...nextAccounts[0], isDefault: true, updatedAt: now };
  }
  db.users[userIndex] = {
    ...user,
    sellerBankAccounts: nextAccounts,
    updatedAt: now,
  };
  await appendAuditLog(db, {
    action: "seller_bank_account_deleted",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: `Seller deleted bank account ${account.id}.`,
    oldValue: { bankAccountId: account.id, bankName: account.bankName, branchNumber: account.branchNumber, accountLast4: account.accountLast4 },
  });
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  return { deleted: true };
}

export async function updateUserPreferredLocale(input: {
  userId: string;
  preferredLocale: PreferredLocale;
}): Promise<AlphaExchangeUser> {
  const db = await readDb({ bypassCache: true });
  const committed: { user?: AlphaExchangeUser } = {};
  const applyPreferredLocale = (snapshot: AlphaExchangeDb) => {
    const index = snapshot.users.findIndex((user) => user.id === input.userId);
    if (index === -1) throw new Error("User not found.");
    const user = snapshot.users[index];
    if (user.preferredLocale === input.preferredLocale) {
      committed.user = user;
      return snapshot;
    }
    snapshot.users[index] = {
      ...user,
      preferredLocale: input.preferredLocale,
      updatedAt: nowIso(),
    };
    committed.user = snapshot.users[index];
    return snapshot;
  };

  applyPreferredLocale(db);
  await writeDb(db, {
    selectedTables: ["users"],
    rebaseOnLatest: applyPreferredLocale,
  });
  if (!committed.user) throw new Error("User not found.");
  return committed.user;
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
  // Own private WhatsApp/phone fields intentionally remain outside this
  // counterparty-content policy. Every field below can be projected to a
  // buyer, seller, or public profile and must stay on-platform.
  assertNoExchangeDirectContact(
    input.fullName,
    input.profilePhotoUrl,
    input.coverBannerUrl,
    input.bio,
    input.tradingExperience,
    input.workingHours,
    input.country,
    input.city,
    ...(input.languages ?? []),
    ...(input.preferredPaymentMethods ?? []),
  );
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

function normalizeComplianceEvidenceDataUrl(value: string) {
  const trimmed = String(value ?? "").trim();
  const marker = ";base64,";
  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex === -1) {
    return { mimeTypeFromDataUrl: "", contentBase64: trimmed };
  }
  const prefix = trimmed.slice(0, markerIndex);
  const mimeTypeFromDataUrl = prefix.startsWith("data:") ? prefix.slice(5) : "";
  return {
    mimeTypeFromDataUrl,
    contentBase64: trimmed.slice(markerIndex + marker.length),
  };
}

async function uploadComplianceEvidence(input: {
  sellerId: string;
  actorUserId: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  fileData: string;
}) {
  const fileName = path.basename(String(input.fileName ?? "").trim() || "compliance-evidence");
  if (!fileName) throw new Error("Evidence filename is required.");
  const parsed = normalizeComplianceEvidenceDataUrl(input.fileData);
  if (!parsed.contentBase64) throw new Error("Evidence file payload is required.");
  const mimeType = String(input.mimeType ?? parsed.mimeTypeFromDataUrl ?? "").trim().toLowerCase();
  if (!supportedComplianceEvidenceMimeTypes.has(mimeType)) {
    throw new Error("Evidence must be image/png, image/jpeg, image/webp, or application/pdf.");
  }
  const maxBytes = getMaxEvidenceSizeBytes();
  const raw = Buffer.from(parsed.contentBase64, "base64");
  if (!raw.length || raw.length > maxBytes) {
    throw new Error(`Evidence file exceeds limit (${Math.round(maxBytes / (1024 * 1024))}MB).`);
  }
  const sizeBytes = Number.isFinite(Number(input.sizeBytes)) && Number(input.sizeBytes) > 0
    ? Number(input.sizeBytes)
    : raw.byteLength;
  const extension = extensionForEvidenceMimeType(mimeType);
  const evidenceId = `compliance-evidence-${randomUUID()}`;
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-") || `compliance-evidence.${extension}`;
  const storagePath = `db://alpha-exchange-evidence/compliance/${input.sellerId}/${evidenceId}.${extension}`;

  const repository = await getAlphaExchangeRepository();
  await repository.writeEvidenceContent(storagePath, raw);

  return {
    id: evidenceId,
    fileName: safeFileName,
    mimeType,
    sizeBytes,
    url: `/api/alpha-exchange/admin/sellers/${input.sellerId}/compliance-evidence/${evidenceId}`,
    uploadedByUserId: input.actorUserId,
    uploadedAt: nowIso(),
    storagePath,
  } satisfies MarketplaceComplianceEvidenceReference & { storagePath: string };
}

export async function updateOwnerMarketplaceComplianceRecoveryWallet(input: {
  actorUserId: string;
  network: SupportedNetwork;
  walletAddress: string;
  defaultPaymentRail?: CompliancePaymentRail;
}) {
  const db = await readDb();
  const ownerIndex = db.users.findIndex((user) => user.id === input.actorUserId && hasRole(user, "owner"));
  if (ownerIndex === -1) throw new Error("Owner account not found.");
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  const validationError = getWalletAddressValidationError(input.network, walletAddress);
  if (validationError) throw new Error(validationError);
  const now = nowIso();
  db.users[ownerIndex] = {
    ...db.users[ownerIndex],
    ownerSettings: {
      ...(db.users[ownerIndex].ownerSettings ?? {}),
      marketplaceComplianceRecoveryWallet: {
        network: input.network,
        walletAddress,
        defaultPaymentRail: input.defaultPaymentRail === "alpha_wallet_one_click" ? "alpha_wallet_one_click" : "manual_wallet_transfer",
        updatedAt: now,
        updatedByUserId: input.actorUserId,
      },
    },
    updatedAt: now,
  };
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    targetUserId: input.actorUserId,
    details: "Updated Marketplace Compliance Recovery Wallet settings.",
    newValue: {
      network: input.network,
      walletAddress,
      defaultPaymentRail: input.defaultPaymentRail === "alpha_wallet_one_click" ? "alpha_wallet_one_click" : "manual_wallet_transfer",
    },
  });
  await writeDb(db, { selectedTables: ["users", "seller_profiles", "seller_settings", "audit_logs"] });
  return db.users[ownerIndex].ownerSettings?.marketplaceComplianceRecoveryWallet;
}

export async function findUserByEmail(email: string) {
  const db = await readDb({ skipMaintenance: true });
  const normalized = normalizeEmail(email);
  return db.users.find((user) => normalizeEmail(user.email) === normalized) ?? null;
}

export async function findUsersByEmail(email: string) {
  const db = await readDb({ skipMaintenance: true });
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
  const db = await readDb({ skipMaintenance: true });
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
  await writeDb(db, { selectedTables: PASSWORD_RESET_TABLES });
  return reset;
}

export async function consumePasswordResetToken(rawToken: string) {
  const db = await readDb();
  const hashed = hashToken(rawToken);
  const token = db.passwordResetTokens.find((item) => item.tokenHash === hashed);
  if (!token) return null;
  if (new Date(token.expiresAt) < new Date()) {
    db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.tokenHash !== hashed);
    await writeDb(db, { selectedTables: PASSWORD_RESET_TABLES });
    return null;
  }
  db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.tokenHash !== hashed);
  await writeDb(db, { selectedTables: PASSWORD_RESET_TABLES });
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
  const priorSmsCount = db.smsDeliveries?.length ?? 0;
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

  const reviewDestination = sellerApplicationReviewDestination(next.id);
  for (const adminUser of getAdminNotificationRecipients(db)) {
    pushNotification(db, {
      userId: adminUser.id,
      category: "application",
      title: "New Approved Seller Application",
      message: `${next.fullName} has applied to become an Approved Seller.`,
      actionLabel: "Review Application",
      relatedHref: reviewDestination,
      actionHref: reviewDestination,
      priority: "critical",
      forceInApp: true,
    });
    queueSmsDelivery(db, {
      eventType: "seller_application_submitted",
      eventKey: `seller-application:${next.id}:admin:${adminUser.id}`,
      recipientUserId: adminUser.id,
      destinationPath: reviewDestination,
    });
  }
  pushActivityLog(db, {
    userId: input.userId,
    category: "application",
    title: "Seller application submitted",
    details: "Your seller application is pending owner review.",
  });

  await writeDb(db, { selectedTables: SELLER_APPLICATION_REVIEW_TABLES });
  await dispatchCommittedSms(db, priorSmsCount);
  await dispatchOwnerActionRequiredEmails(db, {
    event: "owner_seller_application_review_required",
    title: { ar: "طلب بائع يحتاج إلى المراجعة", en: "Seller Application Needs Review" },
    message: {
      ar: `تقدّم ${next.fullName} ليصبح بائعًا معتمدًا. راجع الطلب من هاتفك.`,
      en: `${next.fullName} applied to become an Approved Seller. Review the application from your phone.`,
    },
    actionLabel: { ar: "مراجعة الطلب", en: "Review Application" },
    actionHref: reviewDestination,
    referenceLabel: next.id,
  });
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
    relatedHref: sellerApplicationStatusDestination(),
  });
  pushActivityLog(db, {
    userId: application.userId,
    category: "application",
    title: "Application approved",
    details: "You can now create listings as an approved seller.",
  });
  const archivedAdminNotifications = archiveAdminActionNotifications(
    db,
    (notification) => notification.category === "application"
      && (notification.actionHref === sellerApplicationReviewDestination(application.id)
        || notification.relatedHref === sellerApplicationReviewDestination(application.id)),
  );
  await recalculateTrustEngine(db, { reason: "Seller approved", triggeredBy: adminUserId });

  await writeDb(db, { selectedTables: SELLER_APPLICATION_REVIEW_TABLES });
  publishArchivedNotifications(archivedAdminNotifications);
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
    relatedHref: sellerApplicationStatusDestination(),
  });
  pushActivityLog(db, {
    userId: application.userId,
    category: "application",
    title: "Application rejected",
    details: "You can update details and apply again.",
  });
  const archivedAdminNotifications = archiveAdminActionNotifications(
    db,
    (notification) => notification.category === "application"
      && (notification.actionHref === sellerApplicationReviewDestination(application.id)
        || notification.relatedHref === sellerApplicationReviewDestination(application.id)),
  );
  await recalculateTrustEngine(db, { reason: "Seller application rejected", triggeredBy: adminUserId });

  await writeDb(db, { selectedTables: SELLER_APPLICATION_REVIEW_TABLES });
  publishArchivedNotifications(archivedAdminNotifications);
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

function closeRevokedSellerListings(db: AlphaExchangeDb, sellerId: string) {
  const now = nowIso();
  const closableStatuses: ListingStatus[] = ["active", "paused", "expired", "draft"];
  const closedListingIds: string[] = [];
  for (const listing of db.marketplaceListings) {
    if (listing.sellerId !== sellerId) continue;
    if (isListingLocked(listing.status)) continue;
    if (!closableStatuses.includes(listing.status)) continue;
    listing.status = "closed";
    listing.closedAt = now;
    listing.updatedAt = now;
    listing.activeTradeRequestId = undefined;
    listing.lockedAt = undefined;
    closedListingIds.push(listing.id);
  }
  return closedListingIds;
}

export async function getSellerMarketplaceEnforcementStatus(sellerId: string, dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const activeRecord = getSellerActiveEnforcementRecord(db, sellerId);
  const latestRecord = getSellerLatestEnforcementRecord(db, sellerId);
  const latestAuditEntries = getMarketplaceEnforcementAuditLog(db)
    .filter((entry) => entry.sellerId === sellerId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 30);

  return {
    restricted: Boolean(activeRecord),
    blockReason: getSellerEnforcementRestrictionMessage(db, sellerId),
    activeRecord,
    latestRecord,
    recentAuditEntries: latestAuditEntries,
    totalCases: getMarketplaceEnforcementRecords(db).filter((record) => record.sellerId === sellerId).length,
  };
}

export async function issueMarketplaceEnforcementFeeByAdmin(input: {
  sellerId: string;
  actorUserId: string;
  feeAmount: number;
  reason: string;
  adminNotes: string;
  evidenceFiles: Array<{
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
    fileData: string;
  }>;
  dueAt?: string;
}) {
  const db = await readDb();
  const seller = db.users.find((user) => user.id === input.sellerId);
  if (!seller) throw new Error("Seller not found.");
  if (hasRole(seller, "owner")) throw new Error("Owner account cannot be modified.");
  if (seller.sellerStatus !== "approved_seller" && seller.sellerStatus !== "suspended") {
    throw new Error("Marketplace Compliance actions can be issued only to active or suspended seller accounts.");
  }
  const trimmedReason = input.reason.trim();
  if (!trimmedReason) throw new Error("Violation reason is required.");
  const adminNotes = String(input.adminNotes ?? "").trim();
  if (!adminNotes) throw new Error("Internal admin notes are required before issuing a compliance action.");
  if (!Array.isArray(input.evidenceFiles) || input.evidenceFiles.length === 0) {
    throw new Error("At least one evidence attachment is required before issuing a compliance action.");
  }
  const feeAmount = Number(input.feeAmount);
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) throw new Error("Fee amount must be greater than zero.");
  if (getSellerActiveEnforcementRecord(db, input.sellerId)) {
    throw new Error("This seller already has an active marketplace restriction.");
  }

  const sellerRecords = getMarketplaceEnforcementRecords(db).filter((record) => record.sellerId === input.sellerId);
  const priorViolationNumber = sellerRecords.reduce((max, record) => Math.max(max, record.violationNumber), 0);
  const violationNumber = priorViolationNumber + 1;
  if (violationNumber > 1) {
    throw new Error("Second confirmed violation must use permanent revoke action.");
  }

  const walletConfig = getOwnerComplianceRecoveryWalletConfig(db);
  if (!walletConfig) {
    throw new Error("Marketplace Compliance Recovery Wallet is not configured in Owner Settings.");
  }

  const evidenceReferences: MarketplaceComplianceEvidenceReference[] = [];
  for (const item of input.evidenceFiles) {
    const uploaded = await uploadComplianceEvidence({
      sellerId: input.sellerId,
      actorUserId: input.actorUserId,
      fileName: item.fileName,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      fileData: item.fileData,
    });
    evidenceReferences.push({
      id: uploaded.id,
      fileName: uploaded.fileName,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      url: uploaded.url,
      uploadedByUserId: uploaded.uploadedByUserId,
      uploadedAt: uploaded.uploadedAt,
    });
  }

  const now = nowIso();
  const dueAt = input.dueAt?.trim() ? new Date(input.dueAt).toISOString() : undefined;
  const qrPayload = `${walletConfig.network}:${walletConfig.walletAddress}?token=USDT&amount=${feeAmount.toFixed(2)}&reference=${encodeURIComponent(`violation-${violationNumber}`)}`;
  const enforcementRecord: MarketplaceEnforcementRecord = {
    id: `enforcement-${randomUUID()}`,
    sellerId: input.sellerId,
    violationNumber,
    status: "active",
    feeAmount,
    feeCurrency: "USDT",
    recoveryWalletNetwork: walletConfig.network,
    recoveryWalletAddress: walletConfig.walletAddress,
    recoveryPaymentRail: walletConfig.defaultPaymentRail,
    recoveryPaymentStatus: "pending_payment",
    recoveryPaymentRequestedAt: now,
    recoveryPaymentQrPayload: qrPayload,
    reason: trimmedReason,
    adminNotes,
    dueAt,
    issuedByUserId: input.actorUserId,
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  db.marketplaceEnforcementRecords = [enforcementRecord, ...getMarketplaceEnforcementRecords(db)];

  appendMarketplaceEnforcementAudit(db, {
    sellerId: input.sellerId,
    enforcementRecordId: enforcementRecord.id,
    action: "fee_issued",
    actorUserId: input.actorUserId,
    reason: trimmedReason,
    notes: enforcementRecord.adminNotes,
    evidenceReferences,
    metadata: {
      feeAmount,
      feeCurrency: "USDT",
      violationNumber,
      recoveryWalletNetwork: walletConfig.network,
      recoveryWalletAddress: walletConfig.walletAddress,
    },
  });
  await appendAuditLog(db, {
    action: "marketplace_enforcement_fee_issued",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: `Issued marketplace enforcement fee (${feeAmount.toFixed(2)} USDT) for violation #${violationNumber}.`,
    reason: trimmedReason,
    newValue: {
      enforcementRecordId: enforcementRecord.id,
      feeAmount,
      feeCurrency: "USDT",
      violationNumber,
      dueAt,
      recoveryWalletNetwork: walletConfig.network,
      recoveryWalletAddress: walletConfig.walletAddress,
      evidenceCount: evidenceReferences.length,
    },
  });
  pushNotification(db, {
    userId: input.sellerId,
    category: "system",
    priority: "high",
    title: "Marketplace compliance restriction issued",
    message: `A Marketplace Recovery Fee of ${feeAmount.toFixed(2)} USDT was issued. Complete payment to ${walletConfig.walletAddress} on ${walletConfig.network} and submit proof for verification to restore listing access.`,
    relatedHref: "/dashboard/seller/compliance-payment",
  });
  await sendSellerEnforcementEmail(db, input.sellerId, {
    event: "marketplace_enforcement_fee_issued",
    title: {
      ar: "تم فرض تقييد امتثال في السوق",
      en: "Marketplace Compliance Restriction Issued",
    },
    message: {
      ar: `تم إصدار رسوم استعادة للسوق بقيمة ${feeAmount.toFixed(2)} USDT على حساب البائع الخاص بك. أرسل المبلغ إلى ${walletConfig.walletAddress} عبر شبكة ${walletConfig.network}، ثم قدّم إثبات الدفع للتحقّق.`,
      en: `A Marketplace Recovery Fee of ${feeAmount.toFixed(2)} USDT was issued for your seller account. Send payment to ${walletConfig.walletAddress} on ${walletConfig.network}, then submit payment proof for verification.`,
    },
    referenceLabel: enforcementRecord.id,
    idempotencyKey: `enforcement-${enforcementRecord.id}-issued`,
  });
  await writeDb(db, { selectedTables: ENFORCEMENT_MUTATION_TABLES });
  return getSellerMarketplaceEnforcementStatus(input.sellerId, db);
}

export async function submitMarketplaceEnforcementPaymentBySeller(input: {
  sellerId: string;
  note?: string;
}) {
  const db = await readDb();
  const activeRecord = getSellerActiveEnforcementRecord(db, input.sellerId);
  if (!activeRecord) throw new Error("No active marketplace restriction found for this seller.");
  if (!activeRecord.recoveryWalletAddress || !activeRecord.recoveryWalletNetwork) {
    throw new Error("Recovery wallet details are missing from this compliance record.");
  }
  if (getRecoveryFeePaymentStatus(activeRecord) === "awaiting_verification") {
    throw new Error("Payment submission is already awaiting owner verification.");
  }
  const now = nowIso();
  activeRecord.recoveryPaymentStatus = "awaiting_verification";
  activeRecord.recoveryPaymentSubmittedAt = now;
  activeRecord.recoveryPaymentSubmittedByUserId = input.sellerId;
  activeRecord.recoveryPaymentSubmissionNote = input.note?.trim() || undefined;
  activeRecord.updatedAt = now;

  appendMarketplaceEnforcementAudit(db, {
    sellerId: input.sellerId,
    enforcementRecordId: activeRecord.id,
    action: "payment_submitted",
    actorUserId: input.sellerId,
    notes: activeRecord.recoveryPaymentSubmissionNote,
    metadata: {
      recoveryWalletNetwork: activeRecord.recoveryWalletNetwork,
      recoveryWalletAddress: activeRecord.recoveryWalletAddress,
      feeAmount: activeRecord.feeAmount,
      feeCurrency: activeRecord.feeCurrency,
    },
  });
  pushNotification(db, {
    userId: input.sellerId,
    category: "system",
    priority: "high",
    title: "Payment submitted",
    message: "Your Marketplace Recovery Fee payment was submitted and is awaiting owner verification.",
    relatedHref: "/dashboard/seller/compliance-payment",
  });

  const owner = db.users.find((user) => hasRole(user, "owner"));
  const seller = db.users.find((user) => user.id === input.sellerId);
  const sellerContext = seller ? buildNotificationSellerContext(seller) : null;
  if (owner && sellerContext) {
    pushNotification(db, {
      userId: owner.id,
      category: "system",
      priority: "high",
      title: `Compliance payment: ${sellerContext.displayName}`,
      message: `${sellerContext.displayName} submitted payment proof for enforcement ${activeRecord.id}.`,
      relatedSellerName: sellerContext.displayName,
      relatedSellerUsername: sellerContext.username,
      relatedHref: adminMarketplaceEnforcementDestination(),
      actionHref: adminMarketplaceEnforcementDestination(),
      actionLabel: "Review Marketplace Compliance",
      forceInApp: true,
    });
  }

  await writeDb(db, { selectedTables: ENFORCEMENT_MUTATION_TABLES });
  return getSellerMarketplaceEnforcementStatus(input.sellerId, db);
}

export async function submitMarketplaceEnforcementAppealBySeller(input: {
  sellerId: string;
  message: string;
}) {
  const db = await readDb();
  const activeRecord = getSellerActiveEnforcementRecord(db, input.sellerId);
  if (!activeRecord) throw new Error("No active marketplace restriction found for this seller.");
  const message = String(input.message ?? "").trim();
  if (!message) throw new Error("Appeal message is required.");
  if ((activeRecord.appealStatus ?? "none") === "submitted") {
    throw new Error("An appeal is already pending owner decision.");
  }
  const now = nowIso();
  activeRecord.appealStatus = "submitted";
  activeRecord.appealMessage = message;
  activeRecord.appealSubmittedAt = now;
  activeRecord.appealSubmittedByUserId = input.sellerId;
  activeRecord.appealDecisionAt = undefined;
  activeRecord.appealDecisionByUserId = undefined;
  activeRecord.appealDecisionNotes = undefined;
  activeRecord.updatedAt = now;

  appendMarketplaceEnforcementAudit(db, {
    sellerId: input.sellerId,
    enforcementRecordId: activeRecord.id,
    action: "appeal_submitted",
    actorUserId: input.sellerId,
    notes: message,
  });

  const owner = db.users.find((user) => hasRole(user, "owner"));
  const seller = db.users.find((user) => user.id === input.sellerId);
  const sellerContext = seller ? buildNotificationSellerContext(seller) : null;
  if (owner && sellerContext) {
    pushNotification(db, {
      userId: owner.id,
      category: "system",
      priority: "high",
      title: `Compliance appeal: ${sellerContext.displayName}`,
      message: `${sellerContext.displayName} submitted a compliance appeal.`,
      relatedSellerName: sellerContext.displayName,
      relatedSellerUsername: sellerContext.username,
      relatedHref: adminMarketplaceEnforcementDestination(),
      actionHref: adminMarketplaceEnforcementDestination(),
      actionLabel: "Review Marketplace Compliance",
      forceInApp: true,
    });
  }

  await writeDb(db, { selectedTables: ENFORCEMENT_MUTATION_TABLES });
  return getSellerMarketplaceEnforcementStatus(input.sellerId, db);
}

export async function decideMarketplaceEnforcementAppealByOwner(input: {
  sellerId: string;
  actorUserId: string;
  decision: "accepted" | "rejected";
  notes: string;
}) {
  const db = await readDb();
  const actor = db.users.find((user) => user.id === input.actorUserId);
  if (!actor || !hasRole(actor, "owner")) throw new Error("Owner access required.");
  const activeRecord = getSellerActiveEnforcementRecord(db, input.sellerId);
  if (!activeRecord) throw new Error("No active marketplace restriction found for this seller.");
  if ((activeRecord.appealStatus ?? "none") !== "submitted") {
    throw new Error("No submitted appeal exists for this seller.");
  }
  const notes = String(input.notes ?? "").trim();
  if (!notes) throw new Error("Appeal decision notes are required.");
  const now = nowIso();
  activeRecord.appealStatus = input.decision;
  activeRecord.appealDecisionAt = now;
  activeRecord.appealDecisionByUserId = input.actorUserId;
  activeRecord.appealDecisionNotes = notes;
  activeRecord.updatedAt = now;

  appendMarketplaceEnforcementAudit(db, {
    sellerId: input.sellerId,
    enforcementRecordId: activeRecord.id,
    action: "appeal_decided",
    actorUserId: input.actorUserId,
    notes,
    metadata: { decision: input.decision },
  });

  pushNotification(db, {
    userId: input.sellerId,
    category: "system",
    priority: "high",
    title: "Compliance appeal decision",
    message: input.decision === "accepted"
      ? "Your compliance appeal was accepted."
      : "Your compliance appeal was reviewed and rejected.",
    relatedHref: "/dashboard/seller/compliance-payment",
  });

  await writeDb(db, { selectedTables: ENFORCEMENT_MUTATION_TABLES });
  return getSellerMarketplaceEnforcementStatus(input.sellerId, db);
}

export async function confirmMarketplaceEnforcementPaymentByOwner(input: {
  sellerId: string;
  actorUserId: string;
  reason?: string;
  notes?: string;
}) {
  const db = await readDb();
  const actor = db.users.find((user) => user.id === input.actorUserId);
  if (!actor || !hasRole(actor, "owner")) throw new Error("Owner access required.");
  const activeRecord = getSellerActiveEnforcementRecord(db, input.sellerId);
  if (!activeRecord) throw new Error("No active marketplace restriction found for this seller.");
  if (getRecoveryFeePaymentStatus(activeRecord) !== "awaiting_verification") {
    throw new Error("This recovery fee is not awaiting verification.");
  }
  const result = await markMarketplaceEnforcementFeePaidByAdmin({
    sellerId: input.sellerId,
    actorUserId: input.actorUserId,
    reason: input.reason?.trim() || "Recovery fee payment verified by owner.",
    notes: input.notes,
  });
  return result;
}

export async function markMarketplaceEnforcementFeePaidByAdmin(input: {
  sellerId: string;
  actorUserId: string;
  reason?: string;
  notes?: string;
}) {
  const db = await readDb();
  const activeRecord = getSellerActiveEnforcementRecord(db, input.sellerId);
  if (!activeRecord) throw new Error("No active marketplace restriction found for this seller.");
  const now = nowIso();
  activeRecord.status = "resolved_paid";
  activeRecord.paidAt = now;
  activeRecord.paidByUserId = input.actorUserId;
  activeRecord.recoveryPaymentStatus = "confirmed_paid";
  activeRecord.recoveryPaymentConfirmedAt = now;
  activeRecord.recoveryPaymentConfirmedByUserId = input.actorUserId;
  activeRecord.updatedAt = now;

  appendMarketplaceEnforcementAudit(db, {
    sellerId: input.sellerId,
    enforcementRecordId: activeRecord.id,
    action: "fee_paid",
    actorUserId: input.actorUserId,
    reason: input.reason?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    metadata: { feeAmount: activeRecord.feeAmount, feeCurrency: activeRecord.feeCurrency },
  });
  await appendAuditLog(db, {
    action: "marketplace_enforcement_fee_paid",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: `Marked marketplace enforcement fee as paid (${activeRecord.feeAmount.toFixed(2)} USDT).`,
    reason: input.reason?.trim() || undefined,
    oldValue: { status: "active" },
    newValue: { status: activeRecord.status, paidAt: activeRecord.paidAt },
  });
  pushNotification(db, {
    userId: input.sellerId,
    category: "system",
    priority: "high",
    title: "Marketplace compliance restriction cleared",
    message: "Your Marketplace Recovery Fee was confirmed and the compliance restriction is now cleared. Listing and publishing permissions are restored.",
    relatedHref: "/dashboard/seller",
  });
  await sendSellerEnforcementEmail(db, input.sellerId, {
    event: "marketplace_enforcement_fee_paid",
    title: {
      ar: "تم رفع تقييد الامتثال في السوق",
      en: "Marketplace Compliance Restriction Cleared",
    },
    message: {
      ar: "تم تأكيد دفع رسوم استعادة السوق. تمت استعادة صلاحيات إنشاء الإعلانات ونشرها.",
      en: "Your Marketplace Recovery Fee was marked as paid. Listing and publishing permissions are now restored.",
    },
    referenceLabel: activeRecord.id,
    idempotencyKey: `enforcement-${activeRecord.id}-paid`,
  });
  await writeDb(db, { selectedTables: ENFORCEMENT_MUTATION_TABLES });
  return getSellerMarketplaceEnforcementStatus(input.sellerId, db);
}

export async function removeMarketplaceEnforcementRestrictionByAdmin(input: {
  sellerId: string;
  actorUserId: string;
  reason: string;
  notes?: string;
}) {
  const db = await readDb();
  const activeRecord = getSellerActiveEnforcementRecord(db, input.sellerId);
  if (!activeRecord) throw new Error("No active marketplace restriction found for this seller.");
  const trimmedReason = input.reason.trim();
  if (!trimmedReason) throw new Error("Reason is required.");
  const now = nowIso();
  activeRecord.status = "resolved_removed";
  activeRecord.restrictionRemovedAt = now;
  activeRecord.restrictionRemovedByUserId = input.actorUserId;
  activeRecord.updatedAt = now;

  appendMarketplaceEnforcementAudit(db, {
    sellerId: input.sellerId,
    enforcementRecordId: activeRecord.id,
    action: "restriction_removed",
    actorUserId: input.actorUserId,
    reason: trimmedReason,
    notes: input.notes?.trim() || undefined,
  });
  await appendAuditLog(db, {
    action: "marketplace_enforcement_restriction_removed",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: "Removed active marketplace restriction.",
    reason: trimmedReason,
    oldValue: { status: "active" },
    newValue: { status: activeRecord.status, removedAt: activeRecord.restrictionRemovedAt },
  });
  pushNotification(db, {
    userId: input.sellerId,
    category: "system",
    priority: "high",
    title: "Marketplace compliance restriction removed",
    message: "Your marketplace compliance restriction was removed by owner review. Listing and publishing permissions are restored.",
    relatedHref: "/dashboard/seller",
  });
  await writeDb(db, { selectedTables: ENFORCEMENT_MUTATION_TABLES });
  return getSellerMarketplaceEnforcementStatus(input.sellerId, db);
}

export async function revokeSellerMarketplacePrivilegesByAdmin(input: {
  sellerId: string;
  actorUserId: string;
  reason: string;
  notes?: string;
}) {
  const db = await readDb();
  const sellerIndex = db.users.findIndex((user) => user.id === input.sellerId);
  if (sellerIndex === -1) throw new Error("Seller not found.");
  const seller = db.users[sellerIndex];
  if (hasRole(seller, "owner")) throw new Error("Owner account cannot be modified.");

  const sellerRecords = getMarketplaceEnforcementRecords(db).filter((record) => record.sellerId === input.sellerId);
  const priorViolationNumber = sellerRecords.reduce((max, record) => Math.max(max, record.violationNumber), 0);
  if (priorViolationNumber < 1) {
    throw new Error("Permanent revoke requires at least one confirmed prior violation.");
  }
  const trimmedReason = input.reason.trim();
  if (!trimmedReason) throw new Error("Reason is required.");

  const now = nowIso();
  const activeRecord = getSellerActiveEnforcementRecord(db, input.sellerId);
  const revokeRecord = activeRecord ?? {
    id: `enforcement-${randomUUID()}`,
    sellerId: input.sellerId,
    violationNumber: priorViolationNumber + 1,
    status: "revoked" as MarketplaceEnforcementStatus,
    feeAmount: 0,
    feeCurrency: "USDT" as const,
    reason: trimmedReason,
    adminNotes: input.notes?.trim() || undefined,
    issuedByUserId: input.actorUserId,
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  revokeRecord.status = "revoked";
  revokeRecord.revokedAt = now;
  revokeRecord.revokedByUserId = input.actorUserId;
  revokeRecord.updatedAt = now;
  revokeRecord.reason = trimmedReason;
  revokeRecord.adminNotes = input.notes?.trim() || revokeRecord.adminNotes;

  if (!activeRecord) {
    db.marketplaceEnforcementRecords = [revokeRecord, ...getMarketplaceEnforcementRecords(db)];
  }

  const nextRoles = addRole(
    removeRole(removeRole(seller.roles ?? [seller.role], "approved_seller"), "pending_seller_approval"),
    "buyer",
  );
  db.users[sellerIndex] = {
    ...seller,
    role: resolvePrimaryRole(nextRoles),
    roles: nextRoles,
    sellerStatus: "buyer",
    availabilityStatus: "available",
    updatedAt: now,
  };

  const closedListingIds = closeRevokedSellerListings(db, input.sellerId);

  appendMarketplaceEnforcementAudit(db, {
    sellerId: input.sellerId,
    enforcementRecordId: revokeRecord.id,
    action: "seller_revoked",
    actorUserId: input.actorUserId,
    reason: trimmedReason,
    notes: input.notes?.trim() || undefined,
    metadata: { closedListingCount: closedListingIds.length, violationNumber: revokeRecord.violationNumber },
  });
  await appendAuditLog(db, {
    action: "marketplace_enforcement_seller_revoked",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    details: `Revoked marketplace seller privileges permanently. Closed ${closedListingIds.length} open listings.`,
    reason: trimmedReason,
    newValue: { sellerStatus: "buyer", closedListingIds },
  });
  pushNotification(db, {
    userId: input.sellerId,
    category: "system",
    priority: "high",
    title: "Seller privileges revoked",
    message: "Your seller marketplace privileges were permanently revoked after repeated policy violations. Existing active trades remain available for completion.",
    relatedHref: "/dashboard",
  });
  await sendSellerEnforcementEmail(db, input.sellerId, {
    event: "marketplace_enforcement_seller_revoked",
    title: {
      ar: "تم إلغاء صلاحيات البائع في السوق",
      en: "Seller Marketplace Privileges Revoked",
    },
    message: {
      ar: "تم إلغاء صلاحياتك كبائع في السوق نهائيًا بعد انتهاكات متكررة للسياسات. تبقى الصفقات النشطة الحالية متاحة لإكمالها.",
      en: "Your seller marketplace privileges were permanently revoked after repeated policy violations. Existing active trades remain available for completion.",
    },
    referenceLabel: revokeRecord.id,
    idempotencyKey: `enforcement-${revokeRecord.id}-revoked`,
  });
  await recalculateTrustEngine(db, { reason: "Seller marketplace privileges revoked", triggeredBy: input.actorUserId });
  await writeDb(db, { selectedTables: [...ENFORCEMENT_MUTATION_TABLES, "trust_snapshots", "trust_score_history", "activity_logs"] });
  return getSellerMarketplaceEnforcementStatus(input.sellerId, db);
}

export async function getMarketplaceEnforcementDashboardData(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const records = getMarketplaceEnforcementRecords(db);
  const audit = getMarketplaceEnforcementAuditLog(db)
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const sellersById = new Map(db.users.map((user) => [user.id, user]));
  const activeCases = records.filter((record) => record.status === "active");
  const revokedCases = records.filter((record) => record.status === "revoked");
  const resolvedCases = records.filter((record) => record.status === "resolved_paid" || record.status === "resolved_removed");
  return {
    metrics: {
      activeCases: activeCases.length,
      resolvedCases: resolvedCases.length,
      revokedCases: revokedCases.length,
      totalCases: records.length,
      outstandingFeeAmountUsdt: activeCases.reduce((sum, record) => sum + Math.max(0, Number(record.feeAmount)), 0),
    },
    activeCases: activeCases
      .map((record) => ({
        ...record,
        sellerName: sellersById.get(record.sellerId)?.fullName ?? "Unknown Seller",
        sellerEmail: sellersById.get(record.sellerId)?.email ?? "unknown@unknown",
      }))
      .sort((left, right) => new Date(right.issuedAt).getTime() - new Date(left.issuedAt).getTime()),
    recentActivity: audit.slice(0, 50).map((entry) => ({
      ...entry,
      sellerName: sellersById.get(entry.sellerId)?.fullName ?? "Unknown Seller",
      actorName: sellersById.get(entry.actorUserId)?.fullName ?? "System",
    })),
  };
}

export async function getApprovedSellersForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.users
    .filter((user) => user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended")
    .map(toAdminSellerSummary);
}

export async function getHallOfFameEntries() {
  const db = await readDb();
  return db.users
    .filter((user) => (user.sellerPrestigeRank ?? "bronze") === "elite")
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

export async function getMarketplaceListings(status?: string, dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  await ensureDevelopmentTesterMarketplaceListing(db);
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
  const snapshots = computeTrustSnapshotMap(db);
  const sortedListings = qualitySortListings(db, rawListings, snapshots);
  return enrichListingsWithSellerData(db, sortedListings, snapshots);
}

// ── Live marketplace pulse (real, privacy-safe public dashboard) ────────────
const PULSE_ONLINE_WINDOW_MS = 5 * 60 * 1000;
const PULSE_PRESENCE_TOUCH_THROTTLE_MS = 60 * 1000;

export type MarketplacePulseActivityType =
  | "new_listing"
  | "listing_renewed"
  | "trade_completed"
  | "seller_online";

export interface MarketplacePulseActivityEntry {
  id: string;
  type: MarketplacePulseActivityType;
  network?: SupportedNetwork;
  createdAt: string;
}

export interface MarketplacePulseData {
  sellersOnline: number;
  buyersOnline: number;
  activeTrades: number;
  activeListings: number;
  totalUsdtAvailable: number;
  completedTrades: number;
  totalVolumeUsdt: number;
  averageResponseMinutes: number;
  trendingNetwork: SupportedNetwork | null;
  popularPaymentMethod: string | null;
  lastCompletedTrade: { network: SupportedNetwork; completedAt: string } | null;
  recentActivity: MarketplacePulseActivityEntry[];
  generatedAt: string;
}

const PULSE_ACTIVE_TRADE_STATUSES = new Set<PurchaseRequestStatus>([
  "pending",
  "accepted",
  "payment_sent",
  "funds_received",
  "usdt_release_pending",
  "usdt_sent",
]);

function pulseParseMinutes(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function isFreshTimestamp(value: string | null | undefined, windowMs: number, nowMs: number) {
  if (!value) return false;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > 0 && nowMs - ms <= windowMs;
}

/**
 * Lightweight presence heartbeat for the current authenticated user. Updates
 * lastActiveAt (and onlineStatus) only when it is stale, so counting "online"
 * users reflects real active sessions without a write on every poll.
 */
export async function touchUserPresence(userId: string): Promise<void> {
  if (!userId) return;
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === userId);
  if (index === -1) return;
  const user = db.users[index];
  const nowMs = Date.now();
  const lastMs = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
  if (Number.isFinite(lastMs) && lastMs > 0 && nowMs - lastMs < PULSE_PRESENCE_TOUCH_THROTTLE_MS && user.onlineStatus === "online") {
    return;
  }
  const timestamp = nowIso();
  db.users[index] = { ...user, onlineStatus: "online", lastActiveAt: timestamp, updatedAt: timestamp };
  await writeDb(db, { selectedTables: USER_PROFILE_TABLES });
}

/**
 * Compute the real, privacy-safe marketplace pulse. Every value is derived from
 * actual backend state; no buyer names, amounts, wallets, emails or private
 * trade details are exposed.
 */
export async function getMarketplacePulse(dbInput?: AlphaExchangeDb): Promise<MarketplacePulseData> {
  const db = dbInput ?? await readDb();
  const nowMs = Date.now();
  const nowIsoValue = nowIso();

  const hiddenOrSuspended = new Set(
    db.users.filter((user) => user.isProfileHidden === true || user.sellerStatus === "suspended").map((user) => user.id),
  );

  let sellersOnline = 0;
  let buyersOnline = 0;
  for (const user of db.users) {
    if (!isFreshTimestamp(user.lastActiveAt, PULSE_ONLINE_WINDOW_MS, nowMs)) continue;
    const isApprovedSeller = user.sellerStatus === "approved_seller";
    if (isApprovedSeller) {
      if (!hiddenOrSuspended.has(user.id)) sellersOnline += 1;
    } else if (!hasRole(user, "admin") && !hasRole(user, "owner")) {
      buyersOnline += 1;
    }
  }

  let activeTrades = 0;
  let completedTrades = 0;
  let totalVolumeUsdt = 0;
  let lastCompleted: PurchaseRequest | null = null;
  for (const request of db.purchaseRequests) {
    if (PULSE_ACTIVE_TRADE_STATUSES.has(request.status)) activeTrades += 1;
    const isCompleted = request.status === "completed" || request.status === "review_open" || Boolean(request.completedAt);
    if (isCompleted) {
      completedTrades += 1;
      totalVolumeUsdt += toNumber(request.usdtAmount);
      const completedAt = request.completedAt ?? request.updatedAt;
      if (!lastCompleted || new Date(completedAt).getTime() > new Date(lastCompleted.completedAt ?? lastCompleted.updatedAt).getTime()) {
        lastCompleted = request;
      }
    }
  }

  const sellerById = new Map(db.users.map((user) => [user.id, user]));
  const blockedByCommission = new Set(
    db.commissionRecords
      .filter((record) => normalizeCommissionPaymentStatus(record.paymentStatus, record.dueAt) !== "paid")
      .map((record) => record.sellerId),
  );
  const activeListings: MarketplaceListing[] = db.marketplaceListings.filter((listing) => {
    if (!canListingReceiveRequests(listing)) return false;
    if (hiddenOrSuspended.has(listing.sellerId)) return false;
    if (blockedByCommission.has(listing.sellerId)) return false;
    const seller = sellerById.get(listing.sellerId);
    if (!seller || seller.sellerStatus !== "approved_seller") return false;
    if (isSellerUnavailableForNewBuyers(seller.availabilityStatus)) return false;
    if (toNumber(listing.availableAmount) <= 0) return false;
    if (listing.expiresAt) {
      const expiresMs = new Date(listing.expiresAt).getTime();
      if (expiresMs && !Number.isNaN(expiresMs) && expiresMs <= nowMs) return false;
    }
    return true;
  });

  let totalUsdtAvailable = 0;
  const responseSamples: number[] = [];
  const networkCounts = new Map<string, number>();
  const paymentCounts = new Map<string, number>();
  for (const listing of activeListings) {
    totalUsdtAvailable += toNumber(listing.availableAmount);
    const minutes = pulseParseMinutes(listing.responseTime);
    if (minutes > 0) responseSamples.push(minutes);
    const network = String(listing.network ?? "");
    if (network) networkCounts.set(network, (networkCounts.get(network) ?? 0) + 1);
    const methods = resolveListingPaymentMethods(listing.paymentMethods, listing.paymentMethod);
    for (const method of methods) {
      const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
      if (normalized) paymentCounts.set(normalized, (paymentCounts.get(normalized) ?? 0) + 1);
    }
  }
  const averageResponseMinutes = responseSamples.length
    ? Math.max(1, Math.round(responseSamples.reduce((sum, value) => sum + value, 0) / responseSamples.length))
    : 0;
  const topEntry = (counts: Map<string, number>) => {
    let best: string | null = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) { best = key; bestCount = count; }
    }
    return best;
  };
  const trendingNetwork = topEntry(networkCounts) as SupportedNetwork | null;
  const popularPaymentMethod = topEntry(paymentCounts);

  // Anonymized public activity feed: only public, non-sensitive events.
  const activity: MarketplacePulseActivityEntry[] = [];
  for (const listing of db.marketplaceListings) {
    if (hiddenOrSuspended.has(listing.sellerId)) continue;
    if (isFreshTimestamp(listing.createdAt, 24 * 60 * 60 * 1000, nowMs)) {
      activity.push({ id: `newlisting-${listing.id}`, type: "new_listing", network: listing.network, createdAt: listing.createdAt });
    }
    if (listing.lastRenewedAt && isFreshTimestamp(listing.lastRenewedAt, 24 * 60 * 60 * 1000, nowMs)) {
      activity.push({ id: `renew-${listing.id}-${listing.lastRenewedAt}`, type: "listing_renewed", network: listing.network, createdAt: listing.lastRenewedAt });
    }
  }
  for (const request of db.purchaseRequests) {
    const isCompleted = request.status === "completed" || request.status === "review_open" || Boolean(request.completedAt);
    const completedAt = request.completedAt ?? (isCompleted ? request.updatedAt : null);
    if (isCompleted && completedAt && isFreshTimestamp(completedAt, 24 * 60 * 60 * 1000, nowMs)) {
      activity.push({ id: `trade-${request.id}`, type: "trade_completed", network: request.network, createdAt: completedAt });
    }
  }
  for (const user of db.users) {
    if (user.sellerStatus !== "approved_seller" || hiddenOrSuspended.has(user.id)) continue;
    if (user.onlineStatus === "online" && isFreshTimestamp(user.lastActiveAt, PULSE_ONLINE_WINDOW_MS, nowMs)) {
      activity.push({ id: `online-${user.id}`, type: "seller_online", createdAt: user.lastActiveAt ?? nowIsoValue });
    }
  }
  activity.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    sellersOnline,
    buyersOnline,
    activeTrades,
    activeListings: activeListings.length,
    totalUsdtAvailable,
    completedTrades,
    totalVolumeUsdt,
    averageResponseMinutes,
    trendingNetwork: networkCounts.size ? trendingNetwork : null,
    popularPaymentMethod,
    lastCompletedTrade: lastCompleted
      ? { network: lastCompleted.network, completedAt: lastCompleted.completedAt ?? lastCompleted.updatedAt }
      : null,
    recentActivity: activity.slice(0, 12),
    generatedAt: nowIsoValue,
  };
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
  return allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_PROFILE_LISTING_CREATE === "1";
}

function isDevelopmentTesterSeedEnabled() {
  return process.env.NODE_ENV !== "production"
    && process.env.ALPHA_EXCHANGE_SEED_DEVELOPMENT_TESTER_LISTING === "1";
}

function isTesterSellerAccount(user: AlphaExchangeUser) {
  const configuredEmail = process.env.ALPHA_EXCHANGE_DEVELOPMENT_TESTER_EMAIL?.trim().toLowerCase();
  return user.email.trim().toLowerCase() === (configuredEmail || "seller@example.test");
}

function findTesterMarketplaceListing(db: AlphaExchangeDb, sellerId: string) {
  return db.marketplaceListings.find(
    (listing) => listing.sellerId === sellerId
      && (listing.status === "active" || isListingPendingApproval(listing)),
  );
}

function refreshTesterMarketplaceListingSellerDisplayName(db: AlphaExchangeDb, testerSeller: AlphaExchangeUser) {
  let changed = false;
  for (const listing of db.marketplaceListings) {
    if (listing.sellerId !== testerSeller.id) continue;
    if (listing.sellerDisplayName === testerSeller.fullName) continue;
    listing.sellerDisplayName = testerSeller.fullName;
    changed = true;
  }
  return changed;
}

async function ensureDevelopmentTesterMarketplaceListing(db: AlphaExchangeDb) {
  if (!isDevelopmentTesterSeedEnabled()) return;
  const testerSeller = db.users.find((user) => isTesterSellerAccount(user) && user.sellerStatus === "approved_seller");
  if (!testerSeller) return;
  const refreshed = refreshTesterMarketplaceListingSellerDisplayName(db, testerSeller);
  const owner = db.users.find((user) => hasRole(user, "owner"));
  const existingListing = findTesterMarketplaceListing(db, testerSeller.id);
  if (existingListing) {
    if (isListingPendingApproval(existingListing) && owner) {
      await reviewMarketplaceListingByOwner({
        listingId: existingListing.id,
        ownerUserId: owner.id,
        decision: "approve",
        reason: "Development tester listing.",
      });
    } else if (refreshed) {
      await writeDb(db);
    }
    return;
  }

  const listing = await createMarketplaceListing({
    sellerId: testerSeller.id,
    sellerDisplayName: testerSeller.fullName,
    availableAmount: "250",
    price: "3.25",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Leumi",
    minimumTrade: "50",
    maximumTrade: "250",
    notes: "Development tester listing. Do not buy.",
    sellerDescription: "Development tester listing. Do not buy.",
    responseTime: "5 min",
    acceptedCommissionPolicy: true,
    actorUserId: testerSeller.id,
  });
  if (owner) {
    await reviewMarketplaceListingByOwner({
      listingId: listing.id,
      ownerUserId: owner.id,
      decision: "approve",
      reason: "Development tester listing.",
    });
  }
}
function createStoreProfileLogger(scope: string) {
  const startedAt = Date.now();
  return (stage: string) => {
    if (!isListingCreateProfilingEnabled()) return;
    console.log(`[alpha-exchange-profile] ${scope} ${stage} +${Date.now() - startedAt}ms`);
  };
}

function resolveSellerListingBankAccount(
  db: AlphaExchangeDb,
  sellerId: string,
  bankAccountId: string | undefined,
  paymentMethods: string[],
) {
  if (!paymentMethods.some((method) => isBankTransferPaymentMethod(method))) {
    return null;
  }
  const seller = db.users.find((user) => user.id === sellerId);
  if (!seller) throw new Error("Seller not found.");
  const accounts = getSellerBankAccounts(seller);
  if (!accounts.length) {
    if (bankAccountId) throw new Error("Selected bank account was not found for this seller.");
    return null;
  }
  const selected = bankAccountId
    ? accounts.find((account) => account.id === bankAccountId)
    : accounts.find((account) => account.isDefault === true) ?? accounts[0];
  if (!selected) {
    throw new Error("Please select one of your saved bank accounts for Bank Transfer listings.");
  }
  if (bankAccountId && selected.id !== bankAccountId) {
    throw new Error("Selected bank account does not belong to this seller.");
  }
  return selected;
}

function canRevealTradeBankDetailsToActor(request: PurchaseRequest, actorUserId: string, actorRole: UserRole) {
  const participant = request.buyerId === actorUserId || request.sellerId === actorUserId;
  const elevated = actorRole === "admin" || actorRole === "owner";
  if (!participant && !elevated) return false;
  return request.status !== "pending" && request.status !== "declined" && request.status !== "cancelled";
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
  bankAccountId?: string;
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
  assertNoExchangeDirectContact(
    input.sellerDisplayName,
    input.notes,
    input.sellerDescription,
    ...(input.photos ?? []),
  );
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
  const selectedSellerBankAccount = resolveSellerListingBankAccount(db, input.sellerId, input.bankAccountId, listingPaymentMethods);
  const listingBanks = parseIsraeliBankSelection(input.bankName);
  if (requiresIsraeliBankSelection(listingPaymentMethods)) {
    if (!listingBanks.length) {
      throw new Error("Please choose one or two supported banks before publishing the listing.");
    }
    if (listingBanks.length > MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS) {
      throw new Error(`Select no more than ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} supported banks per listing.`);
    }
    if (selectedSellerBankAccount && !listingBanks.includes(selectedSellerBankAccount.bankName)) {
      throw new Error("Supported banks must include the selected seller bank account.");
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
    bankAccountId: selectedSellerBankAccount?.id,
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
  const reviewDestination = adminMarketplaceListingsDestination(listing.id);
  for (const adminUser of getAdminNotificationRecipients(db)) {
    pushNotification(db, {
      userId: adminUser.id,
      category: "listing",
      title: "New Listing Pending Review",
      message: `${input.sellerDisplayName} submitted listing ${listing.id} for admin approval.`,
      relatedListingId: listing.id,
      relatedHref: reviewDestination,
      actionHref: reviewDestination,
      actionLabel: "Review Listing",
      priority: "critical",
      forceInApp: true,
    });
  }
  pushNotification(db, {
    userId: input.sellerId,
    category: "listing",
    title: "Listing submitted",
    message: `Listing ${listing.id} was submitted for admin review.`,
    relatedListingId: listing.id,
    relatedHref: sellerListingWorkspaceDestination(listing),
  });
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
  await dispatchOwnerActionRequiredEmails(db, {
    event: "owner_listing_review_required",
    title: { ar: "إعلان يحتاج إلى الموافقة", en: "Listing Approval Required" },
    message: {
      ar: `قدّم ${input.sellerDisplayName} إعلانًا بكمية ${listing.availableAmount} USDT على شبكة ${listing.network}. راجع الإعلان قبل نشره.`,
      en: `${input.sellerDisplayName} submitted ${listing.availableAmount} USDT on ${listing.network}. Review the listing before it can go live.`,
    },
    actionLabel: { ar: "مراجعة الإعلان", en: "Review Listing" },
    actionHref: reviewDestination,
    referenceLabel: listing.id,
  });
  await sendListingOwnerLifecycleEmail(db, listing, {
    event: "listing_submitted",
    title: { ar: "تم إرسال الإعلان", en: "Listing Submitted" },
    message: {
      ar: "تم إرسال إعلانك بنجاح، وهو بانتظار مراجعة الإدارة.",
      en: "Your listing was submitted successfully and is waiting for admin review.",
    },
    idempotencyKey: `listing-${listing.id}-submitted`,
  });
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
  bankAccountId?: string;
  bankName?: string;
  minimumTrade?: string;
  maximumTrade?: string;
  expiresAt?: string;
  expirationHours?: number | string;
  notes?: string;
  sellerDescription?: string;
  responseTime?: string;
  status?: ListingStatus;
  changeReason?: string;
  changeExplanation?: string;
}) {
  assertNoExchangeDirectContact(
    input.notes,
    input.sellerDescription,
    input.changeReason,
    input.changeExplanation,
    ...(input.photos ?? []),
  );
  const db = await readDb();
  const index = db.marketplaceListings.findIndex((listing) => listing.id === input.listingId);
  if (index === -1) throw new Error("Listing not found.");
  const current = db.marketplaceListings[index];
  if (current.sellerId !== input.sellerId) throw new Error("You can edit only your own listings.");
  const enforcementRestriction = getSellerEnforcementRestrictionMessage(db, input.sellerId);
  if (enforcementRestriction) {
    throw new Error(enforcementRestriction);
  }
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
  const selectedSellerBankAccount = resolveSellerListingBankAccount(
    db,
    input.sellerId,
    input.bankAccountId !== undefined ? input.bankAccountId : current.bankAccountId,
    nextPaymentMethods,
  );
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
    if (selectedSellerBankAccount && !nextBankSelection.includes(selectedSellerBankAccount.bankName)) {
      throw new Error("Supported banks must include the selected seller bank account.");
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
    bankAccountId: selectedSellerBankAccount?.id,
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
  const isPlainEdit = !(input.status === "paused") && !(input.status === "active" && current.status === "paused");
  const editedFieldChanges = isPlainEdit
    ? (["availableAmount", "price", "minimumTrade", "maximumTrade", "currency", "network"] as const).reduce<{
        before: Record<string, string>;
        after: Record<string, string>;
      }>((acc, field) => {
        const before = String(current[field] ?? "");
        const after = String(next[field] ?? "");
        if (before !== after) {
          acc.before[field] = before;
          acc.after[field] = after;
        }
        return acc;
      }, { before: {}, after: {} })
    : { before: {}, after: {} };
  const hasSensitiveChange = Object.keys(editedFieldChanges.after).length > 0;
  await appendAuditLog(db, {
    action: input.status === "paused" ? "listing_paused" : input.status === "active" && current.status === "paused" ? "listing_resumed" : "listing_edited",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    listingId: next.id,
    reason: isPlainEdit ? input.changeReason : undefined,
    oldValue: isPlainEdit && hasSensitiveChange ? editedFieldChanges.before : undefined,
    newValue: isPlainEdit && hasSensitiveChange ? editedFieldChanges.after : undefined,
    details:
      shouldResubmitForApproval
        ? `Resubmitted listing ${next.id} for admin approval`
        : input.status === "paused"
        ? `Paused listing ${next.id}`
        : input.status === "active" && current.status === "paused"
          ? `Resumed listing ${next.id}`
          : input.changeExplanation
            ? `Edited listing ${next.id}: ${input.changeExplanation}`
            : `Edited listing ${next.id}`,
  });
  const reviewDestination = shouldResubmitForApproval ? adminMarketplaceListingsDestination(next.id) : null;
  if (shouldResubmitForApproval && reviewDestination) {
    for (const adminUser of getAdminNotificationRecipients(db)) {
      pushNotification(db, {
        userId: adminUser.id,
        category: "listing",
        title: "New Listing Pending Review",
        message: `${next.sellerDisplayName} resubmitted listing ${next.id} for admin approval.`,
        relatedListingId: next.id,
        relatedHref: reviewDestination,
        actionHref: reviewDestination,
        actionLabel: "Review Listing",
        priority: "critical",
        forceInApp: true,
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
  if (reviewDestination) {
    await dispatchOwnerActionRequiredEmails(db, {
      event: "owner_listing_review_required",
      title: { ar: "تعديلات الإعلان تحتاج إلى المراجعة", en: "Listing Changes Need Review" },
      message: {
        ar: `عدّل ${next.sellerDisplayName} الإعلان ${next.id}. راجعه قبل إعادة نشره.`,
        en: `${next.sellerDisplayName} changed listing ${next.id}. Review it before the listing can return live.`,
      },
      actionLabel: { ar: "مراجعة الإعلان", en: "Review Listing" },
      actionHref: reviewDestination,
      referenceLabel: next.id,
      idempotencyKey: `owner-listing-resubmission:${next.id}:${next.updatedAt}`,
    });
  }
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
    const enforcementRestriction = getSellerEnforcementRestrictionMessage(db, input.sellerId);
    if (enforcementRestriction) {
      throw new Error(enforcementRestriction);
    }
  }
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

  // If a still-active listing already passed its expiry timestamp, emit the
  // canonical expiration transition first so audit + notifications stay intact.
  if (listing.status !== "expired" && listingShouldExpire(listing, Date.now()) && !listingExpirationDeferredByTrade(listing)) {
    await expireListing(db, listing, input.actorUserId, "Listing reached expiration at renewal time.");
  }

  const now = nowIso();
  const previousStatus = listing.status;
  const previousExpiresAt = listing.expiresAt;
  listing.status = "active";
  listing.expiresAt = getListingExpirationIso(now, input.expirationHours);
  listing.expiredAt = undefined;
  listing.expirationEmailPendingAt = undefined;
  listing.expirationEmailSentAt = undefined;
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
    relatedHref: sellerListingWorkspaceDestination(listing),
    actionLabel: "Manage Listing",
  });
  await writeDb(db, { selectedTables: LISTING_WRITE_TABLES });
  await sendListingOwnerLifecycleEmail(db, listing, {
    event: "listing_renewed",
    title: { ar: "تم تجديد الإعلان", en: "Listing Renewed" },
    message: {
      ar: "تم تجديد إعلانك بنجاح، وهو منشور مجددًا في السوق.",
      en: "Your listing was renewed successfully and is live in the marketplace again.",
    },
    idempotencyKey: `listing-${listing.id}-renewed-${listing.lastRenewedAt}`,
  });
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
        relatedHref: requestDetailsHref(activeRequest.id),
      });
      pushNotification(db, {
        userId: activeRequest.sellerId,
        category: "trade",
        title: "Trade cancelled",
        message: `Trade ${activeRequest.tradeId ?? activeRequest.id} was cancelled by an admin listing action.`,
        relatedTradeId: activeRequest.tradeId ?? activeRequest.id,
        relatedListingId: listing.id,
        relatedHref: requestDetailsHref(activeRequest.id),
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
      relatedHref: sellerListingWorkspaceDestination(listing),
    });
  }
  if (input.action === "extend") {
    pushNotification(db, {
      userId: listing.sellerId,
      category: "listing",
      title: "Listing expiration extended",
      message: `An admin extended the expiration for listing ${listing.id}.`,
      relatedListingId: listing.id,
      relatedHref: sellerListingWorkspaceDestination(listing),
    });
  }
  if (input.action === "close" || input.action === "force_close") {
    pushNotification(db, {
      userId: listing.sellerId,
      category: "listing",
      title: input.action === "force_close" ? "Listing force closed" : "Listing closed",
      message: `An admin ${input.action === "force_close" ? "force-closed" : "closed"} listing ${listing.id}.`,
      relatedListingId: listing.id,
      relatedHref: sellerListingWorkspaceDestination(listing),
    });
  }
  if (input.action === "force_close") {
    pushNotification(db, {
      userId: input.adminUserId,
      category: "listing",
      title: "Listing force closed",
      message: `Listing ${listing.id} was force-closed successfully.`,
      relatedListingId: listing.id,
      relatedHref: adminMarketplaceListingsDestination(listing.id),
      actionHref: adminMarketplaceListingsDestination(listing.id),
      actionLabel: "Review Listing",
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
    relatedHref: sellerListingWorkspaceDestination(current),
  });
  if (input.decision === "approve") {
    const listing = db.marketplaceListings[index];
    const listingSummary = `${listing.availableAmount} USDT on ${listing.network} at ${listing.price} ${listing.currency}/USDT`;
    for (const recipient of getListingBroadcastRecipients(db, listing.sellerId)) {
      pushNotification(db, {
        userId: recipient.id,
        category: "listing",
        title: "🟢 New USDT Listing Available",
        message: `${listing.sellerDisplayName} published ${listingSummary}.`,
        relatedListingId: listing.id,
        relatedHref: listingDestination(listing),
      });
    }
  }
  pushActivityLog(db, {
    userId: current.sellerId,
    category: "listing",
    title:
      input.decision === "approve" ? "Listing approved" : input.decision === "reject" ? "Listing rejected" : "Listing changes requested",
    details: input.decision === "approve"
      ? `Listing ${current.id} approved and now live.`
      : `Reason: ${trimmedReason}`,
  });
  const archivedAdminNotifications = archiveAdminActionNotifications(
    db,
    (notification) => notification.category === "listing" && notification.relatedListingId === current.id,
  );
  await recalculateTrustEngine(db, {
    reason:
      input.decision === "approve" ? "Listing approved" : input.decision === "reject" ? "Listing rejected" : "Listing changes requested",
    triggeredBy: input.ownerUserId,
  });
  await writeDb(db, { selectedTables: LISTING_TRUST_WRITE_TABLES });
  publishArchivedNotifications(archivedAdminNotifications);
  return db.marketplaceListings[index];
}

export async function deleteMarketplaceListingForSeller(input: {
  listingId: string;
  sellerId: string;
  actorUserId: string;
  changeReason?: string;
  changeExplanation?: string;
}) {
  assertNoExchangeDirectContact(input.changeReason, input.changeExplanation);
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
  const previousStatus = listing.status;
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
    reason: input.changeReason,
    oldValue: { status: previousStatus },
    newValue: { status: "closed" },
    details: input.changeExplanation
      ? `Closed listing ${input.listingId}: ${input.changeExplanation}`
      : `Closed listing ${input.listingId}`,
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
  const enforcement = await getSellerMarketplaceEnforcementStatus(sellerId, db);
  return {
    activeListingLimit: MAX_ACTIVE_LISTINGS_PER_SELLER,
    openListingCount: getSellerOpenListingCount(db, sellerId),
    openTradeCount: getSellerOpenTradeCount(db, sellerId),
    pendingCommissionCount: getSellerPendingCommissionCount(db, sellerId),
    canCreateListing: blockedReason === null,
    blockedReason,
    enforcement,
  };
}

export async function getSellerDashboardAccessState(userId: string) {
  const db = await readDb();
  const seller = db.users.find((user) => user.id === userId);
  if (!seller) return null;
  const enforcement = await getSellerMarketplaceEnforcementStatus(userId, db);
  return {
    sellerId: seller.id,
    sellerName: seller.fullName,
    sellerStatus: seller.sellerStatus,
    enforcement,
  };
}

export async function getSellerCommissionStatus(
  sellerId: string,
  dbInput?: AlphaExchangeDb,
  options?: { commissionId?: string },
) {
  const db = dbInput ?? await readDb();
  const pendingRecords = getUnpaidSellerCommissionRecords(db, sellerId);
  const requestedCommissionId = options?.commissionId?.trim() || undefined;
  // A deep link may name only a payable commission owned by this seller. Do
  // not silently fall back to a different record when the requested one is
  // missing, settled, or belongs to another seller.
  const primaryRecord = requestedCommissionId
    ? pendingRecords.find((record) => record.id === requestedCommissionId)
    : pendingRecords[0];
  const totalAmountDue = pendingRecords.reduce((sum, record) => sum + getCommissionAmountDueUsdt(db, record), 0);
  const payableAmountDue = primaryRecord ? getCommissionAmountDueUsdt(db, primaryRecord) : 0;
  const hasOverdue = pendingRecords.some((record) => record.paymentStatus === "overdue");
  const primaryRequest = primaryRecord
    ? db.purchaseRequests.find((request) => request.id === primaryRecord.purchaseRequestId)
    : undefined;
  // This list is deliberately limited to the authenticated seller's own
  // unpaid records. It gives the workspace an exact-record selector when
  // more than one commission is payable; it must never become an aggregate
  // payment target.
  const payableRecords = pendingRecords.map((record) => {
    const request = db.purchaseRequests.find((item) => item.id === record.purchaseRequestId);
    return {
      commissionId: record.id,
      amountDue: getCommissionAmountDueUsdt(db, record),
      dueAt: record.dueAt,
      relatedRequestId: record.purchaseRequestId,
      relatedTradeId: request?.tradeId,
      relatedTradeDisplayNumber: request?.displayNumber,
    };
  });

  return {
    status: pendingRecords.length === 0 ? "clear" as const : hasOverdue ? "overdue" as const : "pending" as const,
    pendingCount: pendingRecords.length,
    // Keep amountDue stable for existing dashboard consumers. New payment UI
    // must use payableAmountDue, which is the exact selected record amount.
    amountDue: totalAmountDue,
    totalAmountDue,
    payableAmountDue,
    dueAt: primaryRecord?.dueAt,
    commissionId: primaryRecord?.id,
    selectionError: requestedCommissionId && !primaryRecord ? "The requested commission is not available for payment." : undefined,
    relatedRequestId: primaryRecord?.purchaseRequestId,
    relatedTradeId: primaryRequest?.tradeId,
    relatedTradeDisplayNumber: primaryRequest?.displayNumber,
    payableRecords,
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
  // Accepted only for backwards-compatible internal callers. New Buyer API
  // requests deliberately ignore these fields and do not persist contact data.
  buyerWhatsapp?: string;
  buyerNotes?: string;
  buyerReceivingWalletAddress: string;
  paymentMethod?: string;
  bankName?: string;
  safetyAcknowledged?: boolean;
  actorUserId: string;
}) {
  const startedAt = Date.now();
  const dbReadStartedAt = Date.now();
  const db = await readDb({ bypassCache: true });
  const priorSmsCount = db.smsDeliveries?.length ?? 0;
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
  const existingRequestForListing = db.purchaseRequests.find(
    (r) => r.buyerId === input.buyerId
      && r.listingId === input.listingId
      && isActionableTradeStatus(r.status)
      && !r.buyerConfirmationArchivedAt,
  );
  if (existingRequestForListing) {
    throw new TradeBlockedError(
      "PURCHASE_REQUEST_ALREADY_SUBMITTED",
      "You already submitted a request for this listing. Continue in the existing Trade Room.",
      existingRequestForListing.id,
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
  const buyerReceivingWalletAddress = normalizeWalletAddress(input.buyerReceivingWalletAddress);
  const walletValidationError = getWalletAddressValidationError(listing.network, buyerReceivingWalletAddress);
  if (walletValidationError) throw new Error(walletValidationError);
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
  const sellerBankAccount = listing.bankAccountId && seller
    ? getSellerBankAccountById(seller, listing.bankAccountId)
    : undefined;
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
    usdtAmount,
    fiatAmount,
    currency: listing.currency,
    network: listing.network,
    buyerReceivingWalletAddress,
    paymentMethod: primaryPaymentMethod,
    buyerSafetyAcknowledged,
    sellerSafetyAcknowledged: !requiresFaceToFaceSafetyNotice,
    sellerBankAccountId: sellerBankAccount?.id,
    bankName: (isBankTransferPaymentMethod(primaryPaymentMethod) || isCardlessAtmPaymentMethod(primaryPaymentMethod))
      ? (serializeIsraeliBankSelection(parseIsraeliBankSelection(input.bankName || sellerBankAccount?.bankName || listing.bankName)) || undefined)
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
  pushAdminTradeActivityNotifications(db, {
    title: "New Trade Request Submitted",
    message: `${request.buyerName} requested ${request.usdtAmount} USDT from ${seller.fullName}.`,
    request,
    actionLabel: "Monitor Request",
    actorUserId: input.actorUserId,
  });
  queueSmsDelivery(db, { eventType: "purchase_request_created", eventKey: `purchase-request:${request.id}:seller:${sellerId}`, recipientUserId: sellerId, destinationPath: requestDetailsHref(request.id) });
  pushActivityLog(db, {
    userId: input.buyerId,
    category: "trade",
    title: "Trade request submitted",
    details: `Trade ${request.tradeId} was submitted.`,
  });
  const businessMs = Date.now() - businessStartedAt;
  const writeStartedAt = Date.now();
  await writeDb(db, {
    selectedTables: PURCHASE_REQUEST_CREATE_TABLES,
    // Two tabs, a mobile-network retry, or two Vercel instances can validate
    // the same buyer snapshot before either request commits. Re-check the
    // invariant while the repository's cross-instance advisory lock is held
    // so only one active trade can ever be persisted for a buyer.
    validateBeforeCommit: (snapshot) => {
      const duplicateRequest = snapshot.purchaseRequests.find(
        (candidate) => candidate.id !== request.id
          && candidate.buyerId === input.buyerId
          && candidate.listingId === input.listingId
          && isActionableTradeStatus(candidate.status)
          && !candidate.buyerConfirmationArchivedAt,
      );
      if (duplicateRequest) {
        throw new TradeBlockedError(
          "PURCHASE_REQUEST_ALREADY_SUBMITTED",
          "You already submitted a request for this listing. Continue in the existing Trade Room.",
          duplicateRequest.id,
          { guard: "single-buyer-request-per-listing-at-commit" },
        );
      }

      const awaitingConfirmation = snapshot.purchaseRequests.find(
        (candidate) => candidate.id !== request.id
          && candidate.buyerId === input.buyerId
          && candidate.status === "usdt_sent"
          && candidate.buyerConfirmationArchivedAt,
      );
      if (awaitingConfirmation) {
        throw new TradeBlockedError(
          "AWAITING_BUYER_CONFIRMATION",
          "You have an outstanding trade awaiting your confirmation. Please confirm that you received your USDT before starting another purchase.",
          awaitingConfirmation.id,
          { guard: "single-active-buyer-trade-at-commit" },
        );
      }

      const concurrentActiveTrade = snapshot.purchaseRequests.find(
        (candidate) => candidate.id !== request.id
          && candidate.buyerId === input.buyerId
          && isActiveTradeStatus(candidate.status)
          && !candidate.buyerConfirmationArchivedAt,
      );
      if (concurrentActiveTrade) {
        throw new TradeBlockedError(
          "ACTIVE_TRADE_EXISTS",
          "You already have an active trade in progress. Complete or cancel it before starting another purchase.",
          concurrentActiveTrade.id,
          { guard: "single-active-buyer-trade-at-commit" },
        );
      }
    },
  });
  const writeMs = Date.now() - writeStartedAt;
  await dispatchCommittedSms(db, priorSmsCount);
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
    .map((request) => sanitizePurchaseRequestForActor(enrichRequestWithEvidence(db, request), userId, role));
}

const SELLER_WALLET_VISIBLE_STATUSES = new Set<PurchaseRequestStatus>([
  "funds_received",
  "usdt_release_pending",
  "usdt_sent",
  "completed",
  "review_open",
  "locked",
]);

export function sanitizePurchaseRequestForActor(request: PurchaseRequest, actorUserId: string, actorRole: UserRole) {
  const canViewPrivateContent = actorRole === "admin" || actorRole === "owner";
  const canViewBuyerContact = canViewPrivateContent;
  const canViewWallet = canViewPrivateContent
    || request.buyerId === actorUserId
    || (request.sellerId === actorUserId && SELLER_WALLET_VISIBLE_STATUSES.has(request.status));
  const redacted: PurchaseRequest = {
    ...request,
    buyerName: canViewPrivateContent ? request.buyerName : redactExchangeUserContent(request.buyerName),
    timeline: (request.timeline ?? []).map((entry) => sanitizeTradeTimelineForCounterparty(entry, canViewPrivateContent)),
    messages: (request.messages ?? []).map((message) => sanitizeTradeRoomMessageForCounterparty(message, canViewPrivateContent)),
    buyerEvidence: canViewPrivateContent ? request.buyerEvidence : sanitizeTradeEvidenceForCounterparty(request.buyerEvidence),
    sellerEvidence: canViewPrivateContent ? request.sellerEvidence : sanitizeTradeEvidenceForCounterparty(request.sellerEvidence),
    closeReason: canViewPrivateContent ? request.closeReason : redactExchangeUserContent(request.closeReason),
    closeExplanation: canViewPrivateContent ? request.closeExplanation : redactExchangeUserContent(request.closeExplanation),
    buyerReview: request.buyerReview && !canViewPrivateContent
      ? {
          ...request.buyerReview,
          comment: redactExchangeUserContent(request.buyerReview.comment),
          hiddenReason: redactExchangeUserContent(request.buyerReview.hiddenReason),
        }
      : request.buyerReview,
    sellerResponse: request.sellerResponse && !canViewPrivateContent
      ? { ...request.sellerResponse, message: redactExchangeUserContent(request.sellerResponse.message) }
      : request.sellerResponse,
  };
  if (!canViewBuyerContact) {
    delete (redacted as { buyerWhatsapp?: string }).buyerWhatsapp;
    delete (redacted as { buyerNotes?: string }).buyerNotes;
  }
  if (!canViewWallet) {
    delete redacted.buyerReceivingWalletAddress;
  }
  if (!canRevealTradeBankDetailsToActor(request, actorUserId, actorRole)) {
    delete redacted.sellerBankAccountId;
  }
  return redacted;
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

function sanitizeTradeRoomListing(listing: MarketplaceListing | null) {
  if (!listing) return null;
  const redacted = {
    ...listing,
    sellerDisplayName: redactExchangeUserContent(listing.sellerDisplayName),
    notes: redactExchangeUserContent(listing.notes),
    sellerDescription: redactExchangeUserContent(listing.sellerDescription),
    photos: (listing.photos ?? []).map((photo) => sanitizeCounterpartyMediaUrl(photo)).filter(Boolean),
  };
  delete redacted.bankAccountId;
  if (redacted.sellerProfile) {
    const sellerProfile = { ...redacted.sellerProfile };
    delete sellerProfile.contact;
    redacted.sellerProfile = sellerProfile;
  }
  return redacted;
}

type TradeRoomParticipantSide = "buyer" | "seller";

function getTradeRoomParticipantSide(request: PurchaseRequest, userId: string): TradeRoomParticipantSide | null {
  if (request.buyerId === userId) return "buyer";
  if (request.sellerId === userId) return "seller";
  return null;
}

function assertTradeRoomParticipant(request: PurchaseRequest, userId: string) {
  const side = getTradeRoomParticipantSide(request, userId);
  if (!side) {
    throw new Error("You are not allowed to send Trade Room messages.");
  }
  return side;
}

function isTradeRoomPokeActive(request: PurchaseRequest) {
  // An open dispute remains participant-actionable only while the canonical
  // lifecycle itself is still actionable. Terminal, cancelled, declined, and
  // explicitly timed-out/manual-closed trades cannot be nudged.
  return isActionableTradeStatus(request.status)
    && !request.timedOutAt
    && !request.closedAt;
}

function pokeStateFieldForSender(side: TradeRoomParticipantSide): keyof TradeRoomPokeState {
  return side === "buyer" ? "buyerToSellerAt" : "sellerToBuyerAt";
}

function getPokeCooldownUntil(request: PurchaseRequest, side: TradeRoomParticipantSide) {
  const lastPokedAt = request.pokeState?.[pokeStateFieldForSender(side)];
  if (!lastPokedAt) return null;
  const lastPokedAtMs = new Date(lastPokedAt).getTime();
  if (!Number.isFinite(lastPokedAtMs)) return null;
  return new Date(lastPokedAtMs + TRADE_ROOM_POKE_COOLDOWN_MS);
}

export type TradeRoomPokeAvailability = {
  available: boolean;
  canPoke: boolean;
  cooldownUntil: string | null;
  cooldownRemainingSeconds: number;
  counterpartRole: TradeRoomParticipantSide | null;
};

function getTradeRoomPokeAvailability(request: PurchaseRequest, actorUserId: string): TradeRoomPokeAvailability {
  const participantSide = getTradeRoomParticipantSide(request, actorUserId);
  if (!participantSide || !isTradeRoomPokeActive(request)) {
    return {
      available: false,
      canPoke: false,
      cooldownUntil: null,
      cooldownRemainingSeconds: 0,
      counterpartRole: null,
    };
  }
  const cooldownUntil = getPokeCooldownUntil(request, participantSide);
  const remainingMs = cooldownUntil ? cooldownUntil.getTime() - Date.now() : 0;
  const cooldownRemainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return {
    available: true,
    canPoke: cooldownRemainingSeconds === 0,
    cooldownUntil: cooldownRemainingSeconds > 0 ? cooldownUntil?.toISOString() ?? null : null,
    cooldownRemainingSeconds,
    counterpartRole: participantSide === "buyer" ? "seller" : "buyer",
  };
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

function projectPurchaseRequestForActor(db: AlphaExchangeDb, request: PurchaseRequest, userId: string, role: UserRole) {
  return sanitizePurchaseRequestForActor(enrichRequestWithEvidence(db, request), userId, role);
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
  return activeTrades[0] ? projectPurchaseRequestForActor(db, activeTrades[0], userId, role) : null;
}

export async function getTradeReminderForUser(userId: string, role: UserRole): Promise<AlphaExchangeTradeReminder | null> {
  const db = await readDb();
  const trade = await getFirstActiveTradeForUser(userId, role);
  if (!trade) return null;
  const isBuyer = trade.buyerId === userId;
  const isSeller = trade.sellerId === userId;
  if (!isBuyer && !isSeller) return null;

  const listing = db.marketplaceListings.find((item) => item.id === trade.listingId) ?? null;
  const tradeRef = trade.displayNumber ? `Trade #${trade.displayNumber}` : `Trade ${trade.tradeId ?? trade.id}`;
  const listingDisplayNumber = listing?.displayNumber;
  const actionHref = `/trade-room/${trade.id}`;

  if (trade.status === "review_open") {
    return {
      requestId: trade.id,
      tradeId: trade.tradeId ?? trade.id,
      displayNumber: trade.displayNumber,
      title: "Feedback required",
      message: `${tradeRef} is waiting for your feedback to continue trading.`,
      actionLabel: "Leave feedback",
      actionHref,
      relatedListingId: trade.listingId,
      relatedListingDisplayNumber: listingDisplayNumber,
      priority: "high",
      kind: "feedback_required",
      createdAt: trade.updatedAt,
    };
  }

  if (isBuyer && (trade.status === "accepted" || trade.status === "payment_sent" || trade.status === "funds_received" || trade.status === "usdt_release_pending")) {
    return {
      requestId: trade.id,
      tradeId: trade.tradeId ?? trade.id,
      displayNumber: trade.displayNumber,
      title: "Action required",
      message: `${tradeRef} is waiting for your confirmation.`,
      actionLabel: "Open trade room",
      actionHref,
      relatedListingId: trade.listingId,
      relatedListingDisplayNumber: listingDisplayNumber,
      priority: trade.status === "usdt_release_pending" ? "critical" : "high",
      kind: "buyer_action_required",
      createdAt: trade.updatedAt,
    };
  }

  if (isSeller && (trade.status === "pending" || trade.status === "accepted" || trade.status === "payment_sent" || trade.status === "funds_received" || trade.status === "usdt_release_pending")) {
    return {
      requestId: trade.id,
      tradeId: trade.tradeId ?? trade.id,
      displayNumber: trade.displayNumber,
      title: "Action required",
      message: `${tradeRef} is waiting for your next step.`,
      actionLabel: "Open trade room",
      actionHref,
      relatedListingId: trade.listingId,
      relatedListingDisplayNumber: listingDisplayNumber,
      priority: trade.status === "usdt_release_pending" ? "critical" : "high",
      kind: "seller_action_required",
      createdAt: trade.updatedAt,
    };
  }

  return null;
}

export async function getFirstActionableTradeForUser(userId: string, role: UserRole) {
  const db = await readDb();
  const actionableTrades = filterTradesForUser(db, userId, role)
    .filter((request) => isActionableTradeStatus(request.status))
    .sort(sortTradesByUpdatedAtDesc);
  return actionableTrades[0] ? projectPurchaseRequestForActor(db, actionableTrades[0], userId, role) : null;
}

export async function getTradeRoomRequestForUserById(input: {
  userId: string;
  role: UserRole;
  requestId: string;
}) {
  const requestId = String(input.requestId ?? "").trim();
  if (!requestId) return null;
  const db = await readDb();
  const request = db.purchaseRequests.find((item) => item.id === requestId);
  if (!request) return null;
  const visibleTrades = filterTradesForUser(db, input.userId, input.role);
  const allowed = visibleTrades.some((item) => item.id === request.id);
  if (!allowed) return null;
  return projectPurchaseRequestForActor(db, request, input.userId, input.role);
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
      request: projectPurchaseRequestForActor(db, relatedRequest, input.userId, input.role),
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
        request: projectPurchaseRequestForActor(db, snapshotRequest, input.userId, input.role),
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
    request: fallbackTrade ? projectPurchaseRequestForActor(db, fallbackTrade, input.userId, input.role) : null,
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
  poke: TradeRoomPokeAvailability;
  deadlineAt: string | null;
  timeRemainingSeconds: number | null;
  releaseDeadlineActive: boolean;
  releaseDeadlineOverdue: boolean;
  hasOpenDispute: boolean;
  canOpenDispute: boolean;
  isOverdue: boolean;
  sellerCommissionDueAmount: number;
  sellerCommissionDueCount: number;
  sellerPayableCommissionId?: string;
  sellerPayableCommissionAmount?: number;
}

export async function getTradeRoomData(input: {
  purchaseRequestId: string;
  actorUserId: string;
  actorRole: UserRole;
  markMessagesRead?: boolean;
  strongConsistency?: boolean;
}): Promise<TradeRoomData> {
  const debug = allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
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
    logEvent("warn", {
      event: "trade_room_lookup",
      actorUserId: input.actorUserId,
      outcome: "denied",
      reason: "trade_not_found",
      metadata: { requestCount: db.purchaseRequests.length },
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
  const seenAt = nowIso();
  if (input.markMessagesRead !== false) {
    for (const message of messages) {
      if (message.senderUserId === input.actorUserId) continue;
      if (message.readByUserIds.includes(input.actorUserId)) continue;
      message.readByUserIds.push(input.actorUserId);
      message.seenAt = seenAt;
      if (!message.deliveredAt) message.deliveredAt = seenAt;
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
  const sellerPendingCommissions = getUnpaidSellerCommissionRecords(db, request.sellerId);
  // Prefer the commission created by this Trade Room. An active Trade Room
  // without its own commission can still surface the seller's next payable
  // record, but never a cross-seller or aggregate payment target.
  const payableSellerCommission = sellerPendingCommissions.find((record) => record.purchaseRequestId === request.id)
    ?? sellerPendingCommissions[0];
  const canViewPrivateContent = input.actorRole === "admin" || input.actorRole === "owner";

  return {
    request: sanitizePurchaseRequestForActor(enrichRequestWithEvidence(db, request), input.actorUserId, input.actorRole),
    listing: sanitizeTradeRoomListing(listing),
    counterpart: {
      buyerName: canViewPrivateContent ? buyer?.fullName ?? request.buyerName : redactExchangeUserContent(buyer?.fullName ?? request.buyerName),
      sellerName: canViewPrivateContent ? seller?.fullName ?? listing?.sellerDisplayName ?? request.sellerId : redactExchangeUserContent(seller?.fullName ?? listing?.sellerDisplayName ?? request.sellerId),
    },
    messages: messages.map((message) => sanitizeTradeRoomMessageForCounterparty(message, canViewPrivateContent)),
    poke: getTradeRoomPokeAvailability(request, input.actorUserId),
    deadlineAt,
    timeRemainingSeconds,
    releaseDeadlineActive,
    releaseDeadlineOverdue,
    isOverdue,
    hasOpenDispute: Boolean(openDispute),
    canOpenDispute: isBuyerActor && (request.status === "payment_sent" || request.status === "funds_received" || request.status === "usdt_release_pending" || request.status === "usdt_sent"),
    sellerCommissionDueAmount: Number(sellerPendingCommissions.reduce((sum, record) => sum + getCommissionAmountDueUsdt(db, record), 0).toFixed(2)),
    sellerCommissionDueCount: sellerPendingCommissions.length,
    sellerPayableCommissionId: payableSellerCommission?.id,
    sellerPayableCommissionAmount: payableSellerCommission
      ? Number(getCommissionAmountDueUsdt(db, payableSellerCommission).toFixed(2))
      : undefined,
  };
}

export async function getTradeRoomBankDetails(input: {
  purchaseRequestId: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  const db = await readDb();
  const lookupCandidates = buildPurchaseRequestLookupCandidates(input.purchaseRequestId);
  const requestIndex = db.purchaseRequests.findIndex((item) => lookupCandidates.includes(item.id));
  if (requestIndex === -1) throw new Error("Trade not found.");
  const request = db.purchaseRequests[requestIndex];

  assertTradeParticipantOrAdmin(request, input.actorUserId, input.actorRole);
  if (!canRevealTradeBankDetailsToActor(request, input.actorUserId, input.actorRole)) {
    throw new Error("Bank details are available only after the seller accepts the trade.");
  }

  const seller = db.users.find((user) => user.id === request.sellerId);
  if (!seller) throw new Error("Seller not found.");
  const bankAccount = request.sellerBankAccountId
    ? getSellerBankAccountById(seller, request.sellerBankAccountId)
    : undefined;
  if (!bankAccount) {
    throw new Error("No bank account is linked to this trade.");
  }

  const now = nowIso();
  const recentlyLogged = (request.timeline ?? []).some((entry) =>
    entry.type === "bank_details_revealed"
    && entry.actorUserId === input.actorUserId
    && new Date(entry.createdAt).getTime() >= Date.now() - 5 * 60 * 1000,
  );
  if (!recentlyLogged) {
    appendTradeTimelineEntry(request, {
      type: "bank_details_revealed",
      actorUserId: input.actorUserId,
      actorRole: resolveActorRole(db, input.actorUserId),
      message: "Trade bank details viewed",
      createdAt: now,
    });
    request.updatedAt = now;
    db.purchaseRequests[requestIndex] = request;
    await appendAuditLog(db, {
      action: "trade_bank_details_revealed",
      actorUserId: input.actorUserId,
      targetUserId: request.sellerId,
      purchaseRequestId: request.id,
      listingId: request.listingId,
      details: `Bank details viewed for trade ${request.tradeId ?? request.id}.`,
      newValue: { bankAccountId: bankAccount.id, bankName: bankAccount.bankName, branchNumber: bankAccount.branchNumber, accountLast4: bankAccount.accountLast4 },
    });
    await writeDb(db, { selectedTables: TRADE_BANK_DETAILS_AUDIT_TABLES });
  }

  return {
    requestId: request.id,
    tradeId: request.tradeId ?? request.id,
    bankAccountId: bankAccount.id,
    accountHolderName: bankAccount.accountHolderName,
    bankName: bankAccount.bankName,
    branchNumber: bankAccount.branchNumber,
    accountNumber: bankAccount.accountNumber,
    accountLast4: bankAccount.accountLast4,
  };
}

type ClosePurchaseRequestInput = {
  requestId: string;
  actorUserId: string;
  actorRole: UserRole;
  reason: string;
  explanation?: string;
};

export async function closePurchaseRequestManually(input: ClosePurchaseRequestInput): Promise<PurchaseRequest> {
  return closePurchaseRequestManuallyAttempt(input, 0);
}

async function closePurchaseRequestManuallyAttempt(
  input: ClosePurchaseRequestInput,
  concurrencyRetryCount: number,
): Promise<PurchaseRequest> {
  const db = await readDb({ bypassCache: true });
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.requestId);
  if (requestIndex === -1) throw new Error("Trade not found.");
  const request = db.purchaseRequests[requestIndex];
  const isParticipant = request.buyerId === input.actorUserId || request.sellerId === input.actorUserId;
  const isAdmin = input.actorRole === "admin" || input.actorRole === "owner";
  if (!isParticipant && !isAdmin) {
    throw new Error("You are not allowed to close this trade.");
  }
  if (request.status === "review_open" || request.status === "completed" || request.status === "locked") {
    throw new Error("Completed trades cannot be closed manually.");
  }
  if (request.status === "declined") {
    throw new Error("Declined trades cannot be closed again.");
  }
  if (request.status === "cancelled" && request.closedAt) {
    // A retry can read legacy payload fields. Apply the same participant DTO
    // projection as the normal path so a repeated close cannot expose old
    // Buyer contact metadata or user-authored direct-contact content.
    return sanitizePurchaseRequestForActor(enrichRequestWithEvidence(db, request), input.actorUserId, input.actorRole);
  }
  if (!isAdmin && request.status !== "pending") {
    throw new Error("Trades cannot be closed manually after seller acceptance.");
  }

  const closeReason = String(input.reason ?? "").trim();
  const closeExplanation = String(input.explanation ?? "").trim();
  if (!closeReason) throw new Error("A close reason is required.");
  if (closeReason.length > 120) throw new Error("Close reason is too long.");
  if (closeExplanation.length > 1000) throw new Error("Close explanation is too long.");
  assertNoExchangeDirectContact(closeReason, closeExplanation);

  const now = nowIso();
  const actorRole = resolveActorRole(db, input.actorUserId);
  const next: PurchaseRequest = {
    ...request,
    status: "cancelled",
    closedAt: now,
    closedByUserId: input.actorUserId,
    closeReason,
    closeExplanation: closeExplanation || undefined,
    updatedAt: now,
    timedOutAt: undefined,
    timeoutReason: undefined,
    inactivityWarningSentAt: undefined,
    timeline: [...(request.timeline ?? [])],
  };
  appendTradeTimelineEntry(next, {
    type: "trade_closed_manually",
    actorUserId: input.actorUserId,
    actorRole,
    message: `Trade closed manually: ${closeReason}`,
    createdAt: now,
  });
  appendSystemTradeMessage(db, next, {
    senderUserId: input.actorUserId,
    senderRole: actorRole,
    message: closeExplanation
      ? `Trade was closed manually. Reason: ${closeReason}. ${closeExplanation}`
      : `Trade was closed manually. Reason: ${closeReason}.`,
    createdAt: now,
  });

  const listing = db.marketplaceListings.find((item) => item.id === request.listingId);
  const listingCommitBasis = listing
    ? {
        id: listing.id,
        status: listing.status,
        activeTradeRequestId: listing.activeTradeRequestId,
        availableAmount: listing.availableAmount,
        updatedAt: listing.updatedAt,
      }
    : null;
  if (listing && listing.activeTradeRequestId === request.id) {
    await unlockListingAfterCancelledTrade(db, listing, input.actorUserId, request, closeReason);
  }

  db.purchaseRequests[requestIndex] = next;
  await appendAuditLog(db, {
    action: "trade_closed_manually",
    actorUserId: input.actorUserId,
    targetUserId: request.buyerId === input.actorUserId ? request.sellerId : request.buyerId,
    purchaseRequestId: request.id,
    listingId: request.listingId,
    details: `Trade ${request.tradeId ?? request.id} closed manually.`,
    reason: closeReason,
    newValue: { closedAt: now, closeReason, closeExplanation: closeExplanation || undefined },
  });

  const counterpartyId = request.buyerId === input.actorUserId ? request.sellerId : request.buyerId;
  pushNotification(db, {
    userId: counterpartyId,
    category: "trade",
    title: "Trade closed",
    message: closeExplanation
      ? `The trade was closed manually. Reason: ${closeReason}. ${closeExplanation}`
      : `The trade was closed manually. Reason: ${closeReason}.`,
    relatedTradeId: request.tradeId ?? request.id,
    relatedListingId: request.listingId,
    relatedHref: requestDetailsHref(request.id),
  });
  pushNotification(db, {
    userId: input.actorUserId,
    category: "trade",
    title: "Trade closed",
    message: `You closed this trade. Reason: ${closeReason}.`,
    relatedTradeId: request.tradeId ?? request.id,
    relatedListingId: request.listingId,
    relatedHref: requestDetailsHref(request.id),
  });

  try {
    await writeDb(db, {
      selectedTables: TRADE_STATUS_BASE_TABLES,
      validateLatestBeforeCommit: (canonicalSnapshot) => {
        const canonicalRequest = canonicalSnapshot.purchaseRequests.find((candidate) => candidate.id === request.id);
        if (!canonicalRequest || canonicalRequest.status !== request.status || canonicalRequest.closedAt !== request.closedAt) {
          throw new ConcurrentTradeMutationError();
        }
        const canonicalListing = canonicalSnapshot.marketplaceListings.find((candidate) => candidate.id === request.listingId);
        const listingChanged = listingCommitBasis
          ? !canonicalListing
            || canonicalListing.status !== listingCommitBasis.status
            || canonicalListing.activeTradeRequestId !== listingCommitBasis.activeTradeRequestId
            || canonicalListing.availableAmount !== listingCommitBasis.availableAmount
            || canonicalListing.updatedAt !== listingCommitBasis.updatedAt
          : Boolean(canonicalListing);
        if (listingChanged) {
          throw new ConcurrentTradeMutationError();
        }
      },
    });
  } catch (error) {
    if (error instanceof ConcurrentTradeMutationError && concurrencyRetryCount < 2) {
      return closePurchaseRequestManuallyAttempt(input, concurrencyRetryCount + 1);
    }
    if (error instanceof ConcurrentTradeMutationError) {
      throw new TradeBlockedError(
        "concurrent-close-change",
        "This trade changed while it was being closed. Refresh the Trade Room and try again.",
        input.requestId,
        { guard: "canonical-close-retry" },
      );
    }
    throw error;
  }
  const enriched = enrichRequestWithEvidence(db, db.purchaseRequests[requestIndex]);
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
  return sanitizePurchaseRequestForActor(enriched, input.actorUserId, input.actorRole);
}

export async function postTradeRoomMessage(input: {
  purchaseRequestId: string;
  actorUserId: string;
  message: string;
  clientMessageId?: string;
  imageUrl?: string;
  imageName?: string;
  imageMimeType?: string;
}) {
  const startedAt = Date.now();
  const dbReadStartedAt = Date.now();
  const db = await readDb({ bypassCache: true });
  const dbReadMs = Date.now() - dbReadStartedAt;
  const validationStartedAt = Date.now();
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.purchaseRequestId);
  if (requestIndex === -1) throw new Error("Trade not found.");
  const request = db.purchaseRequests[requestIndex];
  assertTradeRoomParticipant(request, input.actorUserId);

  const message = input.message.trim();
  if (message.length > 1200) throw new Error("Message is too long.");
  assertNoExchangeDirectContact(message, input.imageUrl);
  const image = parseTradeRoomImageDataUrl(input.imageUrl, input.imageMimeType);
  if (!message && !image) throw new Error("Message or image is required.");
  const suppliedClientMessageId = String(input.clientMessageId ?? "").trim().toLowerCase();
  if (suppliedClientMessageId && !/^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(suppliedClientMessageId)) {
    throw new Error("Invalid message request id.");
  }
  const clientMessageId = suppliedClientMessageId || randomUUID();
  const messageId = `trade-msg-${createHash("sha256")
    .update(`${input.purchaseRequestId}:${input.actorUserId}:${clientMessageId}`)
    .digest("hex")
    .slice(0, 32)}`;
  const validationMs = Date.now() - validationStartedAt;

  const businessStartedAt = Date.now();
  const createdAt = nowIso();
  type CommittedTradeRoomMessage = {
    message: TradeChatMessage;
    recipientUserId: string;
    participantSide: TradeRoomParticipantSide;
    trade: { id: string; tradeId?: string };
    notificationPublication: DeferredNotificationPublication | null;
    created: boolean;
  };
  let committed: CommittedTradeRoomMessage | null = null;

  const applyMessageToCanonicalSnapshot = (snapshot: AlphaExchangeDb) => {
    const canonicalRequestIndex = snapshot.purchaseRequests.findIndex((item) => item.id === input.purchaseRequestId);
    if (canonicalRequestIndex === -1) throw new Error("Trade not found.");
    const canonicalRequest = snapshot.purchaseRequests[canonicalRequestIndex];
    const canonicalParticipantSide = assertTradeRoomParticipant(canonicalRequest, input.actorUserId);
    const canonicalRecipientUserId = canonicalParticipantSide === "buyer" ? canonicalRequest.sellerId : canonicalRequest.buyerId;
    const existingMessage = canonicalRequest.messages?.find((candidate) => candidate.id === messageId);
    if (existingMessage) {
      committed = {
        message: existingMessage,
        recipientUserId: canonicalRecipientUserId,
        participantSide: canonicalParticipantSide,
        trade: { id: canonicalRequest.id, tradeId: canonicalRequest.tradeId },
        notificationPublication: null,
        created: false,
      };
      return snapshot;
    }

    const nextMessage: TradeChatMessage = {
      id: messageId,
      purchaseRequestId: canonicalRequest.id,
      kind: "user",
      senderUserId: input.actorUserId,
      senderRole: canonicalParticipantSide === "buyer" ? "buyer" : "approved_seller",
      message,
      createdAt,
      sentAt: createdAt,
      readByUserIds: [input.actorUserId],
      imageUrl: image?.dataUrl,
      // Do not retain client filename metadata: an attachment can be identified
      // safely by its server-generated message id and verified MIME type.
      imageName: image ? `trade-room-attachment-${messageId.slice(-8)}.${extensionForEvidenceMimeType(image.mimeType)}` : undefined,
      imageMimeType: image?.mimeType,
    };
    canonicalRequest.messages = [nextMessage, ...(canonicalRequest.messages ?? [])];
    canonicalRequest.updatedAt = createdAt;
    if (canonicalRequest.status === "accepted") {
      canonicalRequest.inactivityWarningSentAt = undefined;
    }
    snapshot.purchaseRequests[canonicalRequestIndex] = canonicalRequest;
    snapshot.tradeMessages = [nextMessage, ...(snapshot.tradeMessages ?? [])];
    const notificationPublication = pushNotification(snapshot, {
      userId: canonicalRecipientUserId,
      category: "trade",
      title: "New Trade Room message",
      message: "You have a new message in your active Alpha Exchange trade.",
      relatedRequestId: canonicalRequest.id,
      relatedTradeId: canonicalRequest.tradeId,
      relatedListingId: canonicalRequest.listingId,
      relatedHref: `${requestDetailsHref(canonicalRequest.id)}#chat`,
      actionLabel: "Open Trade Room",
      actionHref: `${requestDetailsHref(canonicalRequest.id)}#chat`,
      reason: "trade_room_message",
      forceInApp: true,
      deferRealtime: true,
    });
    committed = {
      message: nextMessage,
      recipientUserId: canonicalRecipientUserId,
      participantSide: canonicalParticipantSide,
      trade: { id: canonicalRequest.id, tradeId: canonicalRequest.tradeId },
      notificationPublication,
      created: true,
    };
    return snapshot;
  };

  applyMessageToCanonicalSnapshot(db);
  const businessMs = Date.now() - businessStartedAt;
  const writeStartedAt = Date.now();
  await writeDb(db, {
    selectedTables: TRADE_ROOM_INTERACTION_TABLES,
    // Reapply the exact message operation under the repository's canonical
    // transaction lock when another Vercel instance wrote first. The stable
    // client id turns an uncertain response/retry into one durable message and
    // one notification instead of duplicates or lost chat history.
    rebaseOnLatest: applyMessageToCanonicalSnapshot,
  });
  const writeMs = Date.now() - writeStartedAt;
  const committedResult = committed as CommittedTradeRoomMessage | null;
  if (!committedResult) throw new Error("Failed to save message.");
  const sseStartedAt = Date.now();
  if (committedResult.created) {
    publishRealtimeEvent({
      type: "trade.message_created",
      payload: {
        requestId: committedResult.trade.id,
        messageId: committedResult.message.id,
      },
    });
    publishNotificationPublication(committedResult.notificationPublication);
  }
  const sseMs = Date.now() - sseStartedAt;
  return {
    message: committedResult.message,
    created: committedResult.created,
    notificationRecipientUserId: committedResult.recipientUserId,
    notificationRecipientRole: committedResult.participantSide === "buyer" ? "seller" as const : "buyer" as const,
    senderParticipantRole: committedResult.participantSide,
    trade: committedResult.trade,
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

export async function postTradeRoomPoke(input: {
  purchaseRequestId: string;
  actorUserId: string;
  requestHeaders: Headers;
}) {
  const db = await readDb({ bypassCache: true });
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.purchaseRequestId);
  if (requestIndex === -1) {
    throw new TradeRoomPokeError({
      code: "TRADE_NOT_FOUND",
      message: "Trade not found.",
      status: 404,
    });
  }

  const request = db.purchaseRequests[requestIndex];
  let participantSide: TradeRoomParticipantSide;
  try {
    participantSide = assertTradeRoomParticipant(request, input.actorUserId);
  } catch {
    throw new TradeRoomPokeError({
      code: "TRADE_PARTICIPANT_REQUIRED",
      message: "Only the Buyer or Seller in this Trade Room can send a reminder.",
      status: 403,
    });
  }
  if (!isTradeRoomPokeActive(request)) {
    throw new TradeRoomPokeError({
      code: "TRADE_NOT_ACTIVE",
      message: "Reminders are available only while this trade is active.",
      status: 409,
    });
  }

  const persistedAvailability = getTradeRoomPokeAvailability(request, input.actorUserId);
  if (!persistedAvailability.canPoke) {
    throw new TradeRoomPokeError({
      code: "POKE_COOLDOWN_ACTIVE",
      message: "Please wait before sending another reminder for this trade.",
      status: 429,
      retryAfterSeconds: persistedAvailability.cooldownRemainingSeconds,
      cooldownUntil: persistedAvailability.cooldownUntil,
    });
  }

  const recipientUserId = participantSide === "buyer" ? request.sellerId : request.buyerId;
  // PostgreSQL-backed, per-trade/per-direction claim. In production the shared
  // limiter fails closed when its database backing is unavailable, so a refresh,
  // another device, or concurrent POST cannot manufacture an extra Poke.
  const cooldownClaim = await checkSharedRateLimit({
    headers: input.requestHeaders,
    key: "exchange:trade-room-poke",
    identifier: `${request.id}:${input.actorUserId}:${recipientUserId}`,
    maxRequests: 1,
    windowMs: TRADE_ROOM_POKE_COOLDOWN_MS,
  });
  if (!cooldownClaim.allowed) {
    const retryAfterSeconds = Math.max(1, cooldownClaim.retryAfterSeconds);
    throw new TradeRoomPokeError({
      code: cooldownClaim.reason === "limiter_unavailable" ? "POKE_COOLDOWN_UNAVAILABLE" : "POKE_COOLDOWN_ACTIVE",
      message: cooldownClaim.reason === "limiter_unavailable"
        ? "Reminders are temporarily unavailable. Please try again shortly."
        : "Please wait before sending another reminder for this trade.",
      status: cooldownClaim.reason === "limiter_unavailable" ? 503 : 429,
      retryAfterSeconds,
      cooldownUntil: cooldownClaim.reason === "limiter_unavailable"
        ? null
        : new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
    });
  }

  const createdAt = nowIso();
  const senderRole: UserRole = participantSide === "buyer" ? "buyer" : "approved_seller";
  const nextPokeState: TradeRoomPokeState = {
    ...(request.pokeState ?? {}),
    [pokeStateFieldForSender(participantSide)]: createdAt,
  };
  request.pokeState = nextPokeState;
  appendSystemTradeMessage(db, request, {
    senderUserId: input.actorUserId,
    senderRole,
    message: participantSide === "buyer"
      ? "Buyer sent a reminder to continue this Trade Room."
      : "Seller sent a reminder to continue this Trade Room.",
    createdAt,
  });
  const newestMessage = request.messages?.[0];
  if (!newestMessage) {
    throw new TradeRoomPokeError({
      code: "POKE_PERSISTENCE_FAILED",
      message: "The reminder could not be saved. Please try again.",
      status: 500,
    });
  }
  request.updatedAt = createdAt;
  db.purchaseRequests[requestIndex] = request;
  const notificationPublication = pushNotification(db, {
    userId: recipientUserId,
    category: "trade",
    title: "Trade Room reminder",
    message: participantSide === "buyer"
      ? "Your Buyer is waiting for you in an active trade."
      : "Your Seller is waiting for you in an active trade.",
    relatedRequestId: request.id,
    relatedTradeId: request.tradeId,
    relatedListingId: request.listingId,
    relatedHref: `${requestDetailsHref(request.id)}#chat`,
    actionLabel: "Open Trade Room",
    actionHref: `${requestDetailsHref(request.id)}#chat`,
    reason: "trade_room_poke",
    forceInApp: true,
    deferRealtime: true,
  });

  await writeDb(db, {
    selectedTables: TRADE_ROOM_INTERACTION_TABLES,
    // The initial read is intentionally not the final authority. Snapshot
    // writes serialize through the repository advisory transaction lock; check
    // the merged canonical request while that lock is held so a cancellation,
    // completion, timeout, or another Poke cannot race this delivery.
    validateBeforeCommit: (canonicalSnapshot) => {
      const canonicalRequest = canonicalSnapshot.purchaseRequests.find((item) => item.id === request.id);
      if (!canonicalRequest) {
        throw new TradeRoomPokeError({
          code: "TRADE_NOT_FOUND",
          message: "Trade not found.",
          status: 404,
        });
      }
      const canonicalSide = getTradeRoomParticipantSide(canonicalRequest, input.actorUserId);
      if (canonicalSide !== participantSide) {
        throw new TradeRoomPokeError({
          code: "TRADE_PARTICIPANT_REQUIRED",
          message: "Only the Buyer or Seller in this Trade Room can send a reminder.",
          status: 403,
        });
      }
      if (!isTradeRoomPokeActive(canonicalRequest)) {
        throw new TradeRoomPokeError({
          code: "TRADE_NOT_ACTIVE",
          message: "Reminders are available only while this trade is active.",
          status: 409,
        });
      }
      const committedPokeAt = canonicalRequest.pokeState?.[pokeStateFieldForSender(participantSide)];
      if (committedPokeAt !== createdAt) {
        throw new TradeRoomPokeError({
          code: "POKE_COOLDOWN_ACTIVE",
          message: "Please wait before sending another reminder for this trade.",
          status: 429,
          retryAfterSeconds: Math.max(1, Math.ceil(TRADE_ROOM_POKE_COOLDOWN_MS / 1000)),
          cooldownUntil: getPokeCooldownUntil(canonicalRequest, participantSide)?.toISOString() ?? null,
        });
      }
    },
  });
  publishRealtimeEvent({
    type: "trade.message_created",
    payload: { requestId: request.id, messageId: newestMessage.id },
  });
  publishNotificationPublication(notificationPublication);

  return {
    message: newestMessage,
    poke: getTradeRoomPokeAvailability(request, input.actorUserId),
    notificationRecipientUserId: recipientUserId,
    notificationRecipientRole: participantSide === "buyer" ? "seller" as const : "buyer" as const,
    senderParticipantRole: participantSide,
    trade: {
      id: request.id,
      tradeId: request.tradeId,
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
  preferredLocale: PreferredLocale;
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

  const username = derivePublicProfileUsername({ fullName: user.fullName, email: user.email, id: user.id, publicTradingName: user.buyerDisplayName });
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
    preferredLocale: normalizePreferredLocale(user.preferredLocale),
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

type UploadTradeEvidenceInput = {
  purchaseRequestId: string;
  actorUserId: string;
  actorRole: UserRole;
  side: TradeEvidenceSide;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
};

type UploadTradeEvidenceResult = {
  request: PurchaseRequest;
  metrics: {
    dbReadMs: number;
    validationMs: number;
    storageMs: number;
    dbWriteMs: number;
    routeMs: number;
    autoAdvancedToPaymentSent: boolean;
    autoAdvancedToUsdtSent: boolean;
    replayed: boolean;
  };
};

export async function uploadTradeEvidence(input: UploadTradeEvidenceInput): Promise<UploadTradeEvidenceResult> {
  return uploadTradeEvidenceAttempt(input, 0);
}

async function uploadTradeEvidenceAttempt(
  input: UploadTradeEvidenceInput,
  concurrencyRetryCount: number,
): Promise<UploadTradeEvidenceResult> {
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
  if (input.side === "seller" && request.status !== "usdt_release_pending") {
    throw new Error("Seller USDT evidence can be uploaded only during the USDT release stage.");
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
  if (!validateUploadContent(raw, mimeType as "image/jpeg" | "image/png" | "image/webp" | "application/pdf")) {
    throw new Error("Evidence content does not match its declared file type.");
  }
  const validationMs = Date.now() - validationStartedAt;

  const extension = extensionForEvidenceMimeType(mimeType);
  // A mobile retry of the exact same upload must address the same durable
  // evidence object. Content-derived identity avoids duplicate timeline,
  // notification, and auto-advance effects without trusting a client token.
  const evidenceId = `evidence-${createHash("sha256")
    .update(`${request.id}\0${input.actorUserId}\0${input.side}\0${mimeType}\0`)
    .update(raw)
    .digest("hex")
    .slice(0, 32)}`;
  // Never expose user-supplied filenames to the counterparty. The content and
  // storage path remain intact; only display/download metadata is neutral.
  const baseName = evidenceDisplayFileName(input.side, mimeType);
  const storageFileName = `${input.side}-${evidenceId}.${extension}`;
  const storagePath = `db://alpha-exchange-evidence/${request.id}/${storageFileName}`;

  const existingIndex = db.tradeEvidenceFiles.findIndex((item) => item.purchaseRequestId === request.id && item.side === input.side);
  const existing = existingIndex >= 0 ? db.tradeEvidenceFiles[existingIndex] : undefined;

  if (existing?.id === evidenceId) {
    return {
      request: sanitizePurchaseRequestForActor(
        enrichRequestWithEvidence(db, request),
        input.actorUserId,
        input.actorRole,
      ),
      metrics: {
        dbReadMs,
        validationMs,
        storageMs: 0,
        dbWriteMs: 0,
        routeMs: Date.now() - startedAt,
        autoAdvancedToPaymentSent: false,
        autoAdvancedToUsdtSent: false,
        replayed: true,
      },
    };
  }
  const existingEvidenceIdAtRead = existing?.id ?? null;
  const requestStatusAtRead = request.status;

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
  const shouldAutoConfirmUsdtSent = input.side === "seller" && request.status === "usdt_release_pending";
  const evidenceListing = shouldAutoSubmitPayment
    ? db.marketplaceListings.find((candidate) => candidate.id === request.listingId)
    : undefined;
  const evidenceListingBasis = evidenceListing
    ? {
        id: evidenceListing.id,
        status: evidenceListing.status,
        activeTradeRequestId: evidenceListing.activeTradeRequestId,
        updatedAt: evidenceListing.updatedAt,
      }
    : null;

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
    nextRequest.inactivityWarningSentAt = undefined;
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
  if (shouldAutoConfirmUsdtSent) {
    nextRequest.status = "usdt_sent";
    nextRequest.usdtSentAt = updatedAt;
    appendTradeTimelineEntry(nextRequest, {
      type: "usdt_sent",
      actorUserId: input.actorUserId,
      actorRole,
      message: "Seller marked USDT sent",
      createdAt: updatedAt,
    });
    appendSystemTradeMessage(db, nextRequest, {
      senderUserId: input.actorUserId,
      senderRole: actorRole,
      message: "Seller marked USDT as sent. Buyer should now confirm receipt.",
      createdAt: updatedAt,
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Seller marked USDT sent",
      message: "Seller marked USDT as sent. Please confirm receipt to complete the trade.",
      relatedTradeId: nextRequest.tradeId,
      relatedListingId: request.listingId,
      relatedHref: requestDetailsHref(request.id),
    });
    queueSmsDelivery(db, {
      eventType: "usdt_sent",
      eventKey: `trade:${request.id}:usdt-sent:buyer:${request.buyerId}`,
      recipientUserId: request.buyerId,
      destinationPath: requestDetailsHref(request.id),
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
  try {
    await writeDb(db, {
      evidenceOverrides: new Map([[evidenceId, raw]]),
      selectedTables: shouldAutoSubmitPayment || shouldAutoConfirmUsdtSent ? TRADE_EVIDENCE_PAYMENT_TABLES : TRADE_EVIDENCE_BASE_TABLES,
      validateLatestBeforeCommit: (canonicalSnapshot) => {
        const canonicalRequest = canonicalSnapshot.purchaseRequests.find((candidate) => candidate.id === request.id);
        const canonicalEvidence = canonicalSnapshot.tradeEvidenceFiles.find(
          (candidate) => candidate.purchaseRequestId === request.id && candidate.side === input.side,
        );
        if (
          !canonicalRequest
          || canonicalRequest.status !== requestStatusAtRead
          || (canonicalEvidence?.id ?? null) !== existingEvidenceIdAtRead
        ) {
          throw new ConcurrentTradeMutationError();
        }
        if (evidenceListingBasis) {
          const canonicalListing = canonicalSnapshot.marketplaceListings.find((candidate) => candidate.id === evidenceListingBasis.id);
          if (
            !canonicalListing
            || canonicalListing.status !== evidenceListingBasis.status
            || canonicalListing.activeTradeRequestId !== evidenceListingBasis.activeTradeRequestId
            || canonicalListing.updatedAt !== evidenceListingBasis.updatedAt
          ) {
            throw new ConcurrentTradeMutationError();
          }
        }
      },
    });
  } catch (error) {
    if (error instanceof ConcurrentTradeMutationError && concurrencyRetryCount < 2) {
      return uploadTradeEvidenceAttempt(input, concurrencyRetryCount + 1);
    }
    if (error instanceof ConcurrentTradeMutationError) {
      throw new TradeBlockedError(
        "concurrent-evidence-change",
        "This trade changed while your evidence was being saved. Refresh the Trade Room and try again.",
        input.purchaseRequestId,
        { guard: "canonical-evidence-retry", side: input.side },
      );
    }
    throw error;
  }
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
    request: sanitizePurchaseRequestForActor(
      enrichRequestWithEvidence(db, db.purchaseRequests[requestIndex]),
      input.actorUserId,
      input.actorRole,
    ),
    metrics: {
      dbReadMs,
      validationMs,
      storageMs,
      dbWriteMs,
      routeMs: Date.now() - startedAt,
      autoAdvancedToPaymentSent: shouldAutoSubmitPayment,
      autoAdvancedToUsdtSent: shouldAutoConfirmUsdtSent,
      replayed: false,
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
  return sanitizePurchaseRequestForActor(enrichRequestWithEvidence(db, request), input.actorUserId, input.actorRole);
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
  return {
    evidence: {
      ...evidence,
      fileName: evidenceDisplayFileName(evidence.side, evidence.mimeType),
    },
    request,
    buffer,
  };
}

export async function downloadMarketplaceComplianceEvidenceById(input: {
  sellerId: string;
  evidenceId: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  const db = await readDb();
  if (input.actorRole !== "admin" && input.actorRole !== "owner") {
    throw new Error("Admin access required.");
  }
  const auditEntry = getMarketplaceEnforcementAuditLog(db).find((entry) =>
    entry.sellerId === input.sellerId
    && Array.isArray(entry.evidenceReferences)
    && entry.evidenceReferences.some((item) => item.id === input.evidenceId),
  );
  if (!auditEntry || !auditEntry.evidenceReferences) {
    throw new Error("Compliance evidence not found.");
  }
  const evidence = auditEntry.evidenceReferences.find((item) => item.id === input.evidenceId);
  if (!evidence) throw new Error("Compliance evidence not found.");
  const storagePath = `db://alpha-exchange-evidence/compliance/${input.sellerId}/${input.evidenceId}.${extensionForEvidenceMimeType(evidence.mimeType)}`;

  const repository = await getAlphaExchangeRepository();
  const buffer = await repository.readEvidenceContent(storagePath);
  if (!buffer?.length) throw new Error("Evidence content not found.");

  return { evidence, buffer };
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

function sanitizeSellerReviewForCounterparty(review: SellerReviewRecord, canViewPrivateContent: boolean) {
  if (canViewPrivateContent) return review;
  return {
    ...review,
    comment: redactExchangeUserContent(review.comment),
    sellerReply: review.sellerReply ? redactExchangeUserContent(review.sellerReply) : undefined,
    hiddenReason: review.hiddenReason ? redactExchangeUserContent(review.hiddenReason) : undefined,
  };
}

export async function submitBuyerTradeReview(input: {
  requestId: string;
  buyerUserId: string;
  rating: number;
  comment: string;
}) {
  const db = await readDb();
  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const comment = String(input.comment ?? "").trim();
  if (!comment) throw new Error("Review comment is required.");
  if (comment.length > 500) throw new Error("Review comment is too long.");
  assertNoExchangeDirectContact(comment);
  type CommittedBuyerReview = {
    review: SellerReviewRecord;
    sellerProgress: {
      previousRank: SellerLevel;
      newRank: SellerLevel;
      nextRank?: SellerLevel;
      remainingVolumeToNextRank: number;
      progressPercent: number;
      promoted: boolean;
    };
    sellerId: string;
    reviewCount: number;
    created: boolean;
  };
  let committed: CommittedBuyerReview | null = null;

  const applyReviewToCanonicalSnapshot = async (snapshot: AlphaExchangeDb) => {
    const requestIndex = snapshot.purchaseRequests.findIndex((item) => item.id === input.requestId);
    if (requestIndex === -1) throw new Error("Trade not found.");
    const request = snapshot.purchaseRequests[requestIndex];
    if (request.buyerId !== input.buyerUserId) throw new Error("Only the buyer can submit this review.");
    if (!request.completedAt && request.status !== "review_open" && request.status !== "locked" && request.status !== "completed") {
      throw new Error("Review unlocks only after trade completion.");
    }
    const existingReview = buildSellerReviewRecordFromRequest(request);
    if (hasBuyerReviewSubmitted(snapshot, request)) {
      if (!existingReview || existingReview.rating !== rating || existingReview.comment !== comment) {
        throw new Error("Buyer review already submitted.");
      }
      const currentSnapshot = computeSellerReputationSnapshot(snapshot, request.sellerId);
      committed = {
        review: existingReview,
        sellerProgress: {
          previousRank: currentSnapshot.level,
          newRank: currentSnapshot.level,
          nextRank: currentSnapshot.nextRank,
          remainingVolumeToNextRank: currentSnapshot.remainingVolumeToNextRank ?? 0,
          progressPercent: currentSnapshot.prestigeProgressPercent ?? 0,
          promoted: false,
        },
        sellerId: request.sellerId,
        reviewCount: snapshot.purchaseRequests.filter((item) => item.sellerId === request.sellerId && item.buyerReview && item.buyerReview.hidden !== true).length,
        created: false,
      };
      return snapshot;
    }

    const sellerSnapshotBefore = computeSellerReputationSnapshot(snapshot, request.sellerId);
    const review = buildSellerReviewFromTrade(request, { buyerUserId: input.buyerUserId, rating, comment });
    snapshot.purchaseRequests[requestIndex] = {
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

    await appendAuditLog(snapshot, {
      action: "trade_review_submitted",
      actorUserId: input.buyerUserId,
      targetUserId: request.sellerId,
      purchaseRequestId: request.id,
      listingId: request.listingId,
      details: `Buyer review submitted for trade ${request.tradeId ?? request.id}`,
    });
    pushNotification(snapshot, {
      userId: request.sellerId,
      category: "review",
      title: "Buyer left a review",
      message: "A buyer submitted a review for a completed trade.",
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
    pushActivityLog(snapshot, {
      userId: input.buyerUserId,
      category: "trade",
      title: "Review submitted",
      details: `Review submitted for trade ${request.tradeId ?? request.id}.`,
    });
    const sellerSnapshotAfter = computeSellerReputationSnapshot(snapshot, request.sellerId);
    committed = {
      review,
      sellerProgress: {
        previousRank: sellerSnapshotBefore.level,
        newRank: sellerSnapshotAfter.level,
        nextRank: sellerSnapshotAfter.nextRank,
        remainingVolumeToNextRank: sellerSnapshotAfter.remainingVolumeToNextRank ?? 0,
        progressPercent: sellerSnapshotAfter.prestigeProgressPercent ?? 0,
        promoted: sellerSnapshotBefore.level !== sellerSnapshotAfter.level,
      },
      sellerId: request.sellerId,
      reviewCount: snapshot.purchaseRequests.filter((item) => item.sellerId === request.sellerId && item.buyerReview && item.buyerReview.hidden !== true).length,
      created: true,
    };
    return snapshot;
  };

  await applyReviewToCanonicalSnapshot(db);
  let result = committed as CommittedBuyerReview | null;
  if (!result) throw new Error("Failed to prepare buyer review.");
  if (result.created) {
    await writeDb(db, {
      selectedTables: TRADE_REVIEW_TABLES,
      rebaseOnLatest: applyReviewToCanonicalSnapshot,
    });
    result = committed as CommittedBuyerReview | null;
    if (!result) throw new Error("Failed to save buyer review.");
  }
  if (result.created) {
    publishRealtimeEvent({
      type: "review.count_changed",
      payload: { sellerId: result.sellerId, reviewCount: result.reviewCount },
    });
  }
  return { review: result.review, sellerProgress: result.sellerProgress };
}

export async function submitSellerReviewResponse(input: {
  requestId?: string;
  reviewId?: string;
  sellerUserId: string;
  message: string;
}) {
  const db = await readDb();
  const message = String(input.message ?? "").trim();
  if (!message) throw new Error("Response message is required.");
  if (message.length > 500) throw new Error("Response message is too long.");
  assertNoExchangeDirectContact(message);
  let committed: { review: SellerReviewRecord; created: boolean } | null = null;
  const applyResponseToCanonicalSnapshot = async (snapshot: AlphaExchangeDb) => {
    const requestIndex = input.reviewId
      ? snapshot.purchaseRequests.findIndex((item) => `review-${item.id}` === input.reviewId || (item.tradeId ? `review-${item.tradeId}` === input.reviewId : false))
      : snapshot.purchaseRequests.findIndex((item) => item.id === input.requestId);
    if (requestIndex === -1) throw new Error("Trade not found.");
    const request = snapshot.purchaseRequests[requestIndex];
    const reviewRecord = buildSellerReviewRecordFromRequest(request);
    if (!reviewRecord) throw new Error("Seller response is available only after buyer review.");
    if (request.sellerId !== input.sellerUserId) throw new Error("Only the seller can respond.");
    if (reviewRecord.hidden) throw new Error("Cannot reply to a hidden review.");
    if (reviewRecord.sellerReply) {
      if (reviewRecord.sellerReply !== message) throw new Error("Seller response already submitted.");
      committed = { review: reviewRecord, created: false };
      return snapshot;
    }

    snapshot.purchaseRequests[requestIndex] = {
      ...request,
      sellerResponse: {
        responderUserId: input.sellerUserId,
        message,
        createdAt: nowIso(),
      },
      updatedAt: nowIso(),
    };
    const updatedReview = buildSellerReviewRecordFromRequest(snapshot.purchaseRequests[requestIndex]);
    if (!updatedReview) throw new Error("Updated review could not be built.");

    await appendAuditLog(snapshot, {
      action: "trade_review_responded",
      actorUserId: input.sellerUserId,
      targetUserId: request.buyerId,
      purchaseRequestId: request.id,
      listingId: request.listingId,
      details: `Seller response submitted for trade ${request.tradeId ?? request.id}`,
    });
    pushNotification(snapshot, {
      userId: request.buyerId,
      category: "trade",
      title: "Seller replied to your review",
      message: "The seller responded to your completed trade review.",
      relatedTradeId: request.tradeId ?? request.id,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
    pushActivityLog(snapshot, {
      userId: input.sellerUserId,
      category: "trade",
      title: "Review response sent",
      details: `Response sent for trade ${request.tradeId ?? request.id}.`,
    });
    committed = { review: updatedReview, created: true };
    return snapshot;
  };

  await applyResponseToCanonicalSnapshot(db);
  let result = committed as { review: SellerReviewRecord; created: boolean } | null;
  if (!result) throw new Error("Failed to prepare seller response.");
  if (result.created) {
    await writeDb(db, {
      selectedTables: TRADE_REVIEW_TABLES,
      rebaseOnLatest: applyResponseToCanonicalSnapshot,
    });
    result = committed as { review: SellerReviewRecord; created: boolean } | null;
    if (!result) throw new Error("Failed to save seller response.");
  }
  return result.review;
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
  const canViewPrivateContent = input.actorRole === "admin" || input.actorRole === "owner";
  return (canViewHidden ? reviews : reviews.filter((review) => !review.hidden))
    .map((review) => sanitizeSellerReviewForCounterparty(review, canViewPrivateContent));
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

type UpdatePurchaseRequestStatusInput = {
  requestId: string;
  actorUserId: string;
  actorRole: UserRole;
  nextStatus: PurchaseRequestStatus;
  safetyAcknowledged?: boolean;
  traceId?: string;
};

type UpdatePurchaseRequestStatusResult = {
  request: PurchaseRequest;
  statusChanged: boolean;
  additionallyDeclinedRequests?: PurchaseRequest[];
  deferredTrustWrite?: () => Promise<void>;
  metrics: {
    totalMs: number;
    readDbMs: number;
    timelineMs: number;
    chatMs: number;
    notificationMs: number;
    writeDbMs: number;
    sseMs: number;
    trustMs: number;
  };
};

export async function updatePurchaseRequestStatus(input: UpdatePurchaseRequestStatusInput): Promise<UpdatePurchaseRequestStatusResult> {
  return updatePurchaseRequestStatusAttempt(input, 0);
}

async function updatePurchaseRequestStatusAttempt(
  input: UpdatePurchaseRequestStatusInput,
  concurrencyRetryCount: number,
): Promise<UpdatePurchaseRequestStatusResult> {
  const startedAt = Date.now();
  const debugTradeRoom = allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
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
  const priorSmsCount = db.smsDeliveries?.length ?? 0;
  const readDbMs = Date.now() - startedAt;
  let timelineMs = 0;
  let chatMs = 0;
  let notificationMs = 0;
  const additionallyDeclinedRequests: PurchaseRequest[] = [];
  let requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.requestId);
  if (requestIndex === -1) {
    throw new TradeBlockedError("purchase-request-not-found", "Purchase request not found.", input.requestId, {
      guard: "request-exists",
      nextStatus: input.nextStatus,
    });
  }
  let request = db.purchaseRequests[requestIndex];
  let stateBefore = request.status;
  logLocalMarketplaceDiagnostic("info", "[trade-consistency] mutation db-read", {
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
  if (currentStatus === input.nextStatus) {
    return {
      request: enrichRequestWithEvidence(db, request),
      statusChanged: false,
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
  if (input.nextStatus === "completed" && (currentStatus === "review_open" || currentStatus === "completed" || currentStatus === "locked")) {
    const enriched = enrichRequestWithEvidence(db, request);
    return {
      request: enriched,
      statusChanged: false,
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
          statusChanged: false,
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
    logLocalMarketplaceDiagnostic("warn", "[trade-store] listing not found for in-progress transition", {
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
  const listingCommitBasis = listing
    ? {
        id: listing.id,
        status: listing.status,
        activeTradeRequestId: listing.activeTradeRequestId,
        availableAmount: listing.availableAmount,
        updatedAt: listing.updatedAt,
      }
    : null;
  const pendingCommissionCountAtRead = input.nextStatus === "accepted"
    ? getSellerPendingCommissionCount(db, request.sellerId)
    : null;
  const pendingSiblingRequestIdsAtRead = input.nextStatus === "accepted"
    ? db.purchaseRequests
        .filter((candidate) => candidate.id !== request.id && candidate.listingId === request.listingId && candidate.status === "pending")
        .map((candidate) => candidate.id)
        .sort()
    : [];
  const allowedByStatus: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
    pending: ["accepted", "declined", "cancelled"],
    accepted: ["payment_sent"],
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
      logLocalMarketplaceDiagnostic("error", "[trade-accept-guard] listing-not-open", {
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
      logLocalMarketplaceDiagnostic("error", "[trade-accept-guard] commission-locked", {
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
      additionallyDeclinedRequests.push(declinedSibling);
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
    pushAdminTradeActivityNotifications(db, {
      title: "Trade Request Accepted",
      message: `Seller accepted ${request.buyerName}'s ${request.usdtAmount} USDT request. The trade is now active.`,
      request: next,
      actionLabel: "Monitor Trade",
      actorUserId: input.actorUserId,
    });
    queueSmsDelivery(db, { eventType: "trade_accepted", eventKey: `trade:${request.id}:accepted:buyer:${request.buyerId}`, recipientUserId: request.buyerId, destinationPath: requestDetailsHref(request.id) });
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
      await unlockListingAfterCancelledTrade(db, listing, input.actorUserId, request, "Buyer cancelled the trade.");
    }
    for (const userId of [request.buyerId, request.sellerId]) {
      pushNotification(db, {
        userId,
        category: "trade",
        title: "Trade cancelled",
        message: "The buyer cancelled this trade request.",
        relatedTradeId: next.tradeId,
        relatedListingId: request.listingId,
        relatedHref: requestDetailsHref(request.id),
      });
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
    queueSmsDelivery(db, { eventType: "payment_sent", eventKey: `trade:${request.id}:payment-sent:seller:${request.sellerId}`, recipientUserId: request.sellerId, destinationPath: requestDetailsHref(request.id) });
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
    queueSmsDelivery(db, { eventType: "funds_received", eventKey: `trade:${request.id}:funds-received:buyer:${request.buyerId}`, recipientUserId: request.buyerId, destinationPath: requestDetailsHref(request.id) });
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
    queueSmsDelivery(db, { eventType: "usdt_sent", eventKey: `trade:${request.id}:usdt-sent:buyer:${request.buyerId}`, recipientUserId: request.buyerId, destinationPath: requestDetailsHref(request.id) });
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
      logLocalMarketplaceDiagnostic("warn", "[trade-store] listing not found during completion — skipping listing state update", {
        requestId: input.requestId,
        listingId: request.listingId,
      });
    }
    let commission = db.commissionRecords.find((record) => record.purchaseRequestId === request.id);
    if (!commission) {
      const normalizedGross = toNumber(next.fiatAmount);
      const normalizedUsdt = toNumber(next.usdtAmount);
      const commissionAmount = isQaCommissionModeEnabled()
        ? 1
        : roundUsdt(normalizedUsdt * COMMISSION_RATE);
      commission = {
        id: `commission-${randomUUID()}`,
        purchaseRequestId: request.id,
        tradeId: next.tradeId,
        listingId: request.listingId,
        sellerId: request.sellerId,
        buyerId: request.buyerId,
        rate: COMMISSION_RATE,
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
      relatedRequestId: request.id,
      relatedListingId: request.listingId,
      relatedHref: commission ? commissionPaymentDestination(commission.id) : requestDetailsHref(request.id),
      actionHref: commission ? commissionPaymentDestination(commission.id) : requestDetailsHref(request.id),
      actionLabel: commission ? "Pay Commission" : undefined,
      reason: commission ? COMMISSION_PAYMENT_DUE_NOTIFICATION_REASON : undefined,
    });
    queueSmsDelivery(db, { eventType: "trade_completed", eventKey: `trade:${request.id}:completed:seller:${request.sellerId}`, recipientUserId: request.sellerId, destinationPath: requestDetailsHref(request.id) });
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
        relatedHref: adminPurchaseRequestsDestination(request.id),
        actionHref: adminPurchaseRequestsDestination(request.id),
        actionLabel: "Review Trade",
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
  if (next.status !== "accepted") {
    next.inactivityWarningSentAt = undefined;
  }
  db.purchaseRequests[requestIndex] = next;
  logLocalMarketplaceDiagnostic("info", "[trade-consistency] mutation status-after", {
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    nextStatus: input.nextStatus,
    statusAfter: next.status,
  });
  if (input.nextStatus === "accepted" && allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1") {
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
  logLocalMarketplaceDiagnostic("info", "[trade-consistency] mutation db-write-start", {
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    nextStatus: input.nextStatus,
  });
  // For trust-affecting transitions, write only the core trade tables synchronously so the
  // response returns quickly (≤5s target). Trust-related tables (user profiles, snapshots,
  // activity logs) are written in a deferred task via after() in the route handler.
  try {
    await writeDb(db, {
      traceTag: debugTradeRoom && isUsdtSentTrace ? input.traceId : undefined,
      selectedTables: shouldRecalculateTrust ? TRADE_COMPLETION_CORE_TABLES : TRADE_STATUS_BASE_TABLES,
      // A snapshot can become stale between validation and the repository's
      // cross-instance advisory lock. Reject only relevant stale state here,
      // then rerun the whole business transition from the canonical snapshot.
      // This prevents Accept-vs-Cancel races, duplicate lifecycle effects, and
      // accepting two buyers for one listing while preserving unrelated writes.
      validateLatestBeforeCommit: (canonicalSnapshot) => {
        const canonicalRequest = canonicalSnapshot.purchaseRequests.find((candidate) => candidate.id === request.id);
        if (!canonicalRequest || canonicalRequest.status !== stateBefore) {
          throw new ConcurrentTradeMutationError();
        }

        const canonicalListing = canonicalSnapshot.marketplaceListings.find((candidate) => candidate.id === request.listingId);
        const listingChanged = listingCommitBasis
          ? !canonicalListing
            || canonicalListing.id !== listingCommitBasis.id
            || canonicalListing.status !== listingCommitBasis.status
            || canonicalListing.activeTradeRequestId !== listingCommitBasis.activeTradeRequestId
            || canonicalListing.availableAmount !== listingCommitBasis.availableAmount
            || canonicalListing.updatedAt !== listingCommitBasis.updatedAt
          : Boolean(canonicalListing);
        if (listingChanged) {
          throw new ConcurrentTradeMutationError();
        }

        if (input.nextStatus === "accepted") {
          const canonicalPendingCommissionCount = getSellerPendingCommissionCount(canonicalSnapshot, request.sellerId);
          const canonicalPendingSiblingIds = canonicalSnapshot.purchaseRequests
            .filter((candidate) => candidate.id !== request.id && candidate.listingId === request.listingId && candidate.status === "pending")
            .map((candidate) => candidate.id)
            .sort();
          if (
            canonicalPendingCommissionCount !== pendingCommissionCountAtRead
            || canonicalPendingSiblingIds.length !== pendingSiblingRequestIdsAtRead.length
            || canonicalPendingSiblingIds.some((id, index) => id !== pendingSiblingRequestIdsAtRead[index])
          ) {
            throw new ConcurrentTradeMutationError();
          }
        }
      },
    });
  } catch (error) {
    if (error instanceof ConcurrentTradeMutationError && concurrencyRetryCount < 2) {
      return updatePurchaseRequestStatusAttempt(input, concurrencyRetryCount + 1);
    }
    if (error instanceof ConcurrentTradeMutationError) {
      throw new TradeBlockedError(
        "concurrent-status-change",
        "This trade changed while your action was being saved. Refresh the Trade Room and try again.",
        input.requestId,
        { guard: "canonical-transition-retry", nextStatus: input.nextStatus },
      );
    }
    throw error;
  }
  const writeDbMs = Date.now() - beforeWriteMs;
  await dispatchCommittedSms(db, priorSmsCount);
  logLocalMarketplaceDiagnostic("info", "[trade-consistency] mutation commit-complete", {
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
  logLocalMarketplaceDiagnostic("info", "[trade-consistency] mutation sse-publish", {
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
    statusChanged: true,
    additionallyDeclinedRequests,
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
  logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-key-diagnostics", {
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

  logLocalMarketplaceDiagnostic("info", "[commission-verify] rpc-fallback-start", { network: input.network, rpcUrl, txHash });

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
    logLocalMarketplaceDiagnostic("info", "[commission-verify] rpc-transfer-not-found", {
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
  logLocalMarketplaceDiagnostic("info", "[commission-verify] rpc-verified", {
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
  const configuredConfirmations = Number(process.env.ALPHA_EXCHANGE_EVM_MIN_CONFIRMATIONS ?? "3");
  const minConfirmations = isProductionSecurityRuntime()
    ? Math.max(3, Number.isFinite(configuredConfirmations) ? configuredConfirmations : 3)
    : Math.max(1, Number.isFinite(configuredConfirmations) ? configuredConfirmations : 3);

  // Log key presence on every attempt so Vercel logs show configuration status.
  logEvmKeyDiagnostics(input.network, Boolean(apiKey));
  logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-lookup-start", {
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
      logLocalMarketplaceDiagnostic("error", "[commission-verify] evm-api-error-will-fallback", {
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
        logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-pending", { network: input.network, txHash: input.txHash });
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
              logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-wrong-network", { selected: input.network, actual: otherNetwork, txHash: input.txHash });
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
      logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-not-found", { network: input.network, txHash: input.txHash });
      return { verified: false, reference: input.txHash, notes: `Transaction was not found on the selected ${networkLabel} network. Please verify the hash and selected network.` };
    }

    const receipt = data.result as EvmTxReceipt;
    const rawStatus = receipt.status;
    const statusInt = typeof rawStatus === "string"
      ? Number.parseInt(rawStatus, 16)
      : (typeof rawStatus === "number" ? rawStatus : -1);
    if (statusInt !== 1) {
      logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-tx-failed", { network: input.network, txHash: input.txHash, rawStatus });
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
      logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-insufficient-confirmations", { network: input.network, txHash: input.txHash, confirmations, minConfirmations });
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
      logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-transfer-not-found", {
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
      logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-insufficient-amount", { network: input.network, txHash: input.txHash, token: tokenMeta.symbol, amountReceived, amountDueUsdt: input.amountDueUsdt });
      return { verified: false, reference: input.txHash, notes: `Insufficient payment. Received ${amountReceived.toFixed(2)} ${tokenMeta.symbol} on ${networkLabel}, but ${input.amountDueUsdt.toFixed(2)} USD is required.` };
    }
    logLocalMarketplaceDiagnostic("info", "[commission-verify] evm-verified", { network: input.network, txHash: input.txHash, token: tokenMeta.symbol, amountReceived, confirmations, via: "explorer" });
    return { verified: true, reference: input.txHash, notes: `Verified: ${amountReceived.toFixed(2)} ${tokenMeta.symbol} received on ${networkLabel}.` };
  } catch (explorerError) {
    primaryError = explorerError instanceof Error ? explorerError.message : String(explorerError);
    logLocalMarketplaceDiagnostic("warn", "[commission-verify] evm-explorer-failed-trying-rpc", { network: input.network, txHash: input.txHash, error: primaryError });
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
    logLocalMarketplaceDiagnostic("error", "[commission-verify] evm-both-verifiers-failed", {
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

  logLocalMarketplaceDiagnostic("info", "[commission-verify] solana-usdt-received", {
    amountReceived: received,
    recipientWalletAddress: input.recipientWalletAddress,
  });
  return { verified: true, reference: input.txHash, notes: `Verified: ${received.toFixed(2)} USDT received on Solana.` };
}

/**
 * A transaction's EVM checksum casing is display-only. Use a stable key for
 * duplicate settlement detection while preserving the submitted signature for
 * display and chain verification. Solana/base58 signatures remain case-sensitive.
 */
function getCommissionPaymentSignatureKey(raw: string) {
  const normalized = normalizeTransactionHash(raw);
  return /^0x[a-fA-F0-9]{64}$/.test(normalized) ? normalized.toLowerCase() : normalized;
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
  const transactionSignatureKey = getCommissionPaymentSignatureKey(txHash);
  const logCtx = { txHash, network: input.network, amountDue: input.amountDue, payerWallet: input.payerWalletAddress };
  logLocalMarketplaceDiagnostic("info", "[commission-verify] verification-started", logCtx);

  // 1. Format check
  if (txHash.length < 24) {
    logLocalMarketplaceDiagnostic("info", "[commission-verify] rejected:hash-too-short", logCtx);
    return { verified: false, reference: txHash, notes: "Transaction hash is too short to be valid." };
  }
  if ((input.network === "ERC20" || input.network === "POLYGON") && !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    logLocalMarketplaceDiagnostic("info", "[commission-verify] rejected:invalid-evm-hash-format", logCtx);
    return { verified: false, reference: txHash, notes: "Invalid transaction hash for the selected EVM network. Please paste the full 0x transaction hash." };
  }
  if (input.network === "SOL" && !/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(txHash)) {
    logLocalMarketplaceDiagnostic("info", "[commission-verify] rejected:invalid-solana-sig-format", logCtx);
    return { verified: false, reference: txHash, notes: "Invalid Solana transaction signature. Please paste the full transaction signature from your wallet or explorer." };
  }

  // 2. Duplicate hash check — prevent re-use of a previously accepted transaction
  if (input.existingSignatures?.includes(transactionSignatureKey)) {
    logLocalMarketplaceDiagnostic("info", "[commission-verify] rejected:duplicate-hash", logCtx);
    return { verified: false, reference: txHash, notes: "This transaction hash has already been used for a previous commission payment." };
  }

  // 3. Recipient must be configured
  if (!input.recipientWalletAddress || input.recipientWalletAddress === "AT-COMMISSION-WALLET") {
    logLocalMarketplaceDiagnostic("error", "[commission-verify] rejected:recipient-not-configured", logCtx);
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
      logLocalMarketplaceDiagnostic("info", "[commission-verify] rejected:unsupported-network", logCtx);
      result = { verified: false, reference: txHash, notes: `Network '${input.network}' is not supported. Accepted: ERC20, POLYGON, SOL.` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logLocalMarketplaceDiagnostic("error", "[commission-verify] blockchain-service-error", { ...logCtx, error: msg });
    return { verified: false, reference: txHash, notes: "Blockchain verification service temporarily unavailable. Please try again in a few minutes." };
  }
  logLocalMarketplaceDiagnostic("info", "[commission-verify] verification-complete", {
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
  network: string;
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

  const { resolveCommissionWalletForNetwork } = await import("@/lib/commission-config");
  const commissionWallet = resolveCommissionWalletForNetwork(input.network);
  if (!commissionWallet.available) {
    // Configuration failures must not create a payment attempt record pointing
    // at an unrelated generic wallet or a placeholder recipient.
    throw new Error(commissionWallet.error);
  }

  const verificationStartedAt = Date.now();
  const chosenNetwork = commissionWallet.network;
  const recipientWalletAddress = commissionWallet.walletAddress;

  // Collect all previously accepted tx hashes to prevent re-use
  const existingSignatures = db.commissionRecords
    .filter((r) => r.paymentVerificationStatus === "verified" && r.paymentSignature)
    .map((r) => getCommissionPaymentSignatureKey(r.paymentSignature as string));

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
  const normalizedPaymentSignature = getCommissionPaymentSignatureKey(input.paymentSignature);
  const applyCommissionPaymentToCanonicalSnapshot = async (snapshot: AlphaExchangeDb) => {
    const canonicalIndex = snapshot.commissionRecords.findIndex((record) => record.id === input.commissionId);
    if (canonicalIndex === -1) throw new Error("Commission record not found.");
    const canonicalRecord = snapshot.commissionRecords[canonicalIndex];
    if (canonicalRecord.sellerId !== input.sellerUserId) {
      throw new Error("You can only settle your own commission.");
    }
    if (normalizeCommissionPaymentStatus(canonicalRecord.paymentStatus, canonicalRecord.dueAt) === "paid") {
      throw new Error("This commission is already settled.");
    }

    const canonicalAmountDueUsdt = getCommissionAmountDueUsdt(snapshot, canonicalRecord);
    if (Math.abs(canonicalAmountDueUsdt - amountDueUsdt) > 0.000001) {
      throw new Error("The commission amount changed. Please refresh and try again.");
    }
    if (verification.verified && snapshot.commissionRecords.some((record) => (
      record.id !== canonicalRecord.id
      && record.paymentVerificationStatus === "verified"
      && getCommissionPaymentSignatureKey(record.paymentSignature ?? "") === normalizedPaymentSignature
    ))) {
      throw new Error("This transaction hash has already been used for a previous commission payment.");
    }

    const now = nowIso();
    const nextRecord: CommissionRecord = {
      ...canonicalRecord,
      paymentProvider: "crypto_wallet",
      paymentNetwork: chosenNetwork,
      payerWalletAddress: input.payerWalletAddress.trim() || undefined,
      recipientWalletAddress,
      paymentSignature: input.paymentSignature.trim(),
      paymentSubmittedAt: now,
      paymentVerificationStatus: verification.verified ? "verified" : "failed",
      paymentVerificationNotes: verification.notes,
      paymentStatus: verification.verified ? "paid" : canonicalRecord.paymentStatus,
      paidAt: verification.verified ? now : canonicalRecord.paidAt,
      updatedAt: now,
    };
    snapshot.commissionRecords[canonicalIndex] = nextRecord;

    await appendAuditLog(snapshot, {
      action: verification.verified ? "commission_paid" : "commission_recorded",
      actorUserId: input.sellerUserId,
      targetUserId: canonicalRecord.sellerId,
      listingId: canonicalRecord.listingId,
      purchaseRequestId: canonicalRecord.purchaseRequestId,
      details: verification.verified
        ? `Commission ${canonicalRecord.id} verified via ${chosenNetwork}. Amount: ${canonicalAmountDueUsdt.toFixed(2)} USDT. Tx: ${input.paymentSignature.trim()}.`
        : `Commission ${canonicalRecord.id} payment rejected via ${chosenNetwork}. Tx: ${input.paymentSignature.trim()}. Reason: ${verification.notes}`,
    });

    const notificationPublications: DeferredNotificationPublication[] = [];
    const request = snapshot.purchaseRequests.find((item) => item.id === canonicalRecord.purchaseRequestId);
    if (verification.verified && request) {
      appendTradeTimelineEntry(request, {
        type: "commission_paid",
        actorUserId: input.sellerUserId,
        actorRole: resolveActorRole(snapshot, input.sellerUserId),
        message: `Commission paid on-chain (${canonicalAmountDueUsdt.toFixed(2)} USDT).`,
        createdAt: now,
      });
    }
    if (verification.verified) {
      const sellerPublication = pushNotification(snapshot, {
        userId: canonicalRecord.sellerId,
        category: "trade",
        title: "Commission payment verified",
        message: `Your commission payment for trade ${canonicalRecord.purchaseRequestId} was verified. Your account is now fully unlocked.`,
        relatedTradeId: canonicalRecord.purchaseRequestId,
        relatedListingId: canonicalRecord.listingId,
        relatedHref: "/usdt-exchange",
        deferRealtime: true,
      });
      if (sellerPublication) notificationPublications.push(sellerPublication);

      const ownerUser = snapshot.users.find((user) => isAlphaExchangeOwnerEmail(user.email));
      if (ownerUser) {
        const ownerPublication = pushNotification(snapshot, {
          userId: ownerUser.id,
          category: "system",
          title: "Commission payment received",
          message: `Commission ${canonicalRecord.id} paid via ${chosenNetwork}. Amount: ${canonicalAmountDueUsdt.toFixed(2)} USDT. Tx: ${input.paymentSignature.trim()}`,
          relatedTradeId: canonicalRecord.purchaseRequestId,
          relatedListingId: canonicalRecord.listingId,
          relatedHref: adminCommissionDestination(canonicalRecord.id),
          actionHref: adminCommissionDestination(canonicalRecord.id),
          actionLabel: "Review Commission",
          deferRealtime: true,
        });
        if (ownerPublication) notificationPublications.push(ownerPublication);
      }
    }

    return { commission: nextRecord, request, notificationPublications };
  };

  let committed = await applyCommissionPaymentToCanonicalSnapshot(db);
  const businessMs = Date.now() - businessStartedAt;

  const writeStartedAt = Date.now();
  await writeDb(db, {
    selectedTables: COMMISSION_PAYMENT_TABLES,
    rebaseOnLatest: async (persistedSnapshot) => {
      committed = await applyCommissionPaymentToCanonicalSnapshot(persistedSnapshot);
      return persistedSnapshot;
    },
  });
  const writeMs = Date.now() - writeStartedAt;
  if (verification.verified && committed.request) {
    publishRealtimeEvent({
      type: "trade.status_changed",
      payload: { request: enrichRequestWithEvidence(db, committed.request) },
    });
  }
  for (const publication of committed.notificationPublications) {
    publishNotificationPublication(publication);
  }
  return {
    commission: committed.commission,
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
  titleEn: string;
  messageEn: string;
  titleAr: string;
  messageAr: string;
  type: BetaAnnouncementType;
}) {
  const db = await readDb();
  const titleEn = announcementText(input.titleEn);
  const messageEn = announcementText(input.messageEn);
  const titleAr = announcementText(input.titleAr);
  const messageAr = announcementText(input.messageAr);
  if (!titleEn || !messageEn || !titleAr || !messageAr) {
    throw new Error("English and Arabic announcement titles and messages are required.");
  }
  if (titleEn.length > 160 || titleAr.length > 160) throw new Error("Announcement titles must be 160 characters or fewer.");
  if (messageEn.length > 2000 || messageAr.length > 2000) throw new Error("Announcement messages must be 2000 characters or fewer.");
  const announcement: BetaAnnouncement = {
    id: `announcement-${randomUUID()}`,
    // Older clients continue to receive useful English aliases.
    title: titleEn,
    message: messageEn,
    titleEn,
    messageEn,
    titleAr,
    messageAr,
    type: input.type,
    isActive: true,
    createdByUserId: input.ownerUserId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.betaAnnouncements.unshift(announcement);
  for (const user of db.users) {
    if (!user.isFoundingMember) continue;
    const userLocale = normalizePreferredLocale(user.preferredLocale);
    const copy = getLocalizedBetaAnnouncementCopy(announcement, userLocale);
    const notificationTitleEn = `Marketplace announcement: ${titleEn}`;
    const notificationTitleAr = `إعلان السوق: ${titleAr}`;
    pushNotification(db, {
      userId: user.id,
      category: "system",
      title: userLocale === "ar" ? notificationTitleAr : notificationTitleEn,
      message: copy.message.slice(0, 140),
      titleEn: notificationTitleEn,
      messageEn: messageEn.slice(0, 140),
      titleAr: notificationTitleAr,
      messageAr: messageAr.slice(0, 140),
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

export async function getActiveBetaAnnouncements(locale?: BetaAnnouncementLocale) {
  const db = await readDb();
  const active = db.betaAnnouncements.filter((item) => item.isActive);
  if (!locale) return active;
  return active.map((announcement) => ({
    ...announcement,
    ...getLocalizedBetaAnnouncementCopy(announcement, locale),
  }));
}

export function isAdminAnnouncementAudience(value: string): value is AdminAnnouncementAudience {
  return value === "all_verified_users"
    || value === "buyers"
    || value === "approved_sellers"
    || value === "administrators";
}

function requireAnnouncementAdmin(db: AlphaExchangeDb, userId: string) {
  const user = db.users.find((candidate) => candidate.id === userId);
  if (!user || (!hasRole(user, "admin") && !hasRole(user, "owner"))) {
    throw new Error("Administrator access required.");
  }
  return user;
}

export function selectAdminAnnouncementRecipients(
  users: AlphaExchangeUser[],
  audience: AdminAnnouncementAudience,
) {
  const matching = users.filter((user) => {
    if (user.emailVerified !== true || user.disabled === true || !user.email.trim()) return false;
    if (audience === "all_verified_users") return true;
    if (audience === "approved_sellers") return hasRole(user, "approved_seller");
    if (audience === "administrators") return hasRole(user, "admin") || hasRole(user, "owner");
    return (user.role === "buyer" || (user.roles ?? []).includes("buyer"))
      && !hasRole(user, "approved_seller")
      && !hasRole(user, "admin")
      && !hasRole(user, "owner");
  });

  const byEmail = new Map<string, AlphaExchangeUser>();
  for (const user of matching.sort((left, right) => left.id.localeCompare(right.id))) {
    const normalizedEmail = user.email.trim().toLowerCase();
    if (!byEmail.has(normalizedEmail)) byEmail.set(normalizedEmail, user);
  }
  return [...byEmail.values()].map((user) => ({
    userId: user.id,
    email: user.email.trim().toLowerCase(),
    name: user.fullName.trim() || "Trader",
  }));
}

export async function getAdminAnnouncementOverview(audience: AdminAnnouncementAudience) {
  const db = await readDb();
  return {
    recipientCount: selectAdminAnnouncementRecipients(db.users, audience).length,
    runs: [...db.adminAnnouncementRuns]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 20),
  };
}

export async function createAdminAnnouncementRun(input: {
  adminUserId: string;
  requestKey: string;
  audience: AdminAnnouncementAudience;
  expectedRecipientCount: number;
  content: AdminAnnouncementEmailContent;
}) {
  const db = await readDb({ bypassCache: true });
  requireAnnouncementAdmin(db, input.adminUserId);
  const requestKey = input.requestKey.trim();
  if (!/^[a-f0-9-]{36}$/i.test(requestKey)) throw new Error("A valid announcement request key is required.");
  const existing = db.adminAnnouncementRuns.find((run) => (
    run.createdByUserId === input.adminUserId && run.requestKey === requestKey
  ));
  if (existing) return existing;
  const content = validateAdminAnnouncementContent(input.content);
  const recipients = selectAdminAnnouncementRecipients(db.users, input.audience);
  if (recipients.length === 0) throw new Error("No verified recipients match this audience.");
  if (recipients.length !== input.expectedRecipientCount) {
    throw new Error(`Recipient count changed from ${input.expectedRecipientCount} to ${recipients.length}. Review the audience before sending.`);
  }

  const timestamp = nowIso();
  const run: AdminAnnouncementRun = {
    id: `admin-announcement-${requestKey}`,
    requestKey,
    audience: input.audience,
    ...content,
    status: "queued",
    recipientCount: recipients.length,
    successCount: 0,
    failureCount: 0,
    retryCount: 0,
    recipients: recipients.map((recipient, index) => ({
      ...recipient,
      status: "pending",
      batchIndex: Math.floor(index / ANNOUNCEMENT_BATCH_SIZE),
    })),
    createdByUserId: input.adminUserId,
    startedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.adminAnnouncementRuns.unshift(run);
  await appendAuditLog(db, {
    action: "admin_announcement_started",
    actorUserId: input.adminUserId,
    details: `Started announcement ${run.id} for ${run.audience} with ${run.recipientCount} recipients.`,
    newValue: {
      announcementId: run.id,
      audience: run.audience,
      recipientCount: run.recipientCount,
      startedAt: run.startedAt,
    },
  });
  await writeDb(db, { selectedTables: ADMIN_ANNOUNCEMENT_TABLES });
  return run;
}

const ANNOUNCEMENT_BATCH_SIZE = 50;
const ANNOUNCEMENT_LOCK_TIMEOUT_MS = 5 * 60_000;
const ANNOUNCEMENT_AUTO_RESUME_DELAY_MS = 5_000;
const ANNOUNCEMENT_MAX_RECIPIENT_ATTEMPTS = 15;

export function selectPendingAdminAnnouncementBatch(recipients: AdminAnnouncementRecipient[]) {
  const firstPendingRecipient = recipients.find((recipient) => recipient.status === "pending");
  if (!firstPendingRecipient) return [];
  return recipients.filter((recipient) => (
    recipient.status === "pending" && recipient.batchIndex === firstPendingRecipient.batchIndex
  )).slice(0, ANNOUNCEMENT_BATCH_SIZE);
}

export function getAdminAnnouncementProviderBatchKey(runId: string, batchIndex: number) {
  return `${runId}-batch-${batchIndex}`.slice(0, 256);
}

export async function deliverAdminAnnouncementBatch(input: {
  adminUserId: string;
  announcementId: string;
}) {
  let db = await readDb({ bypassCache: true });
  requireAnnouncementAdmin(db, input.adminUserId);
  let runIndex = db.adminAnnouncementRuns.findIndex((candidate) => candidate.id === input.announcementId);
  if (runIndex === -1) throw new Error("Announcement delivery run not found.");
  const current = db.adminAnnouncementRuns[runIndex];
  if (current.finishedAt) return current;
  if (current.nextRetryAt) {
    const retryDelayMs = new Date(current.nextRetryAt).getTime() - Date.now();
    if (retryDelayMs > 0) return current;
  }

  const lockedAt = current.batchLockedAt ? new Date(current.batchLockedAt).getTime() : 0;
  if (lockedAt && Number.isFinite(lockedAt) && Date.now() - lockedAt < ANNOUNCEMENT_LOCK_TIMEOUT_MS) {
    throw new Error("An announcement batch is already being delivered.");
  }

  const batch = selectPendingAdminAnnouncementBatch(current.recipients);
  const firstPendingRecipient = batch[0];
  if (batch.length === 0) throw new Error("Announcement has no pending recipients.");
  const batchLockId = randomUUID();
  current.status = "sending";
  current.batchLockedAt = nowIso();
  current.batchLockId = batchLockId;
  current.nextRetryAt = undefined;
  current.updatedAt = current.batchLockedAt;
  const repository = await getAlphaExchangeRepository();
  const lockAcquired = await repository.acquireAdminAnnouncementBatchLock({
    run: current,
    staleBefore: new Date(Date.now() - ANNOUNCEMENT_LOCK_TIMEOUT_MS).toISOString(),
  });
  if (!lockAcquired) throw new Error("An announcement batch is already being delivered.");
  dbCache = null;

  const providerBatchKey = getAdminAnnouncementProviderBatchKey(current.id, firstPendingRecipient?.batchIndex ?? 0);
  const batchResult = await sendAdminAnnouncementBatch({
    recipients: batch.map((recipient) => ({ userId: recipient.userId, email: recipient.email })),
    subject: current.subject,
    title: current.title,
    content: current.content,
    ctaText: current.ctaText,
    ctaUrl: current.ctaUrl,
    idempotencyKey: providerBatchKey,
  });

  db = await readDb({ bypassCache: true });
  requireAnnouncementAdmin(db, input.adminUserId);
  runIndex = db.adminAnnouncementRuns.findIndex((candidate) => candidate.id === input.announcementId);
  if (runIndex === -1) throw new Error("Announcement delivery run not found after delivery.");
  const run = db.adminAnnouncementRuns[runIndex];
  if (run.batchLockId !== batchLockId) {
    throw new Error("Announcement delivery lock changed before results could be recorded.");
  }
  const attemptedAt = nowIso();
  let hasRetryableFailure = false;
  let requiresManualConfiguration = false;
  let automaticRetryDelayMs = 0;
  const providerStatus = "providerStatus" in batchResult ? batchResult.providerStatus : undefined;
  const retryable = !batchResult.ok && isRetryableAnnouncementDeliveryFailure({
    reason: batchResult.reason,
    providerStatus,
  });
  const providerAttempts = "attempts" in batchResult && typeof batchResult.attempts === "number"
    ? batchResult.attempts
    : 1;
  const providerRetryCount = "retryCount" in batchResult && typeof batchResult.retryCount === "number"
    ? batchResult.retryCount
    : 0;
  const providerRetryAfterMs = "retryAfterMs" in batchResult && typeof batchResult.retryAfterMs === "number"
    ? batchResult.retryAfterMs
    : 0;
  for (const attemptedRecipient of batch) {
    const recipient = run.recipients.find((candidate) => candidate.userId === attemptedRecipient.userId);
    if (!recipient) continue;
    recipient.attemptedAt = attemptedAt;
    const legacyFailedAttemptCount = recipient.attemptCount === undefined && recipient.failureReason ? 1 : 0;
    const legacyRetryCount = recipient.retryCount === undefined && recipient.failureReason ? 1 : 0;
    recipient.attemptCount = (recipient.attemptCount ?? legacyFailedAttemptCount) + providerAttempts;
    recipient.retryCount = Math.max(
      (recipient.retryCount ?? legacyRetryCount) + providerRetryCount,
      recipient.attemptCount - 1,
    );
    recipient.lastRetryAfterMs = providerRetryAfterMs > 0
      ? providerRetryAfterMs
      : recipient.lastRetryAfterMs;
    recipient.lastBatchKey = providerBatchKey;
    if (batchResult.ok) {
      recipient.status = "sent";
      recipient.failureReason = undefined;
      recipient.providerStatus = undefined;
      recipient.providerEmailId = batchResult.deliveries.find((delivery) => delivery.userId === recipient.userId)?.providerEmailId;
      continue;
    }
    const retryBudgetRemaining = batchResult.reason === "resend_not_configured"
      || (recipient.attemptCount ?? 0) < ANNOUNCEMENT_MAX_RECIPIENT_ATTEMPTS;
    const willRetry = retryable && retryBudgetRemaining;
    recipient.status = willRetry ? "pending" : "failed";
    recipient.failureReason = retryable && !retryBudgetRemaining
      ? `${batchResult.reason}_retry_exhausted`
      : batchResult.reason;
    recipient.providerStatus = providerStatus;
    hasRetryableFailure ||= willRetry;
    requiresManualConfiguration ||= batchResult.reason === "resend_not_configured";
    if (willRetry && batchResult.reason !== "resend_not_configured") {
      automaticRetryDelayMs = Math.max(
        automaticRetryDelayMs,
        providerRetryAfterMs,
        ANNOUNCEMENT_AUTO_RESUME_DELAY_MS,
      );
    }
  }
  run.successCount = run.recipients.filter((recipient) => recipient.status === "sent").length;
  run.failureCount = run.recipients.filter((recipient) => recipient.status === "failed").length;
  run.retryCount = run.recipients.reduce((total, recipient) => total + (recipient.retryCount ?? 0), 0);
  run.lastProviderRequestAt = "lastAttemptAt" in batchResult
    ? batchResult.lastAttemptAt
    : attemptedAt;
  run.batchLockedAt = undefined;
  run.batchLockId = undefined;
  run.updatedAt = attemptedAt;
  const hasPending = run.recipients.some((recipient) => recipient.status === "pending");
  run.nextRetryAt = hasRetryableFailure && !requiresManualConfiguration
    ? new Date(Date.now() + automaticRetryDelayMs).toISOString()
    : undefined;
  if (!hasPending) {
    const status: AdminAnnouncementStatus = run.failureCount === 0
      ? "completed"
      : run.successCount === 0
        ? "failed"
        : "partial_failure";
    run.status = status;
    run.finishedAt = attemptedAt;
  }
  const committed = await repository.commitAdminAnnouncementBatch({ run, batchLockId });
  if (!committed) throw new Error("Announcement delivery results could not be committed safely.");
  dbCache = null;

  if (run.finishedAt) {
    const auditDb = await readDb({ bypassCache: true });
    await appendAuditLog(auditDb, {
      action: "admin_announcement_completed",
      actorUserId: input.adminUserId,
      details: `Finished announcement ${run.id}: ${run.successCount} succeeded and ${run.failureCount} failed.`,
      newValue: {
        announcementId: run.id,
        audience: run.audience,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        successCount: run.successCount,
        failureCount: run.failureCount,
        retryCount: run.retryCount,
      },
    });
    await writeDb(auditDb, { selectedTables: AUDIT_LOG_ONLY_TABLES });
  }
  if (requiresManualConfiguration) {
    throw new Error("Announcement delivery paused because Resend email configuration is unavailable.");
  }
  return run;
}

export async function sendAdminAnnouncementTest(input: {
  adminUserId: string;
  recipientEmail: string;
  content: AdminAnnouncementEmailContent;
}) {
  const db = await readDb({ bypassCache: true });
  requireAnnouncementAdmin(db, input.adminUserId);
  const email = input.recipientEmail.trim().toLowerCase();
  const recipient = db.users.find((user) => (
    user.email.trim().toLowerCase() === email
    && user.emailVerified === true
    && user.disabled !== true
  ));
  if (!recipient) throw new Error("Test recipient must be an active, verified registered user.");
  const content = validateAdminAnnouncementContent(input.content);
  return sendAdminAnnouncementEmail({
    ...content,
    to: recipient.email,
    idempotencyKey: `admin-announcement-test-${input.adminUserId}-${randomUUID()}`,
  });
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
  /** Used by SSE reconciliation when another server instance may have written. */
  strongConsistency?: boolean;
}) {
  const db = await readDb({ bypassCache: input.strongConsistency === true });

  // Build the display-number lookup ONCE for the entire function so that every
  // enrichNotification call below shares it rather than rebuilding it per call.
  const sharedDisplayLookup = createExchangeDisplayLookup({
    listings: db.marketplaceListings,
    requests: db.purchaseRequests,
    commissions: db.commissionRecords,
    disputes: db.disputes,
    applications: db.sellerApplications,
  });

  // Keep read paths side-effect free. Notifications should only transition
  // state through explicit user/admin actions, not while listing data.
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
      const haystack = `${notification.title} ${notification.message} ${notification.relatedSellerName ?? ""} ${notification.relatedSellerUsername ?? ""} ${notification.relatedTradeId ?? ""} ${notification.relatedRequestId ?? ""} ${notification.relatedListingId ?? ""} ${notification.tradeSnapshot?.counterpartyName ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  const sortedNotifications = [...notifications].sort((left, right) => {
    const leftUnread = left.state === "unread" ? 0 : left.state === "read" ? 1 : 2;
    const rightUnread = right.state === "unread" ? 0 : right.state === "read" ? 1 : 2;
    if (leftUnread !== rightUnread) return leftUnread - rightUnread;
    const createdDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (createdDelta !== 0) return createdDelta;
    const leftRank = typeof left.priorityRank === "number" ? left.priorityRank : 99;
    const rightRank = typeof right.priorityRank === "number" ? right.priorityRank : 99;
    return leftRank - rightRank;
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
  if (input.preferences.sms === true && !hasVerifiedPhoneForSms(db.users[index])) {
    throw new Error("Verify a phone number before enabling SMS notifications.");
  }
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

export async function updateSmsDeliveryStatus(input: { deliveryId?: string; messageSid: string; status: SmsDeliveryStatus; providerStatus: string }) {
  const db = await readDb({ bypassCache: true });
  const index = (db.smsDeliveries ?? []).findIndex((item) =>
    (input.deliveryId && item.id === input.deliveryId) || item.twilioMessageSid === input.messageSid
  );
  if (index < 0) return false;
  const current = db.smsDeliveries![index];
  const status = resolveSmsDeliveryStatusTransition(current.status, input.status);
  if (status === current.status && input.status !== current.status) return false;
  const now = nowIso();
  db.smsDeliveries![index] = {
    ...current,
    status,
    twilioMessageSid: current.twilioMessageSid ?? input.messageSid,
    providerStatus: input.providerStatus,
    updatedAt: now,
    deliveredAt: status === "delivered" ? (current.deliveredAt ?? now) : current.deliveredAt,
    failedAt: status === "failed" ? (current.failedAt ?? now) : current.failedAt,
  };
  await writeDb(db, { selectedTables: ["sms_deliveries"] });
  return true;
}

export function toAdminSmsDelivery(delivery: SmsDeliveryRecord) {
  const lastError = delivery.lastError?.replace(/\+[1-9]\d{7,14}/g, (phone) => (
    phone.length > 5 ? `${phone.slice(0, 3)}•••${phone.slice(-2)}` : "••••"
  ));
  return {
    id: delivery.id,
    eventKey: delivery.eventKey,
    eventType: delivery.eventType,
    recipientUserId: delivery.recipientUserId,
    recipientPhoneMasked: delivery.recipientPhone.length > 5
      ? `${delivery.recipientPhone.slice(0, 3)}•••${delivery.recipientPhone.slice(-2)}`
      : "••••",
    status: delivery.status,
    retryCount: delivery.retryCount,
    twilioMessageSid: delivery.twilioMessageSid,
    providerStatus: delivery.providerStatus,
    lastError,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    sentAt: delivery.sentAt,
    deliveredAt: delivery.deliveredAt,
    failedAt: delivery.failedAt,
  };
}

export async function getSmsDeliveriesForAdmin() {
  const db = await readDb();
  return (db.smsDeliveries ?? [])
    .map(toAdminSmsDelivery)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 100);
}

export async function openTradeDispute(input: {
  purchaseRequestId: string;
  openedByUserId: string;
  reason: string;
}) {
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new Error("Dispute reason is required.");
  if (reason.length > 500) throw new Error("Dispute reason is too long.");
  assertNoExchangeDirectContact(reason);
  const db = await readDb();
  const priorSmsCount = db.smsDeliveries?.length ?? 0;
  let committed: { dispute: TradeDisputeCase; request: PurchaseRequest; created: boolean } | null = null;

  const applyDisputeToCanonicalSnapshot = async (snapshot: AlphaExchangeDb) => {
    const request = snapshot.purchaseRequests.find((item) => item.id === input.purchaseRequestId);
    if (!request) throw new Error("Trade not found.");
    const isParticipant = request.buyerId === input.openedByUserId || request.sellerId === input.openedByUserId;
    if (!isParticipant) throw new Error("Only trade participants can open a dispute.");
    if (request.status === "pending" || request.status === "declined" || request.status === "cancelled") {
      throw new Error("Dispute can be opened only after trade is accepted.");
    }

    const existingOpen = snapshot.disputes.find((item) => item.purchaseRequestId === request.id && item.status === "open");
    if (existingOpen) {
      if (existingOpen.openedByUserId !== input.openedByUserId || existingOpen.reason !== reason) {
        throw new Error("An open dispute already exists for this trade.");
      }
      committed = { dispute: existingOpen, request, created: false };
      return snapshot;
    }

    const dispute: TradeDisputeCase = {
      id: `dispute-${randomUUID()}`,
      tradeId: request.tradeId ?? request.id,
      purchaseRequestId: request.id,
      openedByUserId: input.openedByUserId,
      sellerId: request.sellerId,
      buyerId: request.buyerId,
      reason,
      buyerEvidenceId: getTradeEvidenceFile(snapshot, request.id, "buyer")?.id,
      sellerEvidenceId: getTradeEvidenceFile(snapshot, request.id, "seller")?.id,
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    snapshot.disputes.unshift(dispute);
    appendTradeTimelineEntry(request, {
      type: "dispute_opened",
      actorUserId: input.openedByUserId,
      actorRole: resolveActorRole(snapshot, input.openedByUserId),
      message: "Dispute opened for this trade.",
      createdAt: dispute.createdAt,
    });

    for (const adminUser of getAdminNotificationRecipients(snapshot)) {
      pushNotification(snapshot, {
        userId: adminUser.id,
        category: "dispute",
        title: "Dispute opened",
        message: `Dispute opened for trade ${dispute.tradeId}.`,
        relatedTradeId: dispute.tradeId,
        relatedHref: adminPurchaseRequestsDestination(request.id),
        actionHref: adminPurchaseRequestsDestination(request.id),
        actionLabel: "Review Trade",
        priority: "critical",
        forceInApp: true,
      });
      queueSmsDelivery(snapshot, {
        eventType: "trade_requires_admin_review",
        eventKey: `trade:${request.id}:admin-review:${adminUser.id}`,
        recipientUserId: adminUser.id,
        destinationPath: adminPurchaseRequestsDestination(request.id),
      });
    }
    pushNotification(snapshot, {
      userId: request.buyerId,
      category: "dispute",
      title: "Dispute opened",
      message: `A dispute was opened for trade ${dispute.tradeId}.`,
      relatedTradeId: dispute.tradeId,
      relatedHref: requestDetailsHref(request.id),
    });
    pushNotification(snapshot, {
      userId: request.sellerId,
      category: "dispute",
      title: "Dispute opened",
      message: `A dispute was opened for trade ${dispute.tradeId}.`,
      relatedTradeId: dispute.tradeId,
      relatedHref: requestDetailsHref(request.id),
    });
    pushActivityLog(snapshot, {
      userId: input.openedByUserId,
      category: "dispute",
      title: "Dispute opened",
      details: `Dispute opened for trade ${dispute.tradeId}.`,
    });
    committed = { dispute, request, created: true };
    return snapshot;
  };

  await applyDisputeToCanonicalSnapshot(db);
  let result = committed as { dispute: TradeDisputeCase; request: PurchaseRequest; created: boolean } | null;
  if (!result) throw new Error("Failed to prepare trade dispute.");
  if (result.created) {
    await writeDb(db, {
      selectedTables: DISPUTE_WRITE_TABLES,
      rebaseOnLatest: applyDisputeToCanonicalSnapshot,
    });
    result = committed as { dispute: TradeDisputeCase; request: PurchaseRequest; created: boolean } | null;
    if (!result) throw new Error("Failed to save trade dispute.");
  }
  if (result.created) {
    publishRealtimeEvent({
      type: "trade.status_changed",
      payload: { request: enrichRequestWithEvidence(db, result.request) },
    });
    await dispatchCommittedSms(db, priorSmsCount);
  }
  return result.dispute;
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
  assertNoExchangeDirectContact(reason);

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

export async function broadcastNotificationByAdmin(input: {
  titleEn: string;
  bodyEn: string;
  titleAr: string;
  bodyAr: string;
  type: "info" | "warning" | "success";
  actorUserId: string;
  reason?: string;
}) {
  const titleEn = announcementText(input.titleEn);
  const bodyEn = announcementText(input.bodyEn);
  const titleAr = announcementText(input.titleAr);
  const bodyAr = announcementText(input.bodyAr);
  if (!titleEn || !bodyEn || !titleAr || !bodyAr) {
    throw new Error("English and Arabic broadcast titles and messages are required.");
  }
  if (titleEn.length > 160 || titleAr.length > 160) {
    throw new Error("Broadcast titles must be 160 characters or fewer.");
  }
  if (bodyEn.length > 2000 || bodyAr.length > 2000) {
    throw new Error("Broadcast messages must be 2000 characters or fewer.");
  }

  const db = await readDb();
  for (const user of db.users) {
    const userLocale = normalizePreferredLocale(user.preferredLocale);
    pushNotification(db, {
      userId: user.id,
      category: "system",
      title: userLocale === "ar" ? titleAr : titleEn,
      message: userLocale === "ar" ? bodyAr : bodyEn,
      titleEn,
      messageEn: bodyEn,
      titleAr,
      messageAr: bodyAr,
      priority: input.type === "warning" ? "high" : "normal",
    });
  }
  await appendAuditLog(db, {
    action: "admin_override",
    actorUserId: input.actorUserId,
    details: `Broadcast notification sent: ${titleEn}`,
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
    .map((r) => r.paymentSignature ? getCommissionPaymentSignatureKey(r.paymentSignature) : undefined)
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

  const [summary, applications, approvedSellers, listings, purchaseRequests, commissionRecords, auditLogs, trustEngine, ownerBusiness, privateBeta, listingReliability, enforcement] = await Promise.all([
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
    getListingReliabilityForAdmin(db),
    getMarketplaceEnforcementDashboardData(db),
  ]);
  const notifications = [...db.notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250);
  const activityLog = [...db.activityLog].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250);
  const users = db.users.map((user) => toAdminUserSummary(user));
  const sellerReviews = db.sellerReviews ?? [];
  const complianceSettings = {
    recoveryWallet: getOwnerComplianceRecoveryWalletConfig(db),
  };

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
    listingReliability,
    enforcement,
    complianceSettings,
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
