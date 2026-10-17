import { expect, test, type Page } from "@playwright/test";
import type { Lesson } from "../src/types/academy";

async function owner(page: Page) {
  const login = await page.request.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.241" },
    data: { email: process.env.E2E_OWNER_EMAIL!, password: process.env.E2E_OWNER_PASSWORD!, rememberMe: true } });
  expect(login.ok()).toBeTruthy();
}
async function create(page: Page, id: string) {
  const response = await page.request.post("/api/admin/lessons", { data: { lesson: { id, title: id, titleAr: `درس ${id}`,
    courseId: "c1", status: "draft", description: "Synthetic description", descriptionAr: "وصف تجريبي", summary: "Synthetic summary", summaryAr: "ملخص تجريبي" } } });
  expect(response.status()).toBe(201);
  return (await response.json()).lesson as Lesson;
}
async function saved(page: Page, id: string) {
  const response = await page.request.get(`/api/admin/lessons?q=${encodeURIComponent(id)}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()).lessons as Lesson[]).find(lesson => lesson.id === id)!;
}
for (const locale of ["en", "ar"] as const) {
  const isAr = locale === "ar";
  test.beforeEach(async ({ page }) => { await owner(page); await page.setViewportSize({ width: isAr ? 390 : 1440, height: isAr ? 844 : 936 }); });

  test(`owner preserves edits across selection changes and publishes the edited draft (${locale})`, async ({ page }, info) => {
    const prefix = `audit-editor-switch-${locale}-${info.retry}`;
    const first = await create(page, `${prefix}-first`); const second = await create(page, `${prefix}-second`);
    await page.goto(`/${locale}/admin`);
    await page.getByPlaceholder(isAr ? "بحث بالعنوان/الرقم" : "Search by title/number").fill(prefix);
    await page.getByRole("button", { name: new RegExp(first.title) }).click();
    await page.locator("#lesson-title-en").fill(`${first.title} edited`);
    await page.getByRole("button", { name: new RegExp(second.title) }).click();
    await page.locator("#lesson-title-en").fill(`${second.title} published edit`);
    await page.getByRole("button", { name: isAr ? "نشر" : "Publish", exact: true }).click();
    await expect.poll(async () => (await saved(page, first.id)).title).toBe(`${first.title} edited`);
    await expect.poll(async () => ({ title: (await saved(page, second.id)).title, status: (await saved(page, second.id)).status })).toEqual({ title: `${second.title} published edit`, status: "published" });
    await page.reload();
    await page.getByPlaceholder(isAr ? "بحث بالعنوان/الرقم" : "Search by title/number").fill(prefix);
    await page.getByRole("button", { name: new RegExp(second.title) }).click();
    await expect(page.locator("#lesson-title-en")).toHaveValue(`${second.title} published edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#lesson-title-en").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`owner-editor-${locale}-saved.png`) });
  });

  test(`owner retains a failed save and explicitly retries it (${locale})`, async ({ page }, info) => {
    const lesson = await create(page, `audit-editor-retry-${locale}-${info.retry}`);
    await page.goto(`/${locale}/admin`);
    await page.getByPlaceholder(isAr ? "بحث بالعنوان/الرقم" : "Search by title/number").fill(lesson.id);
    await page.getByRole("button", { name: new RegExp(lesson.title) }).click();
    let failNext = true;
    await page.route(`**/api/admin/lessons/${lesson.id}`, async route => {
      if (route.request().method() === "PUT" && failNext) { failNext = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Controlled temporary outage" }) }); }
      else await route.continue();
    });
    await page.locator("#lesson-title-en").fill(`${lesson.title} retained`);
    const retry = page.getByRole("button", { name: isAr ? "إعادة محاولة الحفظ" : "Retry saving" });
    await expect(retry).toBeVisible();
    await expect(page.locator("#lesson-title-en")).toHaveValue(`${lesson.title} retained`);
    expect((await saved(page, lesson.id)).title).toBe(lesson.title);
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`owner-editor-${locale}-retry.png`) });
    await retry.click();
    await expect.poll(async () => (await saved(page, lesson.id)).title).toBe(`${lesson.title} retained`);
    await expect(retry).toBeHidden();
  });

  test(`owner resolves a stale-tab conflict without silently losing either version (${locale})`, async ({ page }, info) => {
    const lesson = await create(page, `audit-editor-conflict-${locale}-${info.retry}`);
    await page.goto(`/${locale}/admin`);
    await page.getByPlaceholder(isAr ? "بحث بالعنوان/الرقم" : "Search by title/number").fill(lesson.id);
    await page.getByRole("button", { name: new RegExp(lesson.title) }).click();
    const remote = await page.request.put(`/api/admin/lessons/${lesson.id}`, { data: { lesson: { ...lesson, title: `${lesson.title} other tab` } } });
    expect(remote.ok()).toBeTruthy();
    await page.locator("#lesson-title-en").fill(`${lesson.title} local draft`);
    const conflict = page.getByRole("alert").filter({ hasText: isAr ? "تغيّر هذا الدرس" : "This lesson changed" });
    await expect(conflict).toBeVisible();
    expect((await saved(page, lesson.id)).title).toBe(`${lesson.title} other tab`);
    await expect(page.locator("#lesson-title-en")).toHaveValue(`${lesson.title} local draft`);
    await conflict.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`owner-editor-${locale}-conflict.png`) });
    await conflict.getByRole("button", { name: isAr ? "حفظ نسختي بدلاً منها" : "Save my version instead" }).click();
    await expect.poll(async () => (await saved(page, lesson.id)).title).toBe(`${lesson.title} local draft`);
    await expect(conflict).toBeHidden();
  });
}
