// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), feed: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.session }));
vi.mock("@/lib/economic-news/repository", () => ({ readNewsFeed: mocks.feed }));
vi.mock("@/components/news/news-page", () => ({ NewsPage: () => null }));
import NewsRoute, { generateMetadata } from "./page";

describe("economic news page access", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["ar", "en"])("keeps %s guests and invalid sessions away from feed data and preserves the event", async locale => {
    mocks.session.mockResolvedValue(null);
    await expect(NewsRoute({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ event: "te-123" }) })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/news?event=te-123`)};307;`,
    });
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("fails closed when the session store is unavailable", async () => {
    mocks.session.mockRejectedValue(new Error("Session unavailable"));
    await expect(NewsRoute({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) })).rejects.toThrow("Session unavailable");
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it.each(["te-123", "fxs-4fe1bd69-acce-4b24-9d54-f45c81708d29"])("reads %s only after a real signed-in session resolves", async eventId => {
    const feed = { status: "not_configured", updatedAt: null, provider: null, events: [] };
    mocks.session.mockResolvedValue({ id: "fixture-member" });
    mocks.feed.mockResolvedValue(feed);
    const page = await NewsRoute({ params: Promise.resolve({ locale: "ar" }), searchParams: Promise.resolve({ event: eventId }) });
    expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(mocks.feed.mock.invocationCallOrder[0]);
    expect(page.props).toMatchObject({ locale: "ar", initialFeed: feed, eventId });
  });

  it.each(["ar", "en"])("does not index the private %s page", async locale => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale }) });
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
