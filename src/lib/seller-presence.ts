import { deriveUserPresence, PRESENCE_LEASE_MS } from "@alpha-traders/contracts";
export const ONLINE_FRESHNESS_MS = PRESENCE_LEASE_MS;
export const RECENTLY_ACTIVE_MS = 60 * 60 * 1000;
export const deriveSellerPresence = deriveUserPresence;
export type SellerPresence = ReturnType<typeof deriveSellerPresence>;
export type PresenceTone = SellerPresence["tone"];
function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export const COUNTDOWN_HIDE_THRESHOLD_MS = 12 * 60 * 60 * 1000;
export const COUNTDOWN_URGENT_THRESHOLD_MS = 4 * 60 * 60 * 1000;

export type CountdownTier = "hidden" | "neutral" | "urgent" | "expired";

export interface ListingCountdown {
  tier: CountdownTier;
  /** Whether the countdown should be shown on the card. */
  visible: boolean;
  /** Milliseconds remaining (0 when expired/unknown). */
  msRemaining: number;
  /** Compact remaining time, e.g. "3h 45m" or "40m" (empty when not visible). */
  remaining: string;
  /** Full English label, e.g. "Only 3h 45m left" (empty when not visible). */
  label: string;
  /** Full Arabic label (empty when not visible). */
  labelAr: string;
}

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Derive the eligibility countdown for a listing from its expiresAt.
 *
 * Tiers:
 *  - hidden   more than 12h remaining (no countdown shown)
 *  - neutral  between 4h and 12h remaining
 *  - urgent   less than 4h remaining ("Only X left", premium red)
 *  - expired  already past expiry (visible=false; existing lifecycle handles it)
 */
export function deriveListingCountdown(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): ListingCountdown {
  const expiresMs = parseTimestamp(expiresAt);
  if (expiresMs === null) {
    return { tier: "hidden", visible: false, msRemaining: 0, remaining: "", label: "", labelAr: "" };
  }

  const msRemaining = expiresMs - now;
  if (msRemaining <= 0) {
    return { tier: "expired", visible: false, msRemaining: 0, remaining: "", label: "", labelAr: "" };
  }
  if (msRemaining > COUNTDOWN_HIDE_THRESHOLD_MS) {
    return { tier: "hidden", visible: false, msRemaining, remaining: "", label: "", labelAr: "" };
  }

  const remaining = formatRemaining(msRemaining);
  if (msRemaining <= COUNTDOWN_URGENT_THRESHOLD_MS) {
    return {
      tier: "urgent",
      visible: true,
      msRemaining,
      remaining,
      label: `Only ${remaining} left`,
      labelAr: `متبقٍ ${remaining} فقط`,
    };
  }
  return {
    tier: "neutral",
    visible: true,
    msRemaining,
    remaining,
    label: `${remaining} left`,
    labelAr: `${remaining} متبقٍ`,
  };
}
