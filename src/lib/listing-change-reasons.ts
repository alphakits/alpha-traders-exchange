// Shared reason vocabulary + validation for accountable listing changes.
//
// After a listing is created, any change to amount/price/availability — and any
// removal/cancellation — must carry a structured reason plus a free-text
// explanation. This module is the single source of truth for both the client
// form and the server route so the audit trail stays consistent.

export const LISTING_CHANGE_REASONS = [
  "Changed available balance",
  "Price updated",
  "Network issue",
  "Personal reason",
  "Other",
] as const;

export type ListingChangeReason = (typeof LISTING_CHANGE_REASONS)[number];

/** Minimum length for the required free-text explanation. */
export const LISTING_CHANGE_EXPLANATION_MIN_LENGTH = 5;
export const LISTING_CHANGE_EXPLANATION_MAX_LENGTH = 500;

export function isListingChangeReason(value: unknown): value is ListingChangeReason {
  return typeof value === "string" && (LISTING_CHANGE_REASONS as readonly string[]).includes(value);
}

export interface ListingChangeReasonInput {
  reason?: unknown;
  explanation?: unknown;
}

export type ListingChangeReasonValidation =
  | { ok: true; reason: ListingChangeReason; explanation: string }
  | { ok: false; error: string };

/**
 * Validate a structured reason + explanation for an accountable listing change.
 * Returns a normalized (trimmed) reason/explanation on success.
 */
export function validateListingChangeReason(input: ListingChangeReasonInput): ListingChangeReasonValidation {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";

  if (!reason) {
    return { ok: false, error: "Please choose a reason for this change." };
  }
  if (!isListingChangeReason(reason)) {
    return { ok: false, error: "Please choose a valid reason for this change." };
  }
  if (explanation.length < LISTING_CHANGE_EXPLANATION_MIN_LENGTH) {
    return {
      ok: false,
      error: `Please add a short explanation (at least ${LISTING_CHANGE_EXPLANATION_MIN_LENGTH} characters).`,
    };
  }
  if (explanation.length > LISTING_CHANGE_EXPLANATION_MAX_LENGTH) {
    return {
      ok: false,
      error: `Explanation must be ${LISTING_CHANGE_EXPLANATION_MAX_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, reason, explanation };
}

/** Fields whose change makes a reason mandatory on edit. */
const REASON_REQUIRED_FIELDS = ["availableAmount", "price", "minimumTrade", "maximumTrade"] as const;

type ListingSnapshotForReason = {
  availableAmount?: string | null;
  price?: string | null;
  minimumTrade?: string | null;
  maximumTrade?: string | null;
};

function normalizeValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

/**
 * Determine whether a proposed edit touches amount/price/availability and thus
 * requires an accountable reason. Only fields actually present in `next` and
 * different from `current` count.
 */
export function listingEditRequiresReason(
  current: ListingSnapshotForReason,
  next: Partial<ListingSnapshotForReason>,
): boolean {
  return REASON_REQUIRED_FIELDS.some((field) => {
    const proposed = next[field];
    if (proposed === undefined) return false;
    return normalizeValue(proposed) !== normalizeValue(current[field]);
  });
}
