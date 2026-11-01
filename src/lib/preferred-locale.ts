import type { PreferredLocale } from "@/types/alpha-exchange";

export const DEFAULT_PREFERRED_LOCALE: PreferredLocale = "en";

export function isPreferredLocale(value: unknown): value is PreferredLocale {
  return value === "ar" || value === "en";
}

/**
 * Keep supported explicit choices. Missing or invalid preferences follow the
 * English site default; never infer a choice from the legacy `languages` field.
 */
export function normalizePreferredLocale(value: unknown): PreferredLocale {
  if (isPreferredLocale(value)) return value;
  return DEFAULT_PREFERRED_LOCALE;
}
