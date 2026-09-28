import { describe, expect, it } from "vitest";
import { filterPublicSpeedInsight } from "@/lib/public-speed-insights";

describe("public performance measurement privacy", () => {
  it.each(["/en", "/ar/", "/en/news", "/ar/community/", "/en/usdt-exchange"])("allows fixed public page %s", (pathname) => {
    const url = new URL(pathname, "https://www.alphatraders.co.il");
    url.search = "?email=private%40example.com&token=private-token";
    url.hash = "private-fragment";
    expect(filterPublicSpeedInsight({ type: "vital", url: url.href, route: "/unexpected/private-id" })).toEqual({
      type: "vital", url: `https://www.alphatraders.co.il${pathname.replace(/\/$/, "")}`, route: pathname.replace(/\/$/, ""),
    });
  });

  it.each([
    "/en/trade-room/private-id", "/ar/notifications", "/en/account", "/en/admin", "/en/login?token=private",
    "/en/reset-password?token=private", "/en/lessons/private-slug", "/en/news/private-id", "/unknown-page", "/en%2Fnews",
  ])("drops private or unknown URL %s", (pathname) => {
    expect(filterPublicSpeedInsight({ type: "vital", url: `https://www.alphatraders.co.il${pathname}` })).toBeNull();
  });

  it("fails closed for malformed and non-web URLs", () => {
    expect(filterPublicSpeedInsight({ type: "vital", url: "not-a-url" })).toBeNull();
    expect(filterPublicSpeedInsight({ type: "vital", url: "file:///en/news" })).toBeNull();
  });
});
