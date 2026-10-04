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
}
