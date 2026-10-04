import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"]) {
  test(`an unsupported engine has usable ${locale} recovery before framework hydration`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.CSS, "supports", { value: () => false, configurable: true });
    });
    await page.goto(`/${locale}/login?redirectTo=%2F${locale}%2Ftrade-room%2Fprivate-fixture`);
    await expect(page).toHaveURL(new RegExp(`/browser-update\\.html#${locale}$`));
    await expect(page.getByRole("heading", { name: locale === "ar" ? "حدّث متصفح جهازك" : "Update your browser" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect(page.getByRole("link", { name: locale === "ar" ? "المحاولة مجددًا بعد التحديث" : "Try again after updating" })).toHaveAttribute("href", `/${locale}`);
    await expect(page.locator("form")).toHaveCount(0);
  });
  test(`old iOS has actionable ${locale} operating-system recovery`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    });
    try {
      await context.addInitScript(() => {
        Object.defineProperty(window.CSS, "supports", { value: () => false, configurable: true });
      });
      const page = await context.newPage();
      await page.goto(`/${locale}`);
      await expect(page).toHaveURL(new RegExp(`/browser-update\\.html#${locale}$`));
      await expect(page.locator(locale === "ar" ? "#arabic .ios" : "#english .ios")).toBeVisible();
      await expect(page.locator(locale === "ar" ? "#arabic .ios" : "#english .ios")).toContainText("16.4");
      await expect(page.locator("#chrome")).toBeHidden();
      await expect(page.locator("#retry")).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
