export const MOBILE_API_VERSION = "v1" as const;
export const MOBILE_CURRENT_APP_VERSION = "1.2.0" as const;
export const MOBILE_MINIMUM_SUPPORTED_APP_VERSION = "1.0.0" as const;
export const MOBILE_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const MOBILE_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type MobileLocale = "ar" | "en";
export type MobilePlatform = "ios" | "android";
export type MobileUserRole =
  | "guest"
  | "student"
  | "buyer"
  | "pending_seller_approval"
  | "approved_seller"
  | "admin"
  | "owner";

export type MobileSellerStatus =
  | "buyer"
  | "pending_seller_approval"
  | "approved_seller"
  | "rejected"
  | "suspended";

export type MobileApiErrorCode =
  | "INVALID_REQUEST"
  | "DEVICE_HEADERS_REQUIRED"
  | "APP_UPDATE_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "ACCOUNT_DISABLED"
  | "BUYER_ROLE_REQUIRED"
  | "SELLER_ROLE_REQUIRED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "REFRESH_TOKEN_REUSED"
  | "NOT_FOUND"
  | "LISTING_UNAVAILABLE"
  | "LISTING_ACTION_NOT_ALLOWED"
  | "TRADE_NOT_FOUND"
  | "TRADE_ACTION_NOT_ALLOWED"
  | "TRADE_AMOUNT_INVALID"
  | "WALLET_ADDRESS_INVALID"
  | "PAYMENT_METHOD_INVALID"
  | "PRICE_OFFER_INVALID"
  | "SAFETY_ACKNOWLEDGEMENT_REQUIRED"
  | "ACTIVE_TRADE_EXISTS"
  | "PURCHASE_REQUEST_ALREADY_SUBMITTED"
  | "PENDING_BUYER_FEEDBACK"
  | "AWAITING_BUYER_CONFIRMATION"
  | "COMMISSION_DUE"
  | "MESSAGE_INVALID"
  | "DIRECT_CONTACT_BLOCKED"
  | "EVIDENCE_INVALID"
  | "DISPUTE_INVALID"
  | "REVIEW_INVALID"
  | "PROFILE_INVALID"
  | "PROFILE_UPDATE_FAILED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface MobileApiErrorResponse {
  error: {
    code: MobileApiErrorCode;
    message: string;
  };
  requestId: string;
}

export interface MobileAppConfigResponse {
  apiVersion: typeof MOBILE_API_VERSION;
  platform: MobilePlatform;
  currentVersion: string;
  minimumSupportedVersion: string;
  latestVersion: string;
  updateRequired: boolean;
  updateRecommended: boolean;
  checkedAt: string;
  requestId: string;
}

export interface MobileSessionUser {
  id: string;
  fullName: string;
  email: string;
  role: MobileUserRole;
  roles: MobileUserRole[];
  sellerStatus: MobileSellerStatus;
  preferredLocale: MobileLocale;
  profilePhotoUrl: string;
  emailVerified: boolean;
  onboardingSelection?: "guest" | "student" | "buyer" | "seller_applicant";
  onboardingCompletedAt?: string;
  isFoundingMember: boolean;
  isFoundingSeller: boolean;
}

export interface MobileAuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface MobileLoginRequest {
  email: string;
  password: string;
}

export interface MobileLoginResponse {
  user: MobileSessionUser;
  tokens: MobileAuthTokens;
  requestId: string;
}

export interface MobileRefreshRequest {
  refreshToken: string;
}

export interface MobileRefreshResponse {
  tokens: MobileAuthTokens;
  requestId: string;
}

export interface MobileMeResponse {
  user: MobileSessionUser;
  requestId: string;
}

export type MobileOnboardingRequest =
  | { action: "guest" }
  | { action: "student" }
  | {
      action: "buyer";
      firstName: string;
      lastName: string;
      displayName?: string;
    };

export interface MobileOnboardingResponse {
  user: MobileSessionUser;
  requestId: string;
}

export interface MobileSellerApplicationRequest {
  fullName?: string;
  whatsappNumber: string;
  preferredNetworks: string[];
  expectedMonthlyTradingVolume?: string;
  additionalNotes?: string;
}

