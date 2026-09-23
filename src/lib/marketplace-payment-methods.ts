export const MARKETPLACE_PAYMENT_METHODS = [
  "Bank Transfer",
  "Face-to-Face (Meet in Person)",
  "Cardless ATM Withdrawal",
] as const;

export type MarketplacePaymentMethod = (typeof MARKETPLACE_PAYMENT_METHODS)[number];
export const MAX_LISTING_PAYMENT_METHODS = 3;

export const CASH_TRADE_COMPLETION_ELIGIBLE_STATUSES = [
  "usdt_sent",
] as const;

export const CASH_TRADE_USDT_SENT_CONFIRMATION_ELIGIBLE_STATUSES = [
  "funds_received",
  "usdt_release_pending",
] as const;

// Kept as a source-compatible alias for older imports. Face-to-Face and
// Cardless ATM now share the same protected, sequential cash workflow.
export const FACE_TO_FACE_COMPLETION_ELIGIBLE_STATUSES = CASH_TRADE_COMPLETION_ELIGIBLE_STATUSES;

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeMarketplacePaymentMethod(value: unknown): MarketplacePaymentMethod | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const token = normalizeToken(text);
  if (token === "bank transfer" || token === "bank transfer israel" || token === "تحويل بنكي") return "Bank Transfer";
  if (token === "face-to-face (meet in person)" || token === "face-to-face" || token === "face to face" || token === "meet in person" || token === "لقاء شخصي" || token === "لقاء مباشر وجهًا لوجه") {
    return "Face-to-Face (Meet in Person)";
  }
  if (token === "cardless atm withdrawal" || token === "cardless withdrawal" || token === "cardless atm" || token === "atm withdrawal" || token === "سحب بلا بطاقة" || token === "سحب من الصراف بلا بطاقة" || token === "سحب من الصراف دون بطاقة") {
    return "Cardless ATM Withdrawal";
  }
  return null;
}

export function resolveListingPaymentMethods(rawMethods: unknown, fallbackMethod?: unknown): MarketplacePaymentMethod[] {
  const normalized = new Set<MarketplacePaymentMethod>();
  if (Array.isArray(rawMethods)) {
    for (const method of rawMethods) {
      const next = normalizeMarketplacePaymentMethod(method);
      if (next) normalized.add(next);
    }
  }
  const fallback = normalizeMarketplacePaymentMethod(fallbackMethod);
  if (fallback) normalized.add(fallback);
  return Array.from(normalized);
}

export function getMarketplacePaymentMethodOptions(rawMethods: unknown, fallbackMethod?: unknown) {
  const availableMethods = new Set(resolveListingPaymentMethods(rawMethods, fallbackMethod));
  return MARKETPLACE_PAYMENT_METHODS.map((method) => ({
    method,
    available: availableMethods.has(method),
  }));
}

export function getDefaultListingPaymentMethods(rawSellerPreferences: unknown): MarketplacePaymentMethod[] {
  const preferredMethods = resolveListingPaymentMethods(rawSellerPreferences);
  return preferredMethods.length ? preferredMethods : ["Bank Transfer"];
}

export function isFaceToFacePaymentMethod(method: unknown) {
  return normalizeMarketplacePaymentMethod(method) === "Face-to-Face (Meet in Person)";
}

export function isFaceToFaceCompletionAvailable(method: unknown, status: unknown) {
  return isFaceToFacePaymentMethod(method)
    && typeof status === "string"
    && (CASH_TRADE_COMPLETION_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export function isCardlessAtmPaymentMethod(method: unknown) {
  return normalizeMarketplacePaymentMethod(method) === "Cardless ATM Withdrawal";
}

/** Face-to-Face and Cardless ATM use the same no-evidence cash workflow. */
export function isCashTradePaymentMethod(method: unknown) {
  return isFaceToFacePaymentMethod(method) || isCardlessAtmPaymentMethod(method);
}

export function isCashTradeCompletionAvailable(method: unknown, status: unknown) {
  return isCashTradePaymentMethod(method)
    && typeof status === "string"
    && (CASH_TRADE_COMPLETION_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

/** The explicit seller command also confirms USDT delivery for an in-person exchange. */
export function isSellerTradeCompletionAvailable(method: unknown, status: unknown) {
  if (!normalizeMarketplacePaymentMethod(method)) return false;
  return status === "usdt_sent" || (isFaceToFacePaymentMethod(method)
    && (status === "funds_received" || status === "usdt_release_pending"));
}

/** Cash trades record USDT as sent before the seller can complete the trade. */
export function isCashTradeUsdtSentConfirmationAvailable(method: unknown, status: unknown) {
  return isCashTradePaymentMethod(method)
    && typeof status === "string"
    && (CASH_TRADE_USDT_SENT_CONFIRMATION_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export function isBankTransferPaymentMethod(method: unknown) {
  return normalizeMarketplacePaymentMethod(method) === "Bank Transfer";
}

export function requiresSellerPayoutBankAccount(rawMethods: unknown, fallbackMethod?: unknown) {
  return resolveListingPaymentMethods(rawMethods, fallbackMethod).some(isBankTransferPaymentMethod);
}

export function requiresIsraeliBankSelection(rawMethods: unknown, fallbackMethod?: unknown) {
  return resolveListingPaymentMethods(rawMethods, fallbackMethod).some((method) =>
    isBankTransferPaymentMethod(method) || isCardlessAtmPaymentMethod(method),
  );
}

export function isBuyerEvidenceRequiredForPaymentMethod(method: unknown) {
  return !isCashTradePaymentMethod(method);
}

function resolveSellerEvidenceRequiredMethods() {
  const fallback = "Face-to-Face (Meet in Person)";
  const raw = (
    process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_REQUIRED_SELLER_EVIDENCE_METHODS
    ?? process.env.ALPHA_EXCHANGE_REQUIRED_SELLER_EVIDENCE_METHODS
    ?? fallback
  );
  const methods = new Set<MarketplacePaymentMethod>();
  for (const token of raw.split(",")) {
    const normalized = normalizeMarketplacePaymentMethod(token);
    if (normalized) methods.add(normalized);
  }
  if (!methods.size) {
    methods.add("Face-to-Face (Meet in Person)");
  }
  return methods;
}

export function isSellerEvidenceRequiredForPaymentMethod(method: unknown) {
  const normalized = normalizeMarketplacePaymentMethod(method);
  if (!normalized) return false;
  // Cash trades deliberately advance through explicit participant
  // confirmations. Neither side should be blocked on a photo upload.
  if (isCashTradePaymentMethod(normalized)) return false;
  return resolveSellerEvidenceRequiredMethods().has(normalized);
}
