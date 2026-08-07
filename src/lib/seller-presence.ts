import type { SellerOnlineStatus } from "@/types/alpha-exchange";

// Presence and listing-countdown helpers.
//
// Everything here is derived from real, timestamp-driven data (a seller's
// stored online flag + lastActiveAt, and a listing's expiresAt). Nothing is
// fabricated: when the source data is missing we degrade to a neutral/offline
// or hidden state rather than inventing activity.

/** A seller is only treated as "Online" if their online flag is backed by a
 * recent heartbeat. Beyond this window we fall back to timestamp-driven tiers
 * so a stale session never shows a misleading green dot. */
export const ONLINE_FRESHNESS_MS = 15 * 60 * 1000;
/** Upper bound for the yellow "Active N min ago" tier. */
export const RECENTLY_ACTIVE_MS = 60 * 60 * 1000;

export type PresenceTone = "online" | "recent" | "idle";

export interface SellerPresence {
  /** Styling tone: online (green), recent (amber), idle (gray). */
  tone: PresenceTone;
  /** True only when the seller is genuinely online right now. */
  online: boolean;
  /** English presence label. */
  label: string;
  /** Arabic presence label. */
  labelAr: string;
  /** Whole minutes since last activity, or null when unknown. */
  minutesSinceActive: number | null;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function calendarDayDifference(fromMs: number, toMs: number): number {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((toMidnight - fromMidnight) / (24 * 60 * 60 * 1000));
}

/**
 * Derive a natural, timestamp-driven presence state for a seller.
 *
 * Tiers:
 *  - green  "Online"                (online flag + fresh heartbeat)
 *  - amber  "Active N min ago"      (last active within the last hour)
 *  - gray   "Last seen today"       (earlier today)
 *  - gray   "Last seen yesterday"   (previous calendar day)
 *  - gray   "Offline"              (older / unknown)
 */
export function deriveSellerPresence(
  input: { onlineStatus?: SellerOnlineStatus | null; lastActiveAt?: string | null },
  now: number = Date.now(),
): SellerPresence {
  const lastActiveMs = parseTimestamp(input.lastActiveAt);
  const elapsed = lastActiveMs === null ? null : Math.max(0, now - lastActiveMs);
  const minutesSinceActive = elapsed === null ? null : Math.floor(elapsed / 60000);

  const hasFreshHeartbeat = elapsed !== null && elapsed <= ONLINE_FRESHNESS_MS;
  if (input.onlineStatus === "online" && (hasFreshHeartbeat || lastActiveMs === null)) {
    return { tone: "online", online: true, label: "Online", labelAr: "متصل الآن", minutesSinceActive };
  }

  if (elapsed !== null && elapsed <= RECENTLY_ACTIVE_MS) {
    const minutes = Math.max(1, Math.round(elapsed / 60000));
    return {
      tone: "recent",
      online: false,
      label: `Active ${minutes} min ago`,
      labelAr: `نشط قبل ${minutes} دقيقة`,
      minutesSinceActive,
    };
  }

  if (lastActiveMs !== null) {
    const dayDiff = calendarDayDifference(lastActiveMs, now);
    if (dayDiff <= 0) {
      return { tone: "idle", online: false, label: "Last seen today", labelAr: "آخر ظهور اليوم", minutesSinceActive };
    }
    if (dayDiff === 1) {
      return { tone: "idle", online: false, label: "Last seen yesterday", labelAr: "آخر ظهور أمس", minutesSinceActive };
    }
  }

  return { tone: "idle", online: false, label: "Offline", labelAr: "غير متصل", minutesSinceActive };
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
