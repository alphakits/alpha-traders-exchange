import type {
  MaskedWiseUsdAccount,
  WiseUsdAccount,
  WiseUsdAccountDetails,
  WiseUsdAccountSnapshot,
} from "../types/wise";

export type WiseUsdAccountValidationResult =
  | { success: true; data: WiseUsdAccountDetails }
  | { success: false; errors: Record<string, string> };

const DETAIL_KEYS = [
  "provider", "currency", "countryCode", "accountHolderType", "accountHolderName",
  "bankName", "bankAddress", "routingNumber", "accountNumber", "accountType",
] as const;

// Reject controls and text-direction overrides, while allowing international names.
const UNSAFE_TEXT = /[\p{Cc}\p{Cs}\u200e\u200f\u202a-\u202e\u2066-\u2069<>]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trim outer whitespace only. Never strip punctuation, coerce numbers, or invent fields. */
export function normalizeWiseUsdAccountInput(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {};
  const result: Record<string, unknown> = {};
  for (const key of DETAIL_KEYS) {
    if (Object.hasOwn(input, key)) {
      const value = input[key];
      result[key] = typeof value === "string" ? value.trim() : value;
    }
  }
  return result;
}

function isValidText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string"
    && [...value].length >= min
    && [...value].length <= max
    && !UNSAFE_TEXT.test(value);
}

/** Syntax only: a passing checksum does not prove an account or bank exists. */
export function isValidAchRoutingNumber(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{9}$/.test(value)) return false;
  const prefix = Number(value.slice(0, 2));
  // ABA electronic-payment series. Government/check-only series are outside this draft.
  if (!((prefix >= 1 && prefix <= 12) || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72))) {
    return false;
  }
  const digits = [...value].map(Number);
  const checksum = 3 * (digits[0] + digits[3] + digits[6])
    + 7 * (digits[1] + digits[4] + digits[7])
    + digits[2] + digits[5] + digits[8];
  return checksum % 10 === 0;
}

/** String storage preserves leading zeroes. This is not account-existence verification. */
export function isValidWiseUsdAccountNumber(value: unknown): value is string {
  return typeof value === "string" && /^\d{4,17}$/.test(value) && !/^0+$/.test(value);
}

export function parseWiseUsdAccountDetails(input: unknown): WiseUsdAccountValidationResult {
  const value = normalizeWiseUsdAccountInput(input);
  const errors: Record<string, string> = {};
  if (value.provider !== "wise") errors.provider = "Choose Wise as the bank-transfer provider.";
  if (value.currency !== "USD") errors.currency = "USD accounts only.";
  if (value.countryCode !== "US") errors.countryCode = "Enter US account details for USD ACH transfers.";
  if (value.accountHolderType !== "personal") errors.accountHolderType = "Personal accounts only.";
  if (!isValidText(value.accountHolderName, 2, 140) || !/\p{L}/u.test(value.accountHolderName)) {
    errors.accountHolderName = "Enter the full legal account-holder name shown in your Wise USD details.";
  }
  if (!isValidText(value.bankName, 2, 140) || !/\p{L}/u.test(value.bankName)) {
    errors.bankName = "Enter the bank name shown in your Wise USD account details.";
  }
  if (value.bankAddress !== undefined && value.bankAddress !== "" && !isValidText(value.bankAddress, 2, 300)) {
    errors.bankAddress = "Enter a valid bank address, or leave it empty.";
  }
  if (!isValidAchRoutingNumber(value.routingNumber)) {
    errors.routingNumber = "Enter a valid 9-digit ACH routing number without spaces or punctuation.";
  }
  if (!isValidWiseUsdAccountNumber(value.accountNumber)) {
    errors.accountNumber = "Enter 4–17 account-number digits, including any leading zeroes.";
  }
  if (value.accountType !== "checking" && value.accountType !== "savings") {
    errors.accountType = "Choose checking or savings exactly as shown in your account details.";
  }
  if (Object.keys(errors).length) return { success: false, errors };

  // This allowlist intentionally excludes client-supplied IDs, review metadata and extra fields.
  return {
    success: true,
    data: {
      provider: "wise",
      currency: "USD",
      countryCode: "US",
      accountHolderType: "personal",
      accountHolderName: value.accountHolderName as string,
      bankName: value.bankName as string,
      ...(value.bankAddress ? { bankAddress: value.bankAddress as string } : {}),
      routingNumber: value.routingNumber as string,
      accountNumber: value.accountNumber as string,
      accountType: value.accountType as WiseUsdAccountDetails["accountType"],
    },
  };
}

