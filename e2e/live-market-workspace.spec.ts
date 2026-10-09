import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

for (const locale of ["en", "ar"] as const) {
  test(`${locale} seller profile reaches current listing controls and passive charts fit all screens`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    expect(new URL(baseURL!).hostname).toBe("localhost");
    // Optional local transport fixture contains captured public provider responses,
    // never generated prices. Live network verification remains the default.
    const captureDirectory = process.env.ALPHA_E2E_MARKET_CAPTURES;
    if (captureDirectory) {
      await page.route("**/api/market/chart?symbol=*", async route => {
        const symbol = new URL(route.request().url()).searchParams.get("symbol");
        if (symbol !== "BTCUSDT" && symbol !== "ETHUSDT") return route.continue();
        const file = join(captureDirectory, `${symbol === "BTCUSDT" ? "btc" : "eth"}-real-candles.json`);
        const rows = JSON.parse(readFileSync(file, "utf8")) as [number, string, string, string, string][];
        await route.fulfill({ json: { chart: { symbol, interval: "5m", source: "Binance", stale: false,
          updatedAt: statSync(file).mtime.toISOString(), candles: rows.map(([time, open, high, low, close]) => ({ time, open: Number(open), high: Number(high), low: Number(low), close: Number(close) })) } } });
      });
      await page.route("**/api/market/center", route => route.fulfill({ contentType: "application/json", body: readFileSync(join(captureDirectory, "captured-market-center.json"), "utf8") }));
    }
    const response = await page.request.post("/api/auth/login", {
      headers: { "x-forwarded-for": "198.51.100.148" },
      data: { email: process.env.E2E_SELLER_EMAIL, password: process.env.E2E_SELLER_PASSWORD, rememberMe: false },
    });
    expect(response.ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/profile`);
    await page.getByRole("link", { name: locale === "en" ? "Seller workspace" : "مساحة البائع", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/usdt-exchange#my-listings-section$`));
    await expect(page.locator("#my-listings-section")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#my-listings-section")).toContainText(locale === "en" ? "My Listings" : "قائمتي");
    await page.locator("#my-listings-section").screenshot({ path: testInfo.outputPath(`seller-workspace-${locale}.png`) });
    const overview = page.locator("#market-overview");
    await expect(overview.locator("details, summary, button, a, iframe")).toHaveCount(0);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 936 });
      await overview.scrollIntoViewIfNeeded();
      await expect(overview).toBeVisible();
      // Scroll each passive card into view so its visibility-scoped real feed starts.
      for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
        const card = overview.locator(`[data-market-chart="${symbol}"]`);
        await card.scrollIntoViewIfNeeded();
        await expect(card.locator("svg")).toBeVisible({ timeout: 30_000 });
        expect(Number(await card.locator("svg").getAttribute("data-candle-count"))).toBeGreaterThan(2);
      }
      const sizing = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      expect(sizing.scroll).toBeLessThanOrEqual(sizing.width + 1);
      const carousel = overview.locator("[data-live-market-cards]");
      await carousel.evaluate(element => { element.scrollLeft = 0; });
      if (width < 768) await overview.locator('[data-market-chart="BTCUSDT"]').scrollIntoViewIfNeeded();
      await overview.screenshot({ path: testInfo.outputPath(`market-${locale}-${width}.png`) });
    }
    expect(errors).toEqual([]);
    // Old entry points now render the same working exchange and visible listing controls.
    await page.goto(`/${locale}/dashboard/seller#my-listings-section`);
    await expect(page.locator("#my-listings-section")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#marketplace")).toBeVisible();
  });
}
