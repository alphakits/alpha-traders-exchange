"use client";

import { memo, useMemo, useSyncExternalStore } from "react";
import { Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MarketplaceListing } from "@/types/alpha-exchange";

export type DiscordListingShareMapping = {
  listingId: string;
  state: "queued" | "publishing" | "active" | "update_pending" | "delete_pending" | "sold" | "deleted" | "failed";
  publishedAt: string | null;
  updatedAt: string;
  errorCode: string | null;
};

export type DiscordListingSharingStatus = {
  serverTime: string;
  nextEligibleAt: string | null;
  cooldownSecondsRemaining: number;
  linked: boolean;
  available: boolean;
  listings: DiscordListingShareMapping[];
};

function toAmount(value: string): number {
  return Number(value.replace(/[^\d.]/g, "")) || 0;
}

const secondClockListeners = new Set<() => void>();
let secondClockTimer: number | null = null;
let secondClockSnapshot = 0;

function subscribeToSecondClock(listener: () => void) {
  secondClockListeners.add(listener);
  if (secondClockTimer === null) {
    secondClockSnapshot = Date.now();
    secondClockTimer = window.setInterval(() => {
      secondClockSnapshot = Date.now();
      for (const notify of secondClockListeners) notify();
    }, 1_000);
  }
  return () => {
    secondClockListeners.delete(listener);
    if (secondClockListeners.size === 0 && secondClockTimer !== null) {
      window.clearInterval(secondClockTimer);
      secondClockTimer = null;
    }
  };
}

const subscribeToNothing = () => () => undefined;
const getSecondClockSnapshot = () => secondClockSnapshot;
const getServerClockSnapshot = () => 0;

export function formatDiscordShareCountdown(seconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return safeSeconds > 0 ? "<1m" : "now";
}

export const DiscordShareAction = memo(function DiscordShareAction({
  listing,
  sharing,
  busy,
  onShare,
}: {
  listing: MarketplaceListing;
  sharing: DiscordListingSharingStatus | null;
  busy: boolean;
  onShare: (listing: MarketplaceListing) => void;
}) {
  const mapping = sharing?.listings.find((item) => item.listingId === listing.id);
  const serverOffsetMs = useMemo(
    () => sharing ? new Date(sharing.serverTime).getTime() - Date.now() : 0,
    [sharing],
  );
  const targetTime = sharing?.nextEligibleAt
    ? new Date(sharing.nextEligibleAt).getTime()
    : 0;
  const initialSecondsRemaining = targetTime
    ? Math.max(0, Math.ceil((targetTime - (Date.now() + serverOffsetMs)) / 1000))
    : 0;
  const clockNow = useSyncExternalStore(
    initialSecondsRemaining > 0 ? subscribeToSecondClock : subscribeToNothing,
    getSecondClockSnapshot,
    getServerClockSnapshot,
  );
  const secondsRemaining = targetTime
    ? initialSecondsRemaining <= 0
      ? 0
      : Math.max(0, Math.ceil((targetTime - ((clockNow || Date.now()) + serverOffsetMs)) / 1000))
    : 0;

  const listingEligible = listing.status === "active"
    && listing.approvalStatus === "approved"
    && toAmount(listing.availableAmount) > 0
    && (!listing.expiresAt || new Date(listing.expiresAt).getTime() > Date.now());
  const cooldownLabel = secondsRemaining > 0
    ? formatDiscordShareCountdown(secondsRemaining)
    : null;

  let label = "Share to Discord";
  let detail = "Publish this current listing to the managed Discord marketplace.";
  let disabled = busy || !listingEligible || !sharing?.available || !sharing.linked;
  if (busy) {
    label = "Accepting share...";
    detail = "The website is validating and claiming your share window.";
  } else if (!listingEligible) {
    label = "Listing ineligible";
    detail = "Only approved active listings with available USDT can be shared.";
  } else if (!sharing?.available) {
    label = "Sharing unavailable";
    detail = "Discord sharing status could not be loaded. Your listing actions still work.";
  } else if (!sharing.linked) {
    label = "Connect Discord first";
    detail = "Link Discord in Account Settings before sharing.";
  } else if (mapping?.state === "queued" || mapping?.state === "publishing") {
    label = "Publishing to Discord...";
    detail = "Accepted by Alpha Traders and waiting for the Discord worker.";
    disabled = true;
  } else if (mapping?.state === "update_pending") {
    label = "Discord update pending";
    detail = "Your existing Discord post is being refreshed from current listing data.";
    disabled = true;
  } else if (mapping?.state === "failed") {
    label = "Discord delivery needs support";
    detail = "The share window remains claimed to prevent spam. Support can inspect the safe delivery diagnostics.";
    disabled = true;
  } else if (cooldownLabel) {
    label = mapping?.state === "active" ? "Shared" : `Next Share ${cooldownLabel}`;
    detail = mapping?.state === "active"
      ? `Next Share ${cooldownLabel}`
      : `Seller-wide cooldown • Next Share ${cooldownLabel}`;
    disabled = true;
  } else if (mapping?.state === "active") {
    label = "Refresh Discord post";
    detail = "Refresh the same post from authoritative website data.";
    disabled = false;
  }

  return (
    <div className="w-full rounded-xl border border-[#C9A227]/25 bg-[#C9A227]/[0.07] p-3 sm:w-auto sm:min-w-[240px]">
      <Button
        type="button"
        size="sm"
        className="min-h-11 w-full justify-center"
        disabled={disabled}
        onClick={() => onShare(listing)}
      >
        {busy || mapping?.state === "queued" || mapping?.state === "publishing" || mapping?.state === "update_pending"
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
        {label}
      </Button>
      <p
        className="mt-2 text-xs leading-5 text-[#D1D5DB]"
        role={cooldownLabel ? "timer" : "status"}
        aria-live="polite"
      >
        {detail}
      </p>
    </div>
  );
});
