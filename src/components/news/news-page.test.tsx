import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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
  it("shows the official calendar without advertising active alerts or polling an unconfigured API", async () => {
    const { rerender } = render(<NewsPage locale="en" initialFeed={{ status: "not_configured", updatedAt: null, provider: null, events: [] }} initialNow={now} />);
    const url = new URL(screen.getByTitle("TradingView USD economic calendar").getAttribute("src")!);
    expect(url.origin).toBe("https://www.tradingview-widget.com");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(JSON.parse(decodeURIComponent(url.hash.slice(1)))).toMatchObject({ countryFilter: "us", importanceFilter: "0,1" });
    expect(screen.getByText(/notifications through the app bell and email are not active/)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/No other events/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).not.toHaveBeenCalled();
    rerender(<NewsPage key="stale" locale="en" initialFeed={{ ...feed, status: "stale" }} initialNow={now} />);
    expect(screen.getByRole("status").textContent).toContain("delayed");
  });
  it("offers a recovery link and reload when the Arabic calendar takes too long", async () => {
    render(<NewsPage locale="ar" initialFeed={{ status: "not_configured", updatedAt: null, provider: null, events: [] }} initialNow={now} />);
    const frame = screen.getByTitle("تقويم أخبار الدولار من TradingView");
    expect(new URL(frame.getAttribute("src")!).searchParams.get("locale")).toBe("ar_AE");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole("status").textContent).toContain("يستغرق وقتًا أطول");
    expect(screen.getByRole("link", { name: "فتح في TradingView" }).getAttribute("href")).toBe("https://ar.tradingview.com/economic-calendar/");
    fireEvent.click(screen.getByRole("button", { name: "إعادة تحميل التقويم" }));
    expect(screen.getByTitle("تقويم أخبار الدولار من TradingView")).not.toBe(frame);
    fireEvent.load(screen.getByTitle("تقويم أخبار الدولار من TradingView"));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("does not create a third-party frame before checking for the installed app shell", () => {
    const html = renderToStaticMarkup(<NewsPage locale="en" initialFeed={{ status: "not_configured", updatedAt: null, provider: null, events: [] }} initialNow={now} />);
    expect(html).not.toContain("<iframe");
  });
  it("gives installed apps an explicit browser action with the same filters instead of a blocked frame", () => {
    vi.stubGlobal("ReactNativeWebView", { postMessage: vi.fn() });
    render(<NewsPage locale="ar" initialFeed={{ status: "not_configured", updatedAt: null, provider: null, events: [] }} initialNow={now} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    const link = screen.getByRole("link", { name: "فتح تقويم الأخبار" });
    const url = new URL(link.getAttribute("href")!);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(url.origin).toBe("https://www.tradingview-widget.com");
    expect(url.searchParams.get("locale")).toBe("ar_AE");
    expect(JSON.parse(decodeURIComponent(url.hash.slice(1)))).toMatchObject({ countryFilter: "us", importanceFilter: "0,1" });
    expect(window.ReactNativeWebView?.postMessage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
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
