import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb, PurchaseRequest } from "../src/types/alpha-exchange";

const supportHeaders = { "x-alpha-test-support": "enabled" };
const prefix = "e2e-owner-override-";
const requestId = `${prefix}request`;
const listingId = `${prefix}listing`;
const endpoint = `/api/alpha-exchange/admin/purchase-requests/${requestId}`;
const reason = "Bank declined the withdrawal code; seller received no money and no USDT was delivered";

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
    headers: { "x-forwarded-for": "198.51.100.96" },
    data: { email, password: process.env[`E2E_${role}_PASSWORD`], rememberMe: false },
  });
  expect(response.ok()).toBe(true);
}

function removeFixture(db: AlphaExchangeDb) {
  db.purchaseRequests = db.purchaseRequests.filter(item => item.id !== requestId);
  db.marketplaceListings = db.marketplaceListings.filter(item => item.id !== listingId);
  db.disputes = db.disputes.filter(item => item.purchaseRequestId !== requestId);
  db.tradeMessages = (db.tradeMessages ?? []).filter(item => item.purchaseRequestId !== requestId);
  db.tradeEvidenceFiles = db.tradeEvidenceFiles.filter(item => item.purchaseRequestId !== requestId);
  db.commissionRecords = db.commissionRecords.filter(item => item.purchaseRequestId !== requestId);
  db.auditLogs = db.auditLogs.filter(item => item.purchaseRequestId !== requestId);
  db.notifications = db.notifications.filter(item => item.relatedRequestId !== requestId);
}

test.describe("Owner payment-stage overrides", () => {
  test.beforeEach(async ({ request, baseURL }) => {
    expect(new URL(baseURL!).hostname).toBe("localhost");
    const db = await readFixture(request);
    removeFixture(db);
    const template = db.marketplaceListings.find(item => item.id === "e2e-global-seller-listing")!;
    const buyer = db.users.find(item => item.email === process.env.E2E_BUYER_EMAIL)!;
    expect(template).toBeTruthy();
    expect(buyer).toBeTruthy();
    const now = new Date().toISOString();
    db.marketplaceListings.push({ ...template, id: listingId, availableAmount: "1000", status: "in_trade", activeTradeRequestId: requestId });
    db.purchaseRequests.push({
      id: requestId, tradeId: `${prefix}trade`, displayNumber: 9801,
      listingId, sellerId: template.sellerId, buyerId: buyer.id, buyerName: buyer.fullName,
      usdtAmount: "250", fiatAmount: "800", pricePerUsdt: "3.20", currency: "ILS", network: "TRC20",
      paymentMethod: "Cardless ATM Withdrawal", status: "accepted", timeline: [],
      sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: now,
      createdAt: now, updatedAt: now,
      actionReminderState: { stage: "accepted", actionStartedAt: now, seller: { userId: template.sellerId, lastSentAt: now, reminderCount: 1 } },
    } satisfies PurchaseRequest);
    db.disputes.push({ id: `${prefix}dispute`, tradeId: `${prefix}trade`, purchaseRequestId: requestId,
      openedByUserId: template.sellerId, sellerId: template.sellerId, buyerId: buyer.id,
      reason: "ATM declined the code; cash was not received", status: "open", createdAt: now, updatedAt: now });
    await writeFixture(request, db);
  });

  for (const locale of ["en", "ar"] as const) {
    test(`owner cancels a disclosed ATM code on ${locale} mobile and retains the decision after reload`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await login(page.request, "OWNER");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/trade-room/${requestId}?view=history`);
      const actions = page.locator("#owner-trade-actions");
      const cancel = actions.getByRole("button", { name: locale === "ar" ? "إلغاء الصفقة" : "Cancel trade", exact: true });
      await expect(cancel).toBeEnabled();
      await expect(actions.getByRole("button", { name: locale === "ar" ? "تحديد الصفقة كمكتملة" : "Mark as completed", exact: true })).toBeEnabled();
      await actions.scrollIntoViewIfNeeded();
      await actions.screenshot({ path: testInfo.outputPath(`owner-trades-actions-${locale}-mobile.png`) });
      const bounds = await actions.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await cancel.click();
      await actions.getByLabel(locale === "ar" ? "السبب" : "Reason", { exact: true }).fill(reason);
      const saved = page.waitForResponse(response => response.url().endsWith(`${endpoint}/force-close`) && response.request().method() === "POST");
      await actions.getByRole("button", { name: locale === "ar" ? "تأكيد الإجراء" : "Confirm action", exact: true }).click();
      expect((await saved).ok()).toBe(true);
      await expect(cancel).toBeDisabled();
      await expect(actions.getByRole("status")).toContainText(locale === "ar" ? "تم حفظ الإجراء والتحقق" : "Current trade state verified");
      const after = await readFixture(page.request);
      expect(after.purchaseRequests.find(item => item.id === requestId)).toMatchObject({
        status: "cancelled", closeReason: reason, closedByUserId: "e2e-global-owner",
      });
      expect(after.purchaseRequests.find(item => item.id === requestId)?.actionReminderState).toBeUndefined();
      expect(after.marketplaceListings.find(item => item.id === listingId)).toMatchObject({ availableAmount: "1000" });
      expect(after.marketplaceListings.find(item => item.id === listingId)?.activeTradeRequestId).toBeUndefined();
      expect(after.commissionRecords.filter(item => item.purchaseRequestId === requestId)).toHaveLength(0);
      expect(after.disputes.find(item => item.purchaseRequestId === requestId)).toMatchObject({ status: "resolved", resolutionNotes: reason });
      expect(after.auditLogs.filter(item => item.purchaseRequestId === requestId && item.details?.includes("Owner cancelled trade"))).toHaveLength(1);
      await page.reload();
      await expect(page.locator("main header").getByText(locale === "ar" ? "ملغاة" : "Cancelled", { exact: true })).toBeVisible();
      await expect(cancel).toBeDisabled();
      await expect(actions.getByRole("button", { name: locale === "ar" ? "تحديد الصفقة كمكتملة" : "Mark as completed", exact: true })).toBeEnabled();
      expect(errors).toEqual([]);
    });
  }

  test("owner override endpoints deny all other roles and keep ordinary cancellation guarded", async ({ playwright, request, baseURL }) => {
    const before = await readFixture(request);
    for (const role of [null, "BUYER", "SELLER", "ADMIN"]) {
      const api = await playwright.request.newContext({ baseURL });
      try {
        if (role) await login(api, role);
        const response = await api.post(`${endpoint}/force-close`, { data: { reason, ownerOnly: true, actorRole: "owner" } });
        expect(response.status()).toBe(role ? 403 : 401);
        if (role === "ADMIN") {
          const normal = await api.post(`${endpoint}/force-cancel`, { data: { reason, ownerOnly: true, actorRole: "owner" } });
          expect(normal.status()).toBe(400);
        }
      } finally { await api.dispose(); }
    }
    const after = await readFixture(request);
    expect(after.purchaseRequests.find(item => item.id === requestId)).toEqual(before.purchaseRequests.find(item => item.id === requestId));
    expect(after.commissionRecords).toEqual(before.commissionRecords);
  });

  test.afterEach(async ({ request }) => {
    const db = await readFixture(request);
    removeFixture(db);
    await writeFixture(request, db);
  });
});
