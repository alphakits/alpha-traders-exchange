// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), feed: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth }));
vi.mock("@/lib/economic-news/repository", () => ({ readNewsFeed: mocks.feed }));
import { GET } from "./route";

describe("private economic news API", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([401, 403, 503])("does not read or disclose a feed after an authorization response of %s", async status => {
    mocks.auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Account unavailable" }, { status }) });
    const response = await GET(new NextRequest("https://www.alphatraders.co.il/api/news?event=te-123"));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("events");
  });

  it.each(["te-123", "fxs-4fe1bd69-acce-4b24-9d54-f45c81708d29"])("serves %s to signed-in users with no public/CDN caching", async eventId => {
    const feed = { status: "not_configured", updatedAt: null, provider: null, events: [] };
    mocks.auth.mockResolvedValue({ user: { id: "fixture-member" }, unauthorized: null });
    mocks.feed.mockResolvedValue(feed);
    const response = await GET(new NextRequest(`https://www.alphatraders.co.il/api/news?event=${eventId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(feed);
    expect(mocks.feed).toHaveBeenCalledWith(expect.any(Number), eventId);
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.feed.mock.invocationCallOrder[0]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
