import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_HIDE_THRESHOLD_MS,
  COUNTDOWN_URGENT_THRESHOLD_MS,
  deriveListingCountdown,
  deriveSellerPresence,
} from "@/lib/seller-presence";

// Use an explicit instant so these calendar-boundary tests do not depend on
// the machine running Vitest (CI workers can be in any timezone).
const NOW = new Date("2026-02-15T10:00:00.000Z").getTime();
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

describe("deriveSellerPresence", () => {
  it("shows Online for an online seller with a fresh heartbeat", () => {
    const presence = deriveSellerPresence({ onlineStatus: "online", lastActiveAt: iso(-2 * 60 * 1000) }, NOW);
    expect(presence.tone).toBe("online");
    expect(presence.online).toBe(true);
    expect(presence.label).toBe("Online");
  });

  it("downgrades a stale online flag to timestamp-driven presence", () => {
    // online flag set but last heartbeat 40 min ago -> not genuinely online
    const presence = deriveSellerPresence({ onlineStatus: "online", lastActiveAt: iso(-40 * 60 * 1000) }, NOW);
    expect(presence.online).toBe(false);
    expect(presence.tone).toBe("recent");
    expect(presence.label).toBe("Active 40 min ago");
  });

  it("shows amber Active N min ago within the last hour", () => {
    const presence = deriveSellerPresence({ onlineStatus: "offline", lastActiveAt: iso(-25 * 60 * 1000) }, NOW);
    expect(presence.tone).toBe("recent");
    expect(presence.label).toBe("Active 25 min ago");
  });

  it("shows Last seen today for earlier the same day", () => {
    const presence = deriveSellerPresence({ onlineStatus: "offline", lastActiveAt: iso(-5 * 60 * 60 * 1000) }, NOW);
    expect(presence.tone).toBe("idle");
    expect(presence.label).toBe("Last seen today");
  });

  it("shows Last seen yesterday for the previous calendar day", () => {
    const yesterday = new Date("2026-02-14T20:00:00.000Z").getTime();
    const presence = deriveSellerPresence({ onlineStatus: "offline", lastActiveAt: new Date(yesterday).toISOString() }, NOW);
    expect(presence.tone).toBe("idle");
    expect(presence.label).toBe("Last seen yesterday");
  });

  it("uses the Israel calendar day regardless of the server timezone", () => {
    const now = new Date("2026-08-27T22:30:00.000Z").getTime();
    const earlierSameIsraelDay = "2026-08-27T21:15:00.000Z";
    const presence = deriveSellerPresence(
      { onlineStatus: "offline", lastActiveAt: earlierSameIsraelDay },
      now,
    );
    expect(presence.label).toBe("Last seen today");
  });

  it("shows Offline for older activity", () => {
    const presence = deriveSellerPresence({ onlineStatus: "offline", lastActiveAt: iso(-4 * 24 * 60 * 60 * 1000) }, NOW);
    expect(presence.tone).toBe("idle");
    expect(presence.label).toBe("Offline");
  });

  it("shows Offline when there is no activity data (never fabricates)", () => {
    const presence = deriveSellerPresence({ onlineStatus: "offline", lastActiveAt: null }, NOW);
    expect(presence.label).toBe("Offline");
    expect(presence.minutesSinceActive).toBeNull();
  });
});

describe("deriveListingCountdown", () => {
  it("hides the countdown when more than 12h remain", () => {
    const countdown = deriveListingCountdown(iso(COUNTDOWN_HIDE_THRESHOLD_MS + 60 * 60 * 1000), NOW);
    expect(countdown.tier).toBe("hidden");
    expect(countdown.visible).toBe(false);
  });

  it("shows a neutral countdown between 4h and 12h", () => {
    const countdown = deriveListingCountdown(iso(8 * 60 * 60 * 1000), NOW);
    expect(countdown.tier).toBe("neutral");
    expect(countdown.visible).toBe(true);
    expect(countdown.label).toBe("8h 0m left");
  });

  it("shows a premium urgent countdown under 4h", () => {
    const countdown = deriveListingCountdown(iso(3 * 60 * 60 * 1000 + 45 * 60 * 1000), NOW);
    expect(countdown.tier).toBe("urgent");
    expect(countdown.visible).toBe(true);
    expect(countdown.label).toBe("Only 3h 45m left");
  });

  it("treats exactly 4h as urgent", () => {
    const countdown = deriveListingCountdown(iso(COUNTDOWN_URGENT_THRESHOLD_MS), NOW);
    expect(countdown.tier).toBe("urgent");
  });

  it("marks past-expiry listings expired and not visible (lifecycle owns it)", () => {
    const countdown = deriveListingCountdown(iso(-60 * 1000), NOW);
    expect(countdown.tier).toBe("expired");
    expect(countdown.visible).toBe(false);
  });

  it("hides the countdown when expiresAt is missing", () => {
    const countdown = deriveListingCountdown(undefined, NOW);
    expect(countdown.tier).toBe("hidden");
    expect(countdown.visible).toBe(false);
  });

  it("formats sub-hour remaining without an hours segment", () => {
    const countdown = deriveListingCountdown(iso(40 * 60 * 1000), NOW);
    expect(countdown.remaining).toBe("40m");
    expect(countdown.label).toBe("Only 40m left");
  });
});
