/** Exercises the published academy with synthetic students on loopback only. */
import { chromium, request } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provisionQaWorld } from "../e2e/support/qa-accounts";
import { lessons } from "../src/lib/content";
import { resolveLessonResourceUrl } from "../src/lib/lesson-video";

async function main() {
  const baseURL = process.env.REVIEW_BASE_URL ?? "http://127.0.0.1:3217";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) throw new Error("Synthetic fixtures require loopback.");
  const out = resolve(process.env.REVIEW_OUTPUT_DIR ?? "test-results/academy-release");
  await mkdir(out, { recursive: true });
  const api = await request.newContext({ baseURL, timeout: 120000 });
  const world = await provisionQaWorld(api);
  const proxyAddress = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const proxyUrl = proxyAddress ? new URL(proxyAddress) : null;
  const proxy = proxyUrl ? { server: proxyUrl.origin, bypass: "127.0.0.1,localhost", ...(proxyUrl.username ? { username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) } : {}) } : undefined;
  const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM_PATH, proxy, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process", "--use-gl=angle", "--use-angle=swiftshader"] });
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, bypassCSP: true, ignoreHTTPSErrors: process.env.REVIEW_IGNORE_HTTPS_ERRORS === "1" });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  const findings: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const anonymous = await context.request.get("/en/lessons/candles-foundation", { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
    const loginRedirect = new URL(anonymous.headers().location, baseURL);
    expect(loginRedirect.pathname).toBe("/en/login");
    expect(loginRedirect.searchParams.get("redirectTo")).toBe("/en/lessons/candles-foundation");
    expect((await context.request.post("/api/auth/login", { data: { email: world.seller.email, password: world.seller.password } })).ok()).toBe(true);
    for (const locale of ["en", "ar"]) {
      const ar = locale === "ar";
      await page.goto(`/${locale}/academy`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const hub = page.getByTestId("academy-student-hub");
      await expect(hub).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await hub.locator('[class*="welcomeEmoji"]').evaluate(el => getComputedStyle(el).animationName)).toBe("none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      expect(await hub.locator('[class*="welcomeEmoji"]').evaluate(el => getComputedStyle(el).animationIterationCount)).toBe("1");
      await page.getByRole("button", { name: ar ? "المحفوظة" : "Saved", exact: true }).click();
      await expect(page.locator("#courses-overview ol li")).toHaveCount(0);
      await page.getByRole("button", { name: ar ? "عرض كل الدروس" : "Show all lessons" }).click();
      await expect(page.locator("#courses-overview ol li")).toHaveCount(lessons.length);
      const pathLinks = await page.locator("#courses-overview ol a").evaluateAll(nodes => nodes.map(node => new URL((node as HTMLAnchorElement).href).pathname));
      expect(pathLinks).toEqual(lessons.map(lesson => `/${locale}/lessons/${lesson.slug}`));
      for (const [index, lesson] of lessons.entries()) {
        console.log(`Checking ${locale}: ${lesson.slug}`);
        await page.goto(`/${locale}/lessons/${lesson.slug}`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const progress = () => page.evaluate(id => JSON.parse(localStorage.getItem("alpha-traders:lesson-progress") || "{}")[id], lesson.id);
        const video = page.locator("video");
        await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 60000 }).toBeGreaterThan(0);
        const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
        expect(duration).toBeGreaterThan(30);
        await video.evaluate(async (el: HTMLVideoElement) => { el.muted = true; await el.play(); });
        await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
        await video.evaluate((el: HTMLVideoElement) => el.pause());
        await page.getByText(ar ? "مواضيع الفيديو" : "Video topics", { exact: true }).click();
        await expect(page.getByText(ar ? lesson.assets.videoChapters[0].titleAr : lesson.assets.videoChapters[0].title, { exact: true }).first()).toBeVisible();
        const overview = page.getByRole("tab", { name: ar ? "الملخّص" : "Overview", exact: true });
        await overview.focus();
        await page.keyboard.press(ar ? "ArrowLeft" : "ArrowRight");
        await expect(page.getByRole("tab", { name: ar ? "التطبيق" : "Practice", exact: true })).toBeFocused();
        await expect(page.locator("#lesson-visuals")).toBeVisible();
        await expect.poll(() => page.locator("#lesson-visuals img").evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
        await page.getByRole("tab", { name: ar ? "الملفات" : "Workbook", exact: true }).click();
        const pdfResponse = await context.request.get(lesson.assets.pdfUrl);
        expect(pdfResponse.status(), `${lesson.slug} workbook`).toBe(200);
        expect((await pdfResponse.body()).subarray(0, 4).toString()).toBe("%PDF");
        await pdfResponse.dispose();
        const inlinePdf = await page.evaluate(() => navigator.pdfViewerEnabled !== false);
        if (inlinePdf) await expect(page.locator("#lesson-workbook iframe")).toBeVisible();
        else await expect(page.getByText(ar ? "افتح ملف العمل أو نزّله لقراءته على جهازك." : "Open or download the workbook to read it on your device.")).toBeVisible();
        const openedPdf = context.waitForEvent("request", { predicate: req => new URL(req.url()).pathname === lesson.assets.pdfUrl && req.isNavigationRequest() });
        await page.getByRole("button", { name: ar ? "القراءة أونلاين" : "Read Online", exact: true }).click();
        await openedPdf;
        await expect.poll(async () => (await progress())?.pdfOpened).toBe(true);
        for (const popup of context.pages().filter(item => item !== page)) await popup.close();
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: ar ? "تنزيل PDF" : "Download PDF", exact: true }).click()]);
        expect(await download.failure()).toBeNull();
        const fullscreen = page.getByRole("button", { name: ar ? "ملء الشاشة" : "Fullscreen", exact: true });
        if (await fullscreen.isVisible()) {
          await fullscreen.click();
          await expect(page.getByRole("button", { name: ar ? "تصغير" : "Exit Fullscreen", exact: true })).toBeVisible();
          await page.evaluate(() => document.exitFullscreen());
          await expect(fullscreen).toBeVisible();
          await fullscreen.click();
          await page.getByRole("button", { name: ar ? "تصغير" : "Exit Fullscreen", exact: true }).click();
          await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
        }
        for (const resource of lesson.assets.resources) {
          const href = resolveLessonResourceUrl(resource.url);
          await expect(page.locator("#lesson-workbook").getByRole("link", { name: ar ? resource.labelAr : resource.label, exact: true })).toHaveAttribute("href", href);
          // Playback is checked above; HEAD avoids retaining entire media files in the test runner.
          const asset = await context.request.head(href);
          expect([200, 206], `${lesson.slug}: ${resource.label}`).toContain(asset.status());
          await asset.dispose();
        }
        await page.getByRole("tab", { name: ar ? "ملاحظاتي" : "My notes", exact: true }).click();
        const note = `${locale}: ${lesson.slug} saved before leaving!`;
        await page.getByRole("textbox", { name: ar ? "ملاحظات الدرس" : "Lesson notes" }).fill(note);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: ar ? "افتح ملاحظاتي" : "Open my notes" }).click();
        await expect(page.getByRole("textbox", { name: ar ? "ملاحظات الدرس" : "Lesson notes" })).toHaveValue(note);
        await expect(page.getByRole("tab", { name: ar ? "ملاحظاتي" : "My notes", exact: true })).toBeFocused();
        await page.getByRole("tab", { name: ar ? "الاختبار" : "Quiz", exact: true }).click();
        await expect(page.getByRole("button", { name: ar ? "إرسال الاختبار" : "Submit Quiz" })).toBeDisabled();
        for (const q of lesson.quiz) await page.locator(`input[name="${q.id}"]`).nth((q.correctIndex + 1) % q.options.length).check();
        await page.getByRole("button", { name: ar ? "إرسال الاختبار" : "Submit Quiz" }).click();
        await expect.poll(async () => (await progress())?.quizScore).toBe(0);
        expect((await progress()).lessonCompleted).toBe(false);
        await page.getByRole("button", { name: ar ? "إعادة المحاولة" : "Retry", exact: true }).click();
        await expect(page.locator("#lesson-quiz input:checked")).toHaveCount(0);
        await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 60000 }).toBeGreaterThan(0);
        // Seek the real recording to its end to exercise the native ended callback.
        await video.evaluate(async (el: HTMLVideoElement) => { el.muted = true; el.currentTime = el.duration - .3; await el.play(); });
        await expect.poll(async () => (await progress())?.videoWatched, { timeout: 45000 }).toBe(true);
        for (const q of lesson.quiz) await page.locator(`input[name="${q.id}"]`).nth(q.correctIndex).check();
        await page.getByRole("button", { name: ar ? "إرسال الاختبار" : "Submit Quiz" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        expect((await progress()).lessonCompleted).toBe(true);
        expect((await progress()).quizScore).toBe(100);
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Shift+Tab");
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.getByRole("dialog")).toHaveCount(0);
        if (index > 0) {
          await page.getByRole("link", { name: ar ? "الدرس السابق" : "Previous lesson", exact: true }).click();
          await expect(page).toHaveURL(new RegExp(`${lessons[index - 1].slug}$`));
          await page.goBack({ waitUntil: "domcontentloaded" });
        }
        await page.getByRole("link", { name: index === lessons.length - 1 ? (ar ? "العودة للمسار" : "Back to my path") : (ar ? "الدرس التالي" : "Next lesson"), exact: true }).click();
        await expect(page).toHaveURL(new RegExp(index === lessons.length - 1 ? `/${locale}/academy$` : `${lessons[index + 1].slug}$`));
        findings.push(`${locale}/${lesson.slug}: video ${Math.round(duration)}s, artwork, keyboard tabs, PDF, download, resources, fullscreen exit, immediate notes, quiz failure/retry/pass, completion focus, and next/previous links passed.`);
      }
      await expect(page.getByRole("link", { name: ar ? "راجع الدروس" : "Review lessons", exact: true })).toBeVisible();
      await expect(page.getByRole("progressbar", { name: ar ? "تقدم التعلّم" : "Learning progress" })).toHaveAttribute("aria-valuenow", "100");
      await page.getByRole("link", { name: ar ? "عرض تقدّمي" : "View my progress", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/academy/dashboard$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect((await context.request.get(`/${locale}/academy/alpha-traders-complete-strategy`)).status()).toBe(200);
      expect((await context.request.get(`/${locale}/learn-with-mark`)).status()).toBe(200);
      await page.evaluate(() => localStorage.clear());
      findings.push(`${locale}: reduced motion, saved empty state, all catalog links, course entry, dashboard, completed journey, and mentorship destination passed.`);
    }
    expect(errors).toEqual([]);
    await writeFile(`${out}/release-verification.json`, JSON.stringify({ findings, errors }, null, 2));
    console.log(JSON.stringify({ findings, errors }, null, 2));
  } finally {
    await browser.close();
    await api.dispose();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
