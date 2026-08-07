// Deterministic, transparent listing-reliability scoring.
//
// Every value here is derived from real seller history — completed trades,
// cancellations, seller-initiated removals, post-creation edits and observed
// listing lifetimes. The scoring is fully deterministic (same input -> same
// output) so it can drive marketplace ordering and be shown to sellers/admins
// without any hidden or fabricated penalties.

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Score at or below which listing behaviour is treated as neutral before any
 * real history exists. New sellers start here rather than at a perfect 100. */
export const RELIABILITY_NEUTRAL_BASELINE = 75;
/** Amount of history (trades + listings) at which we fully trust the raw score. */
export const RELIABILITY_FULL_CONFIDENCE_SAMPLES = 20;

export type ReliabilityWarningTier = "none" | "notice" | "warning" | "critical";

export interface ListingReliabilityInput {
  completedTrades: number;
  cancelledTrades: number;
  /** Listings the seller has created (all statuses). */
  totalListings: number;
  /** Count of post-creation edits (from audit history). */
  editCount: number;
  /** Seller-initiated removals / cancellations of their own listings. */
  removalCount: number;
  /** Lifetimes (ms) of listings that have ended, for average-lifetime insight. */
  listingLifetimesMs: number[];
}

export interface ListingReliability {
  /** % of trades that were cancelled (0-100). */
  cancellationRate: number;
  /** Post-creation edit rate as a % of listings (0-100, capped). */
  editRate: number;
  /** Seller-initiated removal rate as a % of listings (0-100, capped). */
  removalRate: number;
  /** Average lifetime of ended listings, in hours (0 when unknown). */
  averageListingLifetimeHours: number;
  /** Deterministic reliability score (0-100). */
  reliabilityScore: number;
  /** Escalating abuse tier. */
  warningTier: ReliabilityWarningTier;
  /** Human-readable escalating warning copy ("" when tier is none). */
  warningLabel: string;
  /** How much real history backs the score (0-1). */
  confidence: number;
}

const WARNING_COPY: Record<ReliabilityWarningTier, string> = {
  none: "",
  notice:
    "A few recent cancellations or edits were recorded. Keep your listings accurate to maintain your reliability score.",
  warning:
    "Repeated cancellations, removals, or edits are lowering your reliability score and marketplace ranking. Please keep listings accurate.",
  critical:
    "Frequent cancellations, removals, or last-minute edits have significantly lowered your reliability score and ranking. Continued abuse may restrict your listing privileges.",
};

function resolveWarningTier(reliabilityScore: number, cancellationRate: number): ReliabilityWarningTier {
  if (reliabilityScore < 40 || cancellationRate >= 50) return "critical";
  if (reliabilityScore < 55 || cancellationRate >= 35) return "warning";
  if (reliabilityScore < 70 || cancellationRate >= 20) return "notice";
  return "none";
}

/**
 * Compute a deterministic reliability profile for a seller's listing behaviour.
 */
export function computeListingReliability(input: ListingReliabilityInput): ListingReliability {
  const completedTrades = Math.max(0, input.completedTrades);
  const cancelledTrades = Math.max(0, input.cancelledTrades);
  const totalListings = Math.max(0, input.totalListings);
  const editCount = Math.max(0, input.editCount);
  const removalCount = Math.max(0, input.removalCount);

  const totalTrades = completedTrades + cancelledTrades;
  const cancellationRate = totalTrades > 0 ? clamp((cancelledTrades / totalTrades) * 100, 0, 100) : 0;
  const editRate = totalListings > 0 ? clamp((editCount / totalListings) * 100, 0, 100) : 0;
  const removalRate = totalListings > 0 ? clamp((removalCount / totalListings) * 100, 0, 100) : 0;

  const lifetimes = input.listingLifetimesMs.filter((value) => Number.isFinite(value) && value > 0);
  const averageListingLifetimeHours = lifetimes.length
    ? round1(lifetimes.reduce((sum, value) => sum + value, 0) / lifetimes.length / (60 * 60 * 1000))
    : 0;

  // Transparent penalty model, then dampened toward a neutral baseline until
  // enough real history exists to trust it.
  const rawScore = clamp(
    100 - cancellationRate * 0.5 - editRate * 0.15 - removalRate * 0.2,
    0,
    100,
  );
  const sampleSize = totalTrades + totalListings;
  const confidence = clamp(sampleSize / RELIABILITY_FULL_CONFIDENCE_SAMPLES, 0, 1);
  const reliabilityScore = Math.round(
    RELIABILITY_NEUTRAL_BASELINE + (rawScore - RELIABILITY_NEUTRAL_BASELINE) * confidence,
  );

  const warningTier = resolveWarningTier(reliabilityScore, cancellationRate);

  return {
    cancellationRate: round1(cancellationRate),
    editRate: round1(editRate),
    removalRate: round1(removalRate),
    averageListingLifetimeHours,
    reliabilityScore,
    warningTier,
    warningLabel: WARNING_COPY[warningTier],
    confidence: round1(confidence),
  };
}
