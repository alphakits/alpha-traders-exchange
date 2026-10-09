import { expect, test, type Page } from "@playwright/test";

async function expectLoginFits(page: Page) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      'header a, header button, [data-login-surface] input, [data-login-surface] button, [data-login-surface] a',
    )).filter((element) => element.getClientRects().length > 0).map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute("aria-label") || element.textContent || element.id,
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return { width: root.clientWidth, height: window.innerHeight,
      scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, controls };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.height + 1);
  for (const control of geometry.controls) {
    expect(control.left, control.label).toBeGreaterThanOrEqual(-1);
    expect(control.right, control.label).toBeLessThanOrEqual(geometry.width + 1);
    expect(control.top, control.label).toBeGreaterThanOrEqual(-1);
    expect(control.bottom, control.label).toBeLessThanOrEqual(geometry.height + 1);
  }
}

for (const locale of ["en", "ar"]) {
  test(`${locale} login fits desktop, laptop, scaled and landscape viewports`, async ({ page }, testInfo) => {
    await page.goto(`/${locale}/login`);
    await expect(page.locator("form[data-hydrated]")).toHaveAttribute("data-hydrated", "true");
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720],
      [1366, 625], [1280, 600], [1024, 600], [1024, 500], [800, 480], [768, 432], [640, 360]]) {
      await page.setViewportSize({ width, height });
      await expectLoginFits(page);
      if (width === 1366 && height === 625) {
        await page.screenshot({ path: testInfo.outputPath(`login-${locale}-laptop.png`) });
      }
    }
    // Responsive reflow must preserve the same usable form and entered values.
    await page.locator("#login-email").fill("viewport@example.test");
    await page.locator("#login-password").fill("layout-check-only");
    await page.locator('button[aria-controls="login-password"]').click();
    await expect(page.locator("#login-password")).toHaveAttribute("type", "text");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("#login-email")).toHaveValue("viewport@example.test");
    await expect(page.locator("#login-password")).toHaveValue("layout-check-only");
    await expectLoginFits(page);
  });

  test(`${locale} status and verification errors keep all actions reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 625 });
    await page.goto(`/${locale}/login?sessionExpired=1`);
    await expect(page.locator("form[data-hydrated]")).toHaveAttribute("data-hydrated", "true");
    await expectLoginFits(page);
    await page.route("**/api/auth/login", route => route.fulfill({ status: 403, json: {
      error: "Please verify your email before signing in.", requiresEmailVerification: true,
    } }));
    await page.locator("#login-email").fill("viewport@example.test");
    await page.locator("#login-password").fill("layout-check-only");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    const resend = page.getByRole("button", { name: locale === "ar" ? "إعادة إرسال بريد التحقق" : "Resend verification email" });
    await expect(resend).toBeVisible();
    await resend.scrollIntoViewIfNeeded();
    await expect(resend).toBeInViewport();
    await page.locator(`a[href="/${locale}/register"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`a[href="/${locale}/register"]`)).toBeInViewport();
  });

  test(`${locale} phone and enlarged-text auth pages never clip controls`, async ({ page }) => {
    for (const path of ["login", "register", "forgot-password"]) {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(`/${locale}/${path}`);
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      for (const control of await page.locator("main input:visible, main button:visible, main a:visible").all()) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/login`);
    await expectLoginFits(page);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    for (const control of await page.locator("main input:visible, main button:visible, main a:visible").all()) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
  });
}
