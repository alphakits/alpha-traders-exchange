import type { MobileLocale } from "@alpha-traders/contracts";

const ALPHA_TRADERS_WEB_ORIGIN = "https://www.alphatraders.co.il";

const trustedRoutes = {
  forgotPassword: "forgot-password",
  accountSettings: "settings",
  accountDeletion: "account-deletion",
  privacyPolicy: "privacy-policy",
  terms: "terms",
  support: "support",
} as const;

export type TrustedWebDestination = keyof typeof trustedRoutes;

/**
 * Builds external account and legal links from a fixed route allowlist.
 * No API response or user input can supply an arbitrary destination.
 */
export function trustedWebUrl(destination: TrustedWebDestination, locale: MobileLocale) {
  return `${ALPHA_TRADERS_WEB_ORIGIN}/${locale}/${trustedRoutes[destination]}`;
}
