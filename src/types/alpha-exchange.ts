export type UserRole =
  | "guest"
  | "student"
  | "buyer"
  | "pending_seller_approval"
  | "approved_seller"
  | "admin"
  | "owner";
export type OnboardingSelection = "guest" | "student" | "buyer" | "seller_applicant";
export type SellerStatus = "buyer" | "pending_seller_approval" | "approved_seller" | "rejected" | "suspended";
export type SellerOnlineStatus = "online" | "offline";
export type SellerAvailabilityStatus = "available" | "away" | "vacation";
export const SELLER_LEVELS = ["bronze", "silver", "gold", "diamond", "elite"] as const;
export type SellerLevel = (typeof SELLER_LEVELS)[number];

const LEGACY_SELLER_LEVEL_MAP: Record<string, SellerLevel> = {
  platinum: "diamond",
  legendary: "elite",
};

export function isSellerLevel(value: string): value is SellerLevel {
  return (SELLER_LEVELS as readonly string[]).includes(value);
}

export function normalizeSellerLevel(value: string | null | undefined): SellerLevel | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (isSellerLevel(normalized)) return normalized;
  return LEGACY_SELLER_LEVEL_MAP[normalized] ?? null;
}

export type SellerBadge = "elite_seller" | "top_rated" | "fast_responder" | "trusted_seller" | "most_active" | "platinum_seller" | "trades_1000_plus";
export type SupportedNetwork = "TRC20" | "ERC20" | "BEP20" | "SOL";

export interface SellerRankOverride {
  rank: SellerLevel;
  reason: string;
  setAt: string;
  setByUserId: string;
}

export interface SellerPromotionHistoryEntry {
  id: string;
  rank: SellerLevel;
  previousRank?: SellerLevel;
  promotedAt: string;
  lifetimeCompletedVolumeUsdt: number;
  source: "automatic" | "admin_override";
  triggerTradeId?: string;
  reason?: string;
  actorUserId?: string;
}

export type SellerAchievementKey =
  | "first_trade"
  | "trades_100"
  | "fast_responder"
  | "customer_favorite"
  | "volume_500k"
  | "perfect_month"
  | "rising_star"
  | "trusted_veteran";

export interface SellerAchievement {
  id: string;
  key: SellerAchievementKey;
  title: string;
  description: string;
  earnedAt: string;
  source: "automatic";
  metadata?: Record<string, string | number | boolean | undefined>;
}

export interface SellerHallOfFameEntry {
  sellerId: string;
  sellerName: string;
  rank: SellerLevel;
  prestigeVolumeUsdt: number;
  achievements: SellerAchievement[];
  promotedAt: string;
  publicVolumeRange: string;
}

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
  showTradeStats?: boolean;
  showLastActive?: boolean;
  allowDirectMessages?: boolean;
  allowProfileSearch?: boolean;
  showPhonePublic?: boolean;
  showEmailPublic?: boolean;
  notificationPreferences?: NotificationPreferences;
  role: UserRole;
  roles?: UserRole[];
  sellerStatus: SellerStatus;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  emailVerificationTokenHash?: string;
  emailVerificationTokenExpiresAt?: string;
  emailVerificationSentAt?: string;
  isFoundingMember?: boolean;
  isFoundingSeller?: boolean;
  registeredViaInviteCodeId?: string;
  verifiedPhone?: string;
  phoneVerifiedAt?: string;
  phoneOtpHash?: string;
  phoneOtpSalt?: string;
  phoneOtpExpiresAt?: string;
  phoneOtpAttempts?: number;
  phoneOtpPhone?: string;
  buyerVerificationStatus?: "not_started" | "otp_sent" | "verified";
  buyerVerificationAttempts?: number;
  buyerVerificationWindowStartedAt?: string;
  buyerOtpSendsToday?: number;
  buyerOtpSendsDate?: string;
  buyerOtpRequestedAt?: string;
  buyerFirstName?: string;
  buyerLastName?: string;
  buyerDisplayName?: string;
  onboardingSelection?: OnboardingSelection;
  onboardingCompletedAt?: string;
  lifetimeCompletedVolumeUsdt?: number;
  sellerPrestigeRank?: SellerLevel;
  sellerRankOverride?: SellerRankOverride;
  sellerPromotionHistory?: SellerPromotionHistoryEntry[];
  sellerAchievements?: SellerAchievement[];
  disabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  browserPush?: boolean;
  browserPushTradeUpdates?: boolean;
  browserPushChatMessages?: boolean;
  browserPushListings?: boolean;
  browserPushFeedback?: boolean;
  browserPushAdminAlerts?: boolean;
  browserPushPromptDismissedAt?: string;
  browserPushPermissionState?: "default" | "granted" | "denied";
  browserPushSubscriptionHash?: string;
}

export type NotificationCenterCategory = "trades" | "listings" | "account" | "reviews" | "system" | "announcements";
export type NotificationPriorityLevel = "critical" | "high" | "normal" | "low";
export type NotificationState = "read" | "unread" | "archived";

