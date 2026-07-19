import { promises as fs } from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { calculateSellerTrustSnapshot, rankTrustSnapshots } from "@/lib/trust-engine";
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
  NotificationPreferences,
  SellerPublicProfile,
  PremiumSellerProfileData,
  SellerReputationSnapshot,
  SellerStatus,
  SellerOnlineStatus,
  TradeDisputeCase,
  TradeEvidenceFile,
  TradeEvidenceSide,
  TradeTimelineEventType,
  OwnerPrivateBetaDashboardData,
  UserRole,
} from "@/types/alpha-exchange";

const dbPath = path.join(process.cwd(), "src", "data", "alpha-exchange-db.json");
const evidenceRootPath = path.join(process.cwd(), "src", "data", "alpha-exchange-evidence");
const supportedEvidenceMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

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
  privateBetaInvites: [],
  privateBetaInviteUses: [],
  betaFeedback: [],
  betaAnnouncements: [],
};

const DB_CACHE_TTL_MS = 250;
let dbCache: { value: AlphaExchangeDb; updatedAt: number } | null = null;
let dbReadInFlight: Promise<AlphaExchangeDb> | null = null;
let dbWriteInFlight: Promise<void> = Promise.resolve();

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

function extensionForEvidenceMimeType(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "pdf";
}

function toNumber(value: string | number | null | undefined) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function levelRank(level: SellerLevel) {
  if (level === "elite") return 5;
  if (level === "diamond") return 4;
  if (level === "gold") return 3;
  if (level === "silver") return 2;
  return 1;
}

function buildSellerPublicProfile(user: AlphaExchangeUser): SellerPublicProfile {
  return {
    sellerId: user.id,
    sellerName: user.fullName,
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
    isFeaturedSeller: user.isFeaturedSeller === true,
    isProfileHidden: user.isProfileHidden === true,
    onlineStatus: user.onlineStatus,
    lastActiveAt: user.lastActiveAt,
  };
}

function isTrustEligibleSeller(user: AlphaExchangeUser) {
  return user.role === "approved_seller" || user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended";
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
    .map((seller) =>
      calculateSellerTrustSnapshot({
        seller,
        listings: listingsBySeller.get(seller.id) ?? [],
        requests: requestsBySeller.get(seller.id) ?? [],
        commissions: commissionsBySeller.get(seller.id) ?? [],
      }),
    );
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
    };
  }
  return calculateSellerTrustSnapshot({
    seller,
    listings: db.marketplaceListings.filter((listing) => listing.sellerId === seller.id),
    requests: db.purchaseRequests.filter((request) => request.sellerId === seller.id),
    commissions: db.commissionRecords.filter((record) => record.sellerId === seller.id),
    marketplacePosition: 0,
  });
}

