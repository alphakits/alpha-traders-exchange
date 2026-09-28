// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPageMetadata } from "@/lib/seo";
import sitemap from "@/app/sitemap";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.session }));
vi.mock("@/components/prop-firms/firm-directory", () => ({ FirmDirectory: () => null }));
vi.mock("@/components/prop-firms/firm-guide", () => ({ FirmGuide: () => null }));
import Directory from "@/app/[locale]/prop-firms/page";
import Guide from "@/app/[locale]/prop-firms/[firm]/page";

beforeEach(() => { mocks.session.mockReset(); });

describe("server-validated prop-firm access", () => {
  it.each(["ar", "en"])("requires a valid session before rendering the %s directory", async locale => {
    mocks.session.mockResolvedValue(null);
    await expect(Directory({ params: Promise.resolve({ locale }) })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/prop-firms`)};307;`,
    });
  });

  it.each(["ar", "en"])("protects direct %s company links and preserves the selected account", async locale => {
    mocks.session.mockResolvedValue(null);
    const path = `/${locale}/prop-firms/topstep?program=xfa-consistency&size=150000&tag=a&tag=b`;
    await expect(Guide({ params: Promise.resolve({ locale, firm: "topstep" }), searchParams: Promise.resolve({ program: "xfa-consistency", size: "150000", tag: ["a", "b"] }) })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/${locale}/login?redirectTo=${encodeURIComponent(path)};307;`,
    });
  });

  it.each(["ar", "en"])("renders the %s directory and chosen account for a validated user", async locale => {
    mocks.session.mockResolvedValue({ id: "signed-in-test-user" });
    expect((await Directory({ params: Promise.resolve({ locale }) })).props.locale).toBe(locale);
    const page = await Guide({ params: Promise.resolve({ locale, firm: "topstep" }), searchParams: Promise.resolve({ program: "xfa-consistency", size: "150000" }) });
    expect(page.props.initialProgram).toBe("xfa-consistency");
    expect(page.props.initialSize).toBe(150000);
    expect(page.props.firm.slug).toBe("topstep");
  });

  it("fails closed on a session outage instead of rendering guide content", async () => {
    mocks.session.mockRejectedValue(new Error("Session unavailable"));
    await expect(Directory({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("Session unavailable");
    await expect(Guide({ params: Promise.resolve({ locale: "ar", firm: "ftmo" }), searchParams: Promise.resolve({}) })).rejects.toThrow("Session unavailable");
  });

  it("removes members-only guides from the sitemap and marks them noindex", () => {
    expect(sitemap().some(entry => entry.url.includes("/prop-firms"))).toBe(false);
    for (const path of ["/prop-firms", "/prop-firms/topstep"]) {
      expect(buildPageMetadata({ locale: "en", path, title: "Guide", description: "Guide" }).robots).toMatchObject({ index: false });
    }
  });
});
