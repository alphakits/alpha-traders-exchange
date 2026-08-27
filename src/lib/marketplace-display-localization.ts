import {
  normalizeMarketplacePaymentMethod,
  resolveListingPaymentMethods,
} from "@/lib/marketplace-payment-methods";

export type MarketplaceDisplayLocale = "ar" | "en";

const ARABIC_TEXT_PATTERN = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;

const PAYMENT_METHOD_LABELS = {
  "Bank Transfer": { ar: "تحويل بنكي", en: "Bank Transfer" },
  "Face-to-Face (Meet in Person)": { ar: "لقاء مباشر وجهًا لوجه", en: "Face-to-Face (Meet in Person)" },
  "Cardless ATM Withdrawal": { ar: "سحب من الصراف دون بطاقة", en: "Cardless ATM Withdrawal" },
} as const;

const PAYMENT_METHOD_ALIASES: Record<string, keyof typeof PAYMENT_METHOD_LABELS> = {
  "تحويل بنكي": "Bank Transfer",
  "تحويل مصرفي": "Bank Transfer",
  "لقاء مباشر وجهًا لوجه": "Face-to-Face (Meet in Person)",
  "لقاء شخصي": "Face-to-Face (Meet in Person)",
  "سحب من الصراف دون بطاقة": "Cardless ATM Withdrawal",
  "سحب من الصراف بلا بطاقة": "Cardless ATM Withdrawal",
};

const LANGUAGE_LABELS: Record<string, { ar: string; en: string }> = {
  ar: { ar: "العربية", en: "Arabic" },
  arabic: { ar: "العربية", en: "Arabic" },
  العربية: { ar: "العربية", en: "Arabic" },
  en: { ar: "الإنجليزية", en: "English" },
  english: { ar: "الإنجليزية", en: "English" },
  الإنجليزية: { ar: "الإنجليزية", en: "English" },
  he: { ar: "العبرية", en: "Hebrew" },
  hebrew: { ar: "العبرية", en: "Hebrew" },
  العبرية: { ar: "العبرية", en: "Hebrew" },
  "עברית": { ar: "العبرية", en: "Hebrew" },
};

const TRUST_FLAG_REASON_LABELS: Record<string, { ar: string; en: string }> = {
  marketplace_violations: { ar: "مخالفات في السوق", en: "Marketplace violations" },
  "marketplace violations": { ar: "مخالفات في السوق", en: "Marketplace violations" },
  disputes_lost: { ar: "نزاعات خسرها البائع", en: "Disputes lost" },
  "disputes lost": { ar: "نزاعات خسرها البائع", en: "Disputes lost" },
  high_cancellation_rate: { ar: "معدل إلغاء مرتفع", en: "High cancellation rate" },
  "high cancellation rate": { ar: "معدل إلغاء مرتفع", en: "High cancellation rate" },
  low_trust_score: { ar: "درجة ثقة منخفضة", en: "Low trust score" },
  "low trust score": { ar: "درجة ثقة منخفضة", en: "Low trust score" },
};

function normalizedToken(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

/**
 * Localizes a system-defined marketplace payment rail without leaking an
 * unknown English legacy value into Arabic UI.
 */
export function marketplacePaymentMethodLabelForLocale(value: string, locale: MarketplaceDisplayLocale) {
  const trimmed = value.trim();
  const normalized = normalizeMarketplacePaymentMethod(trimmed) ?? PAYMENT_METHOD_ALIASES[normalizedToken(trimmed)];
  if (normalized) return PAYMENT_METHOD_LABELS[normalized][locale];
  if (locale === "ar") return ARABIC_TEXT_PATTERN.test(trimmed) ? trimmed : "طريقة دفع أخرى";
  return trimmed && !ARABIC_TEXT_PATTERN.test(trimmed) ? trimmed : "Other payment method";
}

export function marketplacePaymentMethodLabelsForLocale(
  rawMethods: unknown,
  fallbackMethod: unknown,
  locale: MarketplaceDisplayLocale,
) {
  return resolveListingPaymentMethods(rawMethods, fallbackMethod).map((method) =>
    marketplacePaymentMethodLabelForLocale(method, locale),
  );
}

/** Localizes stored language names while preserving same-language custom text. */
export function spokenLanguageLabelForLocale(value: string, locale: MarketplaceDisplayLocale) {
  const trimmed = value.trim();
  const known = LANGUAGE_LABELS[normalizedToken(trimmed)];
  if (known) return known[locale];
  if (locale === "ar") return ARABIC_TEXT_PATTERN.test(trimmed) ? trimmed : "لغة أخرى";
  return trimmed && !ARABIC_TEXT_PATTERN.test(trimmed) ? trimmed : "Other language";
}

/**
 * Supports both current fixed English values and stable reason codes so legacy
 * snapshots remain readable after the UI switches language.
 */
export function trustFlagReasonLabelForLocale(value: string, locale: MarketplaceDisplayLocale) {
  const trimmed = value.trim();
  const known = TRUST_FLAG_REASON_LABELS[normalizedToken(trimmed)];
  if (known) return known[locale];
  if (locale === "ar") return ARABIC_TEXT_PATTERN.test(trimmed) ? trimmed : "يحتاج الحساب إلى مراجعة";
  return trimmed && !ARABIC_TEXT_PATTERN.test(trimmed) ? trimmed : "Account requires review";
}
