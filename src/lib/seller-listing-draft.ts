export type SellerListingDraft = {
  availableAmount: string;
  price: string;
  currency: string;
  network: "TRC20" | "ERC20" | "BEP20" | "SOL";
  paymentMethods: string;
  bankName: string;
  minimumTrade: string;
  maximumTrade: string;
};

export function createDefaultSellerListingDraft(): SellerListingDraft {
  return {
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20",
    paymentMethods: "Bank Transfer",
    bankName: "",
    minimumTrade: "0",
    maximumTrade: "",
  };
}

export function getSellerListingDraftStorageKey(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase();
  return normalizedEmail ? `alpha-exchange.listing-draft.${normalizedEmail}` : "alpha-exchange.listing-draft";
}

export function normalizeSellerListingDraft(input?: Partial<SellerListingDraft> | null, fallback: SellerListingDraft = createDefaultSellerListingDraft()): SellerListingDraft {
  const network = input?.network === "TRC20" || input?.network === "ERC20" || input?.network === "BEP20" || input?.network === "SOL" ? input.network : fallback.network;

  return {
    availableAmount: typeof input?.availableAmount === "string" ? input.availableAmount : fallback.availableAmount,
    price: typeof input?.price === "string" ? input.price : fallback.price,
    currency: typeof input?.currency === "string" && input.currency.trim() ? input.currency : fallback.currency,
    network,
    paymentMethods: typeof input?.paymentMethods === "string" ? input.paymentMethods : fallback.paymentMethods,
    bankName: typeof input?.bankName === "string" ? input.bankName : fallback.bankName,
    minimumTrade: typeof input?.minimumTrade === "string" ? input.minimumTrade : fallback.minimumTrade,
    maximumTrade: typeof input?.maximumTrade === "string" ? input.maximumTrade : fallback.maximumTrade,
  };
}

export function readSellerListingDraft(email?: string | null, fallback: SellerListingDraft = createDefaultSellerListingDraft()): SellerListingDraft {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(getSellerListingDraftStorageKey(email));
    if (!raw) return fallback;
    return normalizeSellerListingDraft(JSON.parse(raw) as Partial<SellerListingDraft> | null, fallback);
  } catch {
    return fallback;
  }
}

export function persistSellerListingDraft(email: string | null | undefined, draft: SellerListingDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getSellerListingDraftStorageKey(email), JSON.stringify(draft));
  } catch {
    // Ignore persistence failures so the seller flow still works.
  }
}
