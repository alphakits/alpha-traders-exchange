// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import middleware from "@/middleware";
import { LOCALE_CHOICE_COOKIE } from "@/i18n/locale-preference";
import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";

const origin = "https://www.alphatraders.co.il";

function request(path: string, cookie = "") {
  return new NextRequest(`${origin}${path}`, {
    headers: { "accept-language": "ar,ar-IL;q=0.9,en;q=0.5", cookie },
  });
}

describe("English default and explicit language choices", () => {
  it.each(["", "NEXT_LOCALE=ar", `${LOCALE_CHOICE_COOKIE}=invalid`, `${LOCALE_CHOICE_COOKIE}=ar`])("opens English without a signed-in language choice (%s)", (cookie) => {
    const response = middleware(request("/", cookie));
    expect(response.headers.get("location")).toBe(`${origin}/en`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it.each(["ar", "en"])("keeps an explicit %s choice while the session is active", (locale) => {
    const cookie = `${AUTH_COOKIE_NAME}=test-session; ${LOCALE_CHOICE_COOKIE}=${locale}; NEXT_LOCALE=ar`;
    expect(middleware(request("/", cookie)).headers.get("location")).toBe(`${origin}/${locale}`);
    expect(middleware(request("/login?redirectTo=%2Fdashboard%2Fseller", cookie)).headers.get("location"))
      .toBe(`${origin}/${locale}/login?redirectTo=%2Fdashboard%2Fseller`);
  });

  it.each(["ar", "en"])("keeps explicit /%s links in their requested language", (locale) => {
    const response = middleware(request(`/${locale}`, `${LOCALE_CHOICE_COOKIE}=${locale === "en" ? "ar" : "en"}`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBe(locale);
    expect(response.cookies.get(LOCALE_CHOICE_COOKIE)).toBeUndefined();
  });

  it("preserves canonicalization of uppercase locale links", () => {
    expect(middleware(request("/AR/login")).headers.get("location")).toBe(`${origin}/ar/login`);
  });

  it("localizes deep links and sends signed-out visitors home", () => {
    const entry = middleware(request("/trade-room/trade-123?tab=messages"));
    expect(entry.headers.get("location")).toBe(`${origin}/en/trade-room/trade-123?tab=messages`);
    const protectedPage = middleware(new NextRequest(entry.headers.get("location")!));
    expect(protectedPage.headers.get("location")).toBe(`${origin}/en`);
  });
});
