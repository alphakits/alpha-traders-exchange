import type {
  AlphaExchangeUser,
  OnboardingSelection,
  PreferredLocale,
  SellerAvailabilityStatus,
  SellerLevel,
  SellerOnlineStatus,
  SellerStatus,
  SupportedNetwork,
  UserRole,
} from "@/types/alpha-exchange";
import { normalizePreferredLocale } from "@/lib/preferred-locale";

/**
 * The intentionally small, browser-safe representation of the current user.
 *
 * This is a runtime DTO, not an `Omit<AlphaExchangeUser, ...>`: new persistence
 * fields are excluded unless they are deliberately added here.
 */
export type ClientSessionUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  roles?: UserRole[];
  sellerStatus: SellerStatus;
  whatsappNumber: string;
  preferredNetworks: SupportedNetwork[];
  profilePhotoUrl: string;
  coverBannerUrl?: string;
  languages: string[];
  preferredLocale?: PreferredLocale;
  bio: string;
  tradingExperience?: string;
  workingHours?: string;
  preferredPaymentMethods?: string[];
  country?: string;
  city?: string;
  onlineStatus: SellerOnlineStatus;
  lastActiveAt?: string;
  isFeaturedSeller?: boolean;
  isProfileHidden?: boolean;
  isFoundingMember?: boolean;
  isFoundingSeller?: boolean;
  emailVerified?: boolean;
  isPhotoVerified?: boolean;
  buyerVerificationStatus?: "not_started" | "otp_sent" | "verified";
  onboardingSelection?: OnboardingSelection;
  onboardingCompletedAt?: string;
  createdAt: string;
};

/** Runtime allowlist for seller records rendered in the admin workspace. */
export type AdminSellerSummary = {
  id: string;
  fullName: string;
  email: string;
  whatsappNumber: string;
  role: UserRole;
  roles: UserRole[];
  sellerStatus: SellerStatus;
  availabilityStatus?: SellerAvailabilityStatus;
  lifetimeCompletedVolumeUsdt?: number;
  sellerPrestigeRank?: SellerLevel;
  sellerRankOverride?: {
    rank: SellerLevel;
    reason: string;
    setAt: string;
    setByUserId: string;
  };
  createdAt: string;
  updatedAt: string;
};

type ClientSessionUserOptions = {
  /** Allows server-only verification policy (for example a configured bypass) to be reflected as a boolean. */
  isPhotoVerified?: boolean;
};

/** Runtime allowlist for the small user summary rendered by the admin dashboard. */
export function toAdminUserSummary(user: AlphaExchangeUser) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    roles: user.roles ?? [user.role],
    disabled: user.disabled === true,
    createdAt: user.createdAt,
  };
}

/** Runtime allowlist for admin seller-management responses. */
export function toAdminSellerSummary(user: AlphaExchangeUser): AdminSellerSummary {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    whatsappNumber: user.whatsappNumber,
    role: user.role,
    roles: user.roles ?? [user.role],
    sellerStatus: user.sellerStatus,
    availabilityStatus: user.availabilityStatus,
    lifetimeCompletedVolumeUsdt: user.lifetimeCompletedVolumeUsdt,
    sellerPrestigeRank: user.sellerPrestigeRank,
    sellerRankOverride: user.sellerRankOverride
      ? {
          rank: user.sellerRankOverride.rank,
          reason: user.sellerRankOverride.reason,
          setAt: user.sellerRankOverride.setAt,
          setByUserId: user.sellerRankOverride.setByUserId,
        }
      : undefined,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** Runtime allowlist for server-to-client session bootstrap props. */
export function toClientSessionUser(
  user: AlphaExchangeUser | null,
  options: ClientSessionUserOptions = {},
): ClientSessionUser | null {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    roles: user.roles ?? [user.role],
    sellerStatus: user.sellerStatus,
    whatsappNumber: user.whatsappNumber,
    preferredNetworks: user.preferredNetworks,
    profilePhotoUrl: user.profilePhotoUrl,
    coverBannerUrl: user.coverBannerUrl,
    languages: user.languages,
    preferredLocale: normalizePreferredLocale(user.preferredLocale),
    bio: user.bio,
    tradingExperience: user.tradingExperience,
    workingHours: user.workingHours,
    preferredPaymentMethods: user.preferredPaymentMethods,
    country: user.country,
    city: user.city,
    onlineStatus: user.onlineStatus,
    lastActiveAt: user.lastActiveAt,
    isFeaturedSeller: user.isFeaturedSeller,
    isProfileHidden: user.isProfileHidden,
    isFoundingMember: user.isFoundingMember,
    isFoundingSeller: user.isFoundingSeller,
    emailVerified: user.emailVerified === true,
    isPhotoVerified: options.isPhotoVerified ?? Boolean(user.verifiedPhone && user.phoneVerifiedAt),
    buyerVerificationStatus: user.buyerVerificationStatus,
    onboardingSelection: user.onboardingSelection,
    onboardingCompletedAt: user.onboardingCompletedAt,
    createdAt: user.createdAt,
  };
}
