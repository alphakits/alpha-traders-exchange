import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatNotificationRelativeTime } from "@/lib/notification-time";

describe("formatNotificationRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses Israel's calendar boundary instead of the runtime timezone", () => {
    vi.setSystemTime(new Date("2026-08-27T21:30:00.000Z")); // 00:30 on Aug 28 in Israel

    expect(formatNotificationRelativeTime("2026-08-27T20:30:00.000Z", "en")).toBe("Yesterday");
    expect(formatNotificationRelativeTime("2026-08-27T20:30:00.000Z", "ar")).toBe("أمس");
    expect(formatNotificationRelativeTime("2026-08-27T21:00:00.000Z", "en")).toBe("30 minutes ago");
  });

  it("keeps Latin digits in Arabic relative financial UI copy", () => {
    vi.setSystemTime(new Date("2026-08-27T10:10:00.000Z"));
    expect(formatNotificationRelativeTime("2026-08-27T10:05:00.000Z", "ar")).toContain("5");
  });

  it("formats older dates in Israel time and includes the year when needed", () => {
    vi.setSystemTime(new Date("2026-01-02T10:00:00.000Z"));
    expect(formatNotificationRelativeTime("2025-12-20T22:30:00.000Z", "en")).toContain("2025");
  });
});
