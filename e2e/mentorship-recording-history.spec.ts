import { expect, test } from "@playwright/test";

for (const locale of ["ar", "en"]) {
  test(`Back restores the ${locale} course content after leaving its recording section`, async ({ page, baseURL }) => {
    expect(new URL(baseURL!).hostname).toBe("localhost");
    const email = process.env.E2E_BUYER_EMAIL;
    expect(email).toMatch(/@(?:offline\.)?example\.test$/);
    const login = await page.request.post("/api/auth/login", {
      headers: { "x-forwarded-for": "198.51.100.79" },
      data: { email, password: process.env.E2E_BUYER_PASSWORD, rememberMe: false },
    });
    expect(login.ok()).toBe(true);

    await page.goto(`/${locale}/learn-with-mark`);
    await page.locator('main a[href="#mark-explains"]').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/learn-with-mark#mark-explains$`));
    await page.locator("header .alpha-brand-link").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/?$`));
    // Exercise Back after the destination has rendered, not while its route
    // is still streaming: the URL can change before the home content commits.
    await expect(page.locator("main .alpha-home-hero h1")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${locale}/learn-with-mark#mark-explains$`));
    await expect(page.locator("#course-overview")).toBeVisible();
    await expect(page.locator("#mark-explains audio")).toBeVisible();
  });
}
