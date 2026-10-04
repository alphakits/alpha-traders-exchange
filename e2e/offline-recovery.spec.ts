import { expect, test } from "@playwright/test";
import { LOCALE_CHOICE_COOKIE } from "../src/i18n/locale-preference";

for (const locale of ["en", "ar"]) {
  test(`offline recovery remains reachable with an explicit ${locale} preference`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: LOCALE_CHOICE_COOKIE, value: locale, url: baseURL! }]);
    const response = await page.goto("/offline");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp("/offline$"));
    await expect(page.getByRole("heading", { name: "أنت غير متصل بالإنترنت. أعد الاتصال للمتابعة." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "You’re offline. Reconnect to continue trading." })).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
  });
}