function qualitySortListings(db: AlphaExchangeDb, listings: MarketplaceListing[]) {
  const snapshots = computeTrustSnapshotMap(db);
  return [...listings].sort((left, right) => {
    const leftRep = snapshots.get(left.sellerId) ?? computeSellerReputationSnapshot(db, left.sellerId);
    const rightRep = snapshots.get(right.sellerId) ?? computeSellerReputationSnapshot(db, right.sellerId);

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

export async function getSellerReputationByUserId(userId: string) {
  const db = await readDb();
  const user = db.users.find((item) => item.id === userId);
  if (!user) return null;
  return {
    profile: buildSellerPublicProfile(user),
    reputation: computeSellerReputationSnapshot(db, userId),
  };
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
  const viewerIsOwner = input.viewerRole === "admin" && isAlphaExchangeOwnerEmail(input.viewerEmail ?? "");
  if (seller.isProfileHidden === true && !viewerIsOwner) return null;

  const sellerRequests = db.purchaseRequests.filter((request) => request.sellerId === seller.id);
  const completedStatuses = new Set<PurchaseRequestStatus>(["completed", "locked", "review_open"]);
  const completedTrades = sellerRequests.filter((request) => completedStatuses.has(request.status) || Boolean(request.completedAt));
  const reviews = completedTrades
    .filter((request) => request.buyerReview)
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

  const profile = buildSellerPublicProfile(seller);
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
    sellerLevel: trustSnapshot.level,
    trustScore: Number(trustSnapshot.trustScore.toFixed(1)),
    completedTrades: completedTrades.length,
    tradeVolume: Number(trustSnapshot.totalUsdtVolume.toFixed(2)),
    averageRating: Number(trustSnapshot.rating.toFixed(2)),
    responseTimeMinutes: Number(responseTimeMinutes.toFixed(2)),
    completionRate: Number(completionRate.toFixed(2)),
    repeatBuyersPercent: Number(repeatBuyersPercent.toFixed(2)),
    totalReviews: reviews.length,
    yearsOnPlatform: Number(yearsOnPlatform.toFixed(2)),
    badges: trustSnapshot.badges ?? [],
    latestReviews: reviews.slice(0, 12),
    recentActivity,
    ownerTools,
  };
}

function isValidRole(value: string): value is UserRole {
  return value === "buyer" || value === "approved_seller" || value === "admin";
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
    value === "usdt_sent" ||
    value === "trade_completed" ||
    value === "trade_locked" ||
    value === "review_unlocked" ||
    value === "buyer_evidence_uploaded" ||
    value === "seller_evidence_uploaded" ||
    value === "request_declined" ||
    value === "request_cancelled"
  );
}

function isValidListingStatus(value: string): value is ListingStatus {
  return value === "pending_approval" || value === "changes_requested" || value === "rejected" || value === "available" || value === "paused" || value === "sold";
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
  return "buyer";
}

function normalizeRoleForUser(email: string, role: UserRole): UserRole {
  if (isAlphaExchangeOwnerEmail(email)) return "admin";
  if (role === "admin") return "admin";
  return role;
}

function normalizeDb(db: AlphaExchangeDb): AlphaExchangeDb {
  return {
    ...defaultDb,
    ...db,
    users: (db.users ?? []).map((user) => {
      const email = normalizeEmail(typeof user.email === "string" ? user.email : "");
      const role = isValidRole(user.role) ? user.role : "buyer";
      const sellerStatus = isValidSellerStatus((user as { sellerStatus?: string }).sellerStatus ?? "") ? (user as { sellerStatus: SellerStatus }).sellerStatus : inferSellerStatus(role);
      const normalizedRole = normalizeRoleForUser(email, role);
      return {
        ...user,
        email,
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
        lastActiveAt: typeof (user as { lastActiveAt?: string }).lastActiveAt === "string" ? (user as { lastActiveAt: string }).lastActiveAt : (typeof user.updatedAt === "string" ? user.updatedAt : undefined),
        isFeaturedSeller: (user as { isFeaturedSeller?: boolean }).isFeaturedSeller === true,
        isProfileHidden: (user as { isProfileHidden?: boolean }).isProfileHidden === true,
        notificationPreferences: normalizeNotificationPreferences((user as { notificationPreferences?: NotificationPreferences }).notificationPreferences),
        isFoundingMember: (user as { isFoundingMember?: boolean }).isFoundingMember === true,
        isFoundingSeller: (user as { isFoundingSeller?: boolean }).isFoundingSeller === true,
        registeredViaInviteCodeId:
          typeof (user as { registeredViaInviteCodeId?: string }).registeredViaInviteCodeId === "string"
            ? (user as { registeredViaInviteCodeId: string }).registeredViaInviteCodeId
            : undefined,
      };
    }),
    sellerApplications: (db.sellerApplications ?? []).map((application) => ({
      ...application,
      status: isValidSellerApplicationStatus(application.status) ? application.status : "pending",
    })),
    purchaseRequests: (db.purchaseRequests ?? []).map((request) => ({
      ...request,
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
        typeof (request as { paymentMethod?: string }).paymentMethod === "string" && (request as { paymentMethod: string }).paymentMethod.trim()
          ? (request as { paymentMethod: string }).paymentMethod.trim()
          : "Bank transfer",
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
      lockedAt: typeof (request as { lockedAt?: string }).lockedAt === "string" ? (request as { lockedAt: string }).lockedAt : undefined,
      reviewUnlockedAt:
        typeof (request as { reviewUnlockedAt?: string }).reviewUnlockedAt === "string" ? (request as { reviewUnlockedAt: string }).reviewUnlockedAt : undefined,
      buyerReview:
        (request as { buyerReview?: { reviewerUserId?: string; rating?: number; comment?: string; createdAt?: string } }).buyerReview &&
        typeof (request as { buyerReview: { reviewerUserId?: string } }).buyerReview.reviewerUserId === "string"
          ? {
              reviewerUserId: (request as { buyerReview: { reviewerUserId: string } }).buyerReview.reviewerUserId,
              rating: Number((request as { buyerReview: { rating?: number } }).buyerReview.rating ?? 5),
              comment: String((request as { buyerReview: { comment?: string } }).buyerReview.comment ?? "").trim(),
              createdAt: String((request as { buyerReview: { createdAt?: string } }).buyerReview.createdAt ?? request.updatedAt),
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
    commissionRecords: db.commissionRecords ?? [],
    auditLogs: db.auditLogs ?? [],
    authSessions: db.authSessions ?? [],
    passwordResetTokens: db.passwordResetTokens ?? [],
    notifications: (db.notifications ?? []).filter((item) => item && typeof item.userId === "string"),
    activityLog: (db.activityLog ?? []).filter((item) => item && typeof item.userId === "string"),
    disputes: (db.disputes ?? [])
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        ...item,
        buyerEvidenceId: typeof (item as { buyerEvidenceId?: string }).buyerEvidenceId === "string" ? (item as { buyerEvidenceId: string }).buyerEvidenceId : undefined,
        sellerEvidenceId: typeof (item as { sellerEvidenceId?: string }).sellerEvidenceId === "string" ? (item as { sellerEvidenceId: string }).sellerEvidenceId : undefined,
      })),
    sellerReports: (db.sellerReports ?? []).filter((item) => item && typeof item.id === "string"),
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
    marketplaceListings: (db.marketplaceListings ?? []).map((listing) => ({
      ...listing,
      photos: Array.isArray((listing as { photos?: string[] }).photos)
        ? (listing as { photos: string[] }).photos.map((photo) => String(photo).trim()).filter(Boolean).slice(0, 6)
        : [],
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
      paymentMethods: Array.isArray((listing as { paymentMethods?: string[] }).paymentMethods)
        ? (listing as { paymentMethods: string[] }).paymentMethods.map((method) => String(method).trim()).filter(Boolean).slice(0, 8)
        : (typeof (listing as { paymentMethod?: string }).paymentMethod === "string" && (listing as { paymentMethod: string }).paymentMethod.trim()
            ? [(listing as { paymentMethod: string }).paymentMethod.trim()]
            : ["Bank transfer"]),
      paymentMethod:
        typeof (listing as { paymentMethod?: string }).paymentMethod === "string" && (listing as { paymentMethod: string }).paymentMethod.trim()
          ? (listing as { paymentMethod: string }).paymentMethod.trim()
          : (Array.isArray((listing as { paymentMethods?: string[] }).paymentMethods) && (listing as { paymentMethods: string[] }).paymentMethods.length
              ? String((listing as { paymentMethods: string[] }).paymentMethods[0]).trim()
              : "Bank transfer"),
      sellerDescription: typeof (listing as { sellerDescription?: string }).sellerDescription === "string"
        ? (listing as { sellerDescription: string }).sellerDescription.trim()
        : "",
      notes: typeof (listing as { notes?: string }).notes === "string"
        ? (listing as { notes: string }).notes.trim()
        : "",
      expiresAt: typeof (listing as { expiresAt?: string }).expiresAt === "string"
        ? (listing as { expiresAt: string }).expiresAt
        : undefined,
      ownerReviewReason: typeof (listing as { ownerReviewReason?: string }).ownerReviewReason === "string"
        ? (listing as { ownerReviewReason: string }).ownerReviewReason.trim()
        : undefined,
      ownerReviewedAt: typeof (listing as { ownerReviewedAt?: string }).ownerReviewedAt === "string"
        ? (listing as { ownerReviewedAt: string }).ownerReviewedAt
        : undefined,
      ownerReviewedBy: typeof (listing as { ownerReviewedBy?: string }).ownerReviewedBy === "string"
        ? (listing as { ownerReviewedBy: string }).ownerReviewedBy
        : undefined,
      status: isValidListingStatus(String((listing as { status?: string }).status ?? "")) ? (listing as { status: ListingStatus }).status : "available",
      network:
        typeof (listing as { network?: string }).network === "string" && isSupportedNetwork((listing as { network: string }).network)
          ? ((listing as { network: SupportedNetwork }).network)
          : "TRC20",
    })),
  };
}

async function ensureDbFile() {
  try {
    await fs.access(dbPath);
  } catch {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, `${JSON.stringify(defaultDb, null, 2)}\n`, "utf8");
  }
}

function waitFor(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readDb(): Promise<AlphaExchangeDb> {
  const now = Date.now();
  if (dbCache && now - dbCache.updatedAt <= DB_CACHE_TTL_MS) {
    return structuredClone(dbCache.value);
  }
  if (!dbReadInFlight) {
    dbReadInFlight = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await ensureDbFile();
          const raw = await fs.readFile(dbPath, "utf8");
          const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
          const parsed = JSON.parse(json) as AlphaExchangeDb;
          const normalized = normalizeDb(parsed);
          dbCache = { value: normalized, updatedAt: Date.now() };
          return normalized;
        } catch (error) {
          lastError = error;
          if (!(error instanceof SyntaxError) || attempt === 3) {
            break;
          }
          await waitFor(30 * (attempt + 1));
        }
      }
      if (dbCache) {
        return dbCache.value;
      }
      throw lastError instanceof Error ? lastError : new Error("Failed to read Alpha Exchange database.");
    })().finally(() => {
      dbReadInFlight = null;
    });
  }
  const normalized = await dbReadInFlight;
  return structuredClone(normalized);
}

