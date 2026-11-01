// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { NextRequest } from "next/server";
import middleware from "@/middleware";
import { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";
import sitemap from "@/app/sitemap";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.session }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
import Page, { generateMetadata } from "@/app/[locale]/learn-with-mark/page";

beforeEach(() => { mocks.session.mockReset(); });

describe("members-only mentorship page", () => {
  it.each(["en", "ar"])("protects normal and prefetch requests in %s before sending course content", async locale => {
    const path = `/${locale}/learn-with-mark?utm_source=friend`;
    for (const headers of [new Headers(), new Headers({ RSC: "1", "Next-Router-Prefetch": "1" })]) {
      const response = await middleware(new NextRequest(`https://www.alphatraders.co.il${path}`, { headers }));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe(`/${locale}/login`);
      expect(location.searchParams.get("redirectTo")).toBe(path);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain("1,200");
    }
  });

  it.each(["en", "ar"])("rejects a fabricated or expired %s session and retains the intended page", async locale => {
    const path = `/${locale}/learn-with-mark?utm_source=friend&tag=a&tag=b`;
    const response = await middleware(new NextRequest(`https://www.alphatraders.co.il${path}`, {
      headers: { cookie: `${AUTH_COOKIE_NAME}=expired-token; ${AUTH_VERIFIED_COOKIE_NAME}=1` },
    }));
    expect(response.headers.get("location")).toBeNull();
    mocks.session.mockResolvedValue(null);
    await expect(Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ utm_source: "friend", tag: ["a", "b"], unused: undefined }) })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/${locale}/login?redirectTo=${encodeURIComponent(path)};307;`,
    });
  });

  it.each(["en", "ar"])("retains the course and referral offer for a valid %s member", async locale => {
    mocks.session.mockResolvedValue({ id: "signed-in-learner" });
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale }) }));
    expect(html).toContain("ICT Mentorship");
    expect(html).toContain("1,200");
    expect(html).toContain("course-overview");
    expect(html).not.toMatch(/without creating an account|No website account is needed|بدون إنشاء حساب|ما بتحتاج حساب/);
  });

  it("fails closed if session validation is unavailable", async () => {
    mocks.session.mockRejectedValue(new Error("Session unavailable"));
    await expect(Page({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("Session unavailable");
  });

  it("keeps the protected course out of public search discovery", async () => {
    expect(sitemap().some(entry => entry.url.includes("/learn-with-mark"))).toBe(false);
    for (const locale of ["en", "ar"]) {
      expect((await generateMetadata({ params: Promise.resolve({ locale }) })).robots).toMatchObject({ index: false, follow: false });
    }
  });
});
