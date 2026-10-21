import { expect, test, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";
import type { AlphaExchangeDb, PurchaseRequest } from "../src/types/alpha-exchange";

const headers = { "x-alpha-test-support": "enabled" };
const prefix = "e2e-receipt-viewer-";
async function readFixture(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers });
  expect(response.ok()).toBe(true);
  return await response.json() as AlphaExchangeDb;
}
async function writeFixture(api: APIRequestContext, db: AlphaExchangeDb) {
  expect((await api.put("/api/testing/alpha-exchange-state", { headers, data: db })).ok()).toBe(true);
}
async function login(api: APIRequestContext, role: "BUYER" | "SELLER" | "OWNER") {
  const email = process.env[`E2E_${role}_EMAIL`];
  expect(email).toMatch(/@example\.test$/);
  const response = await api.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.106" },
    data: { email, password: process.env[`E2E_${role}_PASSWORD`], rememberMe: false } });
  expect(response.ok()).toBe(true);
}

test.afterEach(async ({ request }) => {
  const db = await readFixture(request);
  db.purchaseRequests = db.purchaseRequests.filter(trade => !trade.id.startsWith(prefix));
  db.tradeEvidenceFiles = db.tradeEvidenceFiles.filter(file => !file.purchaseRequestId.startsWith(prefix));
  await writeFixture(request, db);
});

for (const role of ["BUYER", "SELLER", "OWNER"] as const) {
  for (const locale of ["en", "ar"] as const) {
    test(`${locale} ${role} can open and close private receipt photos on phone and desktop`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      expect(new URL(baseURL!).hostname).toBe("localhost");
      const db = await readFixture(page.request);
      const buyer = db.users.find(user => user.email === process.env.E2E_BUYER_EMAIL)!;
      const seller = db.users.find(user => user.email === process.env.E2E_SELLER_EMAIL)!;
      const now = new Date().toISOString();
      const requestId = `${prefix}${role.toLowerCase()}-${locale}`;
      const trade = { id: requestId, tradeId: `${requestId}-trade`, displayNumber: 9920,
        listingId: "e2e-global-seller-listing", sellerId: seller.id, buyerId: buyer.id, buyerName: "Synthetic buyer",
        usdtAmount: "100", pricePerUsdt: "3.20", fiatAmount: "323.20", currency: "ILS", network: "TRC20",
        paymentMethod: "Bank Transfer", status: "accepted", timeline: [], acceptedAt: now, createdAt: now, updatedAt: now,
      } as PurchaseRequest;
      db.purchaseRequests.push(trade);
      await writeFixture(page.request, db);
      // Upload through the authenticated API; the viewer must fetch the real private bytes.
      const bytes = await sharp({ create: { width: 320, height: 2400, channels: 4, background: "#d4af37" } }).png().toBuffer();
      const upload = async (side: "buyer" | "seller") => {
        const response = await page.request.post(`/api/alpha-exchange/purchase-requests/${requestId}/evidence`, {
          data: { side, fileName: `${side}-receipt.png`, mimeType: "image/png", sizeBytes: bytes.length, fileData: `data:image/png;base64,${bytes.toString("base64")}` },
        });
        expect(response.ok(), await response.text()).toBe(true);
      };
      await login(page.request, "BUYER");
      await upload("buyer");
      const afterBuyer = await readFixture(page.request);
      const saved = afterBuyer.purchaseRequests.find(item => item.id === requestId)!;
      expect(saved.buyerEvidence).toBeTruthy();
      // This browser test isolates viewing at the seller-release stage; the database harness tests the lifecycle transitions.
      saved.status = "usdt_release_pending";
      saved.fundsReceivedAt = now;
      await writeFixture(page.request, afterBuyer);
      await login(page.request, "SELLER");
      await upload("seller");
      await login(page.request, role);
      const roomResponse = await page.request.get(`/api/alpha-exchange/trade-room/${requestId}${role === "OWNER" ? "?view=history" : ""}`);
      expect(roomResponse.ok()).toBe(true);
      const room = await roomResponse.json();
      const names = {
        buyer: role === "OWNER" ? room.ownerHistory.evidenceFiles.find((file: { side: string }) => file.side === "buyer").fileName : room.request.buyerEvidence.fileName,
        seller: role === "OWNER" ? room.ownerHistory.evidenceFiles.find((file: { side: string }) => file.side === "seller").fileName : room.request.sellerEvidence.fileName,
      };
      const url = `/${locale}/trade-room/${requestId}${role === "OWNER" ? "?view=history" : ""}`;
      await page.goto(url);
      const originalUrl = page.url();
      const pages = page.context().pages().length;
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        for (const side of ["buyer", "seller"] as const) {
          const trigger = page.getByRole("button", { name: names[side], exact: true });
          await trigger.click();
          const viewer = page.getByRole("dialog", { name: names[side], exact: true });
          await expect(viewer).toBeVisible();
          const image = viewer.getByRole("img", { name: names[side], exact: true });
          await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalHeight === 2400)).toBe(true);
          const close = viewer.getByRole("button", { name: locale === "ar" ? "إغلاق" : "Close", exact: true });
          await expect(close).toBeFocused();
          const box = await close.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
          await close.click();
          await expect(viewer).toHaveCount(0);
          await expect(trigger).toBeFocused();
          expect(page.url()).toBe(originalUrl);
          expect(page.context().pages()).toHaveLength(pages);
        }
      }
      const trigger = page.getByRole("button", { name: names.buyer, exact: true });
      await trigger.click();
      const viewer = page.getByRole("dialog", { name: names.buyer, exact: true });
      await page.keyboard.press("Tab");
      await expect(viewer.getByRole("link")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(viewer.getByRole("button", { name: locale === "ar" ? "إغلاق" : "Close" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.mouse.click(2, 2);
      await expect(viewer).toHaveCount(0);
      expect(page.url()).toBe(originalUrl);
      if (role === "OWNER") {
        await page.goto(`/${locale}/admin/alpha-exchange?section=purchase-requests&requestId=${requestId}&details=1`);
        const ownerTrigger = page.getByRole("button", { name: /buyer.*\.png/ });
        await ownerTrigger.click();
        await expect(page.getByRole("dialog", { name: /buyer.*\.png/ })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: /buyer.*\.png/ })).toHaveCount(0);
        // Closing the nested viewer must preserve the owner's underlying trade details.
        await expect(ownerTrigger).toBeVisible();
        await expect(ownerTrigger).toBeFocused();
      }
    });
  }
}
