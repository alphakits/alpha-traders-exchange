import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  for (const width of [320, 393, 1440]) {
    for (const native of [false, true]) {
      test(`${native ? "installed" : "browser"} ${locale} charts stay in Alpha Traders at ${width}px`, async ({ page, context }, testInfo) => {
        await page.setViewportSize({ width, height: 852 });
        // A synthetic bridge in the isolated fixture exercises the installed
        // website surface without a real account, device or external side effect.
        if (native) await page.addInitScript(() => {
          window.ReactNativeWebView = { postMessage: () => undefined };
        });
        const externalChartRequests: string[] = [];
        page.on("request", (request) => {
          if (/tradingview\./i.test(request.url())) externalChartRequests.push(request.url());
        });
        // The local fixture can use deterministic data when provider access is
        // unavailable. Leave this unset for preview/production feed verification.
        if (process.env.E2E_CHART_MOCK_DATA === "1") {
          await page.addInitScript(() => Object.defineProperty(window, "WebSocket", { value: undefined, configurable: true }));
          await page.route("**/api/market/chart?*", (route) => route.fulfill({ json: { chart: {
            symbol: new URL(route.request().url()).searchParams.get("symbol"),
            interval: "5m", source: "Binance", stale: false, updatedAt: new Date().toISOString(),
            candles: Array.from({ length: 48 }, (_, index) => ({
              time: Math.floor(Date.now() / 300_000) * 300_000 - (47 - index) * 300_000,
              open: 2700 + index * 2, high: 2710 + index * 2,
              low: 2695 + index * 2, close: 2705 + index * 2,
            })),
          } } }));
        }
        await page.goto(`/${locale}`, { waitUntil: "domcontentloaded" });
        const charts = page.locator("[data-market-charts]");
        const beforeUrl = page.url();
        for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
          const card = charts.locator(`[data-market-chart="${symbol}"]`);
          await card.scrollIntoViewIfNeeded();
          const chart = card.getByRole("img", { name: /(?:BTC|ETH)\s*\/\s*USDT/ });
          await expect(chart).toBeVisible({ timeout: 30_000 });
          // Real pointer input also covers passive SVGs with pointer-events:none.
          const box = await chart.boundingBox();
          expect(box).not.toBeNull();
          await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
          await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: "middle" });
        }
        await expect(charts.locator("a, button, iframe, [href], [target]")).toHaveCount(0);
        expect(page.url()).toBe(beforeUrl);
        expect(context.pages()).toHaveLength(1);
        expect(externalChartRequests).toEqual([]);
        await expect(page.locator('iframe[src*="tradingview"]')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        if (native && width === 393) await charts.screenshot({ path: testInfo.outputPath("market-chart.png") });
        if (width < 768) {
          const footer = page.locator("footer");
          const legal = footer.locator("details").filter({ hasText: locale === "ar" ? "قانوني" : "Legal" });
          await legal.locator("summary").click();
          const terms = legal.getByRole("link", { name: locale === "ar" ? "الشروط" : "Terms", exact: true });
          await expect(terms).toBeVisible();
          await terms.click();
          await expect(page).toHaveURL(new RegExp(`/${locale}/terms$`));
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expect(page.locator("main")).toContainText("1%");
          await expect(page.locator("main")).toContainText("2%");
        }
      });
    }
  }
}