/** Exact private comparison value; it contains account details and must never be logged. */
export function getWiseUsdAccountFingerprint(details: WiseUsdAccountDetails): string {
  const parsed = parseWiseUsdAccountDetails(details);
  if (!parsed.success) throw new Error("Invalid Wise USD account details.");
  const value = parsed.data;
  return JSON.stringify(DETAIL_KEYS.map((key) => value[key] ?? ""));
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidReviewTimestamp(value: unknown): value is string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Manual document review only; this does not assert verification by Wise or payment receipt. */
export function isWiseOwnershipReviewed(account: WiseUsdAccount): boolean {
  if (!account || !hasText(account.id) || !hasText(account.userId)) return false;
  const parsed = parseWiseUsdAccountDetails(account);
  if (!parsed.success) return false;
  const review = account.ownershipReview;
  return review?.status === "manually_reviewed"
    && review.method === "document_review"
    && hasText(review.reviewedBy)
    && review.reviewedBy.trim() !== account.userId.trim()
    && hasText(review.evidenceReference)
    && isValidReviewTimestamp(review.reviewedAt)
    && review.verifiedAccountHolderName === parsed.data.accountHolderName
    && review.accountFingerprint === getWiseUsdAccountFingerprint(parsed.data);
}

export function createWiseUsdAccountSnapshot(account: WiseUsdAccount): Readonly<WiseUsdAccountSnapshot> {
  const parsed = parseWiseUsdAccountDetails(account);
  if (!parsed.success || !isWiseOwnershipReviewed(account) || account.ownershipReview.status !== "manually_reviewed") {
    throw new Error("A current manual ownership review is required for this Wise account.");
  }
  return Object.freeze({
    ...parsed.data,
    accountId: account.id,
    userId: account.userId,
    ownershipReviewedAt: account.ownershipReview.reviewedAt,
    ownershipReviewMethod: "document_review" as const,
  });
}

/** Masked owner/participant view. Never spread the underlying account into a response. */
export function maskWiseUsdAccount(account: WiseUsdAccount): MaskedWiseUsdAccount {
  const reviewStatus = account.ownershipReview?.status;
  return {
    id: account.id,
    provider: "wise",
    currency: "USD",
    accountHolderName: account.accountHolderName,
    bankName: account.bankName,
    accountLast4: account.accountNumber.slice(-4),
    routingLast4: account.routingNumber.slice(-4),
    accountType: account.accountType,
    ownershipReviewStatus: isWiseOwnershipReviewed(account)
      ? "manually_reviewed"
      : reviewStatus === "rejected" ? "rejected" : "pending_review",
  };
}

/** Legacy Bank Transfer records without a provider remain legacy records, never inferred Wise. */
export function isWiseBankTransfer(value: {
  paymentMethod?: unknown;
  bankTransferProvider?: unknown;
  currency?: unknown;
}): boolean {
  return value.paymentMethod === "Bank Transfer"
    && value.bankTransferProvider === "wise"
    && value.currency === "USD";
}

/** Server capability only. Client flags cannot enable a payment provider. */
export function isWiseDraftEnabled(env?: Readonly<Record<string, string | undefined>>): boolean {
  if (typeof window !== "undefined") return false;
  const serverEnv = env ?? (typeof process !== "undefined" ? process.env : {});
  const hasRuntimePool = (globalThis as { __alphaTradersRuntimeDbPool?: unknown }).__alphaTradersRuntimeDbPool != null;
  return serverEnv.ALPHA_WISE_DRAFT_ENABLED === "1"
    && serverEnv.ALPHA_EXCHANGE_DATA_BACKEND === "json"
    // The descriptive backend label is insufficient: the real repository resolves these.
    && serverEnv.ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY === "1"
    && !serverEnv.DATABASE_URL
    && !serverEnv.SUPABASE_DB_URL
    && !hasRuntimePool
    && serverEnv.VERCEL !== "1"
    && !serverEnv.VERCEL_ENV
    && !serverEnv.RAILWAY_ENVIRONMENT_ID
    && !serverEnv.RAILWAY_PROJECT_ID;
}