export interface NotificationTradeSnapshot {
  requestId: string;
  requestDisplayNumber?: number;
  tradeId?: string;
  tradeDisplayNumber?: number;
  listingDisplayNumber?: number;
  sellerId: string;
  buyerId: string;
  counterpartyName: string;
  counterpartyAvatarUrl?: string;
  usdtAmount: string;
  fiatAmount: string;
  currency: string;
  currentStage: string;
  requiredAction: string;
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
  displayNumber?: number;
  createdAt: string;
  updatedAt: string;
}

export type ListingStatus = "draft" | "active" | "paused" | "matched" | "in_trade" | "expired" | "completed" | "cancelled" | "closed";
export type ListingApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested";

export interface SellerPublicProfile {
  sellerId: string;
  sellerName: string;
  publicTradingName?: string;
  fullName?: string;
  username?: string;
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
  isFoundingMember?: boolean;
  isProfileHidden?: boolean;
  isOwner?: boolean;
  role?: UserRole;
  roles?: UserRole[];
  sellerStatus?: SellerStatus;
  allowDirectMessages?: boolean;
  isEmailVerified?: boolean;
  contact?: {
    email: string;
    phone: string;
  };
  onlineStatus: SellerOnlineStatus;
  availabilityStatus: SellerAvailabilityStatus;
  lastActiveAt?: string;
}

export interface SellerReviewRecord {
  id: string;
  tradeId: string;
  buyerId: string;
  sellerId: string;
  rating: number;
  comment: string;
  sellerReply?: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  hidden: boolean;
  hiddenReason?: string;
  verifiedTrade: boolean;
  tradeAmount: string;
  network: string;
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
  nextRank?: SellerLevel;
  progressToNextRankPercent: number;
  amountToNextRankUsdt: number;
  publicVolumeRange: string;
  lifetimeCompletedVolumeUsdt: number;
  trustScore: number;
  completedTrades: number;
  tradeVolume?: number;
  exactTradeVolume?: number;
  commissionPaid: number;
  averageTradeSize: number;
  averageRating: number;
  responseTimeMinutes: number;
  completionRate: number;
  repeatBuyersPercent: number;
  totalReviews: number;
  yearsOnPlatform: number;
  badges: SellerBadge[];
  promotionHistory: SellerPromotionHistoryEntry[];
  achievements: SellerAchievement[];
  prestigeVolumeUsdt: number;
  prestigeVolumePublicLabel: string;
  hallOfFameEligible: boolean;
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
  publicVolumeRange?: string;
  nextRank?: SellerLevel;
  remainingVolumeToNextRank?: number;
  prestigeProgressPercent?: number;
  lifetimeCompletedVolumeUsdt?: number;
  prestigeVolumeUsdt?: number;
  isRankOverridden?: boolean;
}

