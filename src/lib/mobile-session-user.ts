import type { MobileSessionUser } from "@alpha-traders/contracts";
import { normalizePreferredLocale } from "@/lib/preferred-locale";
import { safeMobileMediaUrl } from "@/lib/mobile-safe-media-url";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { isOwnerApprovedSeller } from "@/lib/seller-approval";
import { normalizeRolesForUser, resolvePrimaryRole } from "@/lib/roles";

/** Native allowlist. Persistence credentials, contact numbers, bank accounts,
 * owner settings, and internal verification fields are excluded by default. */
export function toMobileSessionUser(user: AlphaExchangeUser): MobileSessionUser {
  const roles = normalizeRolesForUser({
    email: user.email,
    role: user.role,
    roles: user.roles,
    sellerStatus: user.sellerStatus,
    sellerApprovalVerification: user.sellerApprovalVerification,
  });
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: resolvePrimaryRole(roles),
    roles,
    sellerStatus: user.sellerStatus,
    sellerApprovalVerified: isOwnerApprovedSeller(user),
    preferredLocale: normalizePreferredLocale(user.preferredLocale),
    profilePhotoUrl: safeMobileMediaUrl(user.profilePhotoUrl),
    emailVerified: user.emailVerified === true,
    onboardingSelection: user.onboardingSelection,
    onboardingCompletedAt: user.onboardingCompletedAt,
    isFoundingMember: user.isFoundingMember === true,
    isFoundingSeller: user.isFoundingSeller === true,
  };
}
