import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.session }));
vi.mock("@/lib/seo", () => ({ buildPageMetadata: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/components/admin/alpha-exchange-admin-dashboard", () => ({
  AlphaExchangeAdminDashboard: () => <div data-testid="private-exchange-dashboard" />,
}));
vi.mock("@/components/admin/owner-live-analytics-panel", () => ({
  OwnerLiveAnalyticsPanel: () => <div data-testid="private-owner-analytics" />,
}));

import Page from "@/app/[locale]/admin/alpha-exchange/page";

const props = (locale = "en") => ({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({}) });
beforeEach(() => vi.clearAllMocks());

describe("exchange administration page access", () => {
  it.each(["en", "ar"])("keeps an ordinary admin on a stable private-data-free page in %s", async locale => {
    mocks.session.mockResolvedValue({ id: "ordinary-admin", role: "admin", roles: ["admin"], sellerStatus: "buyer" });
    const markup = renderToStaticMarkup(await Page(props(locale)));
    expect(markup).not.toContain("private-exchange-dashboard");
    expect(markup).not.toContain("private-owner-analytics");
    expect(markup).toContain(locale === "ar" ? "مالك المنصة فقط" : "platform owner only");
    expect(markup).toContain(`href="/${locale}/profile"`);
  });

  it.each([{ roles: ["owner"] }, { roles: ["owner", "admin"] }])("preserves owner access with roles $roles", async ({ roles }) => {
    mocks.session.mockResolvedValue({ id: "owner", role: "owner", roles, sellerStatus: "buyer" });
    const markup = renderToStaticMarkup(await Page(props()));
    expect(markup).toContain("private-exchange-dashboard");
    expect(markup).toContain("private-owner-analytics");
  });

  it("redirects an anonymous visitor to sign-in", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(Page(props())).rejects.toThrow("REDIRECT:/en/login?redirectTo=%2Fen%2Fadmin%2Falpha-exchange");
  });

  it("keeps a buyer outside the administration page", async () => {
    mocks.session.mockResolvedValue({ id: "buyer", role: "buyer", roles: ["buyer"], sellerStatus: "buyer" });
    await expect(Page(props())).rejects.toThrow("REDIRECT:/en/usdt-exchange");
  });
});