export interface MobileSellerApplicationResponse {
  application: {
    id: string;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
    updatedAt: string;
  };
  user: MobileSessionUser;
  requestId: string;
}

export interface MobileAccountProfile {
  id: string;
  fullName: string;
  username: string;
  email: string;
  profilePhotoUrl: string;
  coverBannerUrl: string;
  role: MobileUserRole;
  sellerStatus: MobileSellerStatus;
  onlineStatus: "online" | "offline";
  bio: string;
  country: string;
  language: string;
  whatsappNumber: string;
  memberSince: string;
  lastLogin: string;
  showTradeStats: boolean;
  showLastActive: boolean;
  allowDirectMessages: boolean;
  allowProfileSearch: boolean;
  showPhonePublic: boolean;
  showEmailPublic: boolean;
}

export type MobileAccountRoleBadge =
  | "guest"
  | "student"
  | "buyer"
  | "pending_seller"
  | "approved_seller"
  | "administrator"
  | "owner";

export interface MobileBuyerActivityStats {
  level: "bronze" | "silver" | "gold" | "diamond" | "elite";
  nextLevel?: "bronze" | "silver" | "gold" | "diamond" | "elite";
  progressToNextLevelPercent: number;
  amountToNextLevelUsdt: number;
  requiredVolumeUsdt: number;
  lifetimeCompletedVolumeUsdt: number;
  activeTrades: number;
  completedTrades: number;
  reviewsGiven: number;
}

export type MobileAccountStats =
  | {
      kind: "buyer";
      level: "bronze" | "silver" | "gold" | "diamond" | "elite";
      lifetimeCompletedVolumeUsdt: number;
      activeTrades: number;
      completedTrades: number;
      reviewsGiven: number;
      nextLevel?: "bronze" | "silver" | "gold" | "diamond" | "elite";
      amountToNextLevelUsdt: number;
      requiredVolumeUsdt: number;
      progressToNextLevelPercent: number;
    }
  | {
      kind: "seller";
      level: "bronze" | "silver" | "gold" | "diamond" | "elite";
      lifetimeCompletedVolumeUsdt: number;
      completedTrades: number;
      activeListings: number;
      pendingListings: number;
      averageRating: number;
      trustScore: number;
      nextLevel?: "bronze" | "silver" | "gold" | "diamond" | "elite";
      amountToNextLevelUsdt: number;
      commissionPaidUsdt: number;
      averageTradeSizeUsdt: number;
      promotionHistory: Array<{
        id: string;
        rank: "bronze" | "silver" | "gold" | "diamond" | "elite";
        promotedAt: string;
      }>;
      buyerActivity: MobileBuyerActivityStats;
      progressToNextLevelPercent: number;
    };

export interface MobileAccountProfileUpdateRequest {
  fullName?: string;
  bio?: string;
  country?: string;
  language?: string;
  whatsappNumber?: string;
  showTradeStats?: boolean;
  showLastActive?: boolean;
  allowDirectMessages?: boolean;
  allowProfileSearch?: boolean;
  showPhonePublic?: boolean;
  showEmailPublic?: boolean;
}

export interface MobileAccountProfileResponse {
  profile: MobileAccountProfile;
  stats: MobileAccountStats;
  roleBadge: MobileAccountRoleBadge;
  roleLabel: string;
  accountStatuses: string[];
  user: MobileSessionUser;
  requestId: string;
}

export interface MobileProfilePhotoResponse {
  kind: "profile" | "cover";
  url: string;
  requestId: string;
}

export interface MobileLogoutResponse {
  revoked: true;
  scope: "device" | "all";
  requestId: string;
}

export interface MobilePagination {
  limit: number;
  offset: number;
  nextOffset: number | null;
}

export type MobileAcademyLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "ict"
  | "psychology"
  | "risk-management";

export type MobileLessonDifficulty = "easy" | "medium" | "hard" | "expert";

export interface MobileAcademyLessonSummary {
  id: string;
  slug: string;
  title: string;
  titleAr: string;
  module: string;
  moduleAr: string;
  description: string;
  descriptionAr: string;
  durationMinutes: number;
  order: number;
  lessonNumber: number;
  difficulty: MobileLessonDifficulty;
  hasVideo: boolean;
  hasWorkbook: boolean;
  quizQuestionCount: number;
}

