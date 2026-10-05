import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  for (const width of [320, 393]) {
    test(`installed ${locale} homepage and footer stay usable at ${width}px without automatic chart frames`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 });
      // A synthetic bridge in the isolated fixture exercises the installed
      // website surface without a real account, device or external side effect.
      await page.addInitScript(() => {
        window.ReactNativeWebView = { postMessage: () => undefined };
      });
      await page.goto(`/${locale}`);
      await page.getByRole("button", { name: "BTC/USDT", exact: true }).click();
      const chart = page.getByRole("link", { name: locale === "ar" ? "فتح المخطط في المتصفح" : "Open chart in browser", exact: true });
      await expect(chart).toBeVisible();
      await expect(chart).toHaveAttribute("href", /symbol=BINANCE%3ABTCUSDT/);
      await expect(page.locator('iframe[src^="https://s.tradingview.com/"]')).toHaveCount(0);

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
    });
  }
}
