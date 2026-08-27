import { describe, expect, it } from "vitest";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";

describe("request locale", () => {
  it("honors X-Locale ahead of every inferred locale", () => {
    expect(resolveSupportedRequestLocale(new Headers({ "X-Locale": "ar", "Accept-Language": "en" }))).toBe("ar");
    expect(resolveSupportedRequestLocale(new Headers({
      "X-Locale": "en",
      Referer: "https://www.alphatraders.co.il/ar/forgot-password",
      "Accept-Language": "ar",
    }))).toBe("en");
  });

  it("keeps the localized page choice ahead of the browser language", () => {
    expect(resolveSupportedRequestLocale(new Headers({
      Referer: "https://www.alphatraders.co.il/ar/forgot-password",
      "Accept-Language": "en-US,en;q=0.9",
    }))).toBe("ar");
    expect(resolveSupportedRequestLocale(new Headers({
      Referer: "https://www.alphatraders.co.il/en/verify-email",
      "Accept-Language": "ar-IL,ar;q=0.9",
    }))).toBe("en");
  });

  it("respects Accept-Language ordering, quality, and exclusions", () => {
    expect(resolveSupportedRequestLocale(new Headers({ "Accept-Language": "en-US,en;q=0.9,ar;q=0" }))).toBe("en");
    expect(resolveSupportedRequestLocale(new Headers({ "Accept-Language": "en;q=0.5,ar-IL;q=0.9" }))).toBe("ar");
    expect(resolveSupportedRequestLocale(new Headers({ "Accept-Language": "ar;q=0,en;q=0" }), "ar")).toBe("ar");
  });

  it("uses the localized referer and then the requested default", () => {
    expect(resolveSupportedRequestLocale(new Headers({ Referer: "https://www.alphatraders.co.il/ar/profile" }))).toBe("ar");
    expect(resolveSupportedRequestLocale(new Headers(), "ar")).toBe("ar");
  });
});
