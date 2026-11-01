import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb, PurchaseRequest } from "../src/types/alpha-exchange";

const headers = { "x-alpha-test-support": "enabled" };
const prefix = "e2e-participant-entry-";
async function readFixture(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers });
  expect(response.ok()).toBe(true);
  return await response.json() as AlphaExchangeDb;
}
async function writeFixture(api: APIRequestContext, db: AlphaExchangeDb) {
  expect((await api.put("/api/testing/alpha-exchange-state", { headers, data: db })).ok()).toBe(true);
}

test.afterEach(async ({ request }) => {
  const db = await readFixture(request);
  db.purchaseRequests = db.purchaseRequests.filter(trade => !trade.id.startsWith(prefix));
  await writeFixture(request, db);
});

for (const role of ["GUEST", "STUDENT"] as const) {
  for (const locale of ["en", "ar"] as const) {
    test(`${locale} ${role} participant opens the room on the first click on phone and desktop`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      expect(new URL(baseURL!).hostname).toBe("localhost");
      const email = process.env[`E2E_${role}_EMAIL`];
      expect(email).toMatch(/@example\.test$/);
      const db = await readFixture(page.request);
      const participant = db.users.find(user => user.email === email)!;
      expect(participant.role).toBe(role.toLowerCase());
      const now = new Date().toISOString();
      const requestId = `${prefix}${role.toLowerCase()}`;
      const ownTrade = {
        id: requestId, tradeId: `${requestId}-trade`, displayNumber: 9917,
        listingId: "e2e-global-seller-listing", sellerId: "e2e-global-seller", buyerId: participant.id,
        buyerName: "Private participant", usdtAmount: "250", fiatAmount: "900", currency: "ILS", network: "TRC20",
        paymentMethod: "Bank Transfer", status: "accepted", timeline: [], acceptedAt: now, createdAt: now, updatedAt: now,
      } as PurchaseRequest;
      db.purchaseRequests = db.purchaseRequests.filter(trade => !trade.id.startsWith(prefix));
      db.purchaseRequests.push(ownTrade, { ...ownTrade, id: `${prefix}unrelated`, tradeId: `${prefix}unrelated-trade`, displayNumber: 9918, buyerId: "e2e-global-admin" });
      await writeFixture(page.request, db);
      const login = await page.request.post("/api/auth/login", {
        headers: { "x-forwarded-for": "198.51.100.97" },
        data: { email, password: process.env[`E2E_${role}_PASSWORD`], rememberMe: false },
      });
      expect(login.ok()).toBe(true);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}/profile`);
        const banner = page.getByTestId("trade-header-notice");
        await expect(banner).toContainText("9917");
        await banner.getByRole("link").click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/trade-room/${requestId}$`));
        await expect(page.getByTestId("trade-room-summary")).toContainText("009917");
        await expect(banner).toHaveCount(0);
        const room = await page.request.get(`/api/alpha-exchange/trade-room/${requestId}`);
        expect(room.status()).toBe(200);
        expect((await room.json()).request.id).toBe(requestId);
      }
      await page.goto(`/${locale}/trade-room`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/trade-room/${requestId}$`));
      await expect(page.getByTestId("trade-room-summary")).toContainText("009917");
      await page.goto(`/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/trade-room/${requestId}`)}`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/trade-room/${requestId}$`));
      await page.goto(`/${locale}/trade-room/${prefix}unrelated`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/profile$`));
      expect((await page.request.get(`/api/alpha-exchange/trade-room/${prefix}unrelated`)).status()).toBe(403);
    });
  }
}