export interface MobileAcademyCourse {
  id: string;
  slug: string;
  title: string;
  titleAr: string;
  summary: string;
  summaryAr: string;
  level: MobileAcademyLevel;
  order: number;
  thumbnailUrl: string;
  learningPoints: string[];
  learningPointsAr: string[];
  whyStart: string;
  whyStartAr: string;
  lessons: MobileAcademyLessonSummary[];
}

export interface MobileAcademyCatalogResponse {
  courses: MobileAcademyCourse[];
  contentRevision: string;
  requestId: string;
}

export interface MobileAcademyResource {
  id: string;
  label: string;
  labelAr: string;
  type: "link" | "pdf" | "slide" | "worksheet";
  url: string;
}

export interface MobileAcademyVisual {
  url: string;
  title: string;
  titleAr: string;
}

export interface MobileAcademyQuizQuestion {
  id: string;
  type: "multiple-choice" | "true-false";
  question: string;
  questionAr: string;
  options: string[];
  optionsAr: string[];
  correctIndex: number;
  explanation: string;
  explanationAr: string;
}

export interface MobileAcademyLesson extends MobileAcademyLessonSummary {
  courseId: string;
  summary: string;
  summaryAr: string;
  objectives: string[];
  objectivesAr: string[];
  takeaways: string[];
  takeawaysAr: string[];
  notes: string;
  notesAr: string;
  videoUrl: string;
  workbookUrl: string;
  presentationUrl: string;
  videoChapters: Array<{
    id: string;
    title: string;
    titleAr: string;
    timeSeconds: number;
  }>;
  resources: MobileAcademyResource[];
  quiz: MobileAcademyQuizQuestion[];
  quizPassingScore: number;
  narrative: {
    intro: string;
    introAr: string;
    keyConcepts: string[];
    keyConceptsAr: string[];
    practicalExamples: string[];
    practicalExamplesAr: string[];
    beginnerMistakes: string[];
    beginnerMistakesAr: string[];
    workbookIntro: string;
    workbookIntroAr: string;
    quizContext: string;
    quizContextAr: string;
    visuals: MobileAcademyVisual[];
  } | null;
}

export interface MobileAcademyLessonResponse {
  lesson: MobileAcademyLesson;
  course: MobileAcademyCourse;
  previousLesson: MobileAcademyLessonSummary | null;
  nextLesson: MobileAcademyLessonSummary | null;
  contentRevision: string;
  requestId: string;
}

export type MobileNotificationCategory =
  | "trade"
  | "listing"
  | "account"
  | "trust"
  | "application"
  | "dispute"
  | "report"
  | "system"
  | "review";

export type MobileNotificationPriority = "critical" | "high" | "normal" | "low";

export type MobileNotificationDestination =
  | { screen: "trade"; requestId: string }
  | { screen: "marketplace" }
  | { screen: "profile" }
  | { screen: "settings" }
  | { screen: "seller" }
  | { screen: "seller_application" }
  | { screen: "seller_commissions" }
  | { screen: "admin" };

