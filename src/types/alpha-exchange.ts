export type UserRole = "buyer" | "approved_seller" | "admin";
export type SellerStatus = "buyer" | "pending_seller_approval" | "approved_seller" | "rejected" | "suspended";
export type SellerOnlineStatus = "online" | "offline";
export type SellerAvailabilityStatus = "available" | "away" | "vacation";
export type SellerLevel = "bronze" | "silver" | "gold" | "diamond" | "elite";
export type SellerBadge = "elite_seller" | "top_rated" | "fast_responder" | "trusted_seller" | "most_active" | "platinum_seller" | "trades_1000_plus";
export type SupportedNetwork = "TRC20" | "ERC20" | "BEP20" | "SOL";

export interface AlphaExchangeUser {
  id: string;
  fullName: string;
  email: string;
  passwordHash: string;
  whatsappNumber: string;
  preferredNetworks: SupportedNetwork[];
  profilePhotoUrl: string;
  languages: string[];
  bio: string;
  tradingExperience?: string;
  workingHours?: string;
  preferredPaymentMethods?: string[];
  country?: string;
  city?: string;
  coverBannerUrl?: string;
  onlineStatus: SellerOnlineStatus;
  availabilityStatus: SellerAvailabilityStatus;
  lastActiveAt?: string;
  isFeaturedSeller?: boolean;
  isProfileHidden?: boolean;
  notificationPreferences?: NotificationPreferences;
  role: UserRole;
  sellerStatus: SellerStatus;
  isFoundingMember?: boolean;
  isFoundingSeller?: boolean;
  registeredViaInviteCodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  sms: boolean;
}

export type SellerApplicationStatus = "pending" | "approved" | "rejected";

