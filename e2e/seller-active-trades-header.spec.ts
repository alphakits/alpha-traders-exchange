import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb, PurchaseRequest } from "../src/types/alpha-exchange";

const headers = { "x-alpha-test-support": "enabled" };
const prefix = "e2e-seller-header-";
const endpoint = "/api/alpha-exchange/seller/active-trades";
async function readFixture(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers });
  expect(response.ok()).toBe(true);
  return await response.json() as AlphaExchangeDb;
}
async function writeFixture(api: APIRequestContext, db: AlphaExchangeDb) {
  expect((await api.put("/api/testing/alpha-exchange-state", { headers, data: db })).ok()).toBe(true);
}
async function login(api: APIRequestContext, role = "SELLER") {
  const email = process.env[`E2E_${role}_EMAIL`];
  expect(email).toMatch(/@example\.test$/);
  const response = await api.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.96" },
    data: { email, password: process.env[`E2E_${role}_PASSWORD`], rememberMe: false },
  });
  expect(response.ok()).toBe(true);
}

test.describe("Seller active trade stack", () => {
  test.beforeEach(async ({ request, baseURL }) => {
    expect(new URL(baseURL!).hostname).toBe("localhost");
    const db = await readFixture(request);
    const template = db.users.find(user => user.id === "e2e-global-admin")!;
    db.users = db.users.filter(user => !user.id.startsWith(prefix));
    db.purchaseRequests = db.purchaseRequests.filter(trade => !trade.id.startsWith(prefix));
    for (const index of [1, 2, 3, 4]) {
      const buyerId = `${prefix}buyer-${index}`;
      const now = new Date(Date.now() - (4 - index) * 1000).toISOString();
      db.users.push({ ...template, id: buyerId, email: `${buyerId}@example.test`, fullName: `Private Header Buyer ${index}`, role: "buyer", roles: ["buyer"] });
      db.purchaseRequests.push({
        id: `${prefix}${index}`, tradeId: `${prefix}trade-${index}`, displayNumber: 9800 + index,
        listingId: "e2e-global-seller-listing", sellerId: index === 4 ? "e2e-global-admin" : "e2e-global-seller",
        buyerId, buyerName: `Private Header Buyer ${index}`,
        usdtAmount: `${200 + index * 10}`, fiatAmount: `${700 + index * 10}`, currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
        status: index === 2 ? "payment_sent" : index === 3 ? "usdt_release_pending" : "accepted",
        timeline: [], createdAt: now, updatedAt: now,
      } as PurchaseRequest);
    }
    await writeFixture(request, db);
  });

  for (const locale of ["en", "ar"] as const) {
    test(`three separate ${locale} trades on mobile and desktop with safe room switching`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await login(page.request);
      const response = await page.request.get(endpoint);
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      expect(payload.trades.map((trade: PurchaseRequest) => trade.id)).toEqual([1, 2, 3].map(index => `${prefix}${index}`));
      expect(JSON.stringify(payload)).not.toContain("Private Header");
      await page.goto(`/${locale}`);
      const header = page.getByTestId("seller-active-trades");
      const trigger = header.getByRole("button");
      const panel = header.getByRole("region");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      for (const { width, height } of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
        await page.setViewportSize({ width, height });
        const closed = await header.boundingBox();
        expect(closed!.height).toBeLessThanOrEqual(56);
        await trigger.click();
        await expect(panel).toBeVisible();
        await expect(panel.getByRole("listitem")).toHaveCount(3);
        for (const index of [1, 2, 3]) {
          const card = panel.locator(`[data-trade-id="${prefix}${index}"]`);
          await expect(card).toContainText(`#TR-00980${index}`);
          await expect(card).toContainText(payload.trades[index - 1].buyerName);
          await expect(card.getByRole("link")).toHaveAttribute("href", `/${locale}/trade-room/${prefix}${index}`);
        }
        expect((await header.boundingBox())!.height).toBe(closed!.height);
        const geometry = await panel.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, bottom: element.getBoundingClientRect().bottom, viewport: document.documentElement.clientWidth, width: element.scrollWidth, available: element.clientWidth }));
        expect(geometry.left).toBeGreaterThanOrEqual(-1);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.width).toBeLessThanOrEqual(geometry.available + 1);
        expect(geometry.bottom).toBeLessThan(height - 64);
        if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`seller-trades-${locale}-${width}.png`) });
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const chat = page.getByPlaceholder(locale === "ar" ? "اكتب رسالة..." : "Type a message...");
      for (const index of [1, 2, 3]) {
        await trigger.click();
        await panel.locator(`[data-trade-id="${prefix}${index}"]`).getByRole("link").click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/trade-room/${prefix}${index}$`));
        await expect(page.locator("h1")).toContainText(`#TR-00980${index}`);
        await expect(panel).toBeHidden();
        await expect(chat).toHaveValue("");
        await chat.fill(`Unsent draft for trade ${index}`);
        await trigger.click();
        await expect(panel.locator(`[data-trade-id="${prefix}${index}"] [aria-current="page"]`)).toBeVisible();
        await expect(panel.getByRole("link")).toHaveCount(2);
        await page.keyboard.press("Escape");
      }
      const db = await readFixture(page.request);
      db.purchaseRequests = db.purchaseRequests.map(trade => trade.id === `${prefix}1` ? { ...trade, status: "completed", updatedAt: new Date().toISOString() } : trade);
      await writeFixture(page.request, db);
      await expect(header.locator(`[data-trade-id="${prefix}1"]`)).toHaveCount(0, { timeout: 25_000 });
      await trigger.click();
      await expect(panel.getByRole("listitem")).toHaveCount(2);
      await expect(panel.locator(`[data-trade-id="${prefix}2"]`)).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test.describe("touch scrolling", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    for (const locale of ["en", "ar"] as const) {
      test(`keeps ${locale} scrolling responsive through refresh, rotation and retry`, async ({ page, context, browserName }, testInfo) => {
        test.skip(browserName !== "chromium", "Touch gestures use Chromium's input protocol.");
        test.setTimeout(120_000);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await login(page.request);
        await page.goto(`/${locale}`);
        const header = page.getByTestId("seller-active-trades");
        const trigger = header.getByRole("button");
        const panel = header.getByRole("region");
        const cdp = await context.newCDPSession(page);
        const swipe = async (x: number, top: number, height: number, distance: number) => {
          let remaining = Math.abs(distance);
          while (remaining > 0) {
            const travel = Math.min(remaining, height - 40);
            const start = distance < 0 ? top + height - 20 : top + 20;
            const direction = distance < 0 ? -1 : 1;
            const point = (y: number) => [{ x, y, id: 1 }];
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(start) });
            for (let step = 1; step <= 10; step++) {
              await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(start + direction * travel * step / 10) });
              // Pace actual input events; assertions below wait for observable scroll state.
              await page.waitForTimeout(16);
            }
            await page.waitForTimeout(120);
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            remaining -= travel;
          }
        };
        const swipePanel = async (distance: number) => {
          const box = (await panel.boundingBox())!;
          await swipe(box.x + box.width / 2, box.y, box.height, distance);
        };
        const scrollTop = () => panel.evaluate(element => element.scrollTop);
        const expectPanelFits = async () => {
          const bounds = (await panel.boundingBox())!;
          const footer = (await page.getByRole("navigation", { name: locale === "ar" ? "التنقل الرئيسي للهاتف" : "Mobile primary navigation" }).boundingBox())!;
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(footer.y - 4);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        };
        await trigger.tap();
        await expect(panel).toBeVisible();
        const headerHeight = (await header.boundingBox())!.height;
        await expectPanelFits();
        for (let repeat = 0; repeat < 3; repeat++) {
          await swipePanel(-900);
          await expect.poll(scrollTop).toBeGreaterThan(100);
          const bottom = await scrollTop();
          await swipePanel(-300);
          expect(Math.abs((await scrollTop()) - bottom)).toBeLessThanOrEqual(1);
          expect(await page.evaluate(() => window.scrollY)).toBe(0);
          await swipePanel(900);
          await expect.poll(scrollTop).toBe(0);
          await swipePanel(300);
          expect(await page.evaluate(() => window.scrollY)).toBe(0);
          await expect(trigger).toHaveAttribute("aria-expanded", "true");
        }

        await swipePanel(-180);
        const beforeRefresh = await scrollTop();
        const db = await readFixture(page.request);
        db.purchaseRequests = db.purchaseRequests.map(trade => trade.id === `${prefix}3` ? { ...trade, usdtAmount: "999", updatedAt: new Date().toISOString() } : trade);
        await writeFixture(page.request, db);
        await expect(panel.locator(`[data-trade-id="${prefix}3"]`)).toContainText("999 USDT", { timeout: 25_000 });
        expect(Math.abs((await scrollTop()) - beforeRefresh)).toBeLessThanOrEqual(1);
        expect((await header.boundingBox())!.height).toBe(headerHeight);
        expect(await panel.locator("li").evaluateAll(cards => cards.map(card => card.getAttribute("data-trade-id")))).toEqual([1, 2, 3].map(index => `${prefix}${index}`));

        // A retry notice must not push the scroll panel under the bottom navigation.
        await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, json: { error: "Synthetic temporary outage" } }));
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await expect(header.getByRole("status")).toBeVisible();
        for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 480 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          await expectPanelFits();
          await swipePanel(-900);
          await expect.poll(scrollTop).toBeGreaterThan(0);
          await swipePanel(900);
          await expect.poll(scrollTop).toBe(0);
          if (viewport.width === 844) await page.screenshot({ path: testInfo.outputPath(`seller-scroll-landscape-${locale}.png`) });
        }
        await page.screenshot({ path: testInfo.outputPath(`seller-scroll-retry-${locale}.png`) });
        await page.unroute(`**${endpoint}`);
        await context.setOffline(true);
        await swipePanel(-900);
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await context.setOffline(false);
        await expect(header.getByRole("status")).toHaveCount(0, { timeout: 20_000 });
        await expect(panel.getByRole("listitem")).toHaveCount(3);

        // Dismissal must release page scrolling, even after repeated touch interactions.
        await page.touchscreen.tap(3, 400);
        await expect(panel).toBeHidden();
        await swipe(180, 200, 500, -500);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
        expect((await page.locator("header").boundingBox())!.y).toBe(0);
        await trigger.tap();
        await expect(panel).toBeVisible();
        const pageScroll = await page.evaluate(() => window.scrollY);
        await swipePanel(900);
        expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
        for (let repeat = 0; repeat < 4; repeat++) {
          await trigger.tap();
          await expect(panel).toBeHidden();
          await trigger.tap();
          await expect(panel).toBeVisible();
        }
        await trigger.tap();
        await swipe(180, 200, 500, 900);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
        await trigger.tap();
        await swipePanel(-900);
        await panel.locator(`[data-trade-id="${prefix}3"]`).getByRole("link").tap();
        await expect(page).toHaveURL(new RegExp(`/${locale}/trade-room/${prefix}3$`));
        await expect(panel).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        await cdp.detach();
      });
    }
  });

  test("reads only the seller's trades and does not change payments or trade state", async ({ request }) => {
    await login(request);
    const before = await readFixture(request);
    const response = await request.get(`${endpoint}?sellerId=e2e-global-admin&includeAll=true`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).toContain("private, no-store");
    const payload = await response.json();
    expect(payload.actorId).toBe("e2e-global-seller");
    expect(payload.trades).toHaveLength(3);
    expect(JSON.stringify(payload)).not.toMatch(/Private Header|sellerBankAccount|buyerReceivingWalletAddress|email|whatsapp/);
    const after = await readFixture(request);
    expect(after.purchaseRequests).toEqual(before.purchaseRequests);
    expect(after.commissionRecords).toEqual(before.commissionRecords);
  });

  test("guests and ordinary buyers cannot read seller navigation", async ({ playwright, baseURL }) => {
    for (const role of [null, "BUYER"]) {
      const api = await playwright.request.newContext({ baseURL });
      try {
        if (role) await login(api, role);
        const response = await api.get(endpoint);
        expect(response.status()).toBe(role ? 403 : 401);
      } finally { await api.dispose(); }
    }
  });

  test.afterEach(async ({ request }) => {
    const db = await readFixture(request);
    db.purchaseRequests = db.purchaseRequests.filter(trade => !trade.id.startsWith(prefix));
    db.users = db.users.filter(user => !user.id.startsWith(prefix));
    await writeFixture(request, db);
  });
});
