export const MOBILE_API_VERSION = "v1" as const;
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
  | "INVALID_CREDENTIALS"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "ACCOUNT_DISABLED"
  | "BUYER_ROLE_REQUIRED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "REFRESH_TOKEN_REUSED"
  | "NOT_FOUND"
  | "LISTING_UNAVAILABLE"
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
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface MobileApiErrorResponse {
  error: {
    code: MobileApiErrorCode;
    message: string;
  };
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
  | { screen: "profile" };

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

export type MobileSupportedNetwork = "TRC20" | "ERC20" | "BEP20" | "SOL";

export interface MobileMarketplaceListing {
  id: string;
  displayNumber?: number;
  seller: {
    displayName: string;
    profilePhotoUrl: string;
    isOwner: boolean;
    isFoundingSeller: boolean;
    isFeaturedSeller: boolean;
    onlineStatus: "online" | "offline";
    availabilityStatus: "available" | "away" | "vacation";
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
  pagination: MobilePagination;
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
