/** Loopback-only review using synthetic accounts and the real academy routes. */
import { chromium, request } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provisionQaWorld } from "../e2e/support/qa-accounts";

async function main() {
  const baseURL = process.env.REVIEW_BASE_URL ?? "http://127.0.0.1:3217";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) throw new Error("Review fixtures require a loopback server.");
  const out = resolve(process.env.REVIEW_OUTPUT_DIR ?? "test-results/academy-review");
  await mkdir(out, { recursive: true });
  const api = await request.newContext({ baseURL, timeout: 120000 });
  const world = await provisionQaWorld(api);
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const proxyAddress = proxyUrl ? new URL(proxyUrl) : null;
  const proxy = proxyAddress ? { server: proxyAddress.origin, bypass: "127.0.0.1,localhost", ...(proxyAddress.username ? { username: decodeURIComponent(proxyAddress.username), password: decodeURIComponent(proxyAddress.password) } : {}) } : undefined;
  const browser = await chromium.launch({
    proxy,
    executablePath: process.env.REVIEW_CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process", "--use-gl=angle", "--use-angle=swiftshader"],
    headless: true,
  });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1040 }, reducedMotion: "reduce", bypassCSP: true, ignoreHTTPSErrors: process.env.REVIEW_IGNORE_HTTPS_ERRORS === "1" });
  expect((await context.request.post("/api/auth/login", { data: { email: world.seller.email, password: world.seller.password } })).ok()).toBe(true);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const findings: string[] = [];
  for (const locale of ["en", "ar"]) {
    await page.goto(`/${locale}/academy`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await expect(page.getByRole("link", { name: locale === "en" ? "Start learning" : "ابدأ التعلّم", exact: true })).toBeVisible();
    const hub = page.getByTestId("academy-student-hub");
    await hub.screenshot({ path: `${out}/academy-desktop-${locale}.png`, animations: "disabled" });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${locale} academy overflow ${width}`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({ path: `${out}/academy-mobile-${locale}.png`, animations: "disabled" });
    await hub.screenshot({path:`${out}/academy-path-mobile-${locale}.png`,animations:"disabled"});
    const search = page.getByRole("textbox", { name: locale === "en" ? "Search lessons" : "ابحث في الدروس" });
    await search.fill("trendline");
    await expect(page.locator("#courses-overview ol li")).toHaveCount(1);
    await search.fill("impossible-topic");
    await expect(page.locator("#courses-overview ol li")).toHaveCount(0);
    await search.fill("");
    await expect(page.locator("#courses-overview ol li")).toHaveCount(5);
    await page.getByRole("link", { name: locale === "en" ? "Start learning" : "ابدأ التعلّم", exact: true }).click();
    await expect(page.getByRole("heading", {level:1})).toBeVisible();
    await expect(page.locator("video")).toHaveCount(1);
    const mediaFailures: string[] = [];
    page.on("requestfailed", req => { if(req.url().includes("lesson-2-candles.mp4")) mediaFailures.push(req.failure()?.errorText || "unknown"); });
    await expect.poll(()=>page.locator("video").evaluate((el: HTMLVideoElement)=>el.readyState), {timeout:60000, message:"Published lesson video metadata"}).toBeGreaterThan(0);
    await page.locator("video").evaluate(async (el: HTMLVideoElement)=>{el.muted=true;await el.play();});
    await expect.poll(()=>page.locator("video").evaluate((el:HTMLVideoElement)=>el.currentTime),{timeout:30000}).toBeGreaterThan(0);
    await page.locator("video").evaluate((el:HTMLVideoElement)=>el.pause());
    findings.push(`${locale}: published lesson video loaded and played.`);
    const videoHandle = await page.locator("video").elementHandle();
    await page.getByRole("tab", {name:locale === "en" ? "My notes" : "ملاحظاتي", exact: true}).click();
    const note = `${locale} review: wait for confirmation before drawing a level.`;
    await page.getByRole("textbox", {name:locale === "en" ? "Lesson notes" : "ملاحظات الدرس"}).fill(note);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("alpha-traders:lesson-progress") || "{}").l102?.notes)).toBe(note);
    await page.getByRole("tab", {name:locale === "en" ? "Practice" : "التطبيق", exact: true}).click();
    expect(await videoHandle?.evaluate(el => el.isConnected)).toBe(true);
    await expect(page.locator("#lesson-visuals")).toBeVisible();
    await page.getByRole("tab",{name:locale==="en"?"Quiz":"الاختبار",exact:true}).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("tab",{name:locale==="en"?"My notes":"ملاحظاتي",exact:true}).click();
    await page.getByRole("tab",{name:locale==="en"?"Quiz":"الاختبار",exact:true}).click();
    await expect(page.getByRole("radio").first()).toBeChecked();
    findings.push(`${locale}: unfinished quiz answers retained when switching to notes and back.`);
    await page.getByRole("tab", {name:locale === "en" ? "Overview" : "الملخّص", exact: true}).click();
    await page.getByRole("button", {name:locale === "en" ? "Bookmark lesson" : "حفظ الدرس", exact: true}).click();
    await page.reload({waitUntil:"domcontentloaded"});
    await expect.poll(()=>page.locator("video").evaluate((el: HTMLVideoElement)=>el.readyState), {timeout:60000}).toBeGreaterThan(0);
    await page.getByRole("tab", {name:locale === "en" ? "My notes" : "ملاحظاتي", exact: true}).click();
    await expect(page.getByRole("textbox", {name:locale === "en" ? "Lesson notes" : "ملاحظات الدرس"})).toHaveValue(note);
    await page.getByRole("tab", {name:locale === "en" ? "Overview" : "الملخّص", exact: true}).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${locale} lesson overflow ${width}`).toBeLessThanOrEqual(1);
    }
    await expect(page.getByText(locale === "en" ? "Loading video..." : "جاري تحميل الفيديو...",{exact:true})).toHaveCount(0);
    await page.locator('[class*="studyShell"]').screenshot({path:`${out}/lesson-desktop-${locale}.png`,animations:"disabled"});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`${out}/lesson-mobile-${locale}.png`,animations:"disabled"});
    await page.goto(`/${locale}/academy`,{waitUntil:"domcontentloaded"});
    await expect(page.getByRole("link",{name:locale==="en"?"Continue learning":"تابع تعلّمك",exact:true})).toBeVisible();
    await page.getByRole("button",{name:locale==="en"?"Saved":"المحفوظة",exact:true}).click();
    await expect(page.locator("#courses-overview ol li")).toHaveCount(1);
    findings.push(`${locale}: start/continue, lesson search, saved lessons, lesson navigation, notes restored after refresh, video preserved across tabs, and 320/390/1440px layouts passed.`);
    await page.evaluate(()=>localStorage.clear());
    await page.setViewportSize({width:1440,height:1040});
  }
  expect(errors).toEqual([]);
  await writeFile(`${out}/verification.json`, JSON.stringify({findings,errors}, null, 2));
  console.log(JSON.stringify({findings,errors}, null, 2));
  await browser.close();
  await api.dispose();
}
main().catch(error=>{console.error(error);process.exit(1);});
