// @vitest-environment node
import type { AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import middleware from "@/middleware";
import OfferPage from "@/app/[locale]/mentorship-offer/page";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, locale, children }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale: string }) =>
    <a href={`/${locale}${href}`}>{children}</a>,
}));
afterEach(() => vi.restoreAllMocks());

it.each(["ar", "en"] as const)("opens the public %s invitation before the protected full programme", async locale => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-15T12:00:00Z"));
  const publicURL = `https://www.alphatraders.co.il/${locale}/mentorship-offer`;
  for (const headers of [new Headers(), new Headers({ RSC: "1", "Next-Router-Prefetch": "1" })]) {
    expect((await middleware(new NextRequest(publicURL, { headers }))).headers.get("location")).toBeNull();
  }
  const page = () => OfferPage({ params: Promise.resolve({ locale }) }).then(renderToStaticMarkup);
  const november = await page();
  expect(november).toContain("₪6,030");
  expect(november).toContain("₪6,750");
  expect(november).toContain("7:44");
  expect(november.match(/<a\s/g)).toHaveLength(1);
  expect(november).toContain(`href="/${locale}/learn-with-mark"`);
  expect(november).not.toMatch(/<audio|<form|1,200/);
  const next = await middleware(new NextRequest(`https://www.alphatraders.co.il/${locale}/learn-with-mark`));
  expect(new URL(next.headers.get("location")!).searchParams.get("redirectTo")).toBe(`/${locale}/learn-with-mark`);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-30T22:00:00Z"));
  const december = await page();
  expect(december).toContain(locale === "en" ? "at least 10%" : "10% على الأقل");
  expect(december).not.toMatch(/6,030|6,750/);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-12-31T22:00:00Z"));
  await expect(page()).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/${locale}/learn-trading-free;307;` });
});
