"use client";

import { AlertTriangle, Clock3 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { COUNTDOWN_HIDE_THRESHOLD_MS, deriveListingCountdown } from "@/lib/seller-presence";

const MINUTE_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export const ListingCountdownBadge = memo(function ListingCountdownBadge({ expiresAt, isAr, desktopLayout = false }: {
  expiresAt?: string; isAr: boolean; desktopLayout?: boolean;
}) {
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
  const desktopWarning = desktopLayout && countdown.tier === "urgent";
  const label = desktopWarning
    ? (isAr ? `${countdown.labelAr} فقط` : `Only ${countdown.label}`)
    : (isAr ? countdown.labelAr : countdown.label);
  const Icon = desktopWarning ? AlertTriangle : Clock3;
  return (
    <span className={`seller-listing-countdown seller-listing-countdown--${countdown.tier}`} role="timer"
      aria-label={isAr ? `انتهاء العرض: ${label}` : `Listing expiry: ${label}`}>
      <Icon size={desktopLayout ? 14 : 12} aria-hidden="true" />
      {label}
    </span>
  );
});
