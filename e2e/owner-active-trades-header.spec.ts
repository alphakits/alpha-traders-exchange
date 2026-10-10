import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb, PurchaseRequest } from "../src/types/alpha-exchange";

const supportHeaders = { "x-alpha-test-support": "enabled" };
const fixturePrefix = "e2e-owner-header-";
const endpoint = "/api/alpha-exchange/owner/active-trades";
async function readFixture(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: supportHeaders });
  expect(response.ok()).toBe(true);
  return await response.json() as AlphaExchangeDb;
}
async function writeFixture(api: APIRequestContext, db: AlphaExchangeDb) {
  const response = await api.put("/api/testing/alpha-exchange-state", { headers: supportHeaders, data: db });
  expect(response.ok()).toBe(true);
}
async function login(api: APIRequestContext, role: string) {
  const email = process.env[`E2E_${role}_EMAIL`];
  expect(email).toMatch(/@example\.test$/);
  const response = await api.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.95" },
    data: { email, password: process.env[`E2E_${role}_PASSWORD`], rememberMe: false },
  });
  expect(response.ok()).toBe(true);
}

test.describe("Owner active trades in the shared website/app header", () => {
  test.beforeEach(async ({ request, baseURL }) => {
    expect(new URL(baseURL!).hostname).toBe("localhost");
    const db = await readFixture(request);
    const template = db.users.find(user => user.id === "e2e-global-admin")!;
    expect(template).toBeTruthy();
    db.users = db.users.filter(user => !user.id.startsWith(fixturePrefix));
    db.purchaseRequests = db.purchaseRequests.filter(trade => !trade.id.startsWith(fixturePrefix));
    const now = new Date().toISOString();
    for (const index of [1, 2]) {
      const buyerId = `${fixturePrefix}buyer-${index}`;
      db.users.push({ ...template, id: buyerId, email: `${buyerId}@example.test`, fullName: `Header Buyer ${index}`, role: "buyer", roles: ["buyer"] });
      db.purchaseRequests.push({
        id: `${fixturePrefix}${index}`, tradeId: `${fixturePrefix}trade-${index}`, displayNumber: 9700 + index,
        listingId: "e2e-global-seller-listing", sellerId: "e2e-global-seller", buyerId, buyerName: `Header Buyer ${index}`,
        usdtAmount: "250", fiatAmount: "900", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
        status: "accepted", timeline: [], acceptedAt: now, createdAt: now, updatedAt: now,
      } as PurchaseRequest);
    }
    await writeFixture(request, db);
  });

  for (const locale of ["en", "ar"] as const) {
    test(`opens the ${locale} owner active list directly on phone and desktop`, async ({ page }) => {
      test.setTimeout(90_000);
      await login(page.request, "OWNER");
      const db = await readFixture(page.request);
      const template = db.purchaseRequests.find(trade => trade.id === `${fixturePrefix}1`)!;
      db.purchaseRequests.push({ ...template, id: `${fixturePrefix}completed`, tradeId: `${fixturePrefix}trade-completed`, displayNumber: 9799, status: "completed" });
      await writeFixture(page.request, db);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}/usdt-exchange`);
        await page.getByRole("button", { name: locale === "ar" ? "الصفقات النشطة" : "Active Trades", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/admin/alpha-exchange\\?section=purchase-requests&status=active$`));
        await expect(page.getByRole("heading", { name: locale === "ar" ? "الصفقات النشطة" : "Active Trades", exact: true })).toBeVisible();
        const statusFilter = page.getByRole("combobox", { name: locale === "ar" ? "تصفية الصفقات حسب الحالة" : "Filter trades by status" });
        await expect(statusFilter).toHaveValue("active");
        for (const index of [1, 2]) await expect(page.locator(`#purchase-request-${fixturePrefix}${index}`)).toBeVisible();
        await expect(page.locator(`#purchase-request-${fixturePrefix}completed`)).toHaveCount(0);
        await expect(page.getByText(locale === "ar" ? "سجل انتهاء المهلة" : "Timeout History", { exact: true })).toHaveCount(0);
        await statusFilter.selectOption("completed");
        await expect(page.locator(`#purchase-request-${fixturePrefix}completed`)).toBeVisible();
        await expect(page.locator(`#purchase-request-${fixturePrefix}1`)).toHaveCount(0);
        await page.locator(`#purchase-request-${fixturePrefix}completed`).getByRole("button", { name: locale === "ar" ? "عرض التفاصيل" : "View Details", exact: true }).click();
        const details = page.getByRole("dialog", { name: locale === "ar" ? "تفاصيل طلب الشراء" : "Purchase Request Details", exact: true });
        await expect(details).toBeVisible();
        // A page-entry transform previously centered this fixed dialog inside
        // the tall dashboard, placing its controls below the screen.
        await expect.poll(async () => details.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return bounds.top >= -1 && bounds.left >= -1
            && bounds.bottom <= window.innerHeight + 1 && bounds.right <= window.innerWidth + 1;
        })).toBe(true);
        await expect(details.getByRole("link", { name: locale === "ar" ? "فتح سجل غرفة الصفقة" : "Open trade room history", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(details).toHaveCount(0);
      }
    });

    test(`keeps ${locale} header compact, opens both rooms and refreshes completion`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await login(page.request, "OWNER");
      const response = await page.request.get(endpoint);
      expect(response.ok()).toBe(true);
      expect((await response.json()).trades.filter((trade: PurchaseRequest) => trade.id.startsWith(fixturePrefix))).toHaveLength(2);
      await page.goto(`/${locale}`);
      const header = page.getByTestId("owner-active-trades");
      await expect(header).toBeVisible();
      const trigger = header.getByRole("button");
      const panel = header.getByRole("region");
      for (const { width, height } of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
        await page.setViewportSize({ width, height });
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(panel).toBeHidden();
        const closed = await header.boundingBox();
        expect(closed!.height).toBeLessThanOrEqual(56);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath(`owner-trades-${locale}-collapsed-mobile.png`) });
        await trigger.click();
        await expect(panel).toBeVisible();
        await expect(header.locator(`[data-trade-id="${fixturePrefix}1"]`)).toContainText("Header Buyer 1");
        await expect(header.locator(`[data-trade-id="${fixturePrefix}2"]`)).toContainText("Header Buyer 2");
        // Opening the list must not enlarge the sticky header or push the page.
        expect((await header.boundingBox())!.height).toBe(closed!.height);
        const geometry = await panel.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, bottom: element.getBoundingClientRect().bottom, viewport: document.documentElement.clientWidth, width: element.scrollWidth, available: element.clientWidth }));
        expect(geometry.left).toBeGreaterThanOrEqual(-1);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.width).toBeLessThanOrEqual(geometry.available + 1);
        expect(geometry.bottom).toBeLessThan(height - 64);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath(`owner-trades-${locale}-mobile.png`) });
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
      await page.setViewportSize({ width: 390, height: 700 });
      await trigger.click();
      await page.locator("header").click({ position: { x: 2, y: 2 } });
      await expect(panel).toBeHidden();
      for (const index of [1, 2]) {
        await trigger.click();
        await header.locator(`[data-trade-id="${fixturePrefix}${index}"]`).getByRole("link").click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/trade-room/${fixturePrefix}${index}$`));
        await expect(page.locator("h1")).toContainText(`#TR-00970${index}`);
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(panel).toBeHidden();
      }
      const db = await readFixture(page.request);
      db.purchaseRequests = db.purchaseRequests.map(trade => trade.id === `${fixturePrefix}1` ? { ...trade, status: "completed", updatedAt: new Date().toISOString() } : trade);
      await writeFixture(page.request, db);
      await expect(header.locator(`[data-trade-id="${fixturePrefix}1"]`)).toHaveCount(0, { timeout: 25_000 });
      await trigger.click();
      await expect(header.locator(`[data-trade-id="${fixturePrefix}2"]`)).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("keeps many trades in a scrollable panel without growing the sticky header", async ({ page }) => {
    await login(page.request, "OWNER");
    const db = await readFixture(page.request);
    const template = db.purchaseRequests.find(trade => trade.id === `${fixturePrefix}1`)!;
    for (let index = 3; index <= 12; index++) {
      db.purchaseRequests.push({ ...template, id: `${fixturePrefix}${index}`, tradeId: `${fixturePrefix}trade-${index}`, displayNumber: 9700 + index });
    }
    await writeFixture(page.request, db);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/en");
    const header = page.getByTestId("owner-active-trades");
    await expect(header).toBeVisible();
    const trigger = header.getByRole("button");
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(56);
    await trigger.click();
    const panel = header.getByRole("region");
    await expect(panel).toBeVisible();
    const dimensions = await panel.evaluate(element => ({ content: element.scrollHeight, visible: element.clientHeight, bottom: element.getBoundingClientRect().bottom }));
    expect(dimensions.content).toBeGreaterThan(dimensions.visible);
    expect(dimensions.bottom).toBeLessThan(568 - 64);
    const lastTrade = panel.getByRole("link").last();
    const destination = await lastTrade.getAttribute("href");
    await lastTrade.click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("serves both active rooms to the owner without changing trade data", async ({ request }) => {
    await login(request, "OWNER");
    const before = await readFixture(request);
    const response = await request.get(endpoint);
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    const trades = payload.trades.filter((trade: PurchaseRequest) => trade.id.startsWith(fixturePrefix));
    expect(trades).toHaveLength(2);
    expect(trades.map((trade: PurchaseRequest) => trade.buyerName).join(" ")).toContain("Header Buyer 1");
    expect(trades.map((trade: PurchaseRequest) => trade.buyerName).join(" ")).toContain("Header Buyer 2");
    expect(response.headers()["cache-control"]).toContain("private, no-store");
    for (const locale of ["en", "ar"]) {
      const page = await request.get(`/${locale}`);
      expect(page.ok()).toBe(true);
      const html = await page.text();
      expect(html).toContain('data-testid="owner-active-trades"');
      for (const index of [1, 2]) expect(html).toContain(`/${locale}/trade-room/${fixturePrefix}${index}`);
    }
    const after = await readFixture(request);
    expect(after.purchaseRequests).toEqual(before.purchaseRequests);
    expect(after.commissionRecords).toEqual(before.commissionRecords);
  });

  test("denies guests, buyers, sellers and non-owner admins", async ({ playwright, baseURL }) => {
    for (const role of [null, "BUYER", "SELLER", "ADMIN"]) {
      const api = await playwright.request.newContext({ baseURL });
      try {
        if (role) await login(api, role);
        const response = await api.get(endpoint);
        expect(response.status()).toBe(role ? 403 : 401);
        expect(await response.text()).not.toContain("Header Buyer");
      } finally { await api.dispose(); }
    }
  });

  test.afterEach(async ({ request }) => {
    const db = await readFixture(request);
    db.purchaseRequests = db.purchaseRequests.filter(trade => !trade.id.startsWith(fixturePrefix));
    db.users = db.users.filter(user => !user.id.startsWith(fixturePrefix));
    await writeFixture(request, db);
  });
});
