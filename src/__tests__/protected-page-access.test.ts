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
const privatePaths = ["dashboard", "dashboard/seller", "dashboard/seller/compliance-payment", "trade-room", "trade-room/test-trade", "trades", "profile", "settings", "notifications", "onboarding", "verify-account", "academy", "academy/course", "lessons", "lessons/example", "admin", "admin/alpha-exchange", "admin/discord"];

describe("signed-out page access", () => {
  it.each(["en", "ar"])("sends guest exchange visitors to %s login and retains marketplace filters", locale => {
    const path = `/${locale}/usdt-exchange?mode=buy&sort=trust-desc`;
    const response = middleware(new NextRequest(`${origin}${path}`));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe(`/${locale}/login`);
    expect(destination.searchParams.get("redirectTo")).toBe(path);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it.each(privatePaths)("sends guest %s routes home on both languages and prevents caching the redirect", path => {
    for (const locale of ["en", "ar"]) {
      const response = middleware(new NextRequest(`${origin}/${locale}/${path}?tab=history`, {
        headers: { cookie: `${AUTH_VERIFIED_COOKIE_NAME}=1` },
      }));
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
    const response = middleware(new NextRequest(`${origin}/${locale}/usdt-exchange`, {
      headers: { cookie: `${AUTH_COOKIE_NAME}=expired-token; ${AUTH_VERIFIED_COOKIE_NAME}=1` },
    }));
    expect(response.headers.get("location")).toBeNull();
    mocks.session.mockResolvedValueOnce(null);
    await expect(ExchangeRoute({ params: Promise.resolve({ locale }) })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/${locale}/login?redirectTo=%2F${locale}%2Fusdt-exchange;307;`,
    });
  });

  it("retains repeated query parameters through the server exchange gate", async () => {
    mocks.session.mockResolvedValueOnce(null);
    await expect(ExchangeRoute({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({ mode: "buy", method: ["cash", "bank"], unset: undefined }),
    })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/en/login?redirectTo=${encodeURIComponent("/en/usdt-exchange?mode=buy&method=cash&method=bank")};307;`,
    });
  });

  it("propagates unavailable session reads instead of rendering a guest workspace", async () => {
    mocks.session.mockRejectedValueOnce(new Error("Session unavailable"));
    await expect(ExchangeRoute({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("Session unavailable");
  });

  it("overwrites a spoofed page path before the server layout verifies access", () => {
    const response = middleware(new NextRequest(`${origin}/en/usdt-exchange?mode=buy`, {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=expired-token; ${AUTH_VERIFIED_COOKIE_NAME}=1`,
        [APP_PAGE_PATH_HEADER]: "/en",
      },
    }));
    expect(response.headers.get(`x-middleware-request-${APP_PAGE_PATH_HEADER}`)).toBe("/en/usdt-exchange?mode=buy");
    expect(response.headers.get("x-middleware-override-headers")?.split(",")).toContain(APP_PAGE_PATH_HEADER);
  });
});
