import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsPage } from "./news-page";
import type { NewsEvent, NewsFeed } from "@/lib/economic-news/model";

vi.mock("@/components/auth/canonical-session-provider", () => ({ useCanonicalSession: () => ({ user: null }) }));
vi.mock("./news-preferences", () => ({ NewsPreferences: () => null }));
const now = Date.parse("2026-09-23T12:00:00Z");
const event: NewsEvent = {
  id: "te-1", providerId: "1", title: "CPI m/m", titleAr: "مؤشر أسعار المستهلكين", scheduledAt: "2026-09-23T12:30:00Z",
  actual: null, previous: "0.2%", forecast: "0.3%", revised: null, reference: null, currency: "USD", impact: "high",
  providerUpdatedAt: "2026-09-23T11:59:00Z", syncedAt: new Date(now).toISOString(), source: "BLS", sourceUrl: "https://www.bls.gov/", timing: "exact", kind: "release",
};
const feed: NewsFeed = { status: "ready", updatedAt: new Date(now).toISOString(), provider: "Trading Economics", events: [event] };

describe("USD News page", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(feed)))); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("renders compact upcoming USD news in Israel time with no made-up actual", () => {
    render(<NewsPage locale="en" initialFeed={feed} initialNow={now} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("USD news");
    expect(screen.getAllByText(/15:30/).length).toBeGreaterThan(0);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByRole("combobox").getAttribute("aria-label")).toBeNull(); // Named by its visible label.
    expect(screen.getByRole("combobox", { name: /Timezone/ })).toBeTruthy();
  });
  it("shows the deep-linked released event immediately even when the default list is upcoming", () => {
    const released = { ...event, scheduledAt: "2026-09-23T11:30:00Z", actual: "0.4%", corrected: true };
    render(<NewsPage locale="ar" initialFeed={{ ...feed, events: [released] }} initialNow={now} eventId="te-1" />);
    expect(screen.getByRole("heading", { level: 1 }).closest("[dir]")?.getAttribute("dir")).toBe("rtl");
    expect(screen.getByText("0.4%")).toBeTruthy();
    expect(screen.getByText("تتضمن البيانات مراجعة من المصدر.")).toBeTruthy();
    expect(screen.getByText(/أعلى من المتوقع/)).toBeTruthy();
  });
  it("distinguishes no data connection from a successful empty calendar and labels stale data", () => {
    const { rerender } = render(<NewsPage locale="en" initialFeed={{ status: "not_configured", updatedAt: null, provider: null, events: [] }} initialNow={now} />);
    expect(screen.getByText("USD news is being prepared")).toBeTruthy();
    expect(screen.queryByText(/No other events/)).toBeNull();
    rerender(<NewsPage key="stale" locale="en" initialFeed={{ ...feed, status: "stale" }} initialNow={now} />);
    expect(screen.getByRole("status").textContent).toContain("delayed");
  });
  it("stops network polling in a hidden tab and refreshes released values on return", async () => {
    const visible = vi.spyOn(document, "visibilityState", "get");
    visible.mockReturnValue("hidden");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...feed, events: [{ ...event, scheduledAt: "2026-09-23T11:30:00Z", actual: "0.4%" }] })));
    render(<NewsPage locale="en" initialFeed={feed} initialNow={now} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    visible.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(screen.getByText("0.4%")).toBeTruthy();
    visible.mockRestore();
  });
  it("retains last received figures with a warning after a refresh fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<NewsPage locale="en" initialFeed={feed} initialNow={now} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh news" })); });
    expect(screen.getByRole("status").textContent).toContain("delayed");
    expect(screen.getByText("0.3%")).toBeTruthy();
  });
});
