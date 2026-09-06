import type { MobileSessionUser } from "@alpha-traders/contracts";
import { normalizePreferredLocale } from "@/lib/preferred-locale";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

/** Native allowlist. Persistence credentials, contact numbers, bank accounts,
 * owner settings, and internal verification fields are excluded by default. */
export function toMobileSessionUser(user: AlphaExchangeUser): MobileSessionUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    roles: user.roles ?? [user.role],
    sellerStatus: user.sellerStatus,
    preferredLocale: normalizePreferredLocale(user.preferredLocale),
    profilePhotoUrl: user.profilePhotoUrl,
    emailVerified: user.emailVerified === true,
    onboardingSelection: user.onboardingSelection,
    onboardingCompletedAt: user.onboardingCompletedAt,
    isFoundingMember: user.isFoundingMember === true,
    isFoundingSeller: user.isFoundingSeller === true,
  };
}