/** Privacy-safe notification projection for an authenticated native device. */
export interface MobileNotification {
  id: string;
  category: MobileNotificationCategory;
  title: string;
  message: string;
  isRead: boolean;
  priority: MobileNotificationPriority;
  actionRequired: boolean;
  destination: MobileNotificationDestination | null;
  relatedDisplayNumber?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MobileNotificationsResponse {
  notifications: MobileNotification[];
  total: number;
  unreadCount: number;
  pagination: MobilePagination;
  requestId: string;
}

export interface MobileNotificationResponse {
  notification: MobileNotification;
  requestId: string;
}

export interface MobileNotificationsUpdateResponse {
  updated: true;
  requestId: string;
}

export interface MobileNotificationPreferences {
  inApp: boolean;
  email: boolean;
  sms: boolean;
}

export interface MobileNotificationPreferencesResponse {
  preferences: MobileNotificationPreferences;
  phone: {
    verified: boolean;
    masked: string | null;
  };
  requestId: string;
}

export type MobileNotificationPreferencesUpdateRequest = Partial<MobileNotificationPreferences>;

export type MobileSupportedNetwork = "TRC20" | "ERC20" | "BEP20" | "SOL";

export type MobileMarketplaceSort =
  | "trust-desc"
  | "price-asc"
  | "amount-desc"
  | "rating-desc"
  | "response-fast"
  | "newest";

export interface MobileMarketplaceFilters {
  network?: MobileSupportedNetwork;
  currency?: string;
  paymentMethod?: string;
  onlineOnly?: boolean;
  sort?: MobileMarketplaceSort;
}

export interface MobileMarketplaceListing {
  id: string;
  displayNumber?: number;
  seller: {
    displayName: string;
    profilePhotoUrl: string;
    isCurrentUser: boolean;
    isOwner: boolean;
    isFoundingSeller: boolean;
    isFeaturedSeller: boolean;
    emailVerified: boolean;
    onlineStatus: "online" | "offline";
    availabilityStatus: "available" | "away" | "vacation";
    lastActiveAt?: string;
    country?: string;
    level?: "bronze" | "silver" | "gold" | "diamond" | "elite";
    trustScore?: number;
    rating?: number;
    completedTrades?: number;
    responseTimeMinutes?: number;
  };
  photos: string[];
  availableAmount: string;
  price: string;
  currency: string;
  network: MobileSupportedNetwork;
  paymentMethods: string[];
  minimumTrade: string;
  maximumTrade: string;
  responseTime: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  actions: {
    canViewSellerProfile: boolean;
    canBuyNow: boolean;
    canMakeOffer: boolean;
  };
}

export interface MobileMarketplaceListingsResponse {
  listings: MobileMarketplaceListing[];
  total: number;
  facets: {
    networks: MobileSupportedNetwork[];
    currencies: string[];
    paymentMethods: string[];
  };
  pagination: MobilePagination;
  requestId: string;
}

export type MobileSellerAvailabilityStatus = "available" | "away" | "vacation";

export type MobileSellerListingStatus =
  | "draft"
  | "active"
  | "paused"
  | "matched"
  | "in_trade"
  | "expired"
  | "completed"
  | "cancelled"
  | "closed";

export type MobileSellerListingApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "changes_requested";

/** A bounded seller-owned listing projection for workspace collections. */
export interface MobileSellerListing {
  id: string;
  displayNumber?: number;
  availableAmount: string;
  price: string;
  currency: string;
  network: MobileSupportedNetwork;
  paymentMethods: string[];
  minimumTrade: string;
  maximumTrade: string;
  status: MobileSellerListingStatus;
  approvalStatus?: MobileSellerListingApprovalStatus;
  expiresAt?: string;
  updatedAt: string;
  actions: {
    canPause: boolean;
    canResume: boolean;
  };
}

/** Full editable details, visible only to the authenticated listing owner. */
export interface MobileSellerListingDetail extends MobileSellerListing {
  photos: string[];
  bankAccountId?: string;
  bankName?: string;
  sellerDescription: string;
  notes: string;
  responseTime: string;
  createdAt: string;
}

export interface MobileSellerListingCreateRequest {
  availableAmount: string;
  price: string;
  currency: string;
  network: MobileSupportedNetwork;
  paymentMethods: string[];
  bankAccountId?: string;
  bankName?: string;
  minimumTrade: string;
  maximumTrade: string;
  sellerDescription?: string;
  notes?: string;
  responseTime?: string;
  expirationHours?: number;
  acceptedCommissionPolicy: boolean;
}

export interface MobileSellerListingUpdateRequest extends Omit<MobileSellerListingCreateRequest, "acceptedCommissionPolicy"> {
  changeReason: "Changed available balance" | "Price updated" | "Network issue" | "Personal reason" | "Other";
  changeExplanation: string;
}

export interface MobileSellerBankAccount {
  id: string;
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountLast4: string;
  maskedAccountNumber: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MobileSellerBankAccountsResponse {
  bankAccounts: MobileSellerBankAccount[];
  requestId: string;
}

export interface MobileSellerBankAccountCreateRequest {
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  isDefault?: boolean;
}

export interface MobileAdminPendingListing {
  id: string;
  displayNumber?: number;
  sellerId: string;
  sellerDisplayName: string;
  availableAmount: string;
  price: string;
  currency: string;
  network: MobileSupportedNetwork;
  paymentMethods: string[];
  bankName?: string;
  minimumTrade: string;
  maximumTrade: string;
  sellerDescription: string;
  createdAt: string;
  updatedAt: string;
}

export interface MobileAdminSellerApplication {
  id: string;
  displayNumber?: number;
  userId: string;
  fullName: string;
  email: string;
  whatsappNumber: string;
  preferredNetworks: string[];
  expectedMonthlyTradingVolume: string;
  additionalNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface MobileAdminOverviewResponse {
  pendingListings: MobileAdminPendingListing[];
  pendingSellerApplications: MobileAdminSellerApplication[];
  metrics: {
    pendingListings: number;
    pendingSellerApplications: number;
    activeTrades: number;
    totalListings: number;
  };
  requestId: string;
}

export type MobileAdminReviewRequest =
  | {
      target: "listing";
      id: string;
      decision: "approve" | "reject" | "request_changes";
      reason?: string;
    }
  | {
      target: "seller_application";
      id: string;
      decision: "approve" | "reject";
      reason: string;
    };

export type MobileCommissionNetwork = "TRC20";

export interface MobileSellerCommissionRecord {
  commissionId: string;
  /** Exact USDT amount to transfer; includes the six-decimal verification suffix. */
  amountDue: number;
  /** Explicit alias for newer clients. Older clients use `amountDue`. */
  paymentAmountDue?: number;
  paymentVerificationStatus?: "pending_verification" | "verified" | "failed";
  paymentVerificationNotes?: string;
  paymentSignature?: string;
  paymentSubmittedAt?: string;
  /** Whether the submitted TxID may be replaced while automatic verification is pending. */
  paymentExpectedAmountMode?: "unique_v1" | "legacy_base";
  dueAt?: string;
  relatedRequestId: string;
  relatedTradeId?: string;
  relatedTradeDisplayNumber?: number;
}

export interface MobileSellerCommissionsResponse {
  status: "clear" | "pending" | "overdue";
  pendingCount: number;
  totalAmountDue: number;
  payableRecords: MobileSellerCommissionRecord[];
  paymentNetworks: Array<{
    network: MobileCommissionNetwork;
    label: string;
    available: boolean;
    walletAddress?: string;
    error?: string;
  }>;
  verification?: {
    verified: boolean;
    pending?: boolean;
    reference: string;
    notes: string;
  };
  requestId: string;
}

export interface MobileSellerCommissionPaymentRequest {
  commissionId: string;
  network: MobileCommissionNetwork;
  paymentSignature: string;
}

export interface MobileSellerWorkspaceSummary {
  activeListingLimit: number;
  openListingCount: number;
  openTradeCount: number;
  pendingCommissionCount: number;
  canCreateListing: boolean;
}

export interface MobileSellerListingsResponse {
  listings: MobileSellerListing[];
  total: number;
  pagination: MobilePagination;
  availabilityStatus: MobileSellerAvailabilityStatus;
  summary: MobileSellerWorkspaceSummary;
  requestId: string;
}

export interface MobileSellerListingResponse {
  listing: MobileSellerListing;
  requestId: string;
}

export interface MobileSellerListingDetailResponse {
  listing: MobileSellerListingDetail;
  requestId: string;
}

export interface MobileSellerAvailabilityResponse {
  availabilityStatus: MobileSellerAvailabilityStatus;
  requestId: string;
}

export type MobileSellerBadge =
  | "elite_seller"
  | "top_rated"
  | "fast_responder"
  | "trusted_seller"
  | "most_active"
  | "platinum_seller"
  | "trades_1000_plus";

export interface MobileSellerProfileReview {
  rating: number;
  comment: string;
  createdAt: string;
  buyerDisplayName: string;
  verifiedPurchase: boolean;
  sellerResponse?: {
    message: string;
    createdAt: string;
  };
}

export interface MobileSellerProfile {
  listingId: string;
  displayName: string;
  isCurrentUser: boolean;
  profilePhotoUrl: string;
  bio: string;
  memberSince: string;
  languages: string[];
  country: string;
  onlineStatus: "online" | "offline";
  availabilityStatus: "available" | "away" | "vacation";
  isEmailVerified: boolean;
  isOwner: boolean;
  isFoundingMember: boolean;
  isFoundingSeller: boolean;
  isFeaturedSeller: boolean;
  canBuyNow: boolean;
  canMakeOffer: boolean;
  level: "bronze" | "silver" | "gold" | "diamond" | "elite";
  trustScore: number;
  completedTrades: number;
  averageRating: number;
  responseTimeMinutes: number;
  completionRate: number;
  repeatBuyersPercent: number;
  totalReviews: number;
  publicVolumeRange: string;
  badges: MobileSellerBadge[];
  latestReviews: MobileSellerProfileReview[];
}

export interface MobileSellerProfileResponse {
  seller: MobileSellerProfile;
  requestId: string;
}

export type MobileTradeStatus =
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

export type MobileTradeTimelineEvent =
  | "request_submitted"
  | "price_offer_submitted"
  | "request_accepted"
  | "price_offer_accepted"
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
  | "price_offer_declined"
  | "request_cancelled"
  | "buyer_confirmed_receipt"
  | "buyer_confirmation_overdue"
  | "trade_closed_manually"
  | "trade_inactivity_warning_sent"
  | "bank_details_revealed";

export interface MobileTradeSummary {
  id: string;
  displayNumber?: number;
  side: "buyer" | "seller";
  status: MobileTradeStatus;
  usdtAmount: string;
  fiatAmount: string;
  pricePerUsdt: string;
  listingPriceAtRequest: string;
  priceMode: "listing_price" | "buyer_offer";
  currency: string;
  network: MobileSupportedNetwork;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
}

export interface MobileTradeMessage {
  sender: "you" | "counterparty" | "system";
  message: string;
  createdAt: string;
}

export interface MobileTradeReview {
  rating: number;
  comment: string;
  createdAt: string;
  sellerResponse?: {
    message: string;
    createdAt: string;
  };
}

export interface MobileTradeDetail extends MobileTradeSummary {
  counterpartyDisplayName: string;
  receivingWalletAddress?: string;
  timeline: Array<{
    type: MobileTradeTimelineEvent;
    createdAt: string;
  }>;
  messages: MobileTradeMessage[];
  hasBuyerEvidence: boolean;
  hasSellerEvidence: boolean;
  deadlineAt: string | null;
  timeRemainingSeconds: number | null;
  hasOpenDispute: boolean;
  buyerReview?: MobileTradeReview;
  actions: {
    canAccept: boolean;
    canDecline: boolean;
    canCancel: boolean;
    canViewBankDetails: boolean;
    canUploadPaymentEvidence: boolean;
    canConfirmFunds: boolean;
    canBeginRelease: boolean;
    canUploadReleaseEvidence: boolean;
    canConfirmReceived: boolean;
    canCompleteFaceToFace: boolean;
    canOpenDispute: boolean;
    canSubmitReview: boolean;
    canRespondToReview: boolean;
  };
}

export interface MobileCreateTradeRequest {
  listingId: string;
  usdtAmount: string;
  receivingWalletAddress: string;
  paymentMethod: string;
  priceMode: "listing_price" | "buyer_offer";
  offeredPrice?: string;
  safetyAcknowledged: boolean;
}

export interface MobileTradesResponse {
  trades: MobileTradeSummary[];
  total: number;
  pagination: MobilePagination;
  requestId: string;
}

export interface MobileTradeResponse {
  trade: MobileTradeSummary;
  requestId: string;
}

export interface MobileTradeDetailResponse {
  trade: MobileTradeDetail;
  requestId: string;
}

export interface MobileTradeMessageResponse {
  message: MobileTradeMessage;
  created: boolean;
  requestId: string;
}

export interface MobileTradeBankDetailsResponse {
  bankDetails: {
    accountHolderName: string;
    bankName: string;
    branchNumber: string;
    accountNumber: string;
    accountLast4: string;
  };
  requestId: string;
}