export interface MarketplaceListing {
  id: string;
  sellerId: string;
  sellerDisplayName: string;
  photos: string[];
  displayNumber?: number;
  originalAmount: string;
  availableAmount: string;
  price: string;
  currency: string;
  network: SupportedNetwork;
  paymentMethod: string;
  paymentMethods: string[];
  bankName?: string;
  minimumTrade: string;
  maximumTrade: string;
  expiresAt?: string;
  expiredAt?: string;
  expirationEmailPendingAt?: string;
  expirationEmailSentAt?: string;
  lastRenewedAt?: string;
  notes?: string;
  sellerDescription: string;
  responseTime: string;
  status: ListingStatus;
  approvalStatus?: ListingApprovalStatus;
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
  | "funds_received"
  | "usdt_release_pending"
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
  | "seller_confirmed_funds"
  | "usdt_release_started"
  | "usdt_sent"
  | "trade_completed"
  | "trade_timed_out"
  | "trade_locked"
  | "review_unlocked"
  | "dispute_opened"
  | "commission_recorded"
  | "commission_paid"
  | "buyer_evidence_uploaded"
  | "seller_evidence_uploaded"
  | "request_declined"
  | "request_cancelled"
  | "buyer_confirmed_receipt"
  | "buyer_confirmation_overdue";

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
  hidden?: boolean;
  hiddenReason?: string;
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

export interface TradeChatMessage {
  id: string;
  purchaseRequestId: string;
  kind: "user" | "system";
  senderUserId: string;
  senderRole: UserRole;
  message: string;
  imageUrl?: string;
  imageName?: string;
  imageMimeType?: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  seenAt?: string;
  readByUserIds: string[];
  deletedAt?: string;
}

export type NotificationCategory = "trade" | "listing" | "account" | "trust" | "application" | "dispute" | "report" | "system" | "review";

export interface AlphaExchangeNotification {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  isRead: boolean;
  relatedTradeId?: string;
  relatedRequestId?: string;
  relatedListingId?: string;
  relatedRequestDisplayNumber?: number;
  relatedTradeDisplayNumber?: number;
  relatedListingDisplayNumber?: number;
  relatedHref?: string;
  actionHref?: string;
  actionLabel?: string;
  reason?: string;
  centerCategory?: NotificationCenterCategory;
  state?: NotificationState;
  priority?: NotificationPriorityLevel;
  priorityRank?: number;
  tradeSnapshot?: NotificationTradeSnapshot;
  archivedAt?: string;
  updatedAt?: string;
  createdAt: string;
}

export interface AlphaExchangeTradeReminder {
  requestId: string;
  tradeId: string;
  displayNumber?: number;
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
  relatedListingId?: string;
  relatedListingDisplayNumber?: number;
  priority: "high" | "critical";
  kind: "buyer_action_required" | "seller_action_required" | "feedback_required";
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
  displayNumber?: number;
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
  displayNumber?: number;
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

export type AdminAnnouncementAudience =
  | "all_verified_users"
  | "buyers"
  | "approved_sellers"
  | "administrators";

export type AdminAnnouncementStatus =
  | "queued"
  | "sending"
  | "completed"
  | "partial_failure"
  | "failed";

export type AdminAnnouncementRecipientStatus = "pending" | "sent" | "failed";

export interface AdminAnnouncementRecipient {
  userId: string;
  email: string;
  name: string;
  status: AdminAnnouncementRecipientStatus;
  batchIndex: number;
  attemptedAt?: string;
  attemptCount?: number;
  retryCount?: number;
  lastRetryAfterMs?: number;
  lastBatchKey?: string;
  providerEmailId?: string;
  providerStatus?: number;
  failureReason?: string;
}

export interface AdminAnnouncementRun {
  id: string;
  requestKey: string;
  audience: AdminAnnouncementAudience;
  subject: string;
  title: string;
  content: string;
  ctaText: string;
  ctaUrl: string;
  status: AdminAnnouncementStatus;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  recipients: AdminAnnouncementRecipient[];
  createdByUserId: string;
  startedAt: string;
  finishedAt?: string;
  batchLockedAt?: string;
  batchLockId?: string;
  lastProviderRequestAt?: string;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseRequest {
  id: string;
  tradeId?: string;
  displayNumber?: number;
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
  buyerReceivingWalletAddress?: string;
  paymentMethod: string;
  buyerSafetyAcknowledged?: boolean;
  sellerSafetyAcknowledged?: boolean;
  bankName?: string;
  timeline: TradeTimelineEntry[];
  tradeCreatedAt?: string;
  paymentSentAt?: string;
  fundsReceivedAt?: string;
  usdtReleaseStartedAt?: string;
  usdtReleaseDeadlineAt?: string;
  usdtSentAt?: string;
  completedAt?: string;
  timedOutAt?: string;
  timeoutReason?: string;
  buyerConfirmationArchivedAt?: string;
  lockedAt?: string;
  reviewUnlockedAt?: string;
  buyerEvidence?: TradeEvidenceFile;
  sellerEvidence?: TradeEvidenceFile;
  buyerReview?: TradeReview;
  sellerResponse?: TradeReviewResponse;
  messages?: TradeChatMessage[];
  status: PurchaseRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export type CommissionPaymentStatus = "pending" | "paid" | "overdue";

export interface CommissionRecord {
  id: string;
  purchaseRequestId: string;
  tradeId?: string;
  displayNumber?: number;
  listingId: string;
  sellerId: string;
  buyerId: string;
  rate: number;
  grossAmount: number;
  commissionAmount: number;
  paymentStatus: CommissionPaymentStatus;
  paymentProvider?: "phantom" | "crypto_wallet" | "qa_reset";
  paymentNetwork?: string;
  payerWalletAddress?: string;
  recipientWalletAddress?: string;
  paymentSignature?: string;
  paymentVerificationStatus?: "pending_verification" | "verified" | "failed";
  paymentVerificationNotes?: string;
  paymentSubmittedAt?: string;
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
  | "admin_announcement_started"
  | "admin_announcement_completed"
  | "trade_evidence_uploaded"
  | "trade_evidence_replaced"
  | "trade_evidence_viewed_by_owner"
  | "trade_evidence_viewed_by_moderator"
  | "trade_evidence_downloaded"
  | "seller_prestige_promoted"
  | "seller_prestige_overridden";

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

export type SmsDeliveryStatus = "queued" | "sent" | "delivered" | "failed";
export type SmsEventType =
  | "seller_application_submitted"
  | "trade_requires_admin_review"
  | "purchase_request_created"
  | "trade_accepted"
  | "payment_sent"
  | "funds_received"
  | "usdt_sent"
  | "trade_completed";

export interface SmsDeliveryRecord {
  id: string;
  eventKey: string;
  eventType: SmsEventType;
  recipientUserId: string;
  /** E.164 number; never return this field to browser clients. */
  recipientPhone: string;
  body: string;
  status: SmsDeliveryStatus;
  retryCount: number;
  twilioMessageSid?: string;
  providerStatus?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  deliveredAt?: string;
  failedAt?: string;
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
  tradeMessages?: TradeChatMessage[];
  privateBetaInvites: PrivateBetaInviteCode[];
  privateBetaInviteUses: PrivateBetaInviteUse[];
  betaFeedback: BetaFeedbackEntry[];
  betaAnnouncements: BetaAnnouncement[];
  adminAnnouncementRuns: AdminAnnouncementRun[];
  sellerReviews: SellerReviewRecord[];
  smsDeliveries?: SmsDeliveryRecord[];
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
