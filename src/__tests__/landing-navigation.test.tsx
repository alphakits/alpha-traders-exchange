import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import english from "../../messages/en.json";
import arabic from "../../messages/ar.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: "en" | "ar" }) => {
    const messages = locale === "ar" ? arabic.home : english.home;
    return (key: keyof typeof messages) => messages[key];
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/components/sections/home/trust-bar", () => ({ TrustBar: () => null }));
vi.mock("@/components/sections/home/homepage-stats", () => ({ HomepageStats: () => null }));
vi.mock("@/components/sections/home/founder-preview", () => ({ FounderPreview: () => null }));
vi.mock("@/components/market/alpha-market-center", () => ({ AlphaMarketCenter: () => null }));

import { HomePage } from "@/components/sections/home/home-page";

describe("landing page entry destinations", () => {
  it.each([
    ["en", false], ["ar", false], ["en", true], ["ar", true],
  ] as const)("keeps %s Academy, Exchange and mentorship entry points distinct with signed-in=%s", async (locale, isAuthenticated) => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(await HomePage({ locale, isAuthenticated }));
    const links = [...container.querySelectorAll("a")];
    const entry = (route: string) => isAuthenticated ? route : `/login?redirectTo=${encodeURIComponent(`/${locale}${route}`)}`;
    const exchangeLinks = links.filter(link => /^(?:Enter (?:Alpha )?Exchange|ادخل إلى Alpha Exchange|ادخل البورصة)$/.test(link.textContent?.trim() ?? ""));
    expect(exchangeLinks).toHaveLength(3);
    for (const link of exchangeLinks) expect(link.getAttribute("href")).toBe(entry("/usdt-exchange"));
    const academyLabel = (locale === "ar" ? arabic : english).home.startLearning;
    expect(links.find(link => link.textContent?.trim() === academyLabel)?.getAttribute("href")).toBe(entry("/academy"));
    expect(links.find(link => link.textContent?.includes("ICT Mentorship"))?.getAttribute("href")).toBe("/learn-with-mark");
  });
});
