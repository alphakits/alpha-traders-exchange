import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsPage } from "./news-page";
import type { NewsEvent, NewsFeed } from "@/lib/economic-news/model";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useCanonicalSession: () => session }));
const now = Date.parse("2026-09-23T12:00:00Z");
const event: NewsEvent = {
  id: "te-1", providerId: "1", title: "CPI m/m", titleAr: "مؤشر أسعار المستهلكين", scheduledAt: "2026-09-23T12:30:00Z",
  actual: null, previous: "0.2%", forecast: "0.3%", revised: null, reference: null, currency: "USD", impact: "high",
  providerUpdatedAt: "2026-09-23T11:59:00Z", syncedAt: new Date(now).toISOString(), source: "BLS", sourceUrl: "https://www.bls.gov/", timing: "exact", kind: "release",
};
const feed: NewsFeed = { status: "ready", updatedAt: new Date(now).toISOString(), provider: "Trading Economics", events: [event] };
const preparingFeed: NewsFeed = { status: "not_configured", updatedAt: null, provider: null, events: [] };

describe("USD News page", () => {
  beforeEach(() => {
    session.user = null;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(feed))));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
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
  it("keeps unconfigured news inside Alpha Traders without external content or invented data", async () => {
    render(<NewsPage locale="en" initialFeed={{ status: "not_configured", updatedAt: null, provider: null, events: [] }} initialNow={now} />);
    expect(screen.getByRole("status").textContent).toContain("USD news is being prepared");
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector('a[href^="http"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/TradingView|Open news calendar/);
    expect(screen.queryByText(/No other events/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("renders the same first-party calendar in the installed app and browser", () => {
    const browserHtml = renderToStaticMarkup(<NewsPage locale="ar" initialFeed={feed} initialNow={now} />);
    vi.stubGlobal("ReactNativeWebView", { postMessage: vi.fn() });
    const appHtml = renderToStaticMarkup(<NewsPage locale="ar" initialFeed={feed} initialNow={now} />);
    expect(appHtml).toBe(browserHtml);
    expect(appHtml).not.toContain("<iframe");
    expect(appHtml).not.toContain('target="_blank"');
    expect(appHtml).not.toContain('href="https:');
    expect(appHtml).toContain("BLS");
    expect(window.ReactNativeWebView?.postMessage).not.toHaveBeenCalled();
  });
  it("can activate the first-party calendar through an explicit refresh", async () => {
    render(<NewsPage locale="en" initialFeed={{ status: "not_configured", updatedAt: null, provider: null, events: [] }} initialNow={now} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh news" })); });
    expect(screen.getByText("0.3%")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/news", expect.objectContaining({ cache: "no-store" }));
  });
  it.each(["en", "ar"] as const)("explains an unchanged preparation state after manual refresh in %s", async locale => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(preparingFeed)));
    render(<NewsPage locale={locale} initialFeed={preparingFeed} initialNow={now} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "تحديث الأخبار" : "Refresh news" })); });
    expect(screen.getByText(locale === "ar" ? "تم التحقق. لم تبدأ تحديثات الأخبار المباشرة بعد." : "Checked. Live news updates have not started yet.")).toBeTruthy();
    expect(screen.queryByText("0.3%")).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it("discovers activation on an already open page and then resumes live updates", async () => {
    render(<NewsPage locale="en" initialFeed={preparingFeed} initialNow={now} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(299_999); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("0.3%")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ ...feed, events: [{ ...event, scheduledAt: "2026-09-23T11:30:00Z", actual: "0.4%" }] })));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(screen.getByText("0.4%")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reloads disabled alert preferences when the feed is activated", async () => {
    session.user = { id: "news-user" };
    let preferencesReads = 0;
    vi.mocked(fetch).mockImplementation(async input => {
      if (input === "/api/news/preferences") {
        preferencesReads++;
        return new Response(JSON.stringify({ available: preferencesReads > 1,
          preferences: { inApp: false, email: false }, channels: { inApp: true, email: true } }));
      }
      return new Response(JSON.stringify(feed));
    });
    await act(async () => { render(<NewsPage locale="en" initialFeed={preparingFeed} initialNow={now} />); });
    expect(screen.getByText("News alerts will be available when result updates begin.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh news" })); });
    expect(screen.getByRole("checkbox", { name: "In-app notification bell" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Email" })).toBeTruthy();
    expect(preferencesReads).toBe(2);
  });
  it("checks activation immediately on returning to the app while avoiding hidden polling", async () => {
    const visible = vi.spyOn(document, "visibilityState", "get");
    visible.mockReturnValue("hidden");
    render(<NewsPage locale="en" initialFeed={preparingFeed} initialNow={now} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(fetch).not.toHaveBeenCalled();
    visible.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText("0.3%")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    visible.mockRestore();
  });
  it("retries activation when the connection returns", async () => {
    render(<NewsPage locale="en" initialFeed={preparingFeed} initialNow={now} />);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(screen.getByText("0.3%")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("renders licensed FXStreet occurrences internally without provider branding or a fabricated update time", () => {
    const fx = { ...event, id: "fxs-4fe1bd69-acce-4b24-9d54-f45c81708d29", source: "", providerUpdatedAt: null };
    render(<NewsPage locale="en" initialFeed={{ ...feed, provider: null, events: [fx] }} initialNow={now} eventId={fx.id} />);
    expect(screen.getByText("0.3%")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/FXStreet|Trading Economics|TradingView|Source updated/);
    expect(document.querySelector('a[href^="http"]')).toBeNull();
  });
  it.each([401, 403])("clears cached news and returns to sign-in after authorization fails with %s", async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status }));
    render(<NewsPage locale="ar" initialFeed={feed} initialNow={now} eventId="te-1" />);
    expect(screen.getByText("0.3%")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تحديث الأخبار" })); });
    expect(screen.queryByText("0.3%")).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith("/ar/login?redirectTo=%2Far%2Fnews%3Fevent%3Dte-1");
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText(/News updates are delayed/)).toBeTruthy();
    expect(screen.getByText("Could not refresh news. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByText("0.3%")).toBeTruthy();
  });
});
