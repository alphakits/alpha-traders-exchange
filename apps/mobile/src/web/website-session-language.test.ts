import { describe, expect, it } from "vitest";
import { websiteSessionResume } from "./website-session-language";

const origin = "https://www.alphatraders.co.il";

describe("website shell session language", () => {
  it("starts English with no choice even when an old Arabic page was saved", () => {
    expect(websiteSessionResume(null, `${origin}/ar/trades?filter=completed#history`)).toEqual({
      locale: "en",
      uri: `${origin}/en/trades?filter=completed#history`,
    });
    expect(websiteSessionResume(null, null)).toEqual({ locale: "en", uri: `${origin}/en` });
  });

  it("restores Arabic for the same session and preserves the page destination", () => {
    expect(websiteSessionResume("ar", `${origin}/ar/trade-room/trade-123?tab=chat#latest`)).toEqual({
      locale: "ar",
      uri: `${origin}/ar/trade-room/trade-123?tab=chat#latest`,
    });
  });

  it("returns to English after the trusted logout bridge clears the language choice", () => {
    expect(websiteSessionResume("en", `${origin}/ar/usdt-exchange#marketplace`)).toEqual({
      locale: "en",
      uri: `${origin}/en/usdt-exchange#marketplace`,
    });
  });

  it("retains existing resume URL safety and handles invalid stored language", () => {
    expect(websiteSessionResume("invalid", "https://attacker.example/ar/trades")).toEqual({
      locale: "en", uri: `${origin}/en`,
    });
    expect(websiteSessionResume("ar", `${origin}/api/mobile/v1/auth/session`)).toEqual({
      locale: "ar", uri: `${origin}/ar`,
    });
  });
});
