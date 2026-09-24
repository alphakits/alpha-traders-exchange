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
  it("requires a recent server heartbeat and genuine activity", () => {
    expect(deriveSellerPresence({ onlineStatus: "online", lastSeenAt: iso(-10_000), lastActiveAt: iso(-60_000) }, NOW).online).toBe(true);
    expect(deriveSellerPresence({ onlineStatus: "online", lastActiveAt: iso(-120_000) }, NOW).online).toBe(false);
    expect(deriveSellerPresence({ onlineStatus: "online", lastSeenAt: iso(0), lastActiveAt: iso(-300_000) }, NOW).online).toBe(false);
  });
  it.each([undefined, null, "invalid", iso(60_000)])("never fabricates activity from %s", lastActiveAt => {
    expect(deriveSellerPresence({ onlineStatus: "online", lastActiveAt }, NOW).online).toBe(false);
  });
  it("shows real elapsed activity while offline", () => {
    expect(deriveSellerPresence({ onlineStatus: "offline", lastActiveAt: iso(-25 * 60_000) }, NOW).label).toBe("Offline · Active 25 min ago");
    expect(deriveSellerPresence({ onlineStatus: "offline", lastActiveAt: iso(-47 * 86_400_000) }, NOW).label).toBe("Offline · Active 47d ago");
  });
  it("does not reveal hidden timestamps or presence", () => {
    const presence = deriveSellerPresence({ onlineStatus: "online", lastActiveAt: iso(0), presenceHidden: true }, NOW);
    expect(presence.online).toBe(false);
    expect(presence.minutesSinceActive).toBeNull();
    expect(presence.label).toBe("Activity hidden");
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
