export const MARKETPLACE_PAYMENT_METHODS = [
  "Bank Transfer",
  "Face-to-Face (Meet in Person)",
  "Cardless ATM Withdrawal",
] as const;

export type MarketplacePaymentMethod = (typeof MARKETPLACE_PAYMENT_METHODS)[number];
export const MAX_LISTING_PAYMENT_METHODS = 2;

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeMarketplacePaymentMethod(value: unknown): MarketplacePaymentMethod | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const token = normalizeToken(text);
  if (token === "bank transfer" || token === "bank transfer israel") return "Bank Transfer";
  if (token === "face-to-face (meet in person)" || token === "face-to-face" || token === "face to face" || token === "meet in person") {
    return "Face-to-Face (Meet in Person)";
  }
  if (token === "cardless atm withdrawal" || token === "cardless atm" || token === "atm withdrawal") {
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

export function isFaceToFacePaymentMethod(method: unknown) {
  return normalizeMarketplacePaymentMethod(method) === "Face-to-Face (Meet in Person)";
}

export function isCardlessAtmPaymentMethod(method: unknown) {
  return normalizeMarketplacePaymentMethod(method) === "Cardless ATM Withdrawal";
}

export function isBankTransferPaymentMethod(method: unknown) {
  return normalizeMarketplacePaymentMethod(method) === "Bank Transfer";
}

export function requiresIsraeliBankSelection(rawMethods: unknown, fallbackMethod?: unknown) {
  return resolveListingPaymentMethods(rawMethods, fallbackMethod).some((method) =>
    isBankTransferPaymentMethod(method) || isCardlessAtmPaymentMethod(method),
  );
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
  return resolveSellerEvidenceRequiredMethods().has(normalized);
}
