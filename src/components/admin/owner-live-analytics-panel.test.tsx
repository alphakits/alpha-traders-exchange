import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OwnerLiveAnalyticsPanel } from "./owner-live-analytics-panel";
import { parseLiveAnalytics, type LiveAnalyticsState } from "@/lib/owner-live-analytics";

const report = () => ({
  timeZone: "Asia/Jerusalem" as const,
  reportingStartedAt: new Date(Date.now() - 60_000).toISOString(),
  presence: { status: "ready" as const, asOf: new Date().toISOString(), data: { onlineNow: 1, activeToday: 2, activeLast7Days: 3, activeLast30Days: 4 } },
  traffic: { status: "ready" as const, asOf: new Date().toISOString(), data: {
    visitorsToday: 10, sessionsToday: 12, pageViewsToday: 30, webToday: 12,
    iosToday: 0, androidToday: 0, mobileToday: 0, desktopToday: 12,
    topPages: [{ path: "/usdt-exchange", uniqueVisitors: 10, views: 30 }],
    allTimePages: [{ path: "/usdt-exchange", uniqueVisitors: 91, views: 140 }, { path: "/prop-firms", uniqueVisitors: 5, views: 15 }],
    periods: {
      all: { visitors: 91, accounts: 90, guests: 1, returningVisitors: 4, sessions: 100, pageViews: 155, web: 91, ios: 1, android: 0, mobile: 10, desktop: 90 },
      today: { visitors: 10, accounts: 9, guests: 1, returningVisitors: 2, sessions: 12, pageViews: 30, web: 10, ios: 1, android: 0, mobile: 1, desktop: 10 },
    },
    sources: [], allTimeSources: [],
  } },
});
vi.mock("@/lib/owner-live-analytics-poller", () => ({ startOwnerAnalyticsPolling: ({ onChange }: { onChange: (state: LiveAnalyticsState) => void }) => {
  onChange({ snapshot: report(), refreshing: false, forbidden: false, failed: false });
  return { refresh: vi.fn(), stop: vi.fn() };
} }));
afterEach(cleanup);

describe("section visitors presentation", () => {
  it("defaults to all recorded time and separates unique visitors from total visits", () => {
    render(<OwnerLiveAnalyticsPanel locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /Live User Analytics/ }));
    expect(screen.getByRole("button", { name: "Since the new start" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/New statistics started/)).toBeTruthy();
    const row = screen.getByRole("row", { name: "Alpha Exchange 91 140" });
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["91", "140"]);
    expect(screen.getByRole("columnheader", { name: "Unique visitors" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("row", { name: "Alpha Exchange 10 30" })).toBeTruthy();
    expect(screen.queryByRole("row", { name: "Alpha Exchange 91 140" })).toBeNull();
  });

  it("provides Arabic labels and the same once-per-person counts", () => {
    render(<OwnerLiveAnalyticsPanel locale="ar" />);
    fireEvent.click(screen.getByRole("button", { name: /تحليلات المستخدمين المباشرة/ }));
    expect(screen.getByRole("columnheader", { name: "زوار بدون تكرار" })).toBeTruthy();
    expect(screen.getByRole("row", { name: "الشركات المموّلة 5 15" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "اليوم" }));
    expect(screen.getByRole("row", { name: "Alpha Exchange 10 30" })).toBeTruthy();
  });

  it("keeps sessions out of headline platform counts and applies one period to all cards", () => {
    render(<OwnerLiveAnalyticsPanel locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /Live User Analytics/ }));
    const metricValue = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement?.querySelector("dd")?.textContent;
    expect(metricValue("Unique visitors")).toBe("91");
    expect(metricValue("iOS app visitors")).toBe("1");
    expect(metricValue("Web visitors")).toBe("91");
    expect(screen.queryByText("iOS app sessions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(metricValue("Unique visitors")).toBe("10");
    expect(metricValue("Web visitors")).toBe("10");
    expect(metricValue("iOS app visitors")).toBe("1");
    expect(metricValue("App opens / browser tabs")).toBe("12");
  });

  it("does not present old visit totals or malformed counts as unique visitors", () => {
    for (const uniqueVisitors of [undefined, -1, 141, "91"]) {
      const value = report();
      Object.assign(value.traffic.data.allTimePages[0], { uniqueVisitors });
      expect(parseLiveAnalytics(value)?.traffic.status).toBe("unavailable");
    }
    const oldResponse = report();
    Reflect.deleteProperty(oldResponse.traffic.data, "allTimePages");
    expect(parseLiveAnalytics(oldResponse)?.traffic.status).toBe("unavailable");
  });
});
