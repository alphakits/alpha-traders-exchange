import { expect, test, request } from "@playwright/test";
import { E2E_BASE_URL } from "./support/base-url";
import lessonData from "../src/data/lessons.json";
import providedLessons from "../src/data/lessons-provided.json";

for (const locale of ["en", "ar"] as const) {
  const isAr = locale === "ar";
  test(`price alerts persist for the owning buyer without placing a trade (${locale})`, async ({ page }) => {
    const login = await page.request.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.231" }, data: { email: process.env.E2E_BUYER_EMAIL!, password: process.env.E2E_BUYER_PASSWORD!, rememberMe: true } });
    expect(login.ok()).toBeTruthy();
    await page.setViewportSize({ width: isAr ? 390 : 1280, height: 900 });
    await page.goto(`/${locale}/usdt-exchange`);
    const panel = page.getByRole("region", { name: isAr ? "تنبيه سعر USDT" : "USDT price alert" });
    const save = panel.getByRole("button", { name: isAr ? "حفظ التنبيه" : "Save alert" });
    await expect(save).toBeHidden();
    await panel.locator("summary").click();
    await expect(save).toBeEnabled();
    await panel.getByLabel(isAr ? "أعلى سعر (₪ / USDT)" : "Maximum price (₪ / USDT)").fill("3.65");
    await panel.getByLabel(isAr ? "أقل كمية USDT (اختياري)" : "Minimum USDT (optional)").fill("150");
    await panel.getByLabel(isAr ? "تفعيل تنبيه السعر لحسابي" : "Enable price alerts for my account").check();
    await save.click();
    await expect(panel.getByRole("status")).toHaveText(isAr ? "تم حفظ إعدادات التنبيه." : "Alert preferences saved.");
    const response = await page.request.get("/api/alpha-exchange/price-alerts");
    expect(response.headers()["cache-control"]).toContain("private");
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(["ownerId", "preference"]);
    expect(payload.preference).toMatchObject({ enabled: true, maxPrice: "3.65", minUsdt: "150" });
    const forged = await page.request.patch("/api/alpha-exchange/price-alerts", { headers: { origin: E2E_BASE_URL }, data: { ...payload.preference, userId: "another-buyer" } });
    expect(forged.status()).toBe(400);
    await page.reload();
    await expect(save).toBeHidden();
    await panel.locator("summary").click();
    await expect(panel.getByLabel(isAr ? "أعلى سعر (₪ / USDT)" : "Maximum price (₪ / USDT)")).toHaveValue("3.65");
    await expect(page.locator("body")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await panel.screenshot({ path: `test-results/workspace-additions-${locale}-price-alert.png` });
    await page.request.patch("/api/alpha-exchange/price-alerts", { headers: { origin: E2E_BASE_URL }, data: { enabled: false, maxPrice: "", minUsdt: "", paymentMethod: "all" } });
  });

  test(`owner priorities link directly to private session settings (${locale})`, async ({ page }) => {
    const login = await page.request.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.232" }, data: { email: process.env.E2E_OWNER_EMAIL!, password: process.env.E2E_OWNER_PASSWORD!, rememberMe: true } });
    expect(login.ok()).toBeTruthy();
    await page.goto(`/${locale}/admin/alpha-exchange`);
    const queue = page.getByRole("region", { name: isAr ? "قائمة متابعة المالك" : "Owner attention queue" });
    await expect(queue).toBeVisible();
    await queue.getByRole("link", { name: isAr ? "أمان حساب المالك" : "Owner account security" }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/settings\\?tab=security`));
    const sessions = page.getByRole("region", { name: isAr ? "جلسات حسابك" : "Your account sessions" });
    await expect(sessions.getByText(isAr ? "الجلسة الحالية" : "Current session", { exact: true })).toBeVisible();
    const response = await page.request.get("/api/alpha-exchange/account-sessions");
    const payload = await response.json();
    expect(payload.sessions).toHaveLength(1);
    expect(Object.keys(payload.sessions[0]).sort()).toEqual(["createdAt", "deviceLabel", "expiresAt", "id", "isCurrent"]);
    await sessions.screenshot({ path: `test-results/workspace-additions-${locale}-sessions.png` });
  });
}

for (const locale of ["en", "ar"] as const) {
test(`session controls revoke the current session and restore English after sign-out (${locale})`, async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.233" }, data: { email: process.env.E2E_BUYER_EMAIL!, password: process.env.E2E_BUYER_PASSWORD!, rememberMe: true } })).ok()).toBeTruthy();
  await page.goto(`/${locale}/settings?tab=security`);
  await page.getByRole("button", { name: locale === "ar" ? "تسجيل الخروج من هذه الجلسة" : "Sign out this session", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/login/);
  expect((await page.request.get("/api/alpha-exchange/account-sessions")).status()).toBe(401);
  await expect(page.getByRole("region", { name: locale === "ar" ? "جلسات حسابك" : "Your account sessions" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Login", exact: true })).toBeVisible();
});
}

test("another sign-in replaces the earlier session without changing the one-session policy", async ({ page }) => {
  const loginData = { email: process.env.E2E_BUYER_EMAIL!, password: process.env.E2E_BUYER_PASSWORD!, rememberMe: true };
  expect((await page.request.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.234" }, data: loginData })).ok()).toBeTruthy();
  const other = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    expect((await other.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.235" }, data: loginData })).ok()).toBeTruthy();
    expect((await page.request.get("/api/alpha-exchange/account-sessions")).status()).toBe(401);
    const active = await other.get("/api/alpha-exchange/account-sessions");
    expect((await active.json()).sessions).toHaveLength(1);
  } finally { await other.dispose(); }
});

test("academy resumes the saved position and opens the existing knowledge check", async ({ page }) => {
  const lesson = [...lessonData, ...providedLessons].find(entry => entry.quiz?.length && (entry.status ?? "published") === "published")!;
  expect(lesson).toBeTruthy();
  expect((await page.request.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.236" }, data: { email: process.env.E2E_OWNER_EMAIL!, password: process.env.E2E_OWNER_PASSWORD!, rememberMe: true } })).ok()).toBeTruthy();
  await page.addInitScript(entry => {
    localStorage.setItem("alpha-traders:learning-meta", JSON.stringify({ lastLessonId: entry.id, lastLessonSlug: entry.slug, lastCourseId: entry.courseId, lastActivityAt: "2026-10-04T00:00:00Z", totalStudyMinutes: 12 }));
    localStorage.setItem("alpha-traders:lesson-progress", JSON.stringify({ [entry.id]: { lessonId: entry.id, lessonSlug: entry.slug, courseId: entry.courseId, videoWatched: false, pdfOpened: false, quizCompleted: false, lessonCompleted: false, bookmarked: false, quizScore: null, notes: "", notesSavedAt: null, pdfReadProgress: 0, videoPositionSeconds: 123, updatedAt: "2026-10-04T00:00:00Z" } }));
  }, lesson);
  await page.goto("/en/academy/dashboard");
  await expect(page.getByText(/Saved video position/)).toHaveText("Saved video position: 2:03");
  await expect(page.getByRole("link", { name: /Check your understanding/ })).toHaveAttribute("href", `/en/lessons/${lesson.slug}#lesson-quiz`);
});