async function writeDb(db: AlphaExchangeDb) {
  const normalized = normalizeDb(db);
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  const writeTask = dbWriteInFlight.then(async () => {
    const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(tempPath, payload, "utf8");
    try {
      await fs.rename(tempPath, dbPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  });
  dbWriteInFlight = writeTask.catch(() => undefined);
  await writeTask;
  dbCache = { value: normalized, updatedAt: Date.now() };
  dbReadInFlight = null;
}

async function appendAuditLog(db: AlphaExchangeDb, input: {
  action: AuditAction;
  actorUserId: string;
  targetUserId?: string;
  listingId?: string;
  purchaseRequestId?: string;
  details?: string;
}) {
  const entry: AuditLogEntry = {
    id: `audit-${randomUUID()}`,
    action: input.action,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    listingId: input.listingId,
    purchaseRequestId: input.purchaseRequestId,
    details: input.details,
    createdAt: nowIso(),
  };
  db.auditLogs.unshift(entry);
}

function getOwnerUser(db: AlphaExchangeDb) {
  return db.users.find((user) => user.role === "admin" && isAlphaExchangeOwnerEmail(user.email)) ?? null;
}

function pushNotification(
  db: AlphaExchangeDb,
  input: {
    userId: string;
    category: NotificationCategory;
    title: string;
    message: string;
    relatedTradeId?: string;
    relatedListingId?: string;
    relatedHref?: string;
  },
) {
  const user = db.users.find((item) => item.id === input.userId);
  if (!user) return;
  if (user.notificationPreferences?.inApp === false) return;
  const notification: AlphaExchangeNotification = {
    id: `notif-${randomUUID()}`,
    userId: input.userId,
    category: input.category,
    title: input.title,
    message: input.message,
    isRead: false,
    relatedTradeId: input.relatedTradeId,
    relatedListingId: input.relatedListingId,
    relatedHref: input.relatedHref,
    createdAt: nowIso(),
  };
  db.notifications.unshift(notification);
}

function pushActivityLog(
  db: AlphaExchangeDb,
  input: { userId: string; category: NotificationCategory; title: string; details: string },
) {
  const entry: AlphaExchangeActivityLogEntry = {
    id: `activity-${randomUUID()}`,
    userId: input.userId,
    category: input.category,
    title: input.title,
    details: input.details,
    createdAt: nowIso(),
  };
  db.activityLog.unshift(entry);
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

function enrichRequestWithEvidence(db: AlphaExchangeDb, request: PurchaseRequest): PurchaseRequest {
  const buyerEvidence = db.tradeEvidenceFiles.find((item) => item.purchaseRequestId === request.id && item.side === "buyer");
  const sellerEvidence = db.tradeEvidenceFiles.find((item) => item.purchaseRequestId === request.id && item.side === "seller");
  return {
    ...request,
    buyerEvidence,
    sellerEvidence,
  };
}

function ensureEvidenceDirectory(purchaseRequestId: string) {
  return fs.mkdir(path.join(evidenceRootPath, purchaseRequestId), { recursive: true });
}

function getTradeEvidenceFile(db: AlphaExchangeDb, purchaseRequestId: string, side: TradeEvidenceSide) {
  return db.tradeEvidenceFiles.find((item) => item.purchaseRequestId === purchaseRequestId && item.side === side);
}

async function recalculateTrustEngine(db: AlphaExchangeDb, input: { reason: string; triggeredBy: string }) {
  const previous = new Map(db.trustSnapshots.map((entry) => [entry.sellerId, entry.snapshot]));
  const owner = getOwnerUser(db);
  const computed = rankTrustSnapshots(
    db.users
      .filter((user) => isTrustEligibleSeller(user))
      .map((seller) =>
        calculateSellerTrustSnapshot({
          seller,
          listings: db.marketplaceListings.filter((listing) => listing.sellerId === seller.id),
          requests: db.purchaseRequests.filter((request) => request.sellerId === seller.id),
          commissions: db.commissionRecords.filter((record) => record.sellerId === seller.id),
        }),
      ),
  );

  const now = nowIso();
  db.trustSnapshots = computed.map((snapshot) => ({
    sellerId: snapshot.sellerId,
    snapshot,
    updatedAt: now,
  }));

  for (const snapshot of computed) {
    const previousSnapshot = previous.get(snapshot.sellerId);
    const oldScore = Number(previousSnapshot?.trustScore ?? 0);
    const newScore = Number(snapshot.trustScore);
    const scoreChanged = Math.round(oldScore * 10) !== Math.round(newScore * 10);
    const levelChanged = previousSnapshot && previousSnapshot.level !== snapshot.level;
    const sharpDrop = previousSnapshot && oldScore - newScore >= 8;
    const trustIncreased = previousSnapshot && newScore - oldScore >= 1;
    const flagged = snapshot.trustScore < 55 || snapshot.marketplaceViolations > 0 || snapshot.disputesLost >= 3 || snapshot.cancellationRate >= 20;

    if (scoreChanged) {
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
        title: "Seller level changed",
        message: `Your seller level changed from ${previousSnapshot!.level} to ${snapshot.level}.`,
      });
      pushActivityLog(db, {
        userId: snapshot.sellerId,
        category: "trust",
        title: "Seller level changed",
        details: `Level is now ${snapshot.level}.`,
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

function isAdminEmail(email: string) {
  return isAlphaExchangeOwnerEmail(email);
}

export function canPublishListings(user: Pick<AlphaExchangeUser, "role" | "sellerStatus">) {
  return user.role === "approved_seller" && user.sellerStatus === "approved_seller";
}

export function isPrivateBetaInviteOnlyModeEnabled() {
  return true;
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
  inviteCode: string;
}) {
  const db = await readDb();
  const email = normalizeEmail(input.email);
  if (db.users.some((user) => normalizeEmail(user.email) === email)) {
    throw new Error("Email already registered.");
  }
  if (!isAdminEmail(email)) {
    if (!isPrivateBetaInviteOnlyModeEnabled()) {
      throw new Error("Public registration is disabled.");
    }
    const inviteCode = String(input.inviteCode ?? "").trim().toUpperCase();
    if (!inviteCode) {
      throw new Error("A valid private beta invite code is required.");
    }
    const inviteIndex = db.privateBetaInvites.findIndex((invite) => invite.code === inviteCode);
    if (inviteIndex === -1) {
      throw new Error("Invite code is invalid.");
    }
    const invite = db.privateBetaInvites[inviteIndex];
    const status = resolveInviteStatus(invite);
    if (status !== "active") {
      db.privateBetaInvites[inviteIndex] = {
        ...invite,
        status,
        updatedAt: nowIso(),
      };
      await writeDb(db);
      throw new Error(status === "disabled" ? "Invite code is disabled." : "Invite code has expired.");
    }
  }

  const timestamp = nowIso();
  const role: UserRole = isAdminEmail(email) ? "admin" : "buyer";
  const normalizedInviteCode = String(input.inviteCode ?? "").trim().toUpperCase();
  let usedInviteId: string | undefined;
  if (!isAdminEmail(email)) {
    const inviteIndex = db.privateBetaInvites.findIndex((invite) => invite.code === normalizedInviteCode);
    const invite = db.privateBetaInvites[inviteIndex];
    const updatedInvite: PrivateBetaInviteCode = {
      ...invite,
      usedCount: invite.usedCount + 1,
      status: invite.usedCount + 1 >= invite.maxUses ? "expired" : invite.status,
      updatedAt: timestamp,
    };
    db.privateBetaInvites[inviteIndex] = updatedInvite;
    usedInviteId = updatedInvite.id;
  }
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
    lastActiveAt: timestamp,
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: normalizeNotificationPreferences(),
    role,
    sellerStatus: "buyer",
    isFoundingMember: !isAdminEmail(email),
    isFoundingSeller: false,
    registeredViaInviteCodeId: usedInviteId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.users.push(user);
  if (usedInviteId) {
    db.privateBetaInviteUses.unshift({
      id: `invite-use-${randomUUID()}`,
      inviteCodeId: usedInviteId,
      code: normalizedInviteCode,
      usedByUserId: user.id,
      usedByEmail: user.email,
      usedAt: timestamp,
    });
    pushActivityLog(db, {
      userId: user.id,
      category: "system",
      title: "Joined Private Beta",
      details: "Welcome to Alpha Exchange private beta as a Founding Member.",
    });
  }
  await writeDb(db);
  return user;
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
  await writeDb(db);
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
    lastActiveAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (isTrustEligibleSeller(db.users[index])) {
    await recalculateTrustEngine(db, { reason: "Seller profile updated", triggeredBy: input.userId });
  }
  await writeDb(db);
  return db.users[index];
}

export async function findUserByEmail(email: string) {
  const db = await readDb();
  const normalized = normalizeEmail(email);
  return db.users.find((user) => normalizeEmail(user.email) === normalized) ?? null;
}

export async function findUserById(userId: string) {
  const db = await readDb();
  return db.users.find((user) => user.id === userId) ?? null;
}

export async function createAuthSession(userId: string, token: string, durationDays = 14) {
  const db = await readDb();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  const session: AuthSession = {
    token: hashToken(token),
    userId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  db.authSessions = db.authSessions.filter((item) => item.userId !== userId);
  db.authSessions.push(session);
  await writeDb(db);
  return session;
}

export async function getSessionByToken(token: string) {
  const db = await readDb();
  const hashed = hashToken(token);
  const session = db.authSessions.find((item) => item.token === hashed);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    db.authSessions = db.authSessions.filter((item) => item.token !== hashed);
    await writeDb(db);
    return null;
  }
  return session;
}

export async function deleteSessionByToken(token: string) {
  const db = await readDb();
  const hashed = hashToken(token);
  db.authSessions = db.authSessions.filter((item) => item.token !== hashed);
  await writeDb(db);
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
  await writeDb(db);
  return reset;
}

export async function consumePasswordResetToken(rawToken: string) {
  const db = await readDb();
  const hashed = hashToken(rawToken);
  const token = db.passwordResetTokens.find((item) => item.tokenHash === hashed);
  if (!token) return null;
  if (new Date(token.expiresAt) < new Date()) {
    db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.tokenHash !== hashed);
    await writeDb(db);
    return null;
  }
  db.passwordResetTokens = db.passwordResetTokens.filter((item) => item.tokenHash !== hashed);
  await writeDb(db);
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
    .filter(isSupportedNetwork);

  if (!fullName) throw new Error("Full name is required.");
  if (!whatsappNumber) throw new Error("WhatsApp number is required.");
  if (preferredNetworks.length === 0) throw new Error("At least one preferred network is required.");

  const db = await readDb();
  const now = nowIso();
  const user = db.users.find((item) => item.id === input.userId);
  if (!user) throw new Error("Account not found.");
  if (isAlphaExchangeOwnerEmail(user.email)) throw new Error("Owner accounts cannot submit seller applications.");
  if (user.role === "admin") throw new Error("Administrator accounts cannot submit seller applications.");
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
    db.users[userIndex] = {
      ...db.users[userIndex],
      sellerStatus: "pending_seller_approval",
      role: db.users[userIndex].role === "admin" ? "admin" : "buyer",
      updatedAt: now,
    };
  }

  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "application",
      title: "New seller application",
      message: `${next.fullName} submitted a seller application.`,
      relatedHref: "/admin/alpha-exchange",
    });
  }
  pushActivityLog(db, {
    userId: input.userId,
    category: "application",
    title: "Seller application submitted",
    details: "Your seller application is pending owner review.",
  });

  await writeDb(db);
  return next;
}

