"use client";

import { Clock3 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { COUNTDOWN_HIDE_THRESHOLD_MS, deriveListingCountdown } from "@/lib/seller-presence";

const MINUTE_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export const ListingCountdownBadge = memo(function ListingCountdownBadge({ expiresAt, isAr }: { expiresAt?: string; isAr: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    function update() {
      const currentTime = Date.now();
      const { msRemaining, visible } = deriveListingCountdown(expiresAt, currentTime);
      setNow(visible ? currentTime : null);
      if (msRemaining <= 0) return;

      // Sleep until the badge becomes visible, then wake when the displayed minute changes.
      const delay = visible ? (msRemaining % MINUTE_MS || MINUTE_MS) : msRemaining - COUNTDOWN_HIDE_THRESHOLD_MS;
      timer = window.setTimeout(update, Math.min(delay, MAX_TIMEOUT_MS));
    }
    update();
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  if (now === null) return null;
  const countdown = deriveListingCountdown(expiresAt, now);
  if (!countdown.visible) return null;
  const label = isAr ? countdown.labelAr : countdown.label;
  return (
    <span className={`seller-listing-countdown seller-listing-countdown--${countdown.tier}`} role="timer"
      aria-label={isAr ? `انتهاء العرض: ${label}` : `Listing expiry: ${label}`}>
      <Clock3 size={12} aria-hidden="true" />
      {label}
    </span>
  );
});
