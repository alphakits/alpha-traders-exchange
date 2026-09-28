import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("isolated public economic calendar", () => {
  it("loads the official US high-importance widget with attribution and no account access", async () => {
    const response = GET(new NextRequest("https://www.alphatraders.co.il/api/news/calendar?locale=ar"));
    const html = await response.text();
    const policy = response.headers.get("content-security-policy")!;
    expect(html).toContain('"locale":"ar_AE"');
    expect(html).toContain('"countryFilter":"us"');
    expect(html).toContain('"importanceFilter":"0,1"');
    expect(html).toContain("https://s3.tradingview.com/external-embedding/embed-widget-events.js");
    expect(html).toContain("by TradingView");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("never reflects arbitrary locale input into the document or script", async () => {
    const input = encodeURIComponent('</script><script>alert(1)</script>');
    const response = GET(new NextRequest(`https://www.alphatraders.co.il/api/news/calendar?locale=${input}`));
    const html = await response.text();
    expect(html).toContain('"locale":"en"');
    expect(html).not.toContain("alert(1)");
  });
});