export async function getSellerApplicationByUserId(userId: string) {
  const db = await readDb();
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

export async function approveSellerApplicationByAdmin(applicationId: string, adminUserId: string) {
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
  db.users[userIndex] = {
    ...db.users[userIndex],
    role: db.users[userIndex].role === "admin" ? "admin" : "approved_seller",
    sellerStatus: "approved_seller",
    isFoundingSeller: db.users[userIndex].isFoundingMember === true ? true : db.users[userIndex].isFoundingSeller === true,
    updatedAt: nowIso(),
  };

  await appendAuditLog(db, {
    action: "seller_approved",
    actorUserId: adminUserId,
    targetUserId: application.userId,
    details: `Approved seller application ${application.id}`,
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

  await writeDb(db);
  return db.sellerApplications[applicationIndex];
}

export async function rejectSellerApplicationByAdmin(applicationId: string, adminUserId: string) {
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
    db.users[userIndex] = {
      ...db.users[userIndex],
      role: db.users[userIndex].role === "admin" ? "admin" : "buyer",
      sellerStatus: "rejected",
      updatedAt: nowIso(),
    };
  }

  await appendAuditLog(db, {
    action: "seller_rejected",
    actorUserId: adminUserId,
    targetUserId: application.userId,
    details: `Rejected seller application ${application.id}`,
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

  await writeDb(db);
  return db.sellerApplications[applicationIndex];
}

export async function suspendApprovedSellerByAdmin(userId: string, adminUserId: string) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === userId);
  if (userIndex === -1) throw new Error("User not found.");
  const user = db.users[userIndex];
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
  });
  await recalculateTrustEngine(db, { reason: "Seller suspended", triggeredBy: adminUserId });

  await writeDb(db);
  return db.users[userIndex];
}

export async function reactivateSellerByAdmin(userId: string, adminUserId: string) {
  const db = await readDb();
  const userIndex = db.users.findIndex((user) => user.id === userId);
  if (userIndex === -1) throw new Error("User not found.");
  const user = db.users[userIndex];
  db.users[userIndex] = {
    ...user,
    role: user.role === "admin" ? "admin" : "approved_seller",
    sellerStatus: "approved_seller",
    updatedAt: nowIso(),
  };

  await appendAuditLog(db, {
    action: "seller_reactivated",
    actorUserId: adminUserId,
    targetUserId: userId,
    details: `Reactivated seller ${userId}`,
  });
  await recalculateTrustEngine(db, { reason: "Seller reactivated", triggeredBy: adminUserId });

  await writeDb(db);
  return db.users[userIndex];
}

export async function getApprovedSellersForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.users.filter((user) => user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended");
}

