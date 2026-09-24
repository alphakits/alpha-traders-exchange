// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import middleware from "@/middleware";
import { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";
import { APP_PAGE_PATH_HEADER, isProtectedPage } from "@/lib/protected-page";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.session }));
vi.mock("@/components/sections/usdt-exchange/usdt-exchange-page", () => ({ UsdtExchangePage: () => null }));
import ExchangeRoute from "@/app/[locale]/usdt-exchange/page";

const origin = "https://www.alphatraders.co.il";
const privatePaths = ["usdt-exchange", "dashboard", "dashboard/seller", "dashboard/seller/compliance-payment", "trade-room", "trade-room/test-trade", "trades", "profile", "settings", "notifications", "onboarding", "verify-account", "academy", "academy/course", "lessons", "lessons/example", "admin", "admin/alpha-exchange", "admin/discord"];

describe("signed-out page access", () => {
  it.each(privatePaths)("sends guest %s routes home on both languages and prevents caching the redirect", async path => {
    for (const locale of ["en", "ar"]) {
      const response = (await middleware(new NextRequest(`${origin}/${locale}/${path}?tab=history`, {
        headers: { cookie: `${AUTH_VERIFIED_COOKIE_NAME}=1` },
      })));
      expect(response.headers.get("location")).toBe(`${origin}/en`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it.each(["/en", "/ar", "/en/login", "/en/register", "/en/news", "/en/privacy-policy", "/en/account-deletion", "/en/verify-email", "/en/exchange/seller/example"])("keeps the intended public route %s public", path => {
    expect(isProtectedPage(path)).toBe(false);
  });

  it.each(["en", "ar"])("rejects an invalid cookie before rendering the %s exchange", async locale => {
    // Reproduces the bug: cookie existence passes middleware, but session
    // resolution returns no user (expired, revoked, or fabricated token).
    const response = (await middleware(new NextRequest(`${origin}/${locale}/usdt-exchange`, {
      headers: { cookie: `${AUTH_COOKIE_NAME}=expired-token; ${AUTH_VERIFIED_COOKIE_NAME}=1` },
    })));
    expect(response.headers.get("location")).toBeNull();
    mocks.session.mockResolvedValueOnce(null);
    await expect(ExchangeRoute({ params: Promise.resolve({ locale }) })).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/en;307;" });
  });

  it("propagates unavailable session reads instead of rendering a guest workspace", async () => {
    mocks.session.mockRejectedValueOnce(new Error("Session unavailable"));
    await expect(ExchangeRoute({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("Session unavailable");
  });

  it("overwrites a spoofed page path before the server layout verifies access", async () => {
    const response = (await middleware(new NextRequest(`${origin}/en/usdt-exchange`, {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=expired-token; ${AUTH_VERIFIED_COOKIE_NAME}=1`,
        [APP_PAGE_PATH_HEADER]: "/en",
      },
    })));
    expect(response.headers.get(`x-middleware-request-${APP_PAGE_PATH_HEADER}`)).toBe("/en/usdt-exchange");
    expect(response.headers.get("x-middleware-override-headers")?.split(",")).toContain(APP_PAGE_PATH_HEADER);
  });
});
