import { describe, expect, it } from "vitest";
import { buildPageMetadata } from "@/lib/seo";
import { buildLocalizedSiteMetadata } from "@/lib/site-metadata";

describe("localized site metadata", () => {
  it("provides Arabic defaults and Israel-appropriate Open Graph locale", () => {
    const metadata = buildLocalizedSiteMetadata("ar");

    expect(metadata.title).toMatchObject({ default: expect.stringContaining("تعليم التداول") });
    expect(metadata.description).toContain("أكاديمية عربية");
    expect(metadata.openGraph).toMatchObject({
      locale: "ar_IL",
      alternateLocale: ["en_US"],
      description: expect.stringContaining("أكاديمية"),
    });
    expect(metadata.twitter).toMatchObject({ description: expect.stringContaining("أكاديمية") });
  });

  it("provides complete English defaults without changing technical brand names", () => {
    const metadata = buildLocalizedSiteMetadata("en");

    expect(metadata.title).toMatchObject({
      default: expect.stringContaining("Trading Education & USDT Marketplace"),
    });
    expect(metadata.description).toContain("Premium free trading academy");
    expect(metadata.openGraph).toMatchObject({
      locale: "en_US",
      alternateLocale: ["ar_IL"],
      description: expect.stringContaining("Alpha Traders"),
    });
  });

  it("uses matching Arabic and English Open Graph locale alternates for pages", () => {
    const arabicPage = buildPageMetadata({
      locale: "ar",
      title: "اختبار",
      description: "وصف",
      path: "/test",
    });
    const englishPage = buildPageMetadata({
      locale: "en",
      title: "Test",
      description: "Description",
      path: "/test",
    });

    expect(arabicPage.openGraph).toMatchObject({ locale: "ar_IL", alternateLocale: ["en_US"] });
    expect(englishPage.openGraph).toMatchObject({ locale: "en_US", alternateLocale: ["ar_IL"] });
  });
});