export async function getMarketplaceListings(status?: string) {
  const db = await readDb();
  const nowMs = Date.now();
  const sellerById = new Map(db.users.map((user) => [user.id, user]));
  const hiddenSellerIds = new Set(
    db.users
      .filter((user) => user.isProfileHidden === true || user.sellerStatus === "suspended")
      .map((user) => user.id),
  );
  const rawListings =
    !status || status === "all"
      ? db.marketplaceListings.filter((listing) => {
          if (listing.status !== "available") return false;
          if (hiddenSellerIds.has(listing.sellerId)) return false;
          const seller = sellerById.get(listing.sellerId);
          if (!seller || seller.sellerStatus !== "approved_seller") return false;
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

  await writeDb(db);
  return db.users[index];
}

export async function getMarketplaceListingsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return enrichListingsWithSellerData(db, db.marketplaceListings);
}

export async function getPendingMarketplaceListingsForOwner(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const pending = db.marketplaceListings.filter((listing) => listing.status === "pending_approval");
  return enrichListingsWithSellerData(db, pending);
}

export async function getMarketplaceListingById(id: string) {
  const db = await readDb();
  const listing = db.marketplaceListings.find((item) => item.id === id);
  if (!listing) return null;
  const [enriched] = enrichListingsWithSellerData(db, [listing]);
  return enriched ?? null;
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
  minimumTrade?: string;
  maximumTrade?: string;
  expiresAt?: string;
  notes?: string;
  sellerDescription?: string;
  responseTime: string;
  actorUserId: string;
}) {
  const db = await readDb();
  const now = nowIso();
  const listing: MarketplaceListing = {
    id: `listing-${randomUUID()}`,
    sellerId: input.sellerId,
    sellerDisplayName: input.sellerDisplayName,
    photos: (input.photos ?? []).map((photo) => String(photo).trim()).filter(Boolean).slice(0, 6),
    availableAmount: input.availableAmount.trim(),
    price: input.price.trim(),
    currency: input.currency?.trim() || "ILS",
    network: input.network,
    paymentMethods: (input.paymentMethods ?? [input.paymentMethod ?? "Bank transfer"]).map((method) => String(method).trim()).filter(Boolean).slice(0, 8),
    paymentMethod: "",
    minimumTrade: input.minimumTrade?.trim() || "0",
    maximumTrade: input.maximumTrade?.trim() || input.availableAmount.trim(),
    expiresAt: input.expiresAt?.trim() || undefined,
    notes: input.notes?.trim() || "",
    sellerDescription: input.sellerDescription?.trim() || "",
    responseTime: input.responseTime.trim() || "5 min",
    status: "pending_approval",
    createdAt: now,
    updatedAt: now,
  };
  listing.paymentMethod = listing.paymentMethods[0] ?? "Bank transfer";
  db.marketplaceListings.push(listing);
  await appendAuditLog(db, {
    action: "listing_submitted_for_approval",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    listingId: listing.id,
    details: `Submitted listing ${listing.id} for owner approval`,
  });
  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "listing",
      title: "New listing awaiting approval",
      message: `${input.sellerDisplayName} submitted listing ${listing.id} for approval.`,
      relatedListingId: listing.id,
      relatedHref: "/admin/alpha-exchange/pending-listings",
    });
  }
  pushActivityLog(db, {
    userId: input.sellerId,
    category: "listing",
    title: "Listing submitted",
    details: `Listing ${listing.id} is pending owner approval.`,
  });
  await recalculateTrustEngine(db, { reason: "Listing submitted for approval", triggeredBy: input.actorUserId });
  await writeDb(db);
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
  minimumTrade?: string;
  maximumTrade?: string;
  expiresAt?: string;
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

  const nextStatusFromInput = input.status ?? current.status;
  if (input.status && (current.status === "pending_approval" || current.status === "changes_requested" || current.status === "rejected")) {
    throw new Error("Listing status cannot be changed until owner review is complete.");
  }
  if ((current.status === "rejected" || current.status === "changes_requested") && input.status === undefined) {
    // Any seller edit after owner feedback resubmits the listing for owner approval.
    input.status = "pending_approval";
  } else if (nextStatusFromInput === "available" && current.status !== "paused") {
    throw new Error("Listings can only go live after owner approval.");
  }

  const next: MarketplaceListing = {
    ...current,
    photos: input.photos ? input.photos.map((photo) => String(photo).trim()).filter(Boolean).slice(0, 6) : current.photos,
    availableAmount: input.availableAmount?.trim() || current.availableAmount,
    price: input.price?.trim() || current.price,
    currency: input.currency?.trim() || current.currency,
    network: input.network || current.network,
    paymentMethods: input.paymentMethods
      ? input.paymentMethods.map((method) => String(method).trim()).filter(Boolean).slice(0, 8)
      : (input.paymentMethod?.trim() ? [input.paymentMethod.trim()] : current.paymentMethods),
    paymentMethod: input.paymentMethod?.trim() || current.paymentMethod,
    minimumTrade: input.minimumTrade?.trim() || current.minimumTrade,
    maximumTrade: input.maximumTrade?.trim() || current.maximumTrade,
    expiresAt: input.expiresAt?.trim() || current.expiresAt,
    notes: input.notes?.trim() ?? current.notes,
    sellerDescription: input.sellerDescription?.trim() ?? current.sellerDescription,
    responseTime: input.responseTime?.trim() || current.responseTime,
    status: input.status || current.status,
    updatedAt: nowIso(),
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
  if (next.status === "pending_approval") {
    next.ownerReviewReason = undefined;
    next.ownerReviewedAt = undefined;
    next.ownerReviewedBy = undefined;
  }
  db.marketplaceListings[index] = next;
  await appendAuditLog(db, {
    action: "listing_edited",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    listingId: next.id,
    details: `Edited listing ${next.id}`,
  });
  await recalculateTrustEngine(db, { reason: "Seller listing updated", triggeredBy: input.actorUserId });
  await writeDb(db);
  return next;
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
  const nextStatus: ListingStatus =
    input.decision === "approve" ? "available" : input.decision === "reject" ? "rejected" : "changes_requested";

  db.marketplaceListings[index] = {
    ...current,
    status: nextStatus,
    ownerReviewReason: trimmedReason || undefined,
    ownerReviewedAt: now,
    ownerReviewedBy: input.ownerUserId,
    updatedAt: now,
  };

  await appendAuditLog(db, {
    action:
      input.decision === "approve"
        ? "listing_approved"
        : input.decision === "reject"
          ? "listing_rejected"
          : "listing_changes_requested",
    actorUserId: input.ownerUserId,
    targetUserId: current.sellerId,
    listingId: current.id,
    details:
      input.decision === "approve"
        ? `Owner approved listing ${current.id}`
        : input.decision === "reject"
          ? `Owner rejected listing ${current.id}: ${trimmedReason}`
          : `Owner requested listing changes for ${current.id}: ${trimmedReason}`,
  });
  pushNotification(db, {
    userId: current.sellerId,
    category: "listing",
    title:
      input.decision === "approve" ? "Listing approved" : input.decision === "reject" ? "Listing rejected" : "Listing changes requested",
    message:
      input.decision === "approve"
        ? `Listing ${current.id} is now live.`
        : input.decision === "reject"
          ? `Listing ${current.id} was rejected. ${trimmedReason}`
          : `Owner requested changes for listing ${current.id}. ${trimmedReason}`,
    relatedListingId: current.id,
    relatedHref: "/usdt-exchange",
  });
  pushActivityLog(db, {
    userId: current.sellerId,
    category: "listing",
    title:
      input.decision === "approve" ? "Listing approved" : input.decision === "reject" ? "Listing rejected" : "Listing changes requested",
    details: input.decision === "approve" ? `Listing ${current.id} approved.` : trimmedReason || "Owner decision recorded.",
  });
  await recalculateTrustEngine(db, {
    reason:
      input.decision === "approve" ? "Listing approved" : input.decision === "reject" ? "Listing rejected" : "Listing changes requested",
    triggeredBy: input.ownerUserId,
  });
  await writeDb(db);
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
  db.marketplaceListings = db.marketplaceListings.filter((item) => item.id !== input.listingId);
  await appendAuditLog(db, {
    action: "listing_removed",
    actorUserId: input.actorUserId,
    targetUserId: input.sellerId,
    listingId: input.listingId,
    details: `Removed listing ${input.listingId}`,
  });
  await recalculateTrustEngine(db, { reason: "Listing removed", triggeredBy: input.actorUserId });
  await writeDb(db);
}

