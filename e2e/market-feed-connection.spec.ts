import { expect, test } from "@playwright/test";
import { USD_ILS_REFERENCE_SYMBOL } from "../packages/contracts/src/usd-ils-reference";
import type { MarketSnapshot } from "../src/types/market";

test.describe("shared public market connection", () => {
  for (const locale of ["en", "ar"] as const) {
    test(`homepage and footer share the ${locale} feed`, async ({ page }) => {
      const quotedAt = Date.now();
      const snapshot: MarketSnapshot = {
        status: "live", stale: false, updatedAt: new Date().toISOString(), unavailablePairs: [],
        pairs: {
          ethUsdt: { key: "ethUsdt", label: "ETH/USDT", price: 3200, changePercent: null, source: "test" },
          btcUsdt: { key: "btcUsdt", label: "BTC/USDT", price: 100000, changePercent: null, source: "test" },
          usdtIls: {
            key: "usdtIls", label: "USDT/ILS", price: 3.6, changePercent: null,
            source: USD_ILS_REFERENCE_SYMBOL, quoteStatus: "live",
            quotedAt: new Date(quotedAt).toISOString(), validUntil: new Date(quotedAt + 120_000).toISOString(),
          },
        },
      };
      let requests = 0;
      await page.route("**/api/market/center", async (route) => {
        requests += 1;
        await route.fulfill({ json: { snapshot } });
      });
      await page.goto(`/${locale}`);
      await expect(page.getByText(locale === "ar" ? "مركز ألفا للسوق" : "Alpha Market Center", { exact: true })).toBeVisible();
      await expect(page.locator("footer").getByText("₪3.60000", { exact: true })).toBeVisible();
      expect(requests).toBe(1);
    });
  }
});
