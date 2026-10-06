import { describe, expect, it } from "vitest";
import { websiteNavigationDecision, websiteRequestNavigationDecision } from "./website-navigation";

describe("native document and iframe navigation", () => {
  it.each(["https://s.tradingview.com/widgetembed/?symbol=BINANCE%3AETHUSDT", "https://www.tradingview.com/chart/", "https://tradingview.com/"])("blocks legacy chart links in every native navigation path: %s", (url) => {
    expect(websiteNavigationDecision(url)).toBe("block");
    expect(websiteRequestNavigationDecision({ url })).toBe("block");
    expect(websiteRequestNavigationDecision({ url, isTopFrame: false, navigationType: "other" })).toBe("block");
    expect(websiteRequestNavigationDecision({ url, isTopFrame: true, navigationType: "other" })).toBe("block");
    expect(websiteRequestNavigationDecision({ url, isTopFrame: true, navigationType: "click" })).toBe("block");
  });

  it.each([
    "https://example.com/iframe", "https://s.tradingview.com.evil.test/widgetembed/",
    "https://s.tradingview.com/other", "https://user:pass@s.tradingview.com/widgetembed/",
    "https://s.tradingview.com:444/widgetembed/", "http://s.tradingview.com/widgetembed/",
    "mailto:someone@example.test", "javascript:alert(1)", "data:text/html,hello",
    "blob:https://example.com/frame", "not a URL",
  ])("blocks %s in subframes instead of launching an external application", (url) => {
    expect(websiteRequestNavigationDecision({ url, isTopFrame: false })).toBe("block");
  });

  it("keeps Android links working when iOS-only request metadata is absent", () => {
    expect(websiteRequestNavigationDecision({ url: "https://www.alphatraders.co.il/ar/contact" })).toBe("allow");
    expect(websiteRequestNavigationDecision({ url: "https://example.com/help" })).toBe("external");
    expect(websiteRequestNavigationDecision({ url: "tel:+972500000000" })).toBe("external");
    expect(websiteRequestNavigationDecision({ url: "javascript:alert(1)" })).toBe("block");
  });

  it("keeps trusted navigation and deliberate external clicks while blocking automatic external redirects", () => {
    expect(websiteRequestNavigationDecision({ url: "https://www.alphatraders.co.il/en/login", isTopFrame: true, navigationType: "other" })).toBe("allow");
    expect(websiteRequestNavigationDecision({ url: "https://discord.com/oauth2/authorize", isTopFrame: true, navigationType: "other" })).toBe("allow");
    expect(websiteRequestNavigationDecision({ url: "https://example.com/help", isTopFrame: true, navigationType: "click" })).toBe("external");
    expect(websiteRequestNavigationDecision({ url: "https://example.com/help", isTopFrame: true, navigationType: "other" })).toBe("block");
    expect(websiteRequestNavigationDecision({ url: "mailto:support@alphatraders.co.il", isTopFrame: true, navigationType: "click" })).toBe("external");
  });
});
