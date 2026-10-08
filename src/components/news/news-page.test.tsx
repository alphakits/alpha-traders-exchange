import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });
  it.each(["en", "ar"] as const)("shows exactly three non-overlapping calendar weeks with expandable results in %s", locale => {
    const events = [
      { ...event, id: "te-10", scheduledAt: "2026-09-14T12:30:00Z", actual: "0%" },
      { ...event, id: "te-11", scheduledAt: "2026-09-20T20:59:59Z", actual: "0.1%" },
      { ...event, id: "te-12", scheduledAt: "2026-09-20T21:00:00Z", actual: "0.2%" },
      event,
      { ...event, id: "te-13", scheduledAt: "2026-09-27T21:00:00Z" },
      { ...event, id: "te-14", scheduledAt: "2026-10-04T20:59:59Z" },
      { ...event, id: "te-15", scheduledAt: "2026-10-04T21:00:00Z" },
    ];
    render(<NewsPage locale={locale} initialFeed={{ ...feed, events }} initialNow={now} />);
    const labels = locale === "ar" ? ["هذا الأسبوع", "الأسبوع القادم", "الأسبوع السابق"] : ["This week", "Next week", "Previous week"];
    const controls = within(screen.getByRole("group", { name: locale === "ar" ? "عرض الأخبار" : "News view" })).getAllByRole("button");
    expect(controls.map((button) => button.textContent)).toEqual(labels);
    const ids = () => [...document.querySelectorAll("article")].map((card) => card.id);
    expect(ids()).toEqual(["event-te-12", "event-te-1"]);
    fireEvent.click(controls[1]);
    expect(ids()).toEqual(["event-te-13", "event-te-14"]);
    fireEvent.click(controls[2]);
    expect(ids()).toEqual(["event-te-10", "event-te-11"]);
    expect(screen.queryByRole("link", { name: /Next release|الخبر القادم/ })).toBeNull();
    const details = document.querySelector("article details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(details.querySelector("dd")?.textContent).toBe("0%");
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(false);
  });
  it("opens a previous-week deep link with its results and hides it when another week is chosen", () => {
    const past = { ...event, id: "te-10", scheduledAt: "2026-09-14T12:30:00Z", actual: "0%" };
    render(<NewsPage locale="en" initialFeed={{ ...feed, events: [past, event] }} initialNow={now} eventId={past.id} />);
    expect(screen.getByRole("button", { name: "Previous week" }).getAttribute("aria-pressed")).toBe("true");
    expect((document.querySelector("article details") as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(document.querySelector("article")).toBeNull();
    expect(screen.getByText("No confirmed events have been added for next week yet.")).toBeTruthy();
  });
  it.each(["en", "ar"] as const)("shows the weekly calendar honestly without live controls in %s", async locale => {
    session.user = { id: "weekly-user" };
    const weekly: NewsFeed = { ...feed, mode: "weekly", updatedAt: new Date(now - 86_400_000).toISOString(),
      events: [{ ...event, forecast: null }], coverageEnd: new Date(now + 10 * 86_400_000).toISOString() };
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(weekly)));
    render(<NewsPage locale={locale} initialFeed={weekly} initialNow={now} />);
    expect(screen.getByText(locale === "ar" ? "تحديث كل أحد · النتائج ليست لحظية" : "Updated Sundays · Results are not live")).toBeTruthy();
    expect(document.querySelector("article details")?.hasAttribute("open")).toBe(false);
    expect(screen.queryByText(/News updates are delayed|تحديث الأخبار متأخر|may be out of date/)).toBeNull();
    expect(document.querySelector('a[href^="http"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(299_999); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/news", expect.objectContaining({ cache: "no-store" }));
  });
  it("shows verified weekly results and labels a passed schedule without inventing a result", () => {
    const released = { ...event, scheduledAt: "2026-09-23T11:30:00Z", actual: "0%", forecast: null };
    const passed = { ...event, id: "official-bls-pending-20260923", scheduledAt: "2026-09-23T11:45:00Z", forecast: null };
    render(<NewsPage locale="en" initialFeed={{ ...feed, mode: "weekly", events: [released, passed] }} initialNow={now} />);
    expect(screen.getByText("Result not added")).toBeTruthy();
    expect(screen.queryByText("Awaiting result")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(screen.getByText("Confirmed result")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getAllByText("Forecast").length).toBeGreaterThan(0);
  });
  it("hides expired weekly coverage even before a successful API refresh", () => {
    render(<NewsPage locale="en" initialFeed={{ ...feed, mode: "weekly", coverageEnd: new Date(now).toISOString() }} initialNow={now} />);
    expect(screen.getByText("News is temporarily unavailable")).toBeTruthy();
    expect(screen.queryByText("CPI m/m")).toBeNull();
  });
  it.each(["en", "ar"] as const)("separates this calendar week from later events and routes the next-release shortcut in %s", locale => {
    const earlier = { ...event, id: "official-fed-minutes-20260922", title: "Earlier in the week", titleAr: "حدث سابق هذا الأسبوع", scheduledAt: "2026-09-22T18:00:00Z", actual: null, forecast: null, kind: "speech" as const };
    const later = { ...event, id: "official-bls-cpi-20260928", title: "Following week release", titleAr: "حدث الأسبوع التالي", scheduledAt: "2026-09-28T12:30:00Z", forecast: null };
    render(<NewsPage locale={locale} initialFeed={{ ...feed, mode: "weekly", weekStart: "2026-09-28", weekEnd: "2026-10-05", events: [earlier, event, later] }} initialNow={now} />);
    expect(screen.getByRole("button", { name: locale === "ar" ? "هذا الأسبوع" : "This week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: locale === "ar" ? "حدث سابق هذا الأسبوع" : "Earlier in the week" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: locale === "ar" ? event.titleAr : event.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: locale === "ar" ? "حدث الأسبوع التالي" : "Following week release" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "الأسبوع القادم" : "Next week" }));
    expect(screen.queryByRole("heading", { name: locale === "ar" ? "حدث سابق هذا الأسبوع" : "Earlier in the week" })).toBeNull();
    expect(screen.queryByRole("heading", { name: locale === "ar" ? event.titleAr : event.title })).toBeNull();
    expect(screen.getByRole("heading", { name: locale === "ar" ? "حدث الأسبوع التالي" : "Following week release" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "هذا الأسبوع" : "This week" }));
    fireEvent.click(screen.getByRole("link", { name: locale === "ar" ? /الخبر القادم/ : /Next release/ }));
    expect(screen.getByRole("button", { name: locale === "ar" ? "هذا الأسبوع" : "This week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: locale === "ar" ? event.titleAr : event.title })).toBeTruthy();
  });
  it("moves the calendar week at local Monday even while the verified snapshot stays unchanged", () => {
    const mondayEvent = { ...event, scheduledAt: "2026-09-28T12:30:00Z", forecast: null };
    const justBeforeMonday = Date.parse("2026-09-27T20:59:45Z");
    vi.setSystemTime(justBeforeMonday);
    render(<NewsPage locale="en" initialFeed={{ ...feed, mode: "weekly", events: [mondayEvent] }} initialNow={justBeforeMonday} />);
    expect(screen.queryByRole("heading", { name: event.title })).toBeNull();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole("heading", { name: event.title })).toBeTruthy();
    expect(screen.getByText(/Mon 28 Sep.*Sun 4 Oct/)).toBeTruthy();
  });
  it("opens Next week when the next release falls after this week", () => {
    const later = { ...event, scheduledAt: "2026-09-28T12:30:00Z", forecast: null };
    render(<NewsPage locale="en" initialFeed={{ ...feed, mode: "weekly", events: [later] }} initialNow={now} />);
    expect(screen.queryByRole("heading", { name: event.title })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /Next release/ }));
    expect(screen.getByRole("button", { name: "Next week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: event.title })).toBeTruthy();
  });
  it("renders compact upcoming USD news in Israel time with no made-up actual", () => {
    render(<NewsPage locale="en" initialFeed={feed} initialNow={now} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("USD news");
    expect(screen.getAllByText(/15:30/).length).toBeGreaterThan(0);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByRole("combobox").getAttribute("aria-label")).toBeNull(); // Named by its visible label.
    expect(screen.getByRole("combobox", { name: /Timezone/ })).toBeTruthy();
  });
  it("groups unsorted events by local day and sends the next-release shortcut to the earliest event", () => {
    const late = { ...event, id: "te-2", title: "Later release", scheduledAt: "2026-09-24T12:30:00Z" };
    const early = { ...event, id: "te-3", title: "Early release", scheduledAt: "2026-09-23T12:15:00Z" };
    render(<NewsPage locale="en" initialFeed={{ ...feed, mode: "weekly", events: [late, event, early] }} initialNow={now} />);
    expect([...document.querySelectorAll("article")].map((card) => card.id)).toEqual(["event-te-3", "event-te-1", "event-te-2"]);
    const days = screen.getAllByRole("region");
    expect(days).toHaveLength(2);
    expect(days[0].querySelectorAll("article")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    fireEvent.click(screen.getByRole("link", { name: /Next release/ }));
    expect(document.activeElement?.id).toBe("event-te-3");
    expect(screen.getByRole("button", { name: "This week" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("moves day groups together with the selected timezone across midnight", () => {
    const options = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ ...options, timeZone: "America/New_York" });
    const night = { ...event, scheduledAt: "2026-09-23T22:30:00Z" };
    render(<NewsPage locale="en" initialFeed={{ ...feed, mode: "weekly", events: [night] }} initialNow={now} />);
    expect(document.querySelector("section time")?.getAttribute("datetime")).toBe("2026-09-24");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // The test runtime timezone is the device option; no invented select value.
    const device = [...select.options].find((option) => option.value !== "Asia/Jerusalem");
    if (!device) throw new Error("This test requires a device timezone different from Israel");
    fireEvent.change(select, { target: { value: device.value } });
    expect(document.querySelector("section time")?.getAttribute("datetime")).toBe("2026-09-23");
  });
  it.each(["en", "ar"] as const)("keeps tentative speeches clear without a made-up time or numerical result in %s", locale => {
    const speech = { ...event, kind: "speech" as const, timing: "tentative" as const, previous: null, forecast: null };
    render(<NewsPage locale={locale} initialFeed={{ ...feed, mode: "weekly", events: [speech] }} initialNow={now} />);
    const card = screen.getByRole("article");
    expect(card.textContent).not.toContain("15:30");
    expect(card.textContent).toContain(locale === "ar" ? "لم يُحدد الوقت" : "Time to be confirmed");
    expect(card.querySelector("dl")).toBeNull();
    expect(card.querySelector("details")?.open).toBe(false);
    expect(card.querySelector("summary")?.getAttribute("aria-label")).toContain(locale === "ar" ? event.titleAr : event.title);
    expect(screen.queryByRole("link", { name: /Next release|الخبر القادم/ })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
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
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
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