export interface SellerApplication {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  whatsappNumber: string;
  preferredNetworks: string[];
  expectedMonthlyTradingVolume: string;
  additionalNotes: string;
  status: SellerApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export type ListingStatus = "draft" | "active" | "paused" | "matched" | "in_trade" | "expired" | "completed" | "cancelled" | "closed";

export interface SellerPublicProfile {
  sellerId: string;
  sellerName: string;
  profilePhotoUrl: string;
  memberSince: string;
  languages: string[];
  preferredNetworks: SupportedNetwork[];
  bio: string;
  tradingExperience?: string;
  workingHours?: string;
  preferredPaymentMethods?: string[];
  country?: string;
  city?: string;
  coverBannerUrl?: string;
  isFoundingSeller?: boolean;
  isFeaturedSeller?: boolean;
  isProfileHidden?: boolean;
  onlineStatus: SellerOnlineStatus;
  availabilityStatus: SellerAvailabilityStatus;
  lastActiveAt?: string;
}

export interface SellerProfileReviewEntry {
  id: string;
  tradeId: string;
  rating: number;
  comment: string;
  createdAt: string;
  buyerId: string;
  buyerName: string;
  verifiedPurchase: boolean;
  sellerResponse?: TradeReviewResponse;
}

export interface SellerProfileActivityEntry {
  id: string;
  type: "trade_completed" | "review_submitted" | "trust_score_updated" | "achievement_earned";
  message: string;
  createdAt: string;
}

export interface SellerOwnerToolData {
  auditHistory: AuditLogEntry[];
  commissionHistory: CommissionRecord[];
  tradeHistory: PurchaseRequest[];
}

export interface PremiumSellerProfileData {
  sellerId: string;
  profile: SellerPublicProfile;
  sellerLevel: SellerLevel;
  trustScore: number;
  completedTrades: number;
  tradeVolume: number;
  averageRating: number;
  responseTimeMinutes: number;
  completionRate: number;
  repeatBuyersPercent: number;
  totalReviews: number;
  yearsOnPlatform: number;
  badges: SellerBadge[];
  latestReviews: SellerProfileReviewEntry[];
  recentActivity: SellerProfileActivityEntry[];
  ownerTools?: SellerOwnerToolData;
}

export interface SellerReputationSnapshot {
  sellerId: string;
  trustScore: number;
  reliabilityScore: number;
  responseScore: number;
  activityScore: number;
  marketplacePosition: number;
  reputationSummary: string;
  level: SellerLevel;
  badges: SellerBadge[];
  rating: number;
  completedTrades: number;
  totalUsdtVolume: number;
  successRate: number;
  acceptanceRate: number;
  cancellationRate: number;
  completionRate: number;
  responseTimeMinutes: number;
  customerSatisfaction: number;
  recentActivityScore: number;
  accountAgeDays: number;
  profileCompletion: number;
  verificationScore: number;
  disputesLost: number;
  marketplaceViolations: number;
  listingQualityScore: number;
  profileViews: number;
  listingViews: number;
  tradeRequests: number;
  monthlyGrowthPercent: number;
  estimatedCommissionPaid: number;
  revenueGenerated: number;
  repeatBuyers: number;
  averageTradeSize: number;
}

export interface MarketplaceListing {
  id: string;
  sellerId: string;
  sellerDisplayName: string;
  photos: string[];
  originalAmount: string;
  availableAmount: string;
  price: string;
  currency: string;
  network: SupportedNetwork;
  paymentMethod: string;
  paymentMethods: string[];
  minimumTrade: string;
  maximumTrade: string;
  expiresAt?: string;
  expiredAt?: string;
  lastRenewedAt?: string;
  notes?: string;
  sellerDescription: string;
  responseTime: string;
  status: ListingStatus;
  activeTradeRequestId?: string;
  lockedAt?: string;
  ownerReviewReason?: string;
  ownerReviewedAt?: string;
  ownerReviewedBy?: string;
  completedAt?: string;
  cancelledAt?: string;
  closedAt?: string;
  blockingReason?: string;
  createdAt: string;
  updatedAt: string;
  sellerProfile?: SellerPublicProfile;
  sellerReputation?: SellerReputationSnapshot;
}

export type PurchaseRequestStatus =
  | "pending"
  | "accepted"
  | "payment_sent"
  | "usdt_sent"
  | "completed"
  | "locked"
  | "review_open"
  | "declined"
  | "cancelled";

export type TradeTimelineEventType =
  | "request_submitted"
  | "request_accepted"
  | "payment_sent"
  | "usdt_sent"
  | "trade_completed"
  | "trade_locked"
  | "review_unlocked"
  | "buyer_evidence_uploaded"
  | "seller_evidence_uploaded"
  | "request_declined"
  | "request_cancelled";

export interface TradeTimelineEntry {
  id: string;
  type: TradeTimelineEventType;
  actorUserId: string;
  actorRole: UserRole;
  message: string;
  createdAt: string;
}

export interface TradeReview {
  reviewerUserId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface TradeReviewResponse {
  responderUserId: string;
  message: string;
  createdAt: string;
}

export type TradeEvidenceSide = "buyer" | "seller";
export type TradeEvidenceStatus = "uploaded" | "replaced";

export interface TradeEvidenceFile {
  id: string;
  purchaseRequestId: string;
  side: TradeEvidenceSide;
  uploadedByUserId: string;
  uploadedAt: string;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  sizeBytes: number;
  storagePath: string;
  status: TradeEvidenceStatus;
}

export type NotificationCategory = "trade" | "listing" | "account" | "trust" | "application" | "dispute" | "report" | "system";

export interface AlphaExchangeNotification {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  isRead: boolean;
  relatedTradeId?: string;
  relatedListingId?: string;
  relatedHref?: string;
  createdAt: string;
}

export interface AlphaExchangeActivityLogEntry {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  details: string;
  createdAt: string;
}

export interface TradeDisputeCase {
  id: string;
  tradeId: string;
  purchaseRequestId: string;
  openedByUserId: string;
  sellerId: string;
  buyerId: string;
  reason: string;
  buyerEvidenceId?: string;
  sellerEvidenceId?: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
}

export interface SellerReport {
  id: string;
  reporterUserId: string;
  sellerId: string;
  purchaseRequestId?: string;
  reason: string;
  createdAt: string;
}

export type InviteCodeStatus = "active" | "expired" | "disabled";

export interface PrivateBetaInviteCode {
  id: string;
  code: string;
  status: InviteCodeStatus;
  maxUses: number;
  usedCount: number;
  expiresAt?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrivateBetaInviteUse {
  id: string;
  inviteCodeId: string;
  code: string;
  usedByUserId: string;
  usedByEmail: string;
  usedAt: string;
}

export type BetaFeedbackCategory = "bug" | "suggestion" | "confusing_ux" | "feature_request" | "performance" | "other";
export type BetaFeedbackStatus = "new" | "in_review" | "resolved";

export interface BetaFeedbackEntry {
  id: string;
  userId: string;
  category: BetaFeedbackCategory;
  message: string;
  status: BetaFeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export type BetaAnnouncementType = "maintenance" | "new_feature" | "bug_fix" | "known_issue";

export interface BetaAnnouncement {
  id: string;
  title: string;
  message: string;
  type: BetaAnnouncementType;
  isActive: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseRequest {
  id: string;
  tradeId?: string;
  buyerId: string;
  listingId: string;
  sellerId: string;
  buyerName: string;
  buyerWhatsapp: string;
  buyerNotes: string;
  usdtAmount: string;
  fiatAmount: string;
  currency: string;
  network: SupportedNetwork;
  paymentMethod: string;
  timeline: TradeTimelineEntry[];
  tradeCreatedAt?: string;
  paymentSentAt?: string;
  usdtSentAt?: string;
  completedAt?: string;
  timedOutAt?: string;
  timeoutReason?: string;
  lockedAt?: string;
  reviewUnlockedAt?: string;
  buyerEvidence?: TradeEvidenceFile;
  sellerEvidence?: TradeEvidenceFile;
  buyerReview?: TradeReview;
  sellerResponse?: TradeReviewResponse;
  status: PurchaseRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export type CommissionPaymentStatus = "pending" | "paid" | "overdue";

export interface CommissionRecord {
  id: string;
  purchaseRequestId: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  rate: number;
  grossAmount: number;
  commissionAmount: number;
  paymentStatus: CommissionPaymentStatus;
  dueAt?: string;
  paidAt?: string;
  overdueNotifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AuditAction =
  | "seller_approved"
  | "seller_rejected"
  | "seller_suspended"
  | "seller_reactivated"
  | "seller_featured"
  | "seller_hidden"
  | "seller_unhidden"
  | "listing_created"
  | "listing_expired"
  | "listing_renewed"
  | "listing_expiration_extended"
  | "listing_edited"
  | "listing_paused"
  | "listing_resumed"
  | "listing_matched"
  | "listing_reopened"
  | "listing_completed"
  | "listing_cancelled"
  | "listing_closed"
  | "listing_removed"
  | "purchase_request_submitted"
  | "purchase_completed"
  | "commission_recorded"
  | "commission_paid"
  | "commission_overdue"
  | "seller_vacation_enabled"
  | "seller_vacation_disabled"
  | "trade_timed_out"
  | "admin_override"
  | "trade_review_submitted"
  | "trade_review_responded"
  | "trust_score_updated"
  | "beta_invite_created"
  | "beta_invite_expired"
  | "beta_invite_disabled"
  | "beta_feedback_status_updated"
  | "beta_announcement_created"
  | "beta_announcement_updated"
  | "trade_evidence_uploaded"
  | "trade_evidence_replaced"
  | "trade_evidence_viewed_by_owner"
  | "trade_evidence_viewed_by_moderator"
  | "trade_evidence_downloaded";

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorUserId: string;
  targetUserId?: string;
  listingId?: string;
  purchaseRequestId?: string;
  details?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface TrustSnapshotRecord {
  sellerId: string;
  snapshot: SellerReputationSnapshot;
  updatedAt: string;
}

export interface TrustScoreChangeLog {
  id: string;
  sellerId: string;
  oldScore: number;
  newScore: number;
  reason: string;
  triggeredBy: string;
  createdAt: string;
}

export interface AlphaExchangeDb {
  users: AlphaExchangeUser[];
  sellerApplications: SellerApplication[];
  marketplaceListings: MarketplaceListing[];
  purchaseRequests: PurchaseRequest[];
  commissionRecords: CommissionRecord[];
  auditLogs: AuditLogEntry[];
  authSessions: AuthSession[];
  passwordResetTokens: PasswordResetToken[];
  notifications: AlphaExchangeNotification[];
  activityLog: AlphaExchangeActivityLogEntry[];
  disputes: TradeDisputeCase[];
  sellerReports: SellerReport[];
  trustSnapshots: TrustSnapshotRecord[];
  trustScoreHistory: TrustScoreChangeLog[];
  tradeEvidenceFiles: TradeEvidenceFile[];
  privateBetaInvites: PrivateBetaInviteCode[];
  privateBetaInviteUses: PrivateBetaInviteUse[];
  betaFeedback: BetaFeedbackEntry[];
  betaAnnouncements: BetaAnnouncement[];
}

export interface OwnerBusinessDashboardMetrics {
  today: {
    completedTrades: number;
    tradeVolumeUsdt: number;
    estimatedCommission: number;
    newBuyers: number;
    newSellers: number;
    newListings: number;
    listingsApproved: number;
    listingsRejected: number;
    pendingListings: number;
    pendingSellerApplications: number;
    openDisputes: number;
    resolvedDisputes: number;
    missingBuyerEvidence: number;
    missingSellerEvidence: number;
    tradesWaitingEvidence: number;
    evidenceVerified: number;
    evidenceMissing: number;
  };
  thisWeek: {
    tradeVolumeUsdt: number;
    revenue: number;
    topSeller: string;
    fastestGrowingSeller: string;
    highestTrustScoreIncrease: string;
    averageResponseTimeMinutes: number;
    averageTradeCompletionTimeMinutes: number;
    averageBuyerRating: number;
    repeatBuyersPercent: number;
  };
  sellerLeaderboard: Array<{
    sellerId: string;
    sellerName: string;
    trustScore: number;
    tradeVolumeUsdt: number;
    completedTrades: number;
    averageRating: number;
    responseTimeMinutes: number;
  }>;
  marketplaceHealth: {
    completionRatePercent: number;
    cancellationRatePercent: number;
    disputeRatePercent: number;
    averageTrustScore: number;
    activeSellers: number;
    activeBuyers: number;
    listingsSold: number;
    listingsWaitingApproval: number;
  };
  financialOverview: {
    estimatedCommissionToday: number;
    estimatedCommissionThisWeek: number;
    estimatedCommissionThisMonth: number;
    largestTradeUsdt: number;
    largestTradeId: string;
    largestSeller: string;
    averageTradeSizeUsdt: number;
  };
  liveActivity: Array<{
    id: string;
    type: "new_seller_joined" | "trade_completed" | "listing_approved" | "review_submitted" | "trust_score_updated" | "dispute_opened";
    message: string;
    createdAt: string;
  }>;
}

export interface OwnerPrivateBetaDashboardData {
  inviteCodes: PrivateBetaInviteCode[];
  inviteUses: PrivateBetaInviteUse[];
  pendingInvites: PrivateBetaInviteCode[];
  feedback: BetaFeedbackEntry[];
  feedbackSummary: {
    mostCommonRequests: Array<{ category: BetaFeedbackCategory; count: number }>;
    criticalBugs: number;
    suggestions: number;
    resolved: number;
  };
  announcements: BetaAnnouncement[];
}
