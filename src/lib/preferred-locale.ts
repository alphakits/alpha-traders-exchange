import type { PreferredLocale } from "@/types/alpha-exchange";

export const DEFAULT_PREFERRED_LOCALE: PreferredLocale = "ar";

export function isPreferredLocale(value: unknown): value is PreferredLocale {
  return value === "ar" || value === "en";
}

/**
 * Normalizes persisted UI locale values. Legacy records default to the site's
 * Arabic locale; their old `languages` field was hard-coded to English and is
 * therefore not trustworthy evidence of a user's interface choice.
 */
export function normalizePreferredLocale(value: unknown): PreferredLocale {
  if (isPreferredLocale(value)) return value;
  return DEFAULT_PREFERRED_LOCALE;
}
