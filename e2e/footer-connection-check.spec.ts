import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  test(`footer reports a failed check and subsequent recovery in ${locale}`, async ({ page }, info) => {
    await page.setViewportSize(locale === "ar" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    let unavailable = true;
    let calls = 0;
    await page.route("**/api/health", route => {
      calls += 1;
      return route.fulfill({ status: unavailable ? 503 : 200, contentType: "application/json", body: JSON.stringify({
        status: unavailable ? "degraded" : "ok", checks: { database: unavailable ? "error" : "ok" }, timestamp: new Date().toISOString(),
      }) });
    });
    await page.goto(`/${locale}`);
    const button = page.getByRole("button", { name: locale === "ar" ? "فحص اتصال الموقع" : "Check website connection", exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    expect(calls).toBe(0);
    await button.click();
    await expect(page.getByText(locale === "ar" ? "تعذر تأكيد الاتصال. أعد المحاولة." : "Connection unconfirmed. Try again.", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`connection-failed-${locale}.png`) });
    unavailable = false;
    await button.click();
    await expect(page.getByText(locale === "ar" ? "نجح آخر فحص" : "Last check passed", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`connection-recovered-${locale}.png`) });
    expect(calls).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}