export async function getMyMarketplaceListings(sellerId: string, status?: string) {
  const db = await readDb();
  const rawListings =
    !status || status === "all"
      ? db.marketplaceListings.filter((listing) => listing.sellerId === sellerId)
      : db.marketplaceListings.filter((listing) => listing.sellerId === sellerId && listing.status === status);
  return enrichListingsWithSellerData(db, rawListings);
}

export async function createPurchaseRequest(input: {
  buyerId: string;
  listingId: string;
  buyerName: string;
  buyerWhatsapp: string;
  buyerNotes: string;
  actorUserId: string;
}) {
  const db = await readDb();
  const now = nowIso();
  const listing = db.marketplaceListings.find((item) => item.id === input.listingId);
  if (!listing) throw new Error("Listing not found.");
  if (listing.status !== "available") throw new Error("Listing is not available.");
  if (listing.sellerId === input.buyerId) throw new Error("You cannot submit a purchase request to your own listing.");
  const sellerId = listing.sellerId;
  const usdtAmount = listing.availableAmount;
  const fiatAmount = (toNumber(listing.availableAmount) * toNumber(listing.price)).toFixed(2);
  const request: PurchaseRequest = {
    id: `purchase-${randomUUID()}`,
    buyerId: input.buyerId,
    listingId: input.listingId,
    sellerId,
    tradeId: undefined,
    buyerName: input.buyerName.trim(),
    buyerWhatsapp: input.buyerWhatsapp.trim(),
    buyerNotes: input.buyerNotes.trim(),
    usdtAmount,
    fiatAmount,
    currency: listing.currency,
    network: listing.network,
    paymentMethod: listing.paymentMethod,
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
    details: `Submitted purchase request ${request.id}`,
  });
  pushNotification(db, {
    userId: sellerId,
    category: "trade",
    title: "New trade request",
    message: `${request.buyerName} submitted a trade request.`,
    relatedTradeId: request.tradeId,
    relatedListingId: request.listingId,
    relatedHref: "/usdt-exchange",
  });
  pushActivityLog(db, {
    userId: input.buyerId,
    category: "trade",
    title: "Trade request submitted",
    details: `Request ${request.id} was submitted.`,
  });
  await recalculateTrustEngine(db, { reason: "Purchase request submitted", triggeredBy: input.actorUserId });
  await writeDb(db);
  return request;
}

export async function getMyPurchaseRequests(userId: string, role: UserRole) {
  const db = await readDb();
  if (role === "admin") return db.purchaseRequests.map((request) => enrichRequestWithEvidence(db, request));
  return db.purchaseRequests
    .filter((request) => request.buyerId === userId || request.sellerId === userId)
    .map((request) => enrichRequestWithEvidence(db, request));
}

export interface AccountProfileSummary {
  id: string;
  profilePhotoUrl: string;
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
}

export interface SellerAccountStats {
  kind: "seller";
  sellerLevel: SellerLevel;
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
  };

  if (user.role === "approved_seller" || user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended") {
    const reputation = computeSellerReputationSnapshot(db, user.id);
    const sellerRequests = db.purchaseRequests.filter((request) => request.sellerId === user.id);
    const stats: SellerAccountStats = {
      kind: "seller",
      sellerLevel: reputation.level,
      trustScore: reputation.trustScore,
      completedTrades: sellerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length,
      activeListings: db.marketplaceListings.filter((listing) => listing.sellerId === user.id && listing.status === "available").length,
      pendingListings: db.marketplaceListings.filter((listing) => listing.sellerId === user.id && listing.status === "pending_approval").length,
      averageRating: reputation.rating,
    };
    return { profile, stats };
  }

  const buyerRequests = db.purchaseRequests.filter((request) => request.buyerId === user.id);
  const stats: BuyerAccountStats = {
    kind: "buyer",
    activeTrades: buyerRequests.filter(
      (request) => request.status !== "completed" && request.status !== "declined" && request.status !== "cancelled",
    ).length,
    completedTrades: buyerRequests.filter((request) => request.status === "completed" || Boolean(request.completedAt)).length,
    reviewsGiven: buyerRequests.filter((request) => Boolean(request.buyerReview)).length,
  };
  return { profile, stats };
}

export async function updateAccountProfileData(input: {
  userId: string;
  profilePhotoUrl?: string;
  fullName?: string;
  bio?: string;
  country?: string;
  language?: string;
  whatsappNumber?: string;
}) {
  const languages = input.language !== undefined ? [String(input.language).trim() || "English"] : undefined;
  return updateUserSellerSettings({
    userId: input.userId,
    profilePhotoUrl: input.profilePhotoUrl,
    fullName: input.fullName,
    bio: input.bio,
    country: input.country,
    languages,
    whatsappNumber: input.whatsappNumber,
  });
}

function assertTradeParticipantOrAdmin(request: PurchaseRequest, userId: string, role: UserRole) {
  if (role === "admin") return;
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
  const db = await readDb();
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.purchaseRequestId);
  if (requestIndex === -1) throw new Error("Trade not found.");
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

  await ensureEvidenceDirectory(request.id);
  const extension = extensionForEvidenceMimeType(mimeType);
  const evidenceId = `evidence-${randomUUID()}`;
  const baseName = path
    .basename(String(input.fileName ?? "").trim() || `${input.side}-evidence.${extension}`)
    .replace(/[^a-zA-Z0-9._-]/g, "-");
  const storageFileName = `${input.side}-${evidenceId}.${extension}`;
  const storagePath = path.join(evidenceRootPath, request.id, storageFileName);

  const existingIndex = db.tradeEvidenceFiles.findIndex((item) => item.purchaseRequestId === request.id && item.side === input.side);
  const existing = existingIndex >= 0 ? db.tradeEvidenceFiles[existingIndex] : undefined;
  if (existing?.storagePath) {
    await fs.unlink(existing.storagePath).catch(() => undefined);
  }

  await fs.writeFile(storagePath, raw);

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

  const nextRequest: PurchaseRequest = {
    ...request,
    buyerEvidence: input.side === "buyer" ? evidence : request.buyerEvidence,
    sellerEvidence: input.side === "seller" ? evidence : request.sellerEvidence,
    updatedAt: nowIso(),
  };
  appendTradeTimelineEntry(nextRequest, {
    type: input.side === "buyer" ? "buyer_evidence_uploaded" : "seller_evidence_uploaded",
    actorUserId: input.actorUserId,
    actorRole: resolveActorRole(db, input.actorUserId),
    message: input.side === "buyer" ? "Buyer uploaded payment evidence" : "Seller uploaded USDT evidence",
  });
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

  await writeDb(db);
  return enrichRequestWithEvidence(db, db.purchaseRequests[requestIndex]);
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
  if (input.actorRole === "admin") {
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
  await writeDb(db);

  const buffer = await fs.readFile(evidence.storagePath);
  return { evidence, request, buffer };
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
  if (request.buyerReview) throw new Error("Buyer review already submitted.");

  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const comment = String(input.comment ?? "").trim();
  if (!comment) throw new Error("Review comment is required.");
  if (comment.length > 500) throw new Error("Review comment is too long.");

  db.purchaseRequests[requestIndex] = {
    ...request,
    buyerReview: {
      reviewerUserId: input.buyerUserId,
      rating,
      comment,
      createdAt: nowIso(),
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
    category: "trade",
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

  await recalculateTrustEngine(db, { reason: "Verified trade review submitted", triggeredBy: input.buyerUserId });
  await writeDb(db);
  return db.purchaseRequests[requestIndex];
}

export async function submitSellerReviewResponse(input: {
  requestId: string;
  sellerUserId: string;
  message: string;
}) {
  const db = await readDb();
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.requestId);
  if (requestIndex === -1) throw new Error("Trade not found.");
  const request = db.purchaseRequests[requestIndex];
  if (request.sellerId !== input.sellerUserId) throw new Error("Only the seller can respond.");
  if (!request.buyerReview) throw new Error("Seller response is available only after buyer review.");
  if (request.sellerResponse) throw new Error("Seller response already submitted.");
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

  await recalculateTrustEngine(db, { reason: "Seller review response submitted", triggeredBy: input.sellerUserId });
  await writeDb(db);
  return db.purchaseRequests[requestIndex];
}

export async function updatePurchaseRequestStatus(input: {
  requestId: string;
  actorUserId: string;
  actorRole: UserRole;
  nextStatus: PurchaseRequestStatus;
}) {
  const db = await readDb();
  const requestIndex = db.purchaseRequests.findIndex((item) => item.id === input.requestId);
  if (requestIndex === -1) throw new Error("Purchase request not found.");
  const request = db.purchaseRequests[requestIndex];

  const isSeller = request.sellerId === input.actorUserId;
  const isBuyer = request.buyerId === input.actorUserId;
  const isAdmin = input.actorRole === "admin";

  if (!isSeller && !isBuyer && !isAdmin) {
    throw new Error("You are not allowed to update this request.");
  }

  if (isSeller && !["accepted", "declined", "usdt_sent"].includes(input.nextStatus)) {
    throw new Error("Seller can only set accepted, declined, or usdt_sent.");
  }
  if (isBuyer && !["cancelled", "payment_sent", "completed"].includes(input.nextStatus)) {
    throw new Error("Buyer can only set cancelled, payment_sent, or completed.");
  }

  const currentStatus = request.status;
  const allowedByStatus: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
    pending: ["accepted", "declined", "cancelled"],
    accepted: ["payment_sent", "cancelled"],
    payment_sent: ["usdt_sent"],
    usdt_sent: ["completed"],
    completed: ["locked"],
    locked: ["review_open"],
    review_open: [],
    declined: [],
    cancelled: [],
  };
  if (!allowedByStatus[currentStatus].includes(input.nextStatus)) {
    throw new Error(`Invalid status transition from ${currentStatus} to ${input.nextStatus}.`);
  }

  const actorRole = resolveActorRole(db, input.actorUserId);
  const now = nowIso();
  const next: PurchaseRequest = {
    ...request,
    timeline: [...(request.timeline ?? [])],
    updatedAt: now,
  };

  if (input.nextStatus === "accepted") {
    next.status = "accepted";
    next.tradeId = next.tradeId ?? `trade-${randomUUID()}`;
    next.tradeCreatedAt = now;
    appendTradeTimelineEntry(next, { type: "request_accepted", actorUserId: input.actorUserId, actorRole, message: "Seller accepted request", createdAt: now });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade request accepted",
      message: `Your request ${request.id} was accepted.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
  } else if (input.nextStatus === "declined") {
    next.status = "declined";
    appendTradeTimelineEntry(next, { type: "request_declined", actorUserId: input.actorUserId, actorRole, message: "Seller declined request", createdAt: now });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Trade request declined",
      message: `Your request ${request.id} was declined.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
  } else if (input.nextStatus === "cancelled") {
    next.status = "cancelled";
    appendTradeTimelineEntry(next, { type: "request_cancelled", actorUserId: input.actorUserId, actorRole, message: "Buyer cancelled request", createdAt: now });
  } else if (input.nextStatus === "payment_sent") {
    const buyerEvidence = getTradeEvidenceFile(db, request.id, "buyer");
    if (!buyerEvidence) throw new Error("Buyer evidence is required before marking payment sent.");
    next.status = "payment_sent";
    next.buyerEvidence = buyerEvidence;
    next.paymentSentAt = now;
    appendTradeTimelineEntry(next, { type: "payment_sent", actorUserId: input.actorUserId, actorRole, message: "Buyer marked payment sent", createdAt: now });
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: "Buyer marked payment sent",
      message: `Buyer marked payment sent for trade ${next.tradeId ?? request.id}.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
  } else if (input.nextStatus === "usdt_sent") {
    const sellerEvidence = getTradeEvidenceFile(db, request.id, "seller");
    if (!sellerEvidence) throw new Error("Seller evidence is required before marking USDT sent.");
    next.status = "usdt_sent";
    next.sellerEvidence = sellerEvidence;
    next.usdtSentAt = now;
    appendTradeTimelineEntry(next, { type: "usdt_sent", actorUserId: input.actorUserId, actorRole, message: "Seller marked USDT sent", createdAt: now });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Seller marked USDT sent",
      message: `Seller marked USDT sent for trade ${next.tradeId ?? request.id}.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
  } else if (input.nextStatus === "completed") {
    next.completedAt = now;
    appendTradeTimelineEntry(next, { type: "trade_completed", actorUserId: input.actorUserId, actorRole, message: "Buyer confirmed trade completed", createdAt: now });
    next.lockedAt = now;
    appendTradeTimelineEntry(next, { type: "trade_locked", actorUserId: input.actorUserId, actorRole, message: "Trade locked", createdAt: now });
    next.reviewUnlockedAt = now;
    next.status = "review_open";
    appendTradeTimelineEntry(next, { type: "review_unlocked", actorUserId: input.actorUserId, actorRole, message: "Review window unlocked", createdAt: now });

    const listing = db.marketplaceListings.find((item) => item.id === request.listingId);
    if (listing) {
      listing.status = "sold";
      listing.updatedAt = now;
    }
    const hasCommission = db.commissionRecords.some((record) => record.purchaseRequestId === request.id);
    if (!hasCommission) {
      const normalizedGross = toNumber(next.fiatAmount);
      const commissionAmount = normalizedGross * 0.01;
      const commission: CommissionRecord = {
        id: `commission-${randomUUID()}`,
        purchaseRequestId: request.id,
        listingId: request.listingId,
        sellerId: request.sellerId,
        buyerId: request.buyerId,
        rate: 0.01,
        grossAmount: normalizedGross,
        commissionAmount,
        createdAt: now,
      };
      db.commissionRecords.push(commission);
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
      message: `Trade ${next.tradeId ?? request.id} is completed and locked.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
    pushNotification(db, {
      userId: request.buyerId,
      category: "trade",
      title: "Review available",
      message: `You can now leave one review for trade ${next.tradeId ?? request.id}.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
    });
    pushNotification(db, {
      userId: request.sellerId,
      category: "trade",
      title: "Trade completed",
      message: `Trade ${next.tradeId ?? request.id} was completed by the buyer.`,
      relatedTradeId: next.tradeId,
      relatedListingId: request.listingId,
      relatedHref: "/usdt-exchange",
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

  await recalculateTrustEngine(db, { reason: input.nextStatus === "completed" ? "Trade completed" : "Trade lifecycle updated", triggeredBy: input.actorUserId });

  await writeDb(db);
  return enrichRequestWithEvidence(db, db.purchaseRequests[requestIndex]);
}

export async function getPurchaseRequestsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.purchaseRequests.map((request) => enrichRequestWithEvidence(db, request));
}

export async function getCommissionRecordsForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  return db.commissionRecords;
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
  await writeDb(db);
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
  await writeDb(db);
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
      title: "New beta feedback submitted",
      message: `${user.fullName} submitted ${input.category} feedback.`,
      relatedHref: "/admin/alpha-exchange",
    });
  }
  pushActivityLog(db, {
    userId: input.userId,
    category: "system",
    title: "Beta feedback submitted",
    details: `Category: ${input.category}`,
  });
  await writeDb(db);
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
  await writeDb(db);
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
      title: `Beta announcement: ${announcement.title}`,
      message: announcement.message.slice(0, 140),
      relatedHref: "/usdt-exchange",
    });
  }
  await appendAuditLog(db, {
    action: "beta_announcement_created",
    actorUserId: input.ownerUserId,
    details: `Published beta announcement ${announcement.id}.`,
  });
  await writeDb(db);
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
  await writeDb(db);
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
    await writeDb(db);
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
      .filter((listing) => listing.status === "available" && listing.ownerReviewedAt)
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
      newBuyers: db.users.filter((user) => user.role === "buyer" && isToday(user.createdAt)).length,
      newSellers: db.sellerApplications.filter((application) => application.status === "approved" && isToday(application.updatedAt)).length,
      newListings: db.marketplaceListings.filter((listing) => isToday(listing.createdAt)).length,
      listingsApproved: db.marketplaceListings.filter((listing) => listing.status === "available" && isToday(listing.ownerReviewedAt)).length,
      listingsRejected: db.marketplaceListings.filter((listing) => listing.status === "rejected" && isToday(listing.ownerReviewedAt)).length,
      pendingListings: db.marketplaceListings.filter((listing) => listing.status === "pending_approval").length,
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
      listingsSold: db.marketplaceListings.filter((listing) => listing.status === "sold").length,
      listingsWaitingApproval: db.marketplaceListings.filter((listing) => listing.status === "pending_approval").length,
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
  unreadOnly?: boolean;
  query?: string;
}) {
  const db = await readDb();
  const category = input.category;
  const query = String(input.query ?? "").trim().toLowerCase();
  const notifications = db.notifications.filter((notification) => {
    if (notification.userId !== input.userId) return false;
    if (category && notification.category !== category) return false;
    if (input.unreadOnly && notification.isRead) return false;
    if (!query) return true;
    const haystack = `${notification.title} ${notification.message} ${notification.relatedTradeId ?? ""} ${notification.relatedListingId ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
  const activity = db.activityLog.filter((entry) => entry.userId === input.userId).slice(0, 120);
  return {
    notifications: notifications.slice(0, 200),
    activity,
  };
}

export async function markNotificationReadState(input: { userId: string; notificationId: string; isRead: boolean }) {
  const db = await readDb();
  const index = db.notifications.findIndex((item) => item.id === input.notificationId && item.userId === input.userId);
  if (index === -1) throw new Error("Notification not found.");
  db.notifications[index] = {
    ...db.notifications[index],
    isRead: input.isRead,
  };
  await writeDb(db);
  return db.notifications[index];
}

export async function markAllNotificationsRead(userId: string) {
  const db = await readDb();
  db.notifications = db.notifications.map((item) => (item.userId === userId ? { ...item, isRead: true } : item));
  await writeDb(db);
}

export async function deleteNotification(input: { userId: string; notificationId: string }) {
  const db = await readDb();
  const exists = db.notifications.some((item) => item.id === input.notificationId && item.userId === input.userId);
  if (!exists) throw new Error("Notification not found.");
  db.notifications = db.notifications.filter((item) => !(item.id === input.notificationId && item.userId === input.userId));
  await writeDb(db);
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
  await writeDb(db);
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

  const owner = getOwnerUser(db);
  if (owner) {
    pushNotification(db, {
      userId: owner.id,
      category: "dispute",
      title: "Dispute opened",
      message: `Dispute opened for trade ${dispute.tradeId}.`,
      relatedTradeId: dispute.tradeId,
      relatedHref: "/admin/alpha-exchange",
    });
  }
  pushActivityLog(db, {
    userId: input.openedByUserId,
    category: "dispute",
    title: "Dispute opened",
    details: `Dispute opened for trade ${dispute.tradeId}.`,
  });
  await writeDb(db);
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
  await writeDb(db);
  return report;
}

export async function getAlphaExchangeSummaryForAdmin(dbInput?: AlphaExchangeDb) {
  const db = dbInput ?? await readDb();
  const trustInitialized = await ensureTrustSnapshots(db);
  if (trustInitialized && !dbInput) {
    await writeDb(db);
  }
  return {
    usersCount: db.users.length,
    approvedSellersCount: db.users.filter((user) => user.sellerStatus === "approved_seller").length,
    pendingApplicationsCount: db.sellerApplications.filter((item) => item.status === "pending").length,
    pendingListingsCount: db.marketplaceListings.filter((item) => item.status === "pending_approval").length,
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
    await writeDb(db);
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

export async function getAdminPrepDashboardData() {
  const db = await readDb();
  const trustInitialized = await ensureTrustSnapshots(db);
  if (trustInitialized) {
    await writeDb(db);
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

  return {
    summary,
    applications,
    approvedSellers,
    listings,
    purchaseRequests,
    commissionRecords,
    auditLogs,
    trustEngine,
    ownerBusiness,
    privateBeta,
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

export async function setUserRole(userId: string, role: UserRole) {
  const db = await readDb();
  const index = db.users.findIndex((item) => item.id === userId);
  if (index === -1) throw new Error("User not found.");
  const user = db.users[index];
  if (isAlphaExchangeOwnerEmail(user.email)) {
    db.users[index] = { ...user, role: "admin", updatedAt: nowIso() };
    await recalculateTrustEngine(db, { reason: "User role updated", triggeredBy: userId });
    await writeDb(db);
    return;
  }
  if (role === "admin") {
    throw new Error("Only the owner account can be assigned admin.");
  }
  const nextSellerStatus = role === "approved_seller" ? "approved_seller" : user.sellerStatus;
  db.users[index] = { ...user, role, sellerStatus: nextSellerStatus, updatedAt: nowIso() };
  await recalculateTrustEngine(db, { reason: "User role updated", triggeredBy: userId });
  await writeDb(db);
}

export async function getUsersBySellerStatusForAdmin(status: SellerStatus) {
  const db = await readDb();
  return db.users.filter((user) => user.sellerStatus === status);
}

export function calculateEstimatedTotal(amount: string, price: string) {
  const gross = toNumber(amount) * toNumber(price);
  const commission = gross * 0.01;
  return {
    commission,
    estimatedTotal: gross + commission,
  };
}
